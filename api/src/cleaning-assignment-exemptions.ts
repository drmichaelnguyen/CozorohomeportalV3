import { prisma } from "./prisma.js";
import { requirePortalRole } from "./staff-access.js";
import { logAction } from "./action-log.js";

export async function getCleaningAssignmentExemptions(): Promise<Set<string>> {
  const rows = await prisma.cleaningAssignmentExemption.findMany({
    where: { exempt: true }, select: { userEmail: true }
  });
  return new Set(rows.map(row => row.userEmail.trim().toLowerCase()));
}

export async function isCleaningAssignmentExempt(email: string) {
  const row = await prisma.cleaningAssignmentExemption.findUnique({
    where: { userEmail: email.trim().toLowerCase() }
  });
  return row?.exempt === true;
}

export async function getOwnerCleaningAssignmentExemption(actorEmail: string, targetEmail: string) {
  await requirePortalRole(actorEmail, ["owner", "app_admin"], "Only owners or app admins can manage cleaning exemptions.");
  return { exempt: await isCleaningAssignmentExempt(targetEmail) };
}

export async function setOwnerCleaningAssignmentExemption(input: {
  actorEmail: string; targetEmail: string; exempt: boolean;
}) {
  const actor = await requirePortalRole(input.actorEmail, ["owner", "app_admin"], "Only owners or app admins can manage cleaning exemptions.");
  const userEmail = input.targetEmail.trim().toLowerCase();
  const row = await prisma.cleaningAssignmentExemption.upsert({
    where: { userEmail },
    create: { userEmail, exempt: input.exempt, updatedBy: actor.email },
    update: { exempt: input.exempt, updatedBy: actor.email }
  });
  await logAction({
    actorEmail: actor.email, actorRole: actor.role,
    action: "cleaning.assignment_exemption.set", entityType: "CleaningAssignmentExemption",
    entityId: userEmail, details: `exempt=${input.exempt}`
  });
  return { exempt: row.exempt };
}
