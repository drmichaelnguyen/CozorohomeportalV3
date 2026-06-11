/**
 * Branch registration closure — keep in sync with api/src/branch-closure.ts
 * and portal/lib/branch-closure.ts
 */

const D2_PERMANENT_CLOSURE_DATE = "2026-07-01";

/** D2 no longer accepts new long-term or hostel registrations. */
const D2_NEW_REGISTRATION_CLOSED = true;

function formatClosureDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function isBranchClosedForNewRegistrations(branchId) {
  return branchId === "D2" && D2_NEW_REGISTRATION_CLOSED;
}

function getBranchRegistrationClosedError(branchId) {
  if (!isBranchClosedForNewRegistrations(branchId)) {
    return null;
  }
  return `D2 is permanently closing on ${formatClosureDate(D2_PERMANENT_CLOSURE_DATE)} and is no longer accepting new registrations. Please choose D7 or contact staff.`;
}

function getD2ClosureNotice(lang = "en") {
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

module.exports = {
  D2_PERMANENT_CLOSURE_DATE,
  D2_NEW_REGISTRATION_CLOSED,
  isBranchClosedForNewRegistrations,
  getBranchRegistrationClosedError,
  getD2ClosureNotice
};
