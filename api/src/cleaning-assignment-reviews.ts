import { appendCleaningReviewChatMessage } from "./cleaning-review-chat.js";
import { clearNotificationCaches } from "./support.js";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { resolvePortalLogin, getManagerPermissions } from "./staff-access.js";
import { logAction } from "./action-log.js";

function deny(message: string, statusCode = 403): never {
  throw Object.assign(new Error(message), { statusCode });
}

async function reviewActor(email: string) {
  const normalized = email.trim().toLowerCase();
  const actor = await resolvePortalLogin(normalized);
  if (!actor.allowed || !actor.role) deny("Sign in to review this assignment.");
  const staff = ["manager", "owner", "app_admin"].includes(actor.role);
  if (!staff && actor.role !== "user") deny("You cannot access cleaning assignment reviews.");
  const permissions = actor.role === "manager" ? await getManagerPermissions(normalized, normalized) : null;
  return { email: normalized, role: actor.role, staff, permissions };
}

function authorize(actor: Awaited<ReturnType<typeof reviewActor>>, target: { userEmail: string; branchId: string }, write = false) {
  if (!actor.staff && actor.email !== target.userEmail.trim().toLowerCase()) deny("This assignment belongs to another resident.");
  if (actor.permissions) {
    if (actor.permissions.branches.length && !actor.permissions.branches.includes(target.branchId)) deny("This branch is outside your permissions.");
    const access = actor.permissions.data.cleaning;
    if (access && (!access.read || (write && !access.write))) deny("Cleaning review permission is required.");
  }
}
const messages = { orderBy: { createdAt: "asc" as const } };

export async function getAssignmentReviewForTask(actorEmail: string, taskId: string) {
  const actor = await reviewActor(actorEmail);
  const task = await prisma.cleaningTask.findUnique({ where: { id: taskId } });
  if (!task) deny("Cleaning task not found.", 404);
  authorize(actor, task);
  const review = await prisma.cleaningAssignmentReview.findUnique({
    where: { taskId_userEmail: { taskId, userEmail: task.userEmail.toLowerCase() } }, include: { messages }
  });
  return { explanation: task.assignmentExplanation, review, canResolve: actor.staff };
}

export async function listAssignmentReviews(actorEmail: string, includeResolved = false) {
  const actor = await reviewActor(actorEmail);
  if (actor.permissions?.data.cleaning && !actor.permissions.data.cleaning.read) deny("Cleaning review permission is required.");
  return prisma.cleaningAssignmentReview.findMany({
    where: {
      ...(!includeResolved ? { status: "OPEN" } : {}),
      ...(!actor.staff ? { userEmail: actor.email } : {}),
      ...(actor.permissions?.branches.length ? { branchId: { in: actor.permissions.branches } } : {})
    },
    orderBy: { updatedAt: "desc" }, take: 100,
    select: { id: true, taskId: true, userName: true, branchId: true, taskType: true, scheduledDate: true, status: true, updatedAt: true }
  });
}

export async function getAssignmentReview(actorEmail: string, reviewId: string) {
  const actor = await reviewActor(actorEmail);
  const review = await prisma.cleaningAssignmentReview.findUnique({ where: { id: reviewId }, include: { messages } });
  if (!review) deny("Review not found.", 404);
  authorize(actor, review);
  return { explanation: review.explanation, review, canResolve: actor.staff };
}

export async function postAssignmentReview(input: {
  actorEmail: string; taskId?: string; reviewId?: string; body: string; action: "comment" | "resolve" | "reopen";
}) {
  const actor = await reviewActor(input.actorEmail);
  const body = input.body.trim();
  if (!body || body.length > 2000) deny("Enter a reason or reply between 1 and 2,000 characters.", 400);
  if (input.action === "resolve" && !actor.staff) deny("Only the host can resolve an assignment dispute.");
  const existing = input.reviewId ? await prisma.cleaningAssignmentReview.findUnique({ where: { id: input.reviewId } }) : null;
  if (input.reviewId && !existing) deny("Review not found.", 404);
  const task = !existing && input.taskId ? await prisma.cleaningTask.findUnique({ where: { id: input.taskId } }) : null;
  const target = existing ?? task;
  if (!target) deny("Cleaning assignment not found.", 404);
  authorize(actor, target, true);
  if (!existing && task && task.assignmentSource !== "SYSTEM" && !task.assignmentExplanation) {
    deny("This assignment was not automatically selected.", 400);
  }
  if (!existing && input.action === "resolve") deny("Open the dispute before resolving it.", 400);
  const result = await prisma.$transaction(async tx => {
    const review = existing ?? await tx.cleaningAssignmentReview.upsert({
      where: { taskId_userEmail: { taskId: task!.id, userEmail: task!.userEmail.toLowerCase() } },
      create: {
        taskId: task!.id, userEmail: task!.userEmail.toLowerCase(), userName: task!.userName,
        branchId: task!.branchId, taskType: task!.type, scheduledDate: task!.scheduledDate,
        explanation: task!.assignmentExplanation ?? Prisma.DbNull
      }, update: {}
    });
    const updated = await tx.cleaningAssignmentReview.update({
      where: { id: review.id },
      data: {
        status: input.action === "resolve" ? "RESOLVED" : "OPEN",
        updatedAt: new Date(),
        messages: { create: { authorRole: actor.staff ? "host" : "resident", body } }
      }, include: { messages }
    });
    await appendCleaningReviewChatMessage(tx, { review: updated, actor, body, action: input.action });
    return updated;
  });
  clearNotificationCaches(actor.email, result.userEmail);
  await logAction({ actorEmail: actor.email, actorRole: actor.role,
    action: `cleaning.assignment_review.${input.action}`, entityType: "CleaningAssignmentReview", entityId: result.id });
  return { review: result, explanation: result.explanation, canResolve: actor.staff };
}
