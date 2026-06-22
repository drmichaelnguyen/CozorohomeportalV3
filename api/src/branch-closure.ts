/**
 * Branch registration closure — keep in sync with portal/lib/branch-closure.ts
 * and guest-booking-standalone/branch-closure.js
 */

export const D2_PERMANENT_CLOSURE_DATE = "2026-07-01";

/** D2 no longer accepts new long-term or hostel registrations. */
export const D2_NEW_REGISTRATION_CLOSED = true;

export type BranchId = "D2" | "D7";

export function isBranchClosedForNewRegistrations(branchId: string): branchId is "D2" {
  return branchId === "D2" && D2_NEW_REGISTRATION_CLOSED;
}

export function getBranchRegistrationClosedError(branchId: string): string | null {
  if (!isBranchClosedForNewRegistrations(branchId)) {
    return null;
  }
  return `D2 is permanently closing on ${formatClosureDate(D2_PERMANENT_CLOSURE_DATE)} and is no longer accepting new registrations. Please choose D7 or contact staff.`;
}

function formatClosureDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

export function getD2ClosureNotice(lang: "en" | "vi" = "en"): { title: string; body: string } {
  const closureLabel = formatClosureDate(D2_PERMANENT_CLOSURE_DATE);
  if (lang === "vi") {
    return {
      title: "Chi nhánh D2 ngừng nhận đăng ký mới",
      body: `Chi nhánh D2 sẽ đóng cửa vĩnh viễn từ ${closureLabel}. Biểu mẫu đăng ký dài hạn và hostel tại D2 đã được đóng. Vui lòng chọn D7 hoặc liên hệ nhân viên nếu cần hỗ trợ.`
    };
  }
  return {
    title: "D2 branch registration closed",
    body: `D2 is permanently closing from ${closureLabel}. Long-term and hostel registration forms for D2 are closed. Please choose D7 or contact staff if you need help.`
  };
}
