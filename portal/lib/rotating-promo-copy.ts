/**
 * Daily-rotating bilingual promo / reminder copy (teen-code friendly).
 * Same user + category stays stable for ~24h, then picks another variant.
 */

export type BilingualLine = { en: string; vi: string };

export function pickRotatingLine(
  category: string,
  seed: string,
  variants: readonly BilingualLine[],
  lang: "en" | "vi"
): string {
  if (!variants.length) return "";
  const day = Math.floor(Date.now() / 86_400_000);
  let h = 0;
  const key = `${category}:${seed}:${day}`;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const picked = variants[Math.abs(h) % variants.length]!;
  return lang === "vi" ? picked.vi : picked.en;
}

export function fillPromoTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value == null ? `{${key}}` : String(value);
  });
}

/** Self-assign coin promo popup */
export const SELF_ASSIGN_PROMO_EYEBROWS: BilingualLine[] = [
  { en: "Cleaning · earn more", vi: "Vệ sinh · kiếm thêm coin" },
  { en: "Coin tip of the day", vi: "Tip coin hôm nay nè" },
  { en: "Green slots = sweeter coins", vi: "Ô xanh = coin ngọt hơn" },
  { en: "Self-assign vibe check", vi: "Self-assign check vibe" }
];

export const SELF_ASSIGN_PROMO_TITLES: BilingualLine[] = [
  { en: "Self-assign for higher coins", vi: "Tự đăng ký để nhận nhiều coin hơn" },
  { en: "Grab the open slot, flex the coins", vi: "Chốt ô trống, flex coin liền" },
  { en: "Don't wait for the system — claim it", vi: "Đừng ngồi chờ hệ thống — tự nhận đi nha" },
  { en: "Your future coins say hi", vi: "Coin tương lai gửi say hi nè" },
  { en: "Low-key upgrade your cleaning pay", vi: "Low-key tăng lương trực vệ sinh" }
];

export const SELF_ASSIGN_PROMO_BODIES: BilingualLine[] = [
  {
    en: "Claim open cleaning slots yourself to earn more coins than system or manager assignment: weekday x2, weekend x2.5, Vietnam holiday x3.",
    vi: "Tự đăng ký lịch vệ sinh trên ô trống để nhận nhiều coin hơn so với khi hệ thống/quản lý giao: ngày thường x2, cuối tuần x2.5, lễ VN x3. Đỉnh thật sự."
  },
  {
    en: "Green dates on Schedule pay better when you Assign Myself — weekday x2, weekend x2.5, holiday x3. System assign is the basic drip.",
    vi: "Ngày xanh trên Lịch trả coin ngon hơn khi bạn bấm Tự đăng ký — ngày thường x2, cuối tuần x2.5, lễ x3. Hệ thống giao chỉ là mức basic thôi nha."
  },
  {
    en: "Self-assign is the main character energy: weekday x2, weekend x2.5, VN holiday x3 vs waiting for auto-assign.",
    vi: "Self-assign = vibe main character: ngày thường x2, cuối tuần x2.5, lễ VN x3 — khỏi chờ auto-assign thui."
  },
  {
    en: "Sneaky tip: open slots you claim yourself stack higher multipliers (x2 / x2.5 / x3). Your wallet will thank you later.",
    vi: "Tip hơi bị hay: ô trống bạn tự nhận được nhân x2 / x2.5 / x3. Ví coin sau này sẽ cảm ơn bạn hehe."
  }
];

export const SELF_ASSIGN_PROMO_HINTS: BilingualLine[] = [
  {
    en: "Open Schedule, tap a green open date, then Assign Myself. Early-bird and streak bonuses can stack. Or ask Cozoro Bee in Messages.",
    vi: "Mở Lịch → chạm ngày xanh → Tự đăng ký. Early-bird + streak có thể cộng thêm. Hoặc inbox Cozoro Bee nhờ chốt ca nha."
  },
  {
    en: "Path: Schedule → green date → Assign Myself. Bee in Messages can also find a slot for you. Tip shows only occasionally.",
    vi: "Cách chơi: Lịch → ngày xanh → Tự đăng ký. Bee trong Tin nhắn cũng tìm ca giúp được. Tip này chỉ drop thỉnh thoảng thôi."
  },
  {
    en: "Tap green → Assign Myself. Early-bird (+2k if ≥7 days ahead) and streak (+2k every 3rd) stack on top. Okela?",
    vi: "Chạm xanh → Tự đăng ký. Early-bird (+2k nếu ≥7 ngày) và streak (+2k mỗi lần thứ 3) cộng thêm. Okela chưa?"
  }
];

export const SELF_ASSIGN_PROMO_CTAS: BilingualLine[] = [
  { en: "Open schedule", vi: "Mở lịch vệ sinh" },
  { en: "Go claim a slot", vi: "Đi chốt một ca" },
  { en: "Show me the greens", vi: "Cho xem ô xanh nào" }
];

export const SELF_ASSIGN_PROMO_DISMISSES: BilingualLine[] = [
  { en: "Not now", vi: "Để sau" },
  { en: "Maybe later", vi: "Để tui nghĩ đã" },
  { en: "Skip for now", vi: "Skip tạm nha" }
];

/** Birth-month promo */
export const BIRTH_MONTH_PROMO_EYEBROWS: BilingualLine[] = [
  { en: "Birth month", vi: "Tháng sinh nhật" },
  { en: "Birthday month perks", vi: "Quà tháng sinh nhật" },
  { en: "Main character month", vi: "Tháng main character" }
];

export const BIRTH_MONTH_PROMO_TITLES: BilingualLine[] = [
  { en: "Your birth-month perks", vi: "Ưu đãi tháng sinh nhật của bạn" },
  { en: "This month is your glow-up window", vi: "Tháng này là khung giờ glow-up của bạn" },
  { en: "Birthday month = bonus energy", vi: "Tháng sinh nhật = năng lượng bonus" }
];

export const BIRTH_MONTH_PROMO_TITLES_TODAY: BilingualLine[] = [
  { en: "Happy birthday!", vi: "Chúc mừng sinh nhật!" },
  { en: "It's your day — say hi birthday coins", vi: "Hôm nay là ngày của bạn — say hi coin sinh nhật" },
  { en: "Birthday unlocked!", vi: "Sinh nhật unlocked rồi nè!" }
];

export const BIRTH_MONTH_PROMO_BODIES: BilingualLine[] = [
  {
    en: "This month you can extend early for {multiplier}x extension coins on {minMonths}+ month extensions, and receive +{birthdayCoins} coins on your birthday.",
    vi: "Tháng này bạn gia hạn sớm để nhận coin gia hạn x{multiplier} (từ {minMonths} tháng), plus +{birthdayCoins} coin vào ngày sinh nhật. Quà quá đúng không?"
  },
  {
    en: "Birth-month flex: +{birthdayCoins} on your birthday, and {multiplier}x extension coins when you extend ≥{minMonths} months — even before your contract ends.",
    vi: "Flex tháng sinh nhật: +{birthdayCoins} coin ngày sinh, và coin gia hạn x{multiplier} khi gia hạn ≥{minMonths} tháng — kể cả hợp đồng chưa hết hạn. Đỉnh."
  },
  {
    en: "Don't sleep on birth-month: birthday grant +{birthdayCoins}, and early extend (≥{minMonths} mo) pays {multiplier}x the usual extension coins.",
    vi: "Đừng sleep deal tháng sinh nhật nha: +{birthdayCoins} coin ngày sinh, gia hạn sớm (≥{minMonths} tháng) = coin gia hạn x{multiplier}. Chốt luôn đi."
  }
];

export const BIRTH_MONTH_PROMO_BODIES_TODAY: BilingualLine[] = [
  {
    en: "+{birthdayCoins} birthday coins are added today. Extend this month (≥{minMonths} months) for {multiplier}x extension coins — even before your contract ends.",
    vi: "+{birthdayCoins} coin sinh nhật đã vào hôm nay. Gia hạn trong tháng (≥{minMonths} tháng) để nhận coin gia hạn x{multiplier} — kể cả chưa tới hạn. Iu quá trời."
  },
  {
    en: "Birthday drop: +{birthdayCoins} coins landed. Still want more? Extend ≥{minMonths} months this month for {multiplier}x extension coin energy.",
    vi: "Birthday drop: +{birthdayCoins} coin đã về. Muốn thêm nữa? Gia hạn ≥{minMonths} tháng trong tháng này = vibe coin gia hạn x{multiplier}."
  }
];

export const BIRTH_MONTH_PROMO_CTAS: BilingualLine[] = [
  { en: "Extend contract", vi: "Gia hạn hợp đồng" },
  { en: "Claim the perk", vi: "Chốt ưu đãi luôn" },
  { en: "Extend now", vi: "Gia hạn ngay nè" }
];

/** Referral weekly popup */
export const REFERRAL_PROMO_TITLES: BilingualLine[] = [
  { en: "Refer a friend", vi: "Giới thiệu bạn bè" },
  { en: "Bring a bestie, unlock perks", vi: "Rủ bestie tới, mở quà chung" },
  { en: "Referral vibe check", vi: "Check vibe giới thiệu" },
  { en: "Share Cozoro with your circle", vi: "Share Cozoro cho hội của bạn" }
];

export const REFERRAL_PROMO_INTROS: BilingualLine[] = [
  {
    en: "Quick reminder — referring a friend can unlock discounts and coins for both of you.",
    vi: "Nhắc nhẹ nha — giới thiệu bạn tới có thể mở discount + coin cho cả hai. Deal ổn áp lắm."
  },
  {
    en: "Psst: your referral code energy is still on. Share it and both sides can win coins / discounts.",
    vi: "Pssst: vibe mã giới thiệu vẫn còn hot. Share đi — đôi bên đều có cửa nhận coin / giảm giá."
  },
  {
    en: "Main-character tip: invite someone you trust. New guest + you can both get referral goodies.",
    vi: "Tip main character: rủ người tin được. Người mới + bạn đều có cửa nhận quà referral."
  },
  {
    en: "Low-key reminder of the referral program — details below, chốt khi sẵn sàng.",
    vi: "Nhắc low-key chương trình giới thiệu — chi tiết bên dưới, sẵn sàng thì chốt nha."
  }
];

export const REFERRAL_PROMO_DISMISSES: BilingualLine[] = [
  { en: "Got it", vi: "Đã hiểu" },
  { en: "Okela", vi: "Okela" },
  { en: "Noted!", vi: "Note rồi nè!" }
];

/** Cleaning / laundry reminder chrome + lines */
export const REMINDER_POPUP_HEADERS: BilingualLine[] = [
  { en: "Upcoming reminders", vi: "Nhắc việc sắp tới" },
  { en: "Heads up from Cozoro", vi: "Cozoro nhắc nhẹ nè" },
  { en: "Don't miss this", vi: "Đừng miss cái này nha" },
  { en: "Reminder drop", vi: "Drop nhắc lịch" }
];

export const REMINDER_HIDE_LABELS: BilingualLine[] = [
  { en: "Hide", vi: "Ẩn" },
  { en: "Got it", vi: "Okela" },
  { en: "Dismiss", vi: "Đóng tạm" }
];

export const CLEANING_GROUP_LABELS: BilingualLine[] = [
  { en: "Cleaning reminder", vi: "Nhắc lịch trực" },
  { en: "Duty schedule ping", vi: "Ping lịch vệ sinh" },
  { en: "Kitchen / trash duty", vi: "Ca bếp / rác" }
];

export const LAUNDRY_GROUP_LABELS: BilingualLine[] = [
  { en: "Laundry reminder", vi: "Nhắc lịch giặt" },
  { en: "Washer / dryer ping", vi: "Ping máy giặt / sấy" },
  { en: "Laundry slot alert", vi: "Alert ca giặt sấy" }
];

export const CLEANING_ACTION_LABELS: BilingualLine[] = [
  { en: "Open cleaning schedule", vi: "Mở lịch vệ sinh" },
  { en: "Go to Schedule", vi: "Vào Lịch liền" },
  { en: "Check my duty", vi: "Xem ca trực của tui" }
];

export const LAUNDRY_ACTION_LABELS: BilingualLine[] = [
  { en: "Open bookings", vi: "Mở lịch giặt" },
  { en: "See my laundry", vi: "Xem ca giặt của tui" },
  { en: "Go to bookings", vi: "Vào booking liền" }
];

export const CLEANING_TODAY_TITLES: BilingualLine[] = [
  { en: "Cleaning is today", vi: "Hôm nay có lịch trực nè" },
  { en: "Duty day — it's today", vi: "Ngày trực rồi — hôm nay luôn" },
  { en: "Your cleaning slot is today", vi: "Ca vệ sinh của bạn là hôm nay" }
];

export const CLEANING_TOMORROW_TITLES: BilingualLine[] = [
  { en: "Cleaning is tomorrow", vi: "Mai có lịch trực rồi" },
  { en: "Tomorrow = your duty day", vi: "Mai là ngày trực của bạn" },
  { en: "Heads up: cleaning tomorrow", vi: "Nhắc trước: mai trực vệ sinh" }
];

export const CLEANING_TODAY_BODIES: BilingualLine[] = [
  {
    en: "Your {task} cleaning is today ({date}). Mark done on the assigned date — late window stays open 10 hours after the deadline.",
    vi: "Ca {task} của bạn là hôm nay ({date}). Nhớ bấm hoàn thành đúng ngày — cửa nộp muộn còn mở thêm 10 tiếng sau deadline nha."
  },
  {
    en: "{task} duty today ({date}). Finish on time; if late, you still have ~10 hours after the deadline. You've got this.",
    vi: "Ca {task} hôm nay ({date}). Làm đúng giờ là đẹp; lỡ muộn vẫn còn ~10 tiếng sau deadline. Cố lên nha!"
  },
  {
    en: "Reminder: {task} is on your plate today ({date}). Mark complete when done — late grace = 10h after deadline.",
    vi: "Nhắc nhẹ: {task} nằm trong checklist hôm nay ({date}). Xong thì mark done — grace muộn = 10 tiếng sau deadline."
  }
];

export const CLEANING_TOMORROW_BODIES: BilingualLine[] = [
  {
    en: "Your {task} cleaning is tomorrow ({date}). Mark done on the assigned date; late submission stays open 10 hours after the deadline.",
    vi: "Ca {task} của bạn là ngày mai ({date}). Nhớ hoàn thành đúng ngày; nộp muộn vẫn còn 10 tiếng sau deadline."
  },
  {
    en: "Tomorrow alert: {task} on {date}. Prep tonight so you don't scramble — late window = +10h after deadline.",
    vi: "Alert mai: {task} vào {date}. Chuẩn bị từ tối nay khỏi scramble — cửa muộn = +10 tiếng sau deadline."
  },
  {
    en: "{task} is lined up for tomorrow ({date}). Easy mode: do it on the day, mark done, chill.",
    vi: "{task} xếp sẵn cho mai ({date}). Easy mode: làm đúng ngày, bấm xong, chill."
  }
];

export const LAUNDRY_SOON_TITLES: BilingualLine[] = [
  { en: "Laundry starts in ~10 minutes", vi: "Giặt sấy còn ~10 phút nữa" },
  { en: "Almost laundry time", vi: "Sắp tới giờ giặt rồi" },
  { en: "Washer / dryer warming up", vi: "Máy giặt / sấy sắp tới lượt" }
];

export const LAUNDRY_NOW_TITLES: BilingualLine[] = [
  { en: "Laundry starts now", vi: "Tới giờ giặt rồi nè" },
  { en: "Your laundry slot is live", vi: "Ca giặt của bạn đang live" },
  { en: "Go claim the machine", vi: "Đi chốt máy liền đi" }
];

export const LAUNDRY_SOON_BODIES: BilingualLine[] = [
  {
    en: "{summary} starts at {time}. Hop over soon so you don't miss the slot.",
    vi: "{summary} bắt đầu lúc {time}. Qua sớm một chút kẻo miss slot nha."
  },
  {
    en: "Ping: {summary} at {time} (~10 min). Bring your basket and vibe.",
    vi: "Ping: {summary} lúc {time} (còn ~10 phút). Xách giỏ đồ lên và đi nào."
  },
  {
    en: "{summary} is almost here ({time}). Don't ghost your booking — the next person is waiting.",
    vi: "{summary} sắp tới ({time}). Đừng ghost booking nha — người sau đang chờ đó."
  }
];

export const LAUNDRY_NOW_BODIES: BilingualLine[] = [
  {
    en: "{summary} is starting now ({time}). Time to run your load!",
    vi: "{summary} đang bắt đầu ({time}). Tới giờ chạy máy rồi đó!"
  },
  {
    en: "Live now: {summary} ({time}). Go go go — your slot is open.",
    vi: "Live ngay: {summary} ({time}). Go go go — slot đang mở cho bạn."
  },
  {
    en: "{summary} just hit start time ({time}). Claim the machine before the vibe expires.",
    vi: "{summary} vừa tới giờ ({time}). Chốt máy trước khi vibe hết hạn nha."
  }
];
