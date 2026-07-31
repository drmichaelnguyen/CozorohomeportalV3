import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma.js";
import { resolvePortalLogin } from "./staff-access.js";
import { getClientGroupContext } from "./group-support.js";

export type ChatAttachmentInput = {
  dataUrl: string;
  fileName: string;
  width?: number;
  height?: number;
};

export const chatAttachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true
} as const;

const storageDir = path.join(process.cwd(), "data", "chat-attachments");
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function saveChatAttachments(input: {
  supportMessageId?: string;
  groupMessageId?: string;
  attachments: ChatAttachmentInput[];
}) {
  if (input.attachments.length > 3) throw new Error("A maximum of 3 images is allowed per message.");
  if (input.attachments.length === 0) return [];
  await mkdir(storageDir, { recursive: true });

  const saved = [];
  for (const attachment of input.attachments) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(attachment.dataUrl);
    if (!match || !allowedMimeTypes.has(match[1]!)) throw new Error("Unsupported image format.");
    const bytes = Buffer.from(match[2]!, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 2_000_000) throw new Error("Each compressed image must be 2 MB or smaller.");
    const extension = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
    const storageName = `${randomUUID()}.${extension}`;
    await writeFile(path.join(storageDir, storageName), bytes, { flag: "wx" });
    saved.push(await prisma.chatAttachment.create({
      data: {
        supportMessageId: input.supportMessageId,
        groupMessageId: input.groupMessageId,
        storageName,
        fileName: attachment.fileName.trim().slice(0, 191) || `image.${extension}`,
        mimeType: match[1]!,
        byteSize: bytes.byteLength,
        width: attachment.width,
        height: attachment.height
      },
      select: chatAttachmentSelect
    }));
  }
  return saved;
}

export async function getChatAttachmentForViewer(id: string, viewerEmail: string) {
  const normalizedEmail = viewerEmail.trim().toLowerCase();
  const attachment = await prisma.chatAttachment.findUnique({
    where: { id },
    include: {
      supportMessage: { include: { conversation: { select: { residentEmail: true } } } },
      groupMessage: { select: { groupId: true } }
    }
  });
  if (!attachment) throw new Error("Attachment not found.");

  const viewer = await resolvePortalLogin(normalizedEmail);
  const isStaff = viewer.allowed && viewer.role != null && viewer.role !== "user";
  let allowed = isStaff;
  if (attachment.supportMessage) {
    allowed ||= attachment.supportMessage.conversation.residentEmail === normalizedEmail;
  } else if (attachment.groupMessage && !allowed) {
    const context = await getClientGroupContext(normalizedEmail);
    allowed = Object.values(context.groupIds).includes(attachment.groupMessage.groupId);
  }
  if (!allowed) throw new Error("You do not have access to this attachment.");

  return {
    absolutePath: path.join(storageDir, attachment.storageName),
    mimeType: attachment.mimeType,
    fileName: attachment.fileName
  };
}
