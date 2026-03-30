import { config } from "./config.js";
import { PreferredLanguage } from "./language.js";

export type ProspectReferralInput = {
  name: string;
  phone: string;
};

export type ProspectAvailabilitySnapshot = {
  syncedAt: string;
  branches: Array<{
    branchId: string;
    totalBeds: number;
    occupiedBeds: number;
    availableBeds: number;
    rooms: Array<{
      room: string;
      floor: string;
      totalBeds: number;
      occupiedBeds: number;
      availableBeds: number;
      availableBedNumbers: number[];
    }>;
  }>;
};

export type ProspectPublicSettings = {
  referralDiscountVnd: number;
};

export type ProspectReferralCheck = {
  eligible: boolean;
  referralDiscountVnd: number;
  message: string;
};

function buildHeaders() {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  if (config.apiSharedToken) {
    headers.set("Authorization", `Bearer ${config.apiSharedToken}`);
  }

  return headers;
}

async function readJson<T>(path: string, options?: RequestInit) {
  const headers = buildHeaders();

  if (options?.headers instanceof Headers) {
    options.headers.forEach((value, key) => headers.set(key, value));
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed for ${path} with ${response.status}: ${errorText}`);
  }

  return (await response.json()) as T;
}

export function questionNeedsAvailability(question: string) {
  return /\b(available|availability|vacancy|vacant|bed|beds|room|rooms|branch|d2|d7)\b/i.test(question) ||
    /(còn giường|giường trống|phòng trống|chi nhánh)/i.test(question);
}

export function questionMentionsReferral(question: string) {
  return /\b(referral|referred|refer|discount|introduce)\b/i.test(question) ||
    /(giới thiệu|người giới thiệu|nguoi gioi thieu|giam gia|giảm giá|ưu đãi)/i.test(question);
}

export async function fetchProspectAvailability() {
  return readJson<ProspectAvailabilitySnapshot>("/prospect/availability");
}

export async function fetchProspectPublicSettings() {
  return readJson<ProspectPublicSettings>("/prospect/settings");
}

export async function checkProspectReferral(referral: ProspectReferralInput) {
  return readJson<ProspectReferralCheck>("/prospect/referral/check", {
    method: "POST",
    body: JSON.stringify({
      referrerName: referral.name,
      referrerPhone: referral.phone
    })
  });
}

export function formatVnd(value: number) {
  return `${new Intl.NumberFormat("en-US").format(value)} VND`;
}

export function buildAvailabilityContext(snapshot: ProspectAvailabilitySnapshot) {
  const branchLines = snapshot.branches.map((branch) => {
    const roomLines = branch.rooms.map((room) => {
      return `${room.floor} room ${room.room}: ${room.availableBeds} available (beds ${room.availableBedNumbers.join(", ")})`;
    });

    return [
      `${branch.branchId}: ${branch.availableBeds} available / ${branch.totalBeds} total`,
      ...roomLines
    ].join("\n");
  });

  return [
    `Live bed availability snapshot synced at: ${snapshot.syncedAt}`,
    ...branchLines
  ].join("\n");
}

export function buildAvailabilityFallback(
  snapshot: ProspectAvailabilitySnapshot,
  language: PreferredLanguage = "vi"
) {
  const parts = snapshot.branches
    .filter((branch) => branch.availableBeds > 0)
    .map((branch) => {
      const rooms = branch.rooms
        .slice(0, 4)
        .map((room) => `${room.room} (${room.availableBedNumbers.join(", ")})`)
        .join("; ");
      if (language === "vi") {
        return `${branch.branchId}: còn ${branch.availableBeds} giường${rooms ? ` ở các phòng ${rooms}` : ""}.`;
      }

      return `${branch.branchId}: ${branch.availableBeds} beds available${rooms ? ` in rooms ${rooms}` : ""}.`;
    });

  if (!parts.length) {
    return language === "vi"
      ? "Hiện hệ thống chưa hiển thị giường trống nào. Bạn vui lòng liên hệ staff để xác nhận chỗ mới nhất."
      : "There are no live available beds shown right now. Please contact staff to confirm the latest opening.";
  }

  return language === "vi"
    ? `Tình trạng giường trống hiện tại: ${parts.join(" ")}`
    : `Current live availability: ${parts.join(" ")}`;
}
