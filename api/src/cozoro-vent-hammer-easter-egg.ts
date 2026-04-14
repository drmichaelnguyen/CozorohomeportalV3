/**
 * Resident Cozoro Bee: if user vents hate toward Cozoro / anh Trọng, offer a silly hammer mini-game;
 * on "yes", client opens the game and later redeems capped coins via API.
 */

import type { FounderEggLanguage } from "./cozoro-founder-easter-egg.js";

export type VentHammerEggLanguage = FounderEggLanguage;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COZORO_MARKERS = ["cozoro", "cozorohome", "cozoro home"];
const TRONG_MARKERS = [
  "anh trong",
  /** "Ông Trọng" (respectful) normalizes to "ong trong" */
  "ong trong",
  "mr trong",
  "trong nguyen",
  "nguyen trong",
  "dr trong",
  "bac trong",
  "bac si trong"
];

const HATE_WORDS = [
  "hate",
  "loathe",
  "despise",
  "ghet",
  "stupid",
  "idiot",
  "worst",
  "terrible",
  "awful",
  "garbage",
  "trash",
  "sucks",
  "suck",
  "scam",
  "shit",
  "damn",
  "pathetic",
  "useless",
  "hate you",
  "chan",
  "te qua",
  "vo dung",
  "dien",
  "ngu ngoc",
  "xau xa"
];

function mentionsCozoroOrTrong(n: string): boolean {
  return COZORO_MARKERS.some((m) => n.includes(m)) || TRONG_MARKERS.some((m) => n.includes(m));
}

function mentionsHateOrStrongNegative(n: string): boolean {
  if (HATE_WORDS.some((w) => n.includes(w))) return true;
  if (/( hate | hating | hated )/.test(` ${n} `)) return true;
  return false;
}

/** True when user clearly vents at Cozoro / Mr. Trọng (not e.g. "I don't hate Cozoro"). */
export function detectCozoroVentHate(raw: string): boolean {
  const rawLower = raw.trim().toLowerCase();
  if (/don'?t hate|do not hate|khong ghet|không ghét|not hate|no hate|love cozoro|thich cozoro/.test(rawLower)) {
    return false;
  }
  const n = normalize(raw);
  if (!n) return false;
  if (!mentionsCozoroOrTrong(n)) return false;
  return mentionsHateOrStrongNegative(n);
}

function isShortAffirmative(raw: string): boolean {
  const t = normalize(raw);
  if (!t || t.length > 56) return false;
  if (/^(no|nope|nah|khong|không)\b/.test(t)) return false;
  if (/^co(\s+a)?$/.test(t)) return true;
  return /^(yes|yeah|yep|yup|ok|okay|sure|please|go|play|lets go|let s go|do it|vang|vâng|da|dạ|đồng ý|dong y|thu|thử|chơi|choi|okie|ukm|uh huh|mhm|fine|why not|được|duoc)$/.test(
    t
  );
}

function isShortRefusal(raw: string): boolean {
  const t = normalize(raw);
  if (!t || t.length > 56) return false;
  return /^(no|nope|nah|never|khong|không|dont|don t|thoi|thôi|dung|đừng|cancel|stop|no thanks)$/.test(t);
}

const OFFER_TTL_MS = 15 * 60 * 1000;
const pendingOfferUntil = new Map<string, number>();

function keyEmail(email: string) {
  return email.trim().toLowerCase();
}

export function registerVentHammerOffer(email: string): void {
  pendingOfferUntil.set(keyEmail(email), Date.now() + OFFER_TTL_MS);
}

export function clearVentHammerOffer(email: string): void {
  pendingOfferUntil.delete(keyEmail(email));
}

export function hasActiveVentHammerOffer(email: string): boolean {
  const k = keyEmail(email);
  const exp = pendingOfferUntil.get(k);
  if (!exp || Date.now() > exp) {
    pendingOfferUntil.delete(k);
    return false;
  }
  return true;
}

export function tryVentHammerPendingRefusalReply(
  email: string,
  lastUserMessage: string,
  language: VentHammerEggLanguage
): { reply: string } | null {
  if (!hasActiveVentHammerOffer(email)) return null;
  if (!isShortRefusal(lastUserMessage)) return null;
  clearVentHammerOffer(email);
  if (language === "vi") {
    return {
      reply:
        "Không sao đâu — mình tôn trọng ý bạn. Nếu sau này muốn nói chuyện hay cần hỗ trợ gì, cứ nhắn mình nhé."
    };
  }
  return {
    reply:
      "That’s totally okay — I respect that. If you want to talk later or need anything, I’m still here for you."
  };
}

export function tryVentHammerConsentReply(
  email: string,
  lastUserMessage: string,
  language: VentHammerEggLanguage
): { reply: string; startVentHammerGame: true } | null {
  if (!hasActiveVentHammerOffer(email)) return null;
  if (detectCozoroVentHate(lastUserMessage)) return null;
  if (!isShortAffirmative(lastUserMessage)) return null;
  clearVentHammerOffer(email);
  if (language === "vi") {
    return {
      reply:
        "Dzô! Mình mở **trò đập búa** (30 giây) — đó là ảnh đại diện của anh Trọng thôi, cho đỡ bực nhé. **Mỗi lần trúng +10 coin** (cộng sau vòng). Chúc bạn… trúng đều tay! 🐝🔨",
      startVentHammerGame: true
    };
  }
  return {
    reply:
      "Let’s go — opening the **30-second hammer mini-game**! That’s **Mr. Trong’s avatar** floating around (just for laughs). **+10 coins per clean hit**, credited after the round. Have fun! 🐝🔨",
    startVentHammerGame: true
  };
}

export function tryVentHammerHateReply(
  lastUserMessage: string,
  language: VentHammerEggLanguage,
  email: string
): { reply: string; ventGameOfferPending: true } | null {
  if (!detectCozoroVentHate(lastUserMessage)) return null;
  registerVentHammerOffer(email);
  if (language === "vi") {
    return {
      reply:
        "Mình nghe bạn đang rất khó chịu… Xin lỗi vì cảm giác đó. Bạn có muốn **xả stress theo kiểu hơi ngớ ngẩn** không: một **trò mini 30 giây** — ảnh **anh Trọng** bay loạn, bạn dùng **búa** (ảo) đập trúng thì **mỗi lần +10 Cozoro coin** (cộng thật sau khi hết giờ). Nếu muốn thử, trả lời **có** hoặc **ok** nhé.",
      ventGameOfferPending: true
    };
  }
  return {
    reply:
      "That sounds really rough — I’m sorry you’re feeling that way. Want a **silly way to blow off steam**? I can launch a **30-second mini-game**: **Mr. Trong’s avatar** zips around and you tap with a **virtual hammer** — **+10 Cozoro coins per clean hit** (for real, credited after the round). If you want to try it, reply **yes** or **ok**.",
    ventGameOfferPending: true
  };
}
