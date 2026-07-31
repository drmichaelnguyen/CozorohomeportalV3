import { Prisma, WebLeadConversationStatus, WebLeadMessageRole } from "@prisma/client";
import { prisma } from "./prisma.js";

export type WebLeadSyncPayload = {
  conversationKey: string;
  guestMessage: string;
  botMessage: string;
  guestName?: string | null;
  phone?: string | null;
  facebook?: string | null;
  otherContact?: string | null;
  preferredBranch?: string | null;
  stayMonths?: number | null;
  moveInHint?: string | null;
  occupationHint?: string | null;
  lastQuoteVnd?: number | null;
  summary?: string | null;
};

function trimOrNull(value: string | null | undefined, max = 255) {
  const t = value?.trim();
  if (!t) return null;
  return t.slice(0, max);
}

export async function syncWebLeadTurn(input: WebLeadSyncPayload) {
  const conversationKey = input.conversationKey.trim();
  if (!conversationKey) {
    throw new Error("conversationKey is required");
  }

  const guestMessage = input.guestMessage.trim();
  const botMessage = input.botMessage.trim();
  if (!guestMessage || !botMessage) {
    throw new Error("guestMessage and botMessage are required");
  }

  const now = new Date();
  const nextPhone = input.phone !== undefined ? trimOrNull(input.phone, 48) : undefined;
  const nextFacebook = input.facebook !== undefined ? trimOrNull(input.facebook, 191) : undefined;
  const nextOtherContact =
    input.otherContact !== undefined ? trimOrNull(input.otherContact, 255) : undefined;
  const nextGuestName = input.guestName !== undefined ? trimOrNull(input.guestName, 120) : undefined;

  const data: Prisma.WebLeadConversationUpdateInput = {
    lastMessageAt: now,
    // Keep contact sticky so a later blank sync does not drop a potential customer back to AI notes.
    ...(nextGuestName ? { guestName: nextGuestName } : {}),
    ...(nextPhone ? { phone: nextPhone } : {}),
    ...(nextFacebook ? { facebook: nextFacebook } : {}),
    ...(nextOtherContact ? { otherContact: nextOtherContact } : {}),
    ...(input.preferredBranch !== undefined
      ? { preferredBranch: trimOrNull(input.preferredBranch, 8) }
      : {}),
    ...(input.stayMonths !== undefined
      ? {
          stayMonths:
            typeof input.stayMonths === "number" && Number.isFinite(input.stayMonths)
              ? Math.max(1, Math.min(36, Math.round(input.stayMonths)))
              : null
        }
      : {}),
    ...(input.moveInHint !== undefined ? { moveInHint: trimOrNull(input.moveInHint, 120) } : {}),
    ...(input.occupationHint !== undefined
      ? { occupationHint: trimOrNull(input.occupationHint, 64) }
      : {}),
    ...(input.lastQuoteVnd !== undefined
      ? {
          lastQuoteVnd:
            typeof input.lastQuoteVnd === "number" && Number.isFinite(input.lastQuoteVnd)
              ? Math.max(0, Math.round(input.lastQuoteVnd))
              : null
        }
      : {}),
    ...(input.summary !== undefined ? { summary: trimOrNull(input.summary, 2000) } : {})
  };

  const conversation = await prisma.webLeadConversation.upsert({
    where: { conversationKey },
    create: {
      conversationKey,
      status: WebLeadConversationStatus.OPEN,
      lastMessageAt: now,
      guestName: nextGuestName ?? null,
      phone: nextPhone ?? null,
      facebook: nextFacebook ?? null,
      otherContact: nextOtherContact ?? null,
      preferredBranch: trimOrNull(input.preferredBranch, 8),
      stayMonths:
        typeof input.stayMonths === "number" && Number.isFinite(input.stayMonths)
          ? Math.max(1, Math.min(36, Math.round(input.stayMonths)))
          : null,
      moveInHint: trimOrNull(input.moveInHint, 120),
      occupationHint: trimOrNull(input.occupationHint, 64),
      lastQuoteVnd:
        typeof input.lastQuoteVnd === "number" && Number.isFinite(input.lastQuoteVnd)
          ? Math.max(0, Math.round(input.lastQuoteVnd))
          : null,
      summary: trimOrNull(input.summary, 2000)
    },
    update: data
  });

  await prisma.webLeadMessage.createMany({
    data: [
      {
        conversationId: conversation.id,
        role: WebLeadMessageRole.GUEST,
        body: guestMessage.slice(0, 8000),
        createdAt: now
      },
      {
        conversationId: conversation.id,
        role: WebLeadMessageRole.BOT,
        body: botMessage.slice(0, 8000),
        createdAt: new Date(now.getTime() + 1)
      }
    ]
  });

  return { conversationId: conversation.id, conversationKey };
}

export async function listWebLeadConversations(limit = 80) {
  const rows = await prisma.webLeadConversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    conversationKey: row.conversationKey,
    guestName: row.guestName,
    phone: row.phone,
    facebook: row.facebook,
    otherContact: row.otherContact,
    preferredBranch: row.preferredBranch,
    stayMonths: row.stayMonths,
    moveInHint: row.moveInHint,
    occupationHint: row.occupationHint,
    lastQuoteVnd: row.lastQuoteVnd,
    summary: row.summary,
    status: row.status,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    latestMessage: row.messages[0]
      ? {
          role: row.messages[0].role,
          body: row.messages[0].body,
          createdAt: row.messages[0].createdAt.toISOString()
        }
      : null
  }));
}

export async function getWebLeadConversation(id: string) {
  const row = await prisma.webLeadConversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 300 }
    }
  });
  if (!row) return null;

  return {
    conversation: {
      id: row.id,
      conversationKey: row.conversationKey,
      guestName: row.guestName,
      phone: row.phone,
      facebook: row.facebook,
      otherContact: row.otherContact,
      preferredBranch: row.preferredBranch,
      stayMonths: row.stayMonths,
      moveInHint: row.moveInHint,
      occupationHint: row.occupationHint,
      lastQuoteVnd: row.lastQuoteVnd,
      summary: row.summary,
      status: row.status,
      lastMessageAt: row.lastMessageAt.toISOString(),
      createdAt: row.createdAt.toISOString()
    },
    messages: row.messages.map((m) => ({
      id: m.id,
      role: m.role,
      body: m.body,
      createdAt: m.createdAt.toISOString()
    }))
  };
}

export async function updateWebLeadStatus(id: string, status: WebLeadConversationStatus) {
  return prisma.webLeadConversation.update({
    where: { id },
    data: { status }
  });
}
