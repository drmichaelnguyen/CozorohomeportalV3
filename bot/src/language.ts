export type PreferredLanguage = "vi" | "en";

const VIETNAMESE_SLANG_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(k|ko|khong|hok|hông|hong|hem)\b/gi, "không"],
  [/\b(dc|đc)\b/gi, "được"],
  [/\b(ib|inb)\b/gi, "nhắn tin"],
  [/\b(nt|ntin)\b/gi, "nhắn tin"],
  [/\b(tv|tvan|tưvấn)\b/gi, "tư vấn"],
  [/\bmk\b/gi, "mình"],
  [/\bbn\b/gi, "bao nhiêu"],
  [/\bsđt\b/gi, "số điện thoại"],
  [/\bđh\b/gi, "đại học"],
  [/\bq10\b/gi, "quận 10"],
  [/\bq6\b/gi, "quận 6"],
  [/\bkm\b/gi, "khuyến mãi"],
  [/\bktx\b/gi, "ký túc xá"]
];

const ENGLISH_REQUEST_PATTERNS = [
  /\b(answer|reply|respond|write|speak)\s+(in\s+)?english\b/i,
  /\buse english\b/i,
  /\bbằng tiếng anh\b/i,
  /\bti[eé]ng anh\b/i
];

const VIETNAMESE_REQUEST_PATTERNS = [
  /\b(answer|reply|respond|write)\s+(in\s+)?vietnamese\b/i,
  /\buse vietnamese\b/i,
  /\bbằng tiếng việt\b/i,
  /\bti[eế]ng việt\b/i
];

const VIETNAMESE_HINT_PATTERNS = [
  /[^\x00-\x7F]/,
  /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i,
  /\b(còn|giường|phòng|hợp đồng|huỷ|hủy|giảm giá|giới thiệu|khuyến mãi|đặt cọc|ở trọ|tiện nghi|giặt|sấy|nội quy|chi nhánh|khách|đang|tháng|giá|uu dai|gioi thieu|hop dong|giuong|phong|nha|ah|ạ|nhe|z|k|ko|dc|bn)\b/i
];

const ENGLISH_HINT_PATTERNS = [
  /\b(what|how|where|when|price|available|bed|room|contract|policy|discount|referral|laundry|cleaning|coins|cancel|move[- ]?in|stay)\b/gi
];

export function normalizeVietnameseChatText(text: string) {
  let normalized = String(text ?? "").trim();
  for (const [pattern, replacement] of VIETNAMESE_SLANG_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function detectPreferredLanguage(question: string): PreferredLanguage {
  const normalized = normalizeVietnameseChatText(question);

  if (VIETNAMESE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "vi";
  }

  if (ENGLISH_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "en";
  }

  if (VIETNAMESE_HINT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "vi";
  }

  const englishHits = ENGLISH_HINT_PATTERNS.reduce((count, pattern) => {
    const matches = normalized.match(pattern);
    return count + (matches?.length ?? 0);
  }, 0);

  if (englishHits >= 2) {
    return "en";
  }

  return "vi";
}

export function byLanguage<T>(language: PreferredLanguage, vietnamese: T, english: T) {
  return language === "vi" ? vietnamese : english;
}
