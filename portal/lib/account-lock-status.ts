import { isContractExpired, parseContractEndDate } from "./contract-utils";

export type AccountLockOverride = {
  email?: string;
  unlocked?: boolean;
  forceLocked?: boolean;
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
};

const MS_PER_DAY = 86400000;
const BLOCK_GRACE_DAYS = 5;
const WARN_DAYS_AHEAD = 30;

export function hasManualUnlockBypass(override: AccountLockOverride | null | undefined): boolean {
  return override?.unlocked === true;
}

export function isManuallyForceLocked(override: AccountLockOverride | null | undefined): boolean {
  return override?.forceLocked === true;
}

/** Contract end date restricts booking/controller unless a manager unlock override is active. */
export function isContractExpiryAccessLimited(
  contractEndRaw: string | undefined | null,
  override: AccountLockOverride | null | undefined
): boolean {
  if (hasManualUnlockBypass(override)) {
    return false;
  }
  return isContractExpired(contractEndRaw);
}

export function isResidentPortalAccessLimited(
  client: Record<string, string> | null | undefined,
  override: AccountLockOverride | null | undefined
): boolean {
  if (!client) {
    return false;
  }
  if (isManuallyForceLocked(override)) {
    return true;
  }
  return isContractExpiryAccessLimited(client["Ngày hết hạn hợp đồng"], override);
}

export function getAccountStatus(
  client: Record<string, string> | null,
  override: AccountLockOverride | null
): {
  isBlocked: boolean;
  blockReason: string | null;
  warnings: string[];
} {
  if (!client) {
    return { isBlocked: false, blockReason: null, warnings: [] };
  }

  const now = new Date();
  const contractEnd = parseContractEndDate(client["Ngày hết hạn hợp đồng"]);
  const paymentExpiry = parseContractEndDate(client["Ngày hết hạn gói đã thanh toán"]);
  const warnings: string[] = [];

  if (contractEnd) {
    const diffDays = (now.getTime() - contractEnd.getTime()) / MS_PER_DAY;
    if (diffDays > 0) {
      warnings.push(
        `Hợp đồng đã hết hạn ${Math.floor(diffDays)} ngày — còn ${BLOCK_GRACE_DAYS - Math.floor(diffDays)} ngày ân hạn. Vui lòng gia hạn trên trang chủ.`
      );
    } else if (-diffDays < WARN_DAYS_AHEAD) {
      const daysLeft = Math.ceil(-diffDays);
      warnings.push(
        `Hợp đồng sắp hết hạn vào ngày ${contractEnd.toLocaleDateString("vi-VN")} (còn ${daysLeft} ngày). Gia hạn ngay trên trang chủ để nhận Cozoro Coins: 3 tháng +10.000 · 6 tháng +25.000 · 12 tháng +50.000.`
      );
    }
  }

  if (paymentExpiry) {
    const diffDays = (now.getTime() - paymentExpiry.getTime()) / MS_PER_DAY;
    if (diffDays > 0) {
      warnings.push(
        `Tiền thuê quá hạn ${Math.floor(diffDays)} ngày — còn ${BLOCK_GRACE_DAYS - Math.floor(diffDays)} ngày ân hạn.`
      );
    } else if (-diffDays < WARN_DAYS_AHEAD) {
      warnings.push(`Gói thanh toán sắp hết hạn vào ngày ${paymentExpiry.toLocaleDateString("vi-VN")}.`);
    }
  }

  if (override?.forceLocked) {
    const manualReason = override.note?.trim();
    return {
      isBlocked: true,
      blockReason:
        manualReason && manualReason.length > 0
          ? `Tài khoản đang bị khoá thủ công: ${manualReason}`
          : "Tài khoản đang bị khoá thủ công bởi quản lý.",
      warnings
    };
  }

  if (hasManualUnlockBypass(override) && contractEnd && now.getTime() > contractEnd.getTime()) {
    const updatedBy = override?.updatedBy?.trim();
    warnings.unshift(
      updatedBy
        ? `Tài khoản đã được mở khoá thủ công bởi ${updatedBy}.`
        : "Tài khoản đã được mở khoá thủ công bởi quản lý."
    );
  }

  return { isBlocked: false, blockReason: null, warnings };
}
