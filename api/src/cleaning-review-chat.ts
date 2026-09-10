import type { Prisma } from "@prisma/client";

/** Called inside the dispute transaction so chat and dispute updates commit together. */
export async function appendCleaningReviewChatMessage(
  tx: Pick<Prisma.TransactionClient, "supportConversation" | "supportMessage">,
  input: {
    review: { id: string; userEmail: string; userName: string | null; branchId: string; taskType: string; scheduledDate: Date; status: string };
    actor: { email: string; role: string; staff: boolean };
    body: string;
    action: "comment" | "resolve" | "reopen";
  }
) {
  const { review, actor } = input;
  const residentEmail = review.userEmail.trim().toLowerCase();
  const date = new Intl.DateTimeFormat("vi-VN", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(review.scheduledDate);
  const task = review.taskType.startsWith("TRASH") ? "Trash duty / Đổ rác" : "Kitchen cleaning / Vệ sinh bếp";
  const action = input.action === "resolve" ? "Resolved / Đã giải quyết" : input.action === "reopen" ? "Reopened / Mở lại" : "Discussion / Trao đổi";
  const conversation = await tx.supportConversation.upsert({
    where: { residentEmail },
    create: { residentEmail, residentName: review.userName, status: "OPEN" },
    update: { status: "OPEN" }
  });
  const message = await tx.supportMessage.create({
    data: {
      conversationId: conversation.id,
      senderEmail: actor.email,
      senderName: actor.staff ? "Cozoro" : review.userName,
      senderRole: actor.staff ? (actor.role === "owner" ? "OWNER" : "MANAGER") : "RESIDENT",
      body: `Cleaning schedule dispute / Phản đối lịch vệ sinh\n${review.branchId} · ${task} · ${date}\n${action}\n\n${input.body}`,
      pagePath: `/cleaning-review?id=${encodeURIComponent(review.id)}`
    }
  });
  await tx.supportConversation.update({
    where: { id: conversation.id }, data: { lastMessageAt: message.createdAt, status: "OPEN" }
  });
}
