import {
  SupportConversationStatus,
  SupportMessageSenderRole,
  CleaningTaskStatus
} from "@prisma/client";

import {
  getActiveClientByEmail,
  getFinesForEmail,
  getLaundryBookingsForEmailWithOptions,
  readCachedClients,
  ClientRow,
} from "./google-sheets.js";
import { prisma } from "./prisma.js";
import { ASSISTANT_SENDER_EMAIL, runResidentSupportAssistantTurn } from "./resident-support-ai.js";
import { appendSupportAssistantMetaSuffix } from "./support-assistant-message-meta.js";
import { requirePortalRole, resolvePortalLogin } from "./staff-access.js";
import { sendPushToEmail } from "./push.js";
import { getClientGroupContext } from "./group-support.js";
type SupportViewerRoleValue = "RESIDENT" | "STAFF";
type NotificationSummary<TNotification> = {
  unreadCount: number;
  notifications: TNotification[];
};
type CachedNotificationEntry<TNotification> = {
  expiresAt: number;
  value: NotificationSummary<TNotification>;
};

const SUPPORT_NOTIFICATION_CACHE_TTL_MS = Number(
  process.env.SUPPORT_NOTIFICATION_CACHE_TTL_MS ?? 30 * 1000
);
const residentNotificationCache = new Map<string, CachedNotificationEntry<ResidentNotificationItem>>();
const staffNotificationCache = new Map<string, CachedNotificationEntry<{
  id: string;
  type: "SUPPORT_REQUEST";
  conversationId: string;
  residentEmail: string;
  residentName: string | null;
  title: string;
  body: string;
  createdAt: Date;
  unreadCount: number;
  href: string;
}>>();

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function messageTargetsViewer(message: { senderRole: SupportMessageSenderRole }, viewerRole: SupportViewerRoleValue) {
  if (viewerRole === "RESIDENT") {
    return (
      message.senderRole === SupportMessageSenderRole.MANAGER ||
      message.senderRole === SupportMessageSenderRole.OWNER ||
      message.senderRole === SupportMessageSenderRole.ASSISTANT
    );
  }

  return message.senderRole === SupportMessageSenderRole.RESIDENT;
}

export async function isPrivilegedSupportOperator(email: string) {
  const actor = await resolvePortalLogin(email);
  return actor.allowed && actor.role !== "user" && actor.role != null;
}

async function getResidentName(email: string) {
  const client = await getActiveClientByEmail(email);
  const nameCandidate =
    client?.["Họ và tên"] ??
    client?.["HỌ VÀ TÊN"] ??
    client?.["Tên"] ??
    client?.["TÊN"] ??
    null;

  return typeof nameCandidate === "string" && nameCandidate.trim() ? nameCandidate.trim() : null;
}

export async function getOrCreateSupportConversationForResident(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await prisma.supportConversation.findUnique({
    where: { residentEmail: normalizedEmail }
  });

  if (existing) {
    return existing;
  }

  const residentName = await getResidentName(normalizedEmail);

  return prisma.supportConversation.create({
    data: {
      residentEmail: normalizedEmail,
      residentName: residentName ?? undefined
    }
  });
}

export async function getResidentSupportConversation(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const conversation = await prisma.supportConversation.findUnique({
    where: { residentEmail: normalizedEmail }
  });

  if (!conversation) {
    return { conversation: null, messages: [] };
  }

  const messages = await prisma.supportMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" }
  });

  return { conversation, messages };
}

export type StaffInboxItem = {
  id: string; // For DIRECT this is conversationId, for GROUP this is groupId
  type: "DIRECT" | "GROUP";
  label: string; // Name of resident or Group Name (e.g. Branch D7)
  subLabel: string; // Email or Group ID
  status: SupportConversationStatus;
  lastMessageAt: Date;
  unreadCount: number;
  latestMessage: {
    body: string;
    senderName: string | null;
    createdAt: Date;
  } | null;
};

export async function listManagerInbox(operatorEmail: string): Promise<StaffInboxItem[]> {
  const normalizedOperatorEmail = normalizeEmail(operatorEmail);

  // 1. Fetch Direct Support Conversations
  const directConversations = await prisma.supportConversation.findMany({
    where: {
      messages: { some: {} }
    },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    },
    orderBy: { lastMessageAt: "desc" }
  });

  const directConversationIds = directConversations.map(c => c.id);
  const directReadStates = await getReadStatesMap(directConversationIds, normalizedOperatorEmail, "STAFF");

  const directItems: StaffInboxItem[] = directConversations.map(c => {
    const lastRead = directReadStates.get(c.id) || null;
    const unreadMessages = c.messages.filter(m => 
      m.senderRole === SupportMessageSenderRole.RESIDENT && (!lastRead || m.createdAt > lastRead)
    );
    const latest = c.messages[0];

    return {
      id: c.id,
      type: "DIRECT",
      label: c.residentName || c.residentEmail,
      subLabel: c.residentEmail,
      status: c.status,
      lastMessageAt: c.lastMessageAt,
      unreadCount: unreadMessages.length,
      latestMessage: latest ? {
        body: latest.body,
        senderName: latest.senderName,
        createdAt: latest.createdAt
      } : null
    };
  });

  // 2. Derive all potential groups from clients
  const clientCache = await readCachedClients();
  const rows = clientCache?.rows || [];
  
  const potentialGroupIds = new Set<string>();
  rows.forEach((row: ClientRow) => {
    const branch = (row["Chi nhánh Cozoro dorm"] || row["BRANCH"] || "").trim();
    if (!branch) return;
    
    potentialGroupIds.add(`BRANCH_${branch}`);
    
    const floor = (row["Tầng"] || row["TẦNG"] || "").trim();
    if (floor) {
      potentialGroupIds.add(`FLOOR_${branch}_${floor}`);
    }
    
    const room = (row["Số phòng"] || row["SỐ PHÒNG"] || row["Phòng"] || row["PHÒNG"] || "").trim();
    if (room) {
      potentialGroupIds.add(`ROOM_${branch}_${room}`);
    }
  });

  // 3. Fetch Existing Group Conversations
  const groupsWithMessages = await prisma.groupMessage.groupBy({
    by: ['groupId'],
    _max: { createdAt: true }
  });

  const existingGroupIds = new Set(groupsWithMessages.map(g => g.groupId));
  
  // Combine potential groups with those that have messages but might not have active clients (archived)
  const allGroupIds = new Set([...potentialGroupIds, ...existingGroupIds]);

  const groupItems: StaffInboxItem[] = await Promise.all(Array.from(allGroupIds).map(async (groupId) => {
    const latestMessage = await prisma.groupMessage.findFirst({
      where: { groupId },
      orderBy: { createdAt: "desc" }
    });

    const readState = await prisma.groupReadState.findUnique({
      where: { groupId_viewerEmail: { groupId, viewerEmail: normalizedOperatorEmail } }
    });

    const lastRead = readState?.lastReadAt || null;
    const unreadCount = await prisma.groupMessage.count({
      where: {
        groupId,
        senderRole: SupportMessageSenderRole.RESIDENT,
        createdAt: { gt: lastRead || new Date(0) }
      }
    });

    let label = groupId;
    if (groupId.startsWith("BRANCH_")) label = "Branch " + groupId.replace("BRANCH_", "");
    else if (groupId.startsWith("FLOOR_")) {
      const parts = groupId.split("_");
      label = `Floor ${parts[1]}-${parts[2]}`;
    } else if (groupId.startsWith("ROOM_")) {
      const parts = groupId.split("_");
      label = `Room ${parts[2]} (${parts[1]})`;
    }

    return {
      id: groupId,
      type: "GROUP",
      label,
      subLabel: groupId,
      status: SupportConversationStatus.OPEN,
      lastMessageAt: latestMessage?.createdAt || new Date(0),
      unreadCount,
      latestMessage: latestMessage ? {
        body: latestMessage.body,
        senderName: latestMessage.senderName,
        createdAt: latestMessage.createdAt
      } : null
    };
  }));

  // 4. Merge and Sort
  return [...directItems, ...groupItems].sort((a, b) => 
    b.lastMessageAt.getTime() - a.lastMessageAt.getTime() || a.label.localeCompare(b.label)
  );
}

export async function getGroupUnreadCounts(operatorEmail: string): Promise<Record<string, number>> {
  const normalizedOperatorEmail = normalizeEmail(operatorEmail);
  const groupsWithMessages = await prisma.groupMessage.groupBy({
    by: ['groupId']
  });

  const counts: Record<string, number> = {};
  await Promise.all(groupsWithMessages.map(async (g) => {
    const groupId = g.groupId;
    const readState = await prisma.groupReadState.findUnique({
      where: { groupId_viewerEmail: { groupId, viewerEmail: normalizedOperatorEmail } }
    });
    const lastRead = readState?.lastReadAt || null;
    const unreadCount = await prisma.groupMessage.count({
      where: {
        groupId,
        senderRole: SupportMessageSenderRole.RESIDENT,
        createdAt: { gt: lastRead || new Date(0) }
      }
    });
    if (unreadCount > 0) {
      counts[groupId] = unreadCount;
    }
  }));
  return counts;
}



async function getReadState(conversationId: string, viewerEmail: string, viewerRole: SupportViewerRoleValue) {
  return prisma.supportReadState.findUnique({
    where: {
      conversationId_viewerEmail_viewerRole: {
        conversationId,
        viewerEmail: normalizeEmail(viewerEmail),
        viewerRole
      }
    }
  });
}

async function getReadStatesMap(
  conversationIds: string[],
  viewerEmail: string,
  viewerRole: SupportViewerRoleValue
) {
  if (conversationIds.length === 0) {
    return new Map<string, Date | null>();
  }

  const readStates = await prisma.supportReadState.findMany({
    where: {
      conversationId: {
        in: conversationIds
      },
      viewerEmail: normalizeEmail(viewerEmail),
      viewerRole
    }
  });

  return new Map(readStates.map((entry) => [entry.conversationId, entry.lastReadAt ?? null]));
}

function readNotificationCache<TNotification>(
  cache: Map<string, CachedNotificationEntry<TNotification>>,
  key: string
) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function writeNotificationCache<TNotification>(
  cache: Map<string, CachedNotificationEntry<TNotification>>,
  key: string,
  value: NotificationSummary<TNotification>
) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + SUPPORT_NOTIFICATION_CACHE_TTL_MS
  });
  return value;
}

export function clearAllResidentNotificationCaches() {
  residentNotificationCache.clear();
}

export function clearResidentNotificationCacheForEmail(email: string) {
  residentNotificationCache.delete(normalizeEmail(email));
}

function clearNotificationCaches(email: string, residentEmail?: string) {
  const normalizedEmail = normalizeEmail(email);
  residentNotificationCache.delete(normalizedEmail);
  staffNotificationCache.clear();

  if (residentEmail) {
    residentNotificationCache.delete(normalizeEmail(residentEmail));
  }
}

export async function markSupportConversationRead(input: {
  conversationId: string;
  viewerEmail: string;
  viewerRole: SupportViewerRoleValue;
}) {
  const normalizedViewerEmail = normalizeEmail(input.viewerEmail);

  if (input.viewerRole === "STAFF") {
    await requirePortalRole(
      normalizedViewerEmail,
      ["manager", "owner", "app_admin"],
      "Only managers, owners, or the app admin can mark staff support notifications."
    );
  }

  const conversation = await prisma.supportConversation.findUnique({
    where: { id: input.conversationId }
  });

  if (!conversation) {
    throw new Error("Support conversation not found");
  }

  if (input.viewerRole === "RESIDENT" && conversation.residentEmail !== normalizedViewerEmail) {
    throw new Error("Residents can only mark their own support conversation.");
  }

  clearNotificationCaches(normalizedViewerEmail, conversation.residentEmail);

  return prisma.supportReadState.upsert({
    where: {
      conversationId_viewerEmail_viewerRole: {
        conversationId: input.conversationId,
        viewerEmail: normalizedViewerEmail,
      viewerRole: input.viewerRole
      }
    },
    update: {
      lastReadAt: new Date()
    },
    create: {
      conversationId: input.conversationId,
      viewerEmail: normalizedViewerEmail,
      viewerRole: input.viewerRole,
      lastReadAt: new Date()
    }
  });
}

export async function getSupportConversationById(conversationId: string) {
  const conversation = await prisma.supportConversation.findUnique({
    where: { id: conversationId }
  });

  if (!conversation) {
    throw new Error("Support conversation not found");
  }

  const messages = await prisma.supportMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" }
  });

  return { conversation, messages };
}

function buildUnreadSummary(input: {
  messages: Array<{
    id: string;
    body: string;
    senderEmail: string;
    senderName: string | null;
    senderRole: SupportMessageSenderRole;
    createdAt: Date;
  }>;
  lastReadAt: Date | null;
  viewerRole: SupportViewerRoleValue;
}) {
  const unreadMessages = input.messages.filter((message) => {
    if (!messageTargetsViewer(message, input.viewerRole)) {
      return false;
    }

    return !input.lastReadAt || message.createdAt > input.lastReadAt;
  });

  const latestUnread = unreadMessages[unreadMessages.length - 1] ?? null;

  return {
    unreadCount: unreadMessages.length,
    latestUnreadMessage: latestUnread
      ? {
          id: latestUnread.id,
          body: latestUnread.body,
          senderEmail: latestUnread.senderEmail,
          senderName: latestUnread.senderName,
          senderRole: latestUnread.senderRole,
          createdAt: latestUnread.createdAt
        }
      : null
  };
}

type ResidentNotificationItem = {
  id: string;
  type:
    | "SUPPORT_REPLY"
    | "PAYMENT_DUE"
    | "NEW_FINE"
    | "LAUNDRY_REMINDER"
    | "CLEANING_REMINDER"
    | "CLEANING_AUDIT_RESULT"
    | "PREPAID_PACKAGE";
  title: string;
  body: string;
  createdAt: string | Date;
  unreadCount: number;
  href: string;
  conversationId?: string;
};

function findClientValue(client: Record<string, string> | null, candidates: string[]) {
  if (!client) {
    return "";
  }

  for (const candidate of candidates) {
    const exact = client[candidate];
    if (typeof exact === "string" && exact.trim()) {
      return exact.trim();
    }
  }

  const normalizedCandidates = candidates.map((candidate) => candidate.toLowerCase());
  const dynamicEntry = Object.entries(client).find(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    return normalizedCandidates.some((candidate) => normalizedKey.includes(candidate)) && String(value ?? "").trim();
  });

  return String(dynamicEntry?.[1] ?? "").trim();
}

function parseLooseDate(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) {
    return null;
  }

  const [, dayValue, monthValue, yearValue] = match;
  const year = Number.parseInt(yearValue, 10) < 100 ? 2000 + Number.parseInt(yearValue, 10) : Number.parseInt(yearValue, 10);
  const month = Number.parseInt(monthValue, 10) - 1;
  const day = Number.parseInt(dayValue, 10);
  const date = new Date(year, month, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursUntil(target: Date, now = new Date()) {
  return (target.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function minutesUntil(target: Date, now = new Date()) {
  return (target.getTime() - now.getTime()) / (1000 * 60);
}

async function buildResidentReminderNotifications(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const [client, fineEntries, laundryBookings, cleaningTasks, recentlyAuditedTasks] = await Promise.all([
    getActiveClientByEmail(normalizedEmail),
    getFinesForEmail(normalizedEmail),
    getLaundryBookingsForEmailWithOptions(normalizedEmail, { forceRefresh: false }),
    prisma.cleaningTask.findMany({
      where: {
        userEmail: normalizedEmail,
        status: CleaningTaskStatus.ASSIGNED
      },
      orderBy: {
        scheduledDate: "asc"
      }
    }),
    prisma.cleaningTask.findMany({
      where: {
        userEmail: normalizedEmail,
        status: { in: [CleaningTaskStatus.APPROVED, CleaningTaskStatus.REJECTED] },
        updatedAt: { gte: fourteenDaysAgo }
      },
      orderBy: { updatedAt: "desc" }
    })
  ]);
  const notifications: ResidentNotificationItem[] = [];

  const prepaidWindowStart = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
  const prepaidBillings = await prisma.prepaidPackageBilling.findMany({
    where: {
      residentEmail: normalizedEmail,
      confirmed: true,
      lastAppNotifyAt: { not: null, gte: prepaidWindowStart }
    },
    orderBy: { lastAppNotifyAt: "desc" },
    take: 5
  });
  for (const bill of prepaidBillings) {
    const when = bill.lastAppNotifyAt?.toISOString() ?? now.toISOString();
    const amt = bill.managerPackageTotalVnd.toLocaleString("vi-VN");
    notifications.push({
      id: `prepaid-pkg-${bill.id}`,
      type: "PREPAID_PACKAGE",
      title: "Multi-month package payment",
      body: bill.managerNote?.trim()
        ? `${bill.managerNote.trim()} — Confirmed amount: ${amt} ₫ (month ${bill.billingMonth}).`
        : `Your manager confirmed your package payment amount: ${amt} ₫ (billing month ${bill.billingMonth}).`,
      createdAt: when,
      unreadCount: 1,
      href: "/payments"
    });
  }

  const paymentDueValue = findClientValue(client, [
    "Ngày hết hạn gói đã thanh toán",
    "ngày hết hạn gói đã thanh toán",
    "hết hạn",
    "het han"
  ]);
  const paymentStatusValue = findClientValue(client, ["Đã đóng phí tháng", "đã đóng phí tháng", "đóng phí", "dong phi"]);
  const paymentDueDate = parseLooseDate(paymentDueValue);

  if (paymentDueDate) {
    const hours = hoursUntil(paymentDueDate, now);
    if (hours <= 72) {
      notifications.push({
        id: `payment-due-${normalizedEmail}-${paymentDueDate.toISOString()}`,
        type: "PAYMENT_DUE",
        title: hours < 0 ? "Payment is overdue" : "Payment due soon",
        body:
          hours < 0
            ? `Your payment deadline was ${paymentDueDate.toLocaleDateString()}. Please review your payment details.`
            : `Your payment deadline is ${paymentDueDate.toLocaleDateString()}. Status: ${paymentStatusValue || "not recorded yet"}.`,
        createdAt: paymentDueDate.toISOString(),
        unreadCount: 1,
        href: "/payments"
      });
    }
  }

  const unpaidRecentFines = fineEntries.filter((entry) => {
    const paidValue = (entry.row["ĐÃ THANH TOÁN?"] ?? "").trim().toLowerCase();
    const isPaid = paidValue && paidValue !== "0" && paidValue !== "false" && paidValue !== "chưa";
    if (isPaid || !entry.parsedTimestamp) {
      return false;
    }
    return hoursUntil(new Date(entry.parsedTimestamp), now) >= -24 * 7;
  });
  for (const entry of unpaidRecentFines) {
    notifications.push({
      id: `fine-${normalizedEmail}-${entry.row["DẤU THỜI GIAN"] ?? entry.row["ĐẤU THỜI GIAN"] ?? entry.row["NỘI DUNG VI PHẠM"] ?? ""}`,
      type: "NEW_FINE",
      title: "New fine ticket",
      body: `${entry.row["NỘI DUNG VI PHẠM"] || "A new fine ticket"} was added to your account.`,
      createdAt: entry.parsedTimestamp ?? now.toISOString(),
      unreadCount: 1,
      href: "/fines"
    });
  }

  for (const booking of laundryBookings) {
    const start = new Date(booking.start);
    if (Number.isNaN(start.getTime())) {
      continue;
    }
    const minutes = minutesUntil(start, now);
    if (minutes > 0 && minutes <= 10) {
      notifications.push({
        id: `laundry-10-${booking.id}`,
        type: "LAUNDRY_REMINDER",
        title: "Laundry starts in 10 minutes",
        body: `${booking.summary} starts at ${start.toLocaleTimeString()}.`,
        createdAt: booking.start,
        unreadCount: 1,
        href: "/bookings"
      });
    } else if (minutes > 10 && minutes <= 60) {
      notifications.push({
        id: `laundry-60-${booking.id}`,
        type: "LAUNDRY_REMINDER",
        title: "Laundry starts in 1 hour",
        body: `${booking.summary} starts at ${start.toLocaleTimeString()}.`,
        createdAt: booking.start,
        unreadCount: 1,
        href: "/bookings"
      });
    }
  }

  for (const task of cleaningTasks) {
    const hours = hoursUntil(task.scheduledDate, now);
    if (hours > 0 && hours <= 1) {
      notifications.push({
        id: `cleaning-1h-${task.id}`,
        type: "CLEANING_REMINDER",
        title: "Cleaning task in 1 hour",
        body: `Your cleaning task is scheduled for ${task.scheduledDate.toLocaleString()}. Please prepare to start.`,
        createdAt: task.scheduledDate.toISOString(),
        unreadCount: 1,
        href: "/schedule"
      });
    } else if (hours > 1 && hours <= 12) {
      notifications.push({
        id: `cleaning-12h-${task.id}`,
        type: "CLEANING_REMINDER",
        title: "Cleaning task is coming up",
        body: `Your cleaning task is scheduled for ${task.scheduledDate.toLocaleString()}.`,
        createdAt: task.scheduledDate.toISOString(),
        unreadCount: 1,
        href: "/schedule"
      });
    }
  }

  for (const task of recentlyAuditedTasks) {
    const taskDate = new Date(task.scheduledDate).toLocaleDateString();
    if (task.status === CleaningTaskStatus.REJECTED) {
      notifications.push({
        id: `cleaning-audit-rejected-${task.id}`,
        type: "CLEANING_AUDIT_RESULT",
        title: "Cleaning task not approved",
        body: `Your cleaning on ${taskDate} was not approved — coins forfeited.${task.auditorNote ? ` Note: ${task.auditorNote}` : ""}`,
        createdAt: task.updatedAt.toISOString(),
        unreadCount: 1,
        href: "/schedule"
      });
    } else if (task.status === CleaningTaskStatus.APPROVED) {
      notifications.push({
        id: `cleaning-audit-approved-${task.id}`,
        type: "CLEANING_AUDIT_RESULT",
        title: "Cleaning task approved",
        body: `Your cleaning on ${taskDate} was approved — +${task.rewardCoins.toLocaleString()} coins added.`,
        createdAt: task.updatedAt.toISOString(),
        unreadCount: 1,
        href: "/schedule"
      });
    }
  }

  return notifications.sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

export async function listResidentSupportNotifications(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const cached = readNotificationCache(residentNotificationCache, normalizedEmail);
  if (cached) {
    return cached;
  }

  const conversation = await prisma.supportConversation.findUnique({
    where: { residentEmail: normalizedEmail },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  const reminderNotifications = await buildResidentReminderNotifications(normalizedEmail);
  const notifications: ResidentNotificationItem[] = [...reminderNotifications];

  if (conversation) {
    const readState = await getReadState(conversation.id, normalizedEmail, "RESIDENT");
    const summary = buildUnreadSummary({
      messages: conversation.messages,
      lastReadAt: readState?.lastReadAt ?? null,
      viewerRole: "RESIDENT"
    });

    if (summary.unreadCount > 0 && summary.latestUnreadMessage) {
      notifications.unshift({
        id: `support-${conversation.id}-${summary.latestUnreadMessage.id}`,
        type: "SUPPORT_REPLY",
        conversationId: conversation.id,
        title: "New reply from Cozoro",
        body: summary.latestUnreadMessage.body,
        createdAt: summary.latestUnreadMessage.createdAt,
        unreadCount: summary.unreadCount,
        href: `/support?chat=${encodeURIComponent(conversation.id)}`
      });
    }
  }

  // Add unread group message notifications (room/floor/branch chats)
  try {
    const groupContext = await getClientGroupContext(normalizedEmail);
    const groupIds = Object.values(groupContext.groupIds);

    for (const groupId of groupIds) {
      const readState = await prisma.groupReadState.findUnique({
        where: { groupId_viewerEmail: { groupId, viewerEmail: normalizedEmail } }
      });
      const lastRead = readState?.lastReadAt ?? null;

      const unreadMessages = await prisma.groupMessage.findMany({
        where: {
          groupId,
          senderEmail: { not: normalizedEmail },
          createdAt: { gt: lastRead ?? new Date(0) }
        },
        orderBy: { createdAt: "desc" }
      });

      if (unreadMessages.length > 0) {
        const latest = unreadMessages[0]!;
        let label = groupId;
        if (groupId.startsWith("BRANCH_")) label = "Branch " + groupId.replace("BRANCH_", "");
        else if (groupId.startsWith("FLOOR_")) {
          const parts = groupId.split("_");
          label = `Floor ${parts[1]}-${parts[2]}`;
        } else if (groupId.startsWith("ROOM_")) {
          const parts = groupId.split("_");
          label = `Room ${parts[2]} (${parts[1]})`;
        }

        notifications.push({
          id: `group-${groupId}-${latest.id}`,
          type: "SUPPORT_REPLY",
          conversationId: groupId,
          title: `New message in ${label}`,
          body: latest.isAnonymous ? "Anonymous message" : `${latest.senderName}: ${latest.body}`,
          createdAt: latest.createdAt,
          unreadCount: unreadMessages.length,
          href: `/support?groupId=${encodeURIComponent(groupId)}`
        });
      }
    }
  } catch {
    // If client has no group context (not an active resident), skip group notifications
  }

  return writeNotificationCache(residentNotificationCache, normalizedEmail, {
    unreadCount: notifications.reduce((sum, item) => sum + Math.max(1, item.unreadCount || 0), 0),
    notifications: notifications.sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
  });
}

export async function listStaffSupportNotifications(operatorEmail: string) {
  const normalizedOperatorEmail = normalizeEmail(operatorEmail);
  const cached = readNotificationCache(staffNotificationCache, normalizedOperatorEmail);
  if (cached) {
    return cached;
  }

  await requirePortalRole(
    normalizedOperatorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can load staff notifications."
  );

  const conversations = await prisma.supportConversation.findMany({
    where: {
      messages: {
        some: {}
      }
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: [{ lastMessageAt: "desc" }]
  });

  const readStatesByConversationId = await getReadStatesMap(
    conversations.map((conversation) => conversation.id),
    normalizedOperatorEmail,
    "STAFF"
  );
  type ManagerInboxNotification = {
    id: string;
    type: "SUPPORT_REQUEST";
    conversationId: string;
    residentEmail: string;
    residentName: string | null;
    title: string;
    body: string;
    createdAt: Date;
    unreadCount: number;
    href: string;
  };

  const notifications: ManagerInboxNotification[] = [];

  for (const conversation of conversations) {
    const summary = buildUnreadSummary({
      messages: conversation.messages,
      lastReadAt: readStatesByConversationId.get(conversation.id) ?? null,
      viewerRole: "STAFF"
    });

    if (summary.unreadCount === 0 || !summary.latestUnreadMessage) {
      continue;
    }

    notifications.push({
      id: `support-${conversation.id}-${summary.latestUnreadMessage.id}`,
      type: "SUPPORT_REQUEST",
      conversationId: conversation.id,
      residentEmail: conversation.residentEmail,
      residentName: conversation.residentName,
      title: `${conversation.residentName || conversation.residentEmail} sent a new message`,
      body: summary.latestUnreadMessage.body,
      createdAt: summary.latestUnreadMessage.createdAt,
      unreadCount: summary.unreadCount,
      href: `/manager?chat=${encodeURIComponent(conversation.id)}`
    });
  }

  // Add Group Notifications
  const groupsWithMessages = await prisma.groupMessage.groupBy({
    by: ['groupId'],
    _max: { createdAt: true }
  });

  for (const g of groupsWithMessages) {
    const groupId = g.groupId;
    const readState = await prisma.groupReadState.findUnique({
      where: { groupId_viewerEmail: { groupId, viewerEmail: normalizedOperatorEmail } }
    });
    const lastRead = readState?.lastReadAt || null;

    const unreadMessages = await prisma.groupMessage.findMany({
      where: {
        groupId,
        senderRole: SupportMessageSenderRole.RESIDENT,
        createdAt: { gt: lastRead || new Date(0) }
      },
      orderBy: { createdAt: "desc" }
    });

    if (unreadMessages.length > 0) {
      const latest = unreadMessages[0]!;
      let label = groupId;
      if (groupId.startsWith("BRANCH_")) label = "Branch " + groupId.replace("BRANCH_", "");
      else if (groupId.startsWith("FLOOR_")) {
        const parts = groupId.split("_");
        label = `Floor ${parts[1]}-${parts[2]}`;
      } else if (groupId.startsWith("ROOM_")) {
        const parts = groupId.split("_");
        label = `Room ${parts[2]} (${parts[1]})`;
      }

      notifications.push({
        id: `group-support-${groupId}-${latest.id}`,
        type: "SUPPORT_REQUEST",
        conversationId: groupId,
        residentEmail: "group@cozorohome.com",
        residentName: label,
        title: `New message in ${label}`,
        body: latest.body,
        createdAt: latest.createdAt,
        unreadCount: unreadMessages.length,
        href: `/manager?chat=${encodeURIComponent(groupId)}`
      });
    }
  }

  return writeNotificationCache(staffNotificationCache, normalizedOperatorEmail, {
    notifications: notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    unreadCount: notifications.reduce((sum, item) => sum + item.unreadCount, 0)
  });
}


export async function postResidentSupportMessage(input: {
  email: string;
  body: string;
  pagePath?: string;
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const trimmedBody = input.body.trim();

  if (!trimmedBody) {
    throw new Error("A support message is required.");
  }

  const conversation = await getOrCreateSupportConversationForResident(normalizedEmail);
  const residentName = conversation.residentName ?? (await getResidentName(normalizedEmail));
  clearNotificationCaches(normalizedEmail);

  return prisma.$transaction(async (tx) => {
    const message = await tx.supportMessage.create({
      data: {
        conversationId: conversation.id,
        senderEmail: normalizedEmail,
        senderName: residentName ?? undefined,
        senderRole: SupportMessageSenderRole.RESIDENT,
        body: trimmedBody,
        pagePath: input.pagePath?.trim() || undefined
      }
    });

    const updatedConversation = await tx.supportConversation.update({
      where: { id: conversation.id },
      data: {
        residentName: residentName ?? undefined,
        status: SupportConversationStatus.OPEN,
        lastMessageAt: message.createdAt
      }
    });

    return { conversation: updatedConversation, message };
  });
}

export async function tryAppendAssistantAfterResidentMessage(input: {
  conversationId: string;
  residentEmail: string;
}) {
  const normalizedEmail = normalizeEmail(input.residentEmail);
  const { replyText, assistantMeta } = await runResidentSupportAssistantTurn({
    conversationId: input.conversationId,
    residentEmail: normalizedEmail
  });

  if (!replyText?.trim()) {
    return null;
  }

  const trimmedRaw = replyText.trim().length > 8000 ? replyText.trim().slice(0, 8000) : replyText.trim();
  const trimmed = appendSupportAssistantMetaSuffix(trimmedRaw, assistantMeta);

  const message = await prisma.supportMessage.create({
    data: {
      conversationId: input.conversationId,
      senderEmail: ASSISTANT_SENDER_EMAIL,
      senderName: "Cozoro Assistant",
      senderRole: SupportMessageSenderRole.ASSISTANT,
      body: trimmed
    }
  });

  await prisma.supportConversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: message.createdAt }
  });

  clearNotificationCaches(normalizedEmail);

  const pushPreview = trimmedRaw.length > 100 ? trimmedRaw.slice(0, 97) + "…" : trimmedRaw;
  void sendPushToEmail(normalizedEmail, "New message from Cozoro", pushPreview, "/support").catch(() => {});

  return { message };
}

export async function postOperatorSupportMessage(input: {
  conversationId: string;
  operatorEmail: string;
  body: string;
}) {
  const normalizedOperatorEmail = normalizeEmail(input.operatorEmail);
  const trimmedBody = input.body.trim();

  if (!trimmedBody) {
    throw new Error("A reply message is required.");
  }

  const actor = await requirePortalRole(
    normalizedOperatorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can reply here."
  );

  const existingConversation = await prisma.supportConversation.findUnique({
    where: { id: input.conversationId }
  });

  if (!existingConversation) {
    throw new Error("Support conversation not found");
  }

  const senderRole = actor.role === "owner" ? SupportMessageSenderRole.OWNER : SupportMessageSenderRole.MANAGER;
  const senderName = "Cozoro";
  clearNotificationCaches(normalizedOperatorEmail, existingConversation.residentEmail);

  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.supportMessage.create({
      data: {
        conversationId: existingConversation.id,
        senderEmail: normalizedOperatorEmail,
        senderName,
        senderRole,
        body: trimmedBody
      }
    });

    const updatedConversation = await tx.supportConversation.update({
      where: { id: existingConversation.id },
      data: {
        status: SupportConversationStatus.OPEN,
        lastMessageAt: message.createdAt
      }
    });

    return { conversation: updatedConversation, message };
  });

  void sendPushToEmail(
    existingConversation.residentEmail,
    "New message from Cozoro",
    trimmedBody.length > 100 ? trimmedBody.slice(0, 97) + "…" : trimmedBody,
    "/support"
  ).catch(() => {});

  return result;
}

export async function postOperatorSupportMessageToResident(input: {
  residentEmail: string;
  operatorEmail: string;
  body: string;
}) {
  const normalizedResidentEmail = normalizeEmail(input.residentEmail);
  const resident = await getActiveClientByEmail(normalizedResidentEmail);

  if (!resident) {
    throw new Error("No active client found for that email.");
  }

  const conversation = await getOrCreateSupportConversationForResident(normalizedResidentEmail);

  return postOperatorSupportMessage({
    conversationId: conversation.id,
    operatorEmail: input.operatorEmail,
    body: input.body
  });
}

export async function updateSupportConversationStatus(input: {
  conversationId: string;
  status: SupportConversationStatus;
  operatorEmail: string;
}) {
  const normalizedOperatorEmail = normalizeEmail(input.operatorEmail);

  await requirePortalRole(
    normalizedOperatorEmail,
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can change support status."
  );

  const conversation = await prisma.supportConversation.findUnique({
    where: { id: input.conversationId },
    select: { residentEmail: true }
  });
  if (conversation) {
    clearNotificationCaches(normalizedOperatorEmail, conversation.residentEmail);
  }

  return prisma.supportConversation.update({
    where: { id: input.conversationId },
    data: { status: input.status }
  });
}

/**
 * Owner-only: delete an entire direct support thread (all messages + read states)
 * or clear every message (and read states) in a branch/floor/room group channel.
 */
export async function ownerDeleteSupportConversation(input: {
  operatorEmail: string;
  conversationOrGroupId: string;
}) {
  const operatorEmail = normalizeEmail(input.operatorEmail);
  await requirePortalRole(
    operatorEmail,
    ["owner"],
    "Only owners can delete a whole conversation."
  );

  const id = input.conversationOrGroupId.trim();
  const isGroup =
    id.startsWith("BRANCH_") || id.startsWith("FLOOR_") || id.startsWith("ROOM_");

  if (isGroup) {
    const deleted = await prisma.groupMessage.deleteMany({ where: { groupId: id } });
    await prisma.groupReadState.deleteMany({ where: { groupId: id } });
    staffNotificationCache.clear();
    clearAllResidentNotificationCaches();
    return { ok: true as const, scope: "GROUP" as const, deletedMessageCount: deleted.count };
  }

  const conversation = await prisma.supportConversation.findUnique({
    where: { id },
    select: { id: true, residentEmail: true }
  });

  if (!conversation) {
    throw new Error("Support conversation not found");
  }

  clearNotificationCaches(operatorEmail, conversation.residentEmail);
  await prisma.supportConversation.delete({ where: { id: conversation.id } });
  return { ok: true as const, scope: "DIRECT" as const };
}

/** Owner-only: delete one inbox message (direct `SupportMessage` or group `GroupMessage`). */
export async function ownerDeleteSupportMessage(input: { operatorEmail: string; messageId: string }) {
  const operatorEmail = normalizeEmail(input.operatorEmail);
  await requirePortalRole(
    operatorEmail,
    ["owner"],
    "Only owners can delete a support message."
  );

  const direct = await prisma.supportMessage.findUnique({
    where: { id: input.messageId },
    include: { conversation: { select: { id: true, residentEmail: true, createdAt: true } } }
  });

  if (direct) {
    const { conversationId, conversation } = direct;
    await prisma.supportMessage.delete({ where: { id: direct.id } });

    const latest = await prisma.supportMessage.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    });

    await prisma.supportConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: latest?.createdAt ?? conversation.createdAt }
    });

    clearNotificationCaches(operatorEmail, conversation.residentEmail);
    return { ok: true as const, scope: "DIRECT" as const };
  }

  const groupRow = await prisma.groupMessage.findUnique({ where: { id: input.messageId } });
  if (groupRow) {
    await prisma.groupMessage.delete({ where: { id: groupRow.id } });
    staffNotificationCache.clear();
    clearAllResidentNotificationCaches();
    return { ok: true as const, scope: "GROUP" as const };
  }

  throw new Error("Message not found");
}
