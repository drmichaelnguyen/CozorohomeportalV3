import {
  SupportConversationStatus,
  SupportMessageSenderRole,
  CleaningTaskStatus
} from "@prisma/client";

import {
  getActiveClientByEmail,
  getFinesForEmail,
  getLaundryBookingsForEmailWithOptions,
} from "./google-sheets.js";
import { prisma } from "./prisma.js";
import { requirePortalRole, resolvePortalLogin } from "./staff-access.js";
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
}>>();

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function messageTargetsViewer(message: { senderRole: SupportMessageSenderRole }, viewerRole: SupportViewerRoleValue) {
  if (viewerRole === "RESIDENT") {
    return message.senderRole === SupportMessageSenderRole.MANAGER || message.senderRole === SupportMessageSenderRole.OWNER;
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

export async function listSupportConversationsForInbox() {
  return prisma.supportConversation.findMany({
    where: {
      messages: {
        some: {}
      }
    },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }]
  });
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
    | "CLEANING_REMINDER";
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
  const [client, fineEntries, laundryBookings, cleaningTasks] = await Promise.all([
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
    })
  ]);
  const notifications: ResidentNotificationItem[] = [];

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
    if (minutes > 0 && minutes <= 15) {
      notifications.push({
        id: `laundry-15-${booking.id}`,
        type: "LAUNDRY_REMINDER",
        title: "Laundry starts in 15 minutes",
        body: `${booking.summary} starts at ${start.toLocaleTimeString()}.`,
        createdAt: booking.start,
        unreadCount: 1,
        href: "/bookings"
      });
    } else if (minutes > 15 && minutes <= 60) {
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
    if (hours > 0 && hours <= 12) {
      notifications.push({
        id: `cleaning-${task.id}`,
        type: "CLEANING_REMINDER",
        title: "Cleaning task is coming up",
        body: `Your cleaning task is scheduled for ${task.scheduledDate.toLocaleString()}.`,
        createdAt: task.scheduledDate,
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
        href: "/support"
      });
    }
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
  const notifications = [];

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
      unreadCount: summary.unreadCount
    });
  }

  return writeNotificationCache(staffNotificationCache, normalizedOperatorEmail, {
    notifications,
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
  clearNotificationCaches(normalizedOperatorEmail, existingConversation.residentEmail);

  return prisma.$transaction(async (tx) => {
    const message = await tx.supportMessage.create({
      data: {
        conversationId: existingConversation.id,
        senderEmail: normalizedOperatorEmail,
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
