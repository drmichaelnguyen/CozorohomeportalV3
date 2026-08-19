import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type BranchBroadcastNotice = {
  id: string;
  branch: "D2" | "D7";
  title: string;
  body: string;
  sentAt: string;
  sentBy: string;
  recipientEmails: string[];
  readBy: string[];
};

type BranchBroadcastsFile = { notices: BranchBroadcastNotice[] };

const BRANCH_BROADCASTS_PATH = path.join(process.cwd(), "data", "branch-broadcasts.json");

export async function readBranchBroadcasts(): Promise<BranchBroadcastsFile> {
  try {
    const raw = await readFile(BRANCH_BROADCASTS_PATH, "utf8");
    const parsed = JSON.parse(raw) as BranchBroadcastsFile;
    return { notices: Array.isArray(parsed.notices) ? parsed.notices : [] };
  } catch {
    return { notices: [] };
  }
}

export async function writeBranchBroadcasts(file: BranchBroadcastsFile): Promise<void> {
  await mkdir(path.dirname(BRANCH_BROADCASTS_PATH), { recursive: true });
  await writeFile(BRANCH_BROADCASTS_PATH, JSON.stringify(file, null, 2), "utf8");
}

export async function queueBranchBroadcast(input: {
  branch: "D2" | "D7";
  title: string;
  body: string;
  sentBy: string;
  recipientEmails: string[];
  noticeId?: string;
}) {
  const file = await readBranchBroadcasts();
  file.notices.unshift({
    id: input.noticeId ?? randomUUID(),
    branch: input.branch,
    title: input.title.trim(),
    body: input.body.trim(),
    sentAt: new Date().toISOString(),
    sentBy: input.sentBy.trim().toLowerCase(),
    recipientEmails: [...new Set(input.recipientEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))],
    readBy: []
  });
  if (file.notices.length > 200) {
    file.notices = file.notices.slice(0, 200);
  }
  await writeBranchBroadcasts(file);
}

export async function markBranchBroadcastRead(noticeId: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const file = await readBranchBroadcasts();
  const notice = file.notices.find((entry) => entry.id === noticeId);
  if (!notice) {
    return false;
  }
  if (!notice.recipientEmails.includes(normalizedEmail)) {
    return false;
  }
  if (!notice.readBy.includes(normalizedEmail)) {
    notice.readBy.push(normalizedEmail);
    await writeBranchBroadcasts(file);
  }
  return true;
}

export async function listPendingBranchBroadcasts(email: string, branch: "D2" | "D7") {
  const normalizedEmail = email.trim().toLowerCase();
  const file = await readBranchBroadcasts();
  return file.notices
    .filter(
      (notice) =>
        notice.branch === branch &&
        notice.recipientEmails.includes(normalizedEmail) &&
        !notice.readBy.includes(normalizedEmail)
    )
    .slice(0, 3)
    .map((notice) => ({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      sentAt: notice.sentAt,
      branch: notice.branch
    }));
}
