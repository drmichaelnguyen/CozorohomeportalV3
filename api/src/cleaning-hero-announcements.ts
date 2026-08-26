import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getManagerClients } from "./google-sheets.js";
import { queueBranchBroadcast } from "./branch-broadcasts.js";
import { sendPushToEmail } from "./push.js";
import type { CleaningHeroAward, CleaningHeroPeriodType } from "./cleaning-hero-awards.js";

const announcementsFilePath = path.join(process.cwd(), "data", "cleaning-hero-announcements.json");

export type CleaningHeroAnnouncement = {
  id: string;
  awardId: string;
  periodType: CleaningHeroPeriodType;
  periodKey: string;
  winnerName: string | null;
  winnerEmail: string;
  coinsAwarded: number;
  title: string;
  titleVi: string;
  body: string;
  announcedAt: string;
  readBy: string[];
};

type HeroAnnouncementsFile = {
  announcements: CleaningHeroAnnouncement[];
};

const SELF_ASSIGN_PROMO_EN =
  "Want more coins? Open Schedule and self-assign open cleaning slots: weekday x2, weekend x2.5, Vietnam holiday x3. The resident with the most self-assign completions wins Cozoro Hero bonuses — +30,000 coins/month and +50,000 coins/quarter.";
const SELF_ASSIGN_PROMO_VI =
  "Muốn kiếm thêm coin? Mở Lịch trình và tự nhận các slot vệ sinh còn trống: ngày thường x2, cuối tuần x2,5, ngày lễ VN x3. Ai hoàn thành nhiều lịch tự nhận nhất sẽ nhận thưởng Anh hùng Cozoro — +30.000 coin/tháng và +50.000 coin/quý.";

function formatPeriodLabel(periodType: CleaningHeroPeriodType, periodKey: string) {
  if (periodType === "month") {
    const [year, month] = periodKey.split("-");
    return `${year}-${month}`;
  }
  if (periodType === "quarter") {
    return periodKey.replace("-", " ");
  }
  return periodKey;
}

function buildAnnouncementCopy(award: CleaningHeroAward) {
  const winnerLabel = award.userName?.trim() || award.userEmail;
  const periodLabel = formatPeriodLabel(award.periodType, award.periodKey);
  const coinsLabel = award.coinsAwarded.toLocaleString("en-US");

  const title = `${award.title} — ${periodLabel}`;
  const body = [
    `Congratulations to ${winnerLabel}! They completed the most self-assigned cleaning tasks in ${periodLabel} (${award.completedCount} tasks) and received +${coinsLabel} bonus coins.`,
    "",
    SELF_ASSIGN_PROMO_EN,
    "",
    "---",
    "",
    `Chúc mừng ${winnerLabel}! Bạn ấy hoàn thành nhiều lịch tự nhận nhất trong ${periodLabel} (${award.completedCount} lịch) và nhận +${coinsLabel} coin thưởng.`,
    "",
    SELF_ASSIGN_PROMO_VI
  ].join("\n");

  return { title, body };
}

async function readAnnouncementsFile(): Promise<HeroAnnouncementsFile> {
  try {
    const raw = await readFile(announcementsFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<HeroAnnouncementsFile> | null;
    return { announcements: Array.isArray(parsed?.announcements) ? parsed.announcements : [] };
  } catch {
    return { announcements: [] };
  }
}

async function writeAnnouncementsFile(file: HeroAnnouncementsFile) {
  await mkdir(path.dirname(announcementsFilePath), { recursive: true });
  await writeFile(announcementsFilePath, JSON.stringify(file, null, 2), "utf8");
}

function normalizeBranch(value: string): "D2" | "D7" | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7")) {
    return "D7";
  }
  if (normalized === "2" || normalized === "D2" || normalized.includes("D2")) {
    return "D2";
  }
  return null;
}

/**
 * Broadcast a month/quarter hero award to all active clients: push, first-open popup, and Notification Center.
 */
export async function announceCleaningHeroAward(award: CleaningHeroAward): Promise<boolean> {
  if (award.coinsAwarded <= 0 || !award.userEmail.trim()) {
    return false;
  }
  if (award.periodType !== "month" && award.periodType !== "quarter") {
    return false;
  }

  const file = await readAnnouncementsFile();
  if (file.announcements.some((entry) => entry.awardId === award.id)) {
    return false;
  }

  const { title, body } = buildAnnouncementCopy(award);
  const clients = await getManagerClients();
  const recipientsByBranch = {
    D2: [] as string[],
    D7: [] as string[]
  };

  for (const client of clients) {
    const email = client.email.trim().toLowerCase();
    if (!email) {
      continue;
    }
    const branch = normalizeBranch(client.branch);
    if (branch) {
      recipientsByBranch[branch].push(email);
    }
  }

  const noticeId = `hero-announce-${award.id}`;
  for (const branch of ["D2", "D7"] as const) {
    const recipientEmails = recipientsByBranch[branch];
    if (!recipientEmails.length) {
      continue;
    }
    await queueBranchBroadcast({
      noticeId: `${noticeId}-${branch}`,
      branch,
      title,
      body,
      sentBy: "system:cleaning-hero-awards",
      recipientEmails
    });
    for (const email of recipientEmails) {
      await sendPushToEmail(email, title, body.split("\n")[0] ?? title, "/schedule");
    }
  }

  file.announcements.unshift({
    id: noticeId,
    awardId: award.id,
    periodType: award.periodType,
    periodKey: award.periodKey,
    winnerName: award.userName,
    winnerEmail: award.userEmail,
    coinsAwarded: award.coinsAwarded,
    title: award.title,
    titleVi: award.titleVi,
    body,
    announcedAt: new Date().toISOString(),
    readBy: []
  });
  if (file.announcements.length > 100) {
    file.announcements = file.announcements.slice(0, 100);
  }
  await writeAnnouncementsFile(file);

  console.log(
    `[cleaning-hero] Announced ${award.periodType} ${award.periodKey} hero to all clients (${award.userEmail}, +${award.coinsAwarded} coins)`
  );
  return true;
}

export async function listCleaningHeroAnnouncementsForEmail(
  email: string,
  options?: { withinDays?: number }
): Promise<CleaningHeroAnnouncement[]> {
  const normalized = email.trim().toLowerCase();
  const withinDays = options?.withinDays ?? 45;
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  const file = await readAnnouncementsFile();
  return file.announcements.filter((entry) => new Date(entry.announcedAt).getTime() >= cutoff);
}

export async function markCleaningHeroAnnouncementRead(announcementId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  const file = await readAnnouncementsFile();
  const entry = file.announcements.find((row) => row.id === announcementId);
  if (!entry) {
    return false;
  }
  if (!entry.readBy.includes(normalized)) {
    entry.readBy.push(normalized);
    await writeAnnouncementsFile(file);
  }
  return true;
}
