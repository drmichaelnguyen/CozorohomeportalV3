/**
 * Pure donation-partnership rules: form parsing, coupon math, and follow-up timing.
 * Stay coupons are separate from laundry coupons.
 * SHORT_TERM waives one hostel night (the lowest nightly rate). Deposit is unchanged.
 * LONG_TERM waives one month of rent on the first payment. Deposit is unchanged.
 */

export const DONATION_COUPON_NOTE_PREFIX = "Donation coupon:";
export const DONATION_FOLLOW_UP_HOUR_VN = 9;
export const DONATION_FOLLOW_UP_LATE_MS = 48 * 60 * 60 * 1000;
export const VN_OFFSET_HOURS = 7;

export type DonationTermType = "SHORT_TERM" | "LONG_TERM";
export type DonationKind = "CASH" | "IN_KIND";
export type FollowUpKind = "PRE_EVENT" | "POST_EVENT";

export type PlannedFollowUp = {
  kind: FollowUpKind;
  scheduledFor: Date;
  status: "SCHEDULED" | "SKIPPED";
  skipReason: string | null;
};

export type ParsedDonationFields = {
  name: string | null;
  phone: string | null;
  email: string | null;
  donationType: DonationKind | null;
  donationDetail: string | null;
  eventName: string | null;
  eventDetails: string | null;
  eventDate: string | null;
  socialPlatform: string | null;
  socialHandle: string | null;
  socialLink: string | null;
  returnOffer: string | null;
};

const COUPON_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const LABEL_FIELDS: Array<{ labels: string[]; field: keyof ParsedDonationFields }> = [
  { labels: ["full name", "donor name", "họ và tên", "ho va ten", "họ tên", "ho ten", "name", "tên", "ten"], field: "name" },
  { labels: ["phone number", "số điện thoại", "so dien thoai", "điện thoại", "dien thoai", "phone", "sđt", "sdt"], field: "phone" },
  { labels: ["email address", "địa chỉ email", "dia chi email", "email", "e-mail"], field: "email" },
  {
    labels: [
      "donation type",
      "loại quyên góp",
      "loai quyen gop",
      "loại ủng hộ",
      "type",
      "hình thức",
      "hinh thuc"
    ],
    field: "donationType"
  },
  {
    labels: ["donation detail", "donation details", "chi tiết quyên góp", "chi tiet quyen gop", "detail", "chi tiết", "chi tiet"],
    field: "donationDetail"
  },
  { labels: ["event name", "tên sự kiện", "ten su kien", "event", "sự kiện", "su kien"], field: "eventName" },
  {
    labels: ["event details", "event detail", "chi tiết sự kiện", "chi tiet su kien", "event description"],
    field: "eventDetails"
  },
  { labels: ["event date", "ngày sự kiện", "ngay su kien", "ngày diễn ra", "ngay dien ra", "date"], field: "eventDate" },
  { labels: ["social platform", "nền tảng", "nen tang", "platform"], field: "socialPlatform" },
  { labels: ["social handle", "handle", "tài khoản", "tai khoan", "username"], field: "socialHandle" },
  { labels: ["social link", "social url", "link mxh", "profile link", "link"], field: "socialLink" },
  {
    labels: [
      "return offer",
      "what they will post",
      "what they'll post",
      "cam kết đăng",
      "cam ket dang",
      "bài đăng đổi lại",
      "offer"
    ],
    field: "returnOffer"
  }
];

export function normalizeDonationCouponCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isDonationCouponCode(value: string) {
  return /^CZD-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeDonationCouponCode(value));
}

export function generateDonationCouponCode(randomByte: () => number) {
  const chunk = () =>
    Array.from({ length: 4 }, () => COUPON_ALPHABET[randomByte() % COUPON_ALPHABET.length]).join("");
  return `CZD-${chunk()}-${chunk()}`;
}

export function donationCouponNote(code: string) {
  return `${DONATION_COUPON_NOTE_PREFIX} ${normalizeDonationCouponCode(code)}`;
}

export function donationCouponCodeFromNotes(notes: string | null | undefined) {
  const match = String(notes ?? "").match(/Donation coupon:\s*(CZD-[A-Z0-9]{4}-[A-Z0-9]{4})/i);
  return match ? normalizeDonationCouponCode(match[1]) : "";
}

export function preserveDonationCouponNote(originalNotes: string | null | undefined, nextNotes: string | null | undefined) {
  const code = donationCouponCodeFromNotes(originalNotes);
  const next = String(nextNotes ?? "").trim();
  if (!code || donationCouponCodeFromNotes(next)) return next;
  return [next, donationCouponNote(code)].filter(Boolean).join(" | ");
}

export function addCalendarDays(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** 09:00 Asia/Ho_Chi_Minh on a calendar date, as a UTC Date. */
export function vietnamMorningUtc(ymd: string, hour = DONATION_FOLLOW_UP_HOUR_VN) {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day, hour - VN_OFFSET_HOURS, 0, 0));
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function dmyToIso(day: number, month: number, year: number) {
  if (year < 100) year += 2000;
  const ymd = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(ymd) ? ymd : null;
}

/** Parse a calendar date. Day-first when the text uses slashes or dashes (Vietnam). */
export function parseEventDate(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const ymd = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (isIsoDate(ymd)) return ymd;
  }

  const dmy = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/);
  if (dmy) {
    return dmyToIso(Number(dmy[1]), Number(dmy[2]), Number(dmy[3]));
  }

  return null;
}

export function normalizeDonationType(value: string | null | undefined): DonationKind | null {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!text) return null;
  if (/(in[\s-]?kind|inkind|hien vat|goods|item|vat pham)/.test(text)) return "IN_KIND";
  if (/(cash|tien mat|money|vnd|bank)/.test(text)) return "CASH";
  return null;
}

function emptyParsed(): ParsedDonationFields {
  return {
    name: null,
    phone: null,
    email: null,
    donationType: null,
    donationDetail: null,
    eventName: null,
    eventDetails: null,
    eventDate: null,
    socialPlatform: null,
    socialHandle: null,
    socialLink: null,
    returnOffer: null
  };
}

function assignParsed(target: ParsedDonationFields, field: keyof ParsedDonationFields, raw: string) {
  const value = raw.trim();
  if (!value) return;
  if (field === "donationType") {
    target.donationType = normalizeDonationType(value);
    return;
  }
  if (field === "eventDate") {
    target.eventDate = parseEventDate(value);
    return;
  }
  if (field === "email") {
    const found = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    target.email = (found ? found[0] : value).toLowerCase();
    return;
  }
  target[field] = value;
}

function labelField(label: string): keyof ParsedDonationFields | null {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[:：]\s*$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  let match: keyof ParsedDonationFields | null = null;
  let matchLength = 0;
  for (const entry of LABEL_FIELDS) {
    for (const candidate of entry.labels) {
      const folded = candidate.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalized === folded && folded.length >= matchLength) {
        match = entry.field;
        matchLength = folded.length;
      }
    }
  }
  return match;
}

export function parseDonationSubmissionText(text: string | null | undefined): ParsedDonationFields {
  const raw = String(text ?? "").trim();
  const parsed = emptyParsed();
  if (!raw) return parsed;

  if (raw.startsWith("{")) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      return mergeDonationFields(parsed, fieldsFromUnknownRecord(json));
    } catch {
      // Fall through to labeled text.
    }
  }

  for (const line of raw.split(/\r?\n/)) {
    const split = line.match(/^\s*([^:]{2,40}):\s*(.+)\s*$/);
    if (!split) continue;
    const field = labelField(split[1]);
    if (!field) continue;
    assignParsed(parsed, field, split[2]);
  }

  if (!parsed.email) {
    const found = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (found) parsed.email = found[0].toLowerCase();
  }
  if (!parsed.eventDate) {
    parsed.eventDate = parseEventDate(raw);
  }
  if (!parsed.donationType) {
    parsed.donationType = normalizeDonationType(raw);
  }
  return parsed;
}

function fieldsFromUnknownRecord(record: Record<string, unknown>): Partial<ParsedDonationFields> {
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  return {
    name: read("name", "donorName", "fullName", "guestName"),
    phone: read("phone", "donorPhone"),
    email: read("email", "donorEmail"),
    donationType: normalizeDonationType(read("donationType", "type")),
    donationDetail: read("donationDetail", "detail"),
    eventName: read("eventName", "event"),
    eventDetails: read("eventDetails", "eventDetail"),
    eventDate: parseEventDate(read("eventDate")),
    socialPlatform: read("socialPlatform", "platform"),
    socialHandle: read("socialHandle", "handle"),
    socialLink: read("socialLink", "link"),
    returnOffer: read("returnOffer", "offer")
  };
}

function mergeDonationFields(base: ParsedDonationFields, extra: Partial<ParsedDonationFields>): ParsedDonationFields {
  const next = { ...base };
  (Object.keys(extra) as Array<keyof ParsedDonationFields>).forEach((key) => {
    const value = extra[key];
    if (value) next[key] = value as never;
  });
  return next;
}

export type DonationIngestDraft = {
  externalKey: string;
  name: string;
  email: string;
  phone: string | null;
  donationType: DonationKind;
  donationDetail: string;
  eventName: string | null;
  eventDetails: string | null;
  eventDate: string | null;
  socialPlatform: string | null;
  socialHandle: string | null;
  socialLink: string | null;
  returnOffer: string;
  source: string;
};

function clip(value: string | null | undefined, max: number) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, max);
}

/**
 * Build a donation row from the legacy web-lead sync (occupationHint donation)
 * or from explicit fields the marketing site may add before it switches endpoints.
 */
export function buildDonationIngestFromWebLead(input: {
  conversationKey: string;
  guestName?: string | null;
  phone?: string | null;
  otherContact?: string | null;
  summary?: string | null;
  guestMessage?: string | null;
  explicit?: Partial<ParsedDonationFields> & { eventDate?: string | null };
}): DonationIngestDraft | { skipped: true; reason: string } {
  const fromText = parseDonationSubmissionText(
    [input.summary, input.guestMessage].filter(Boolean).join("\n")
  );
  const explicit = input.explicit ?? {};
  const merged = mergeDonationFields(fromText, explicit);
  const otherEmail = String(input.otherContact ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = (merged.email || (otherEmail ? otherEmail[0].toLowerCase() : "")).trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { skipped: true, reason: "Donation sync is missing an email address." };
  }
  const key = String(input.conversationKey ?? "").trim();
  if (key.length < 4) {
    return { skipped: true, reason: "Donation sync is missing a conversation key." };
  }
  const detail =
    clip(merged.donationDetail, 4000) ||
    clip(input.summary, 4000) ||
    clip(input.guestMessage, 4000) ||
    "Donation partnership request";
  return {
    externalKey: `web-lead:${key}`.slice(0, 120),
    name: clip(merged.name, 160) || clip(input.guestName, 160) || "Donor",
    email,
    phone: clip(merged.phone, 48) || clip(input.phone, 48),
    donationType: merged.donationType ?? "IN_KIND",
    donationDetail: detail,
    eventName: clip(merged.eventName, 200),
    eventDetails: clip(merged.eventDetails, 4000),
    eventDate: merged.eventDate && isIsoDate(merged.eventDate) ? merged.eventDate : null,
    socialPlatform: clip(merged.socialPlatform, 64),
    socialHandle: clip(merged.socialHandle, 120),
    socialLink: clip(merged.socialLink, 500),
    returnOffer: clip(merged.returnOffer, 4000) || "See the donation detail for the offered posts.",
    source: "web-lead"
  };
}

export function planDonationFollowUps(eventDateYmd: string, now: Date): PlannedFollowUp[] {
  if (!isIsoDate(eventDateYmd)) {
    throw new Error("Event date must be YYYY-MM-DD.");
  }
  const specs: Array<{ kind: FollowUpKind; ymd: string }> = [
    { kind: "PRE_EVENT", ymd: addCalendarDays(eventDateYmd, -3) },
    { kind: "POST_EVENT", ymd: addCalendarDays(eventDateYmd, 10) }
  ];
  return specs.map((spec) => {
    const scheduledFor = vietnamMorningUtc(spec.ymd);
    const lateBy = now.getTime() - scheduledFor.getTime();
    if (lateBy > DONATION_FOLLOW_UP_LATE_MS) {
      return {
        kind: spec.kind,
        scheduledFor,
        status: "SKIPPED" as const,
        skipReason: "The send window had already passed when the event date was confirmed."
      };
    }
    return { kind: spec.kind, scheduledFor, status: "SCHEDULED" as const, skipReason: null };
  });
}

/** Lowest nightly rate, which is the one complimentary night. */
export function computeShortTermDonationDiscount(nightlyRates: number[]) {
  const rates = nightlyRates.map((rate) => Number(rate)).filter((rate) => Number.isFinite(rate) && rate > 0);
  if (!rates.length) return 0;
  return Math.round(Math.min(...rates));
}

/**
 * One month of list rent, capped so the credit cannot consume the deposit
 * or a discount already applied to the same first payment.
 */
export function computeLongTermDonationDiscount(input: {
  monthlyRentVnd: number;
  firstPaymentSubtotalVnd?: number | null;
  depositVnd?: number | null;
  otherDiscountVnd?: number | null;
}) {
  const rent = Math.max(0, Math.round(Number(input.monthlyRentVnd) || 0));
  if (!rent) return 0;
  if (input.firstPaymentSubtotalVnd == null || input.firstPaymentSubtotalVnd === undefined) {
    return rent;
  }
  const subtotal = Math.max(0, Math.round(Number(input.firstPaymentSubtotalVnd) || 0));
  const deposit = Math.max(0, Math.round(Number(input.depositVnd) || 0));
  const other = Math.max(0, Math.round(Number(input.otherDiscountVnd) || 0));
  const rentPortion = Math.max(0, subtotal - deposit - other);
  return Math.min(rent, rentPortion);
}

export function applyOneNightWaiver<T extends { stayTotal: number; depositAmount: number; discountAmount: number }>(
  pricing: T,
  nightlyRates: number[]
): T & { donationDiscountAmount: number } {
  const waiver = computeShortTermDonationDiscount(nightlyRates);
  const cut = Math.min(waiver, Math.max(0, Math.round(pricing.stayTotal)));
  const stayTotal = Math.max(0, Math.round(pricing.stayTotal) - cut);
  return {
    ...pricing,
    donationDiscountAmount: cut,
    stayTotal,
    total: stayTotal + pricing.depositAmount,
    discountAmount: Math.round(pricing.discountAmount) + cut
  } as T & { donationDiscountAmount: number };
}

export function couponEmailCopy(input: {
  name: string;
  termType: DonationTermType;
  codes: string[];
  eventName: string | null;
  eventDate: string | null;
}) {
  const eventLine = [input.eventName, input.eventDate].filter(Boolean).join(" · ");
  const benefitEn =
    input.termType === "SHORT_TERM"
      ? "Each code waives one night on a short-term hostel booking (the lowest nightly rate). The deposit is not discounted."
      : "Each code waives one month of rent on the first payment of a new long-term registration. The deposit is not discounted.";
  const benefitVi =
    input.termType === "SHORT_TERM"
      ? "Mỗi mã miễn một đêm lưu trú ngắn hạn (đêm có giá thấp nhất). Tiền cọc không được giảm."
      : "Mỗi mã miễn một tháng tiền phòng trên khoản thanh toán đầu của đăng ký dài hạn mới. Tiền cọc không được giảm.";
  const howEn =
    input.termType === "SHORT_TERM"
      ? "Enter one code on the hostel booking form. Each code works once."
      : "Enter one code on the long-term registration form. Each code works once.";
  const howVi =
    input.termType === "SHORT_TERM"
      ? "Nhập một mã ở mẫu đặt phòng ngắn hạn. Mỗi mã dùng một lần."
      : "Nhập một mã ở mẫu đăng ký dài hạn. Mỗi mã dùng một lần.";
  const codes = input.codes.join("\n");
  return {
    subject: "[Cozoro Home] Partnership coupon codes / Mã ưu đãi hợp tác",
    body: [
      `Dear ${input.name},`,
      "",
      "Your donation partnership with Cozoro Home is approved. Thank you.",
      eventLine ? `Event: ${eventLine}` : "",
      "",
      benefitEn,
      howEn,
      "",
      "Your codes:",
      codes,
      "",
      "---",
      "",
      `Chào ${input.name},`,
      "",
      "Yêu cầu hợp tác quyên góp của bạn đã được duyệt. Cảm ơn bạn.",
      eventLine ? `Sự kiện: ${eventLine}` : "",
      "",
      benefitVi,
      howVi,
      "",
      "Mã của bạn:",
      codes,
      "",
      "Cozoro Home"
    ]
      .filter((line) => line !== "")
      .join("\n")
  };
}

export function preEventEmailCopy(input: {
  name: string;
  eventName: string | null;
  eventDate: string | null;
  returnOffer: string;
}) {
  const eventLine = [input.eventName, input.eventDate].filter(Boolean).join(" · ") || "your event";
  return {
    subject: "[Cozoro Home] 3 days to your event / Còn 3 ngày tới sự kiện",
    body: [
      `Dear ${input.name},`,
      "",
      `Your partnership event is coming up: ${eventLine}.`,
      "Please prepare the social posts you offered for Cozoro Home.",
      "",
      "What you planned to post:",
      input.returnOffer,
      "",
      "---",
      "",
      `Chào ${input.name},`,
      "",
      `Sự kiện hợp tác của bạn sắp diễn ra: ${eventLine}.`,
      "Nhờ bạn chuẩn bị các bài đăng mạng xã hội đã hứa cho Cozoro Home.",
      "",
      "Nội dung bạn dự định đăng:",
      input.returnOffer,
      "",
      "Cozoro Home"
    ].join("\n")
  };
}

export function postEventEmailCopy(input: {
  name: string;
  eventName: string | null;
  eventDate: string | null;
  returnOffer: string;
}) {
  const eventLine = [input.eventName, input.eventDate].filter(Boolean).join(" · ") || "your event";
  return {
    subject: "[Cozoro Home] Please send your social post proof / Nhờ gửi minh chứng bài đăng",
    body: [
      `Dear ${input.name},`,
      "",
      `It has been 10 days since ${eventLine}.`,
      "Please reply to this email with proof of the social posts (links or screenshots).",
      "",
      "What you offered to post:",
      input.returnOffer,
      "",
      "---",
      "",
      `Chào ${input.name},`,
      "",
      `Đã 10 ngày kể từ ${eventLine}.`,
      "Nhờ bạn trả lời email này kèm minh chứng bài đăng (đường dẫn hoặc ảnh chụp màn hình).",
      "",
      "Nội dung bạn đã hứa đăng:",
      input.returnOffer,
      "",
      "Cozoro Home"
    ].join("\n")
  };
}
