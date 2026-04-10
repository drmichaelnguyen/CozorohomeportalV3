import { SupportMessageSenderRole } from "@prisma/client";
import { prisma } from "./prisma.js";
import { resolvePortalLogin } from "./staff-access.js";
import { getActiveClientByEmail } from "./google-sheets.js";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeBranch(value: string | undefined) {
  const normalized = (value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7" as const;
  }
  return "D2" as const;
}

function parseBedNumber(value: string | undefined) {
  const parsed = Number.parseInt((value ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function deriveRoomLabel(branchId: "D2" | "D7", bedValue: string | undefined) {
  const bed = parseBedNumber(bedValue);
  if (!bed || bed <= 0) {
    return "";
  }

  if (branchId === "D2") {
    if (bed >= 1 && bed <= 9) return "1";
    if (bed >= 10 && bed <= 15) return "2";
    if (bed >= 16 && bed <= 21) return "3";
    return "";
  }

  if (bed >= 1 && bed <= 9) return "1.1";
  if (bed >= 10 && bed <= 15) return "1.2";
  if (bed >= 16 && bed <= 24) return "1.3";
  if (bed >= 25 && bed <= 33) return "2.1";
  if (bed >= 34 && bed <= 39) return "2.2";
  if (bed >= 40 && bed <= 48) return "2.3";
  if (bed >= 49 && bed <= 57) return "3.1";
  if (bed >= 58 && bed <= 63) return "3.2";
  return "";
}

export async function getClientGroupContext(email: string) {
  const client = await getActiveClientByEmail(normalizeEmail(email));
  if (!client) {
    throw new Error("No active client found for this email.");
  }

  const branchId = normalizeBranch(client["Chi nhánh Cozoro dorm"]);
  const roomLabel = deriveRoomLabel(branchId, client["số giường"]);
  const floor = roomLabel.split(".")[0];

  return {
    branchId,
    roomLabel,
    floor,
    groupIds: {
      room: `ROOM_${branchId}_${roomLabel}`,
      floor: `FLOOR_${branchId}_${floor}`,
      branch: `BRANCH_${branchId}`
    }
  };
}

export async function getGroupMessages(input: {
  groupId: string;
  viewerEmail: string;
}) {
  const normalizedViewerEmail = normalizeEmail(input.viewerEmail);
  const viewer = await resolvePortalLogin(normalizedViewerEmail);
  const isStaff = viewer.allowed && viewer.role !== "user" && viewer.role != null;

  const messages = await prisma.groupMessage.findMany({
    where: { groupId: input.groupId },
    orderBy: { createdAt: "asc" }
  });

  return messages.map((message) => {
    const isOwnMessage = normalizeEmail(message.senderEmail) === normalizedViewerEmail;
    
    // Admins/Managers see everything. 
    // Residents see "Anonymous" for anonymous resident messages, or "Cozoro" for anonymous staff messages.
    if (!isStaff && !isOwnMessage && message.isAnonymous) {
      if (message.senderRole === SupportMessageSenderRole.RESIDENT) {
        return {
          ...message,
          senderEmail: "anonymous@cozorohome.com",
          senderName: "Anonymous"
        };
      } else {
        return {
          ...message,
          senderEmail: "info@cozorohome.com",
          senderName: "Cozoro"
        };
      }
    }

    return message;
  });
}

export async function postGroupMessage(input: {
  groupId: string;
  senderEmail: string;
  body: string;
  isAnonymous: boolean;
}) {
  const normalizedSenderEmail = normalizeEmail(input.senderEmail);
  const trimmedBody = input.body.trim();
  if (!trimmedBody) {
    throw new Error("Message body cannot be empty.");
  }

  const sender = await resolvePortalLogin(normalizedSenderEmail);
  if (!sender.allowed) {
    throw new Error("You do not have permission to send messages.");
  }

  const senderRole = sender.role === "owner" 
    ? SupportMessageSenderRole.OWNER 
    : sender.role === "manager" 
      ? SupportMessageSenderRole.MANAGER 
      : SupportMessageSenderRole.RESIDENT;

  // For residents, we need to verify they are in the group they are posting to.
  if (senderRole === SupportMessageSenderRole.RESIDENT) {
    const context = await getClientGroupContext(normalizedSenderEmail);
    const allowedGroupIds = Object.values(context.groupIds);
    if (!allowedGroupIds.includes(input.groupId)) {
      throw new Error("You can only post to groups you belong to.");
    }
  }

  const senderName = senderRole === SupportMessageSenderRole.RESIDENT
    ? (await getActiveClientByEmail(normalizedSenderEmail))?.["Họ và tên"] ?? "Resident"
    : sender.name ?? sender.email;

  return prisma.groupMessage.create({
    data: {
      groupId: input.groupId,
      senderEmail: normalizedSenderEmail,
      senderName,
      senderRole,
      isAnonymous: input.isAnonymous,
      body: trimmedBody
    }
  });
}

export async function markGroupRead(input: {
  groupId: string;
  viewerEmail: string;
}) {
  const normalizedViewerEmail = normalizeEmail(input.viewerEmail);

  return prisma.groupReadState.upsert({
    where: {
      groupId_viewerEmail: {
        groupId: input.groupId,
        viewerEmail: normalizedViewerEmail
      }
    },
    update: {
      lastReadAt: new Date()
    },
    create: {
      groupId: input.groupId,
      viewerEmail: normalizedViewerEmail,
      lastReadAt: new Date()
    }
  });
}
