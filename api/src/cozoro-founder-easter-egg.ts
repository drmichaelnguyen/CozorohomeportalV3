/**
 * Playful canned replies when someone asks who built / founded CozoroHome or about anh Trọng / Mr. Trong
 * (manager AI + resident Bee). Client may show a short full-screen starfield when `showStarfieldEffect` is true.
 */

import { detectCozoroVentHate } from "./cozoro-vent-hammer-easter-egg.js";

export type FounderEggLanguage = "en" | "vi";

export type FounderEasterEggResult = {
  reply: string;
  /** Hint for portal: show celebratory star sky ~5s */
  showStarfieldEffect: true;
};

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Named references to Trọng / founder (ASCII-ish after normalize). */
const TRONG_PERSON_MARKERS = [
  "anh trong",
  "ong trong",
  "mr trong",
  "trong nguyen",
  "nguyen trong",
  "dr trong",
  "bac trong",
  "bac si trong",
  "anh trong nguyen",
  "bac trong nguyen"
];

/** Substrings on normalized text — builder / founder / app attribution. */
const FOUNDER_BUILD_TRIGGERS = [
  "who built",
  "who made",
  "who created",
  "who developed",
  "who founded",
  "who wrote",
  "who runs cozoro",
  "who is behind",
  "founder of cozoro",
  "cozorohome founder",
  "founder of cozorohome",
  "founder cozoro",
  "trong to",
  "ai sang lap",
  "nguoi sang lap",
  "sang lap cozoro",
  "sang lap cozorohome",
  "ai xay dung",
  "ai lam app",
  "ai tao ra",
  "ai tao app",
  "app nay ai",
  "ung dung nay ai",
  "anh trong dep",
  "developer cua",
  "developer of"
];

function mentionsTrongPerson(n: string): boolean {
  return TRONG_PERSON_MARKERS.some((m) => n.includes(m));
}

function mentionsFounderBuild(n: string): boolean {
  return FOUNDER_BUILD_TRIGGERS.some((t) => n.includes(t));
}

function shortQuip(language: FounderEggLanguage): string {
  if (language === "vi") {
    return "He he — chính **anh Trọng đẹp trai** đó là người sáng lập & xây dựng CozoroHome đó! Bạn có thích… **yêu quý anh Trọng** hông? 💛";
  }
  return "Haha — **Mr. Trong** (handsome as ever) founded and built CozoroHome! Sooo… do you maybe *love* dear Mr. Trong? 💛";
}

function longAboutTrong(language: FounderEggLanguage): string {
  if (language === "vi") {
    return (
      "**Nguyễn Trọng** — mọi người hay gọi thân mật là **anh Trọng** — là bác sĩ, chủ nhà co-living và người sáng lập **CozoroHome**. " +
      "Anh ấy đã ấp ủ không gian sống D2/D7 thân thiện và dựng portal này để cư dân & ban quản lý làm mọi thứ nhẹ nhàng hơn: giặt, thanh toán, lịch dọn bếp/rác, tin nhắn hỗ trợ… " +
      "Và đúng rồi — **anh Trọng đẹp trai** đó! Bạn có thích… **yêu quý anh Trọng** hông? 💛✨"
    );
  }
  return (
    "**Nguyen Trong** — everyone affectionately calls him **Mr. Trong** — is a physician, co-living host, and the founder of **CozoroHome**. " +
    "He shaped the D2/D7 resident experience and built this portal so daily life stays simple: laundry, payments, cleaning shifts, support chat, and more. " +
    "And yes: **Mr. Trong, still handsome.** Sooo… do you maybe *love* dear Mr. Trong? 💛✨"
  );
}

export function tryFounderEasterEggReply(
  lastUserMessage: string,
  language: FounderEggLanguage
): FounderEasterEggResult | null {
  const raw = lastUserMessage?.trim();
  if (!raw) return null;
  if (detectCozoroVentHate(raw)) {
    return null;
  }
  const n = normalizeForMatch(raw);
  if (!n) return null;

  const person = mentionsTrongPerson(n);
  const founder = mentionsFounderBuild(n);
  if (!person && !founder) return null;

  const reply = person ? longAboutTrong(language) : shortQuip(language);
  return { reply, showStarfieldEffect: true };
}
