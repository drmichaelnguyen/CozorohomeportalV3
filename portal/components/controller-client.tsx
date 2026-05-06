"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { parseContractEndDate } from "../lib/contract-utils";
import { InlineHelp } from "./inline-help";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

const API_TIMEOUT_MS = 6000;

type AcComfortStatus = {
  roomId: string | null;
  roomLabel: string | null;
  occupantCount: number;
  hotCount: number;
  coldCount: number;
  myVote: "HOT" | "COLD" | null;
  majorityHot: boolean;
  majorityCold: boolean;
};

type ControllerContext = {
  email: string;
  name: string;
  branchId: "D2" | "D7";
  bed: string;
  roomCode: string | null;
  contractCode: string;
  room: {
    id: string;
    label: string;
    iftttConfigured: boolean;
    lastRequestedAction: "ON" | "OFF" | null;
    lastRequestedAt: string | null;
  } | null;
  restrictions: {
    canTurnOnNow: boolean;
    turnOnBlockedReason: string | null;
    timeZone: string;
  };
  mappingHint: {
    branchId: "D2" | "D7";
    bed: string;
    roomCode: string;
    contractCode: string;
  };
  comfort?: AcComfortStatus | null;
};

type AirFryerContext = {
  email: string;
  name: string;
  branchId: string;
  eligible: boolean;
  cooldownMinutes: number;
  status: {
    inUse: boolean;
    availableNow: boolean;
    availableAt: string | null;
    currentUse: {
      startedAt: string;
      availableAt: string;
      startedByEmail: string;
      startedByName: string;
    } | null;
    lastUse: {
      startedAt: string;
      availableAt: string;
      startedByEmail: string;
      startedByName: string;
    } | null;
  };
};

type MicrowaveContext = AirFryerContext;

type AccountLockOverride = {
  unlocked?: boolean;
  forceLocked?: boolean;
  updatedBy?: string;
  updatedAt?: string;
  note?: string;
};

type LaundryBooking = {
  id: string;
  calendarId: string;
  calendarSummary: string;
  summary: string;
  start: string;
  end: string;
};

async function fetchJson<T>(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const data = (await response.json()) as T;

    if (!response.ok) {
      const errorMessage =
        typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error
          : "Request failed";
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("API request timed out. Check that the API is running.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseLooseDate(value: string | undefined): Date | null {
  return parseContractEndDate(value);
}

function getAccountStatus(client: Record<string, string> | null, override: AccountLockOverride | null): {
  isBlocked: boolean;
  blockReason: string | null;
  warnings: string[];
} {
  if (!client) return { isBlocked: false, blockReason: null, warnings: [] };
  const now = new Date();
  const MS_PER_DAY = 86400000;
  const BLOCK_GRACE_DAYS = 5;
  const WARN_DAYS_AHEAD = 30;
  const contractEnd = parseLooseDate(client["Ngày hết hạn hợp đồng"]);
  const paymentExpiry = parseLooseDate(client["Ngày hết hạn gói đã thanh toán"]);
  const warnings: string[] = [];
  let blockReason: string | null = null;
  if (contractEnd) {
    const diffDays = (now.getTime() - contractEnd.getTime()) / MS_PER_DAY;
    if (diffDays > BLOCK_GRACE_DAYS) {
      blockReason = `Hợp đồng đã hết hạn ${Math.floor(diffDays)} ngày. Liên hệ quản lý để gia hạn.`;
    } else if (diffDays > 0) {
      warnings.push(`Hợp đồng đã hết hạn ${Math.floor(diffDays)} ngày — còn ${BLOCK_GRACE_DAYS - Math.floor(diffDays)} ngày ân hạn. Vui lòng gia hạn trên trang chủ.`);
    } else if (-diffDays < WARN_DAYS_AHEAD) {
      const daysLeft = Math.ceil(-diffDays);
      warnings.push(`Hợp đồng sắp hết hạn vào ngày ${contractEnd.toLocaleDateString("vi-VN")} (còn ${daysLeft} ngày). Gia hạn ngay trên trang chủ để nhận Cozoro Coins: 3 tháng +10.000 · 6 tháng +25.000 · 12 tháng +50.000.`);
    }
  }
  if (!blockReason && paymentExpiry) {
    const diffDays = (now.getTime() - paymentExpiry.getTime()) / MS_PER_DAY;
    if (diffDays > BLOCK_GRACE_DAYS) {
      blockReason = `Tiền thuê quá hạn ${Math.floor(diffDays)} ngày. Vui lòng thanh toán để tiếp tục sử dụng dịch vụ.`;
    } else if (diffDays > 0) {
      warnings.push(`Tiền thuê quá hạn ${Math.floor(diffDays)} ngày — còn ${BLOCK_GRACE_DAYS - Math.floor(diffDays)} ngày ân hạn.`);
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

  if (blockReason && override?.unlocked) {
    warnings.unshift(
      override.updatedBy
        ? `Tài khoản đã được mở khoá thủ công bởi ${override.updatedBy}.`
        : "Tài khoản đã được mở khoá thủ công bởi quản lý."
    );
    return { isBlocked: false, blockReason: null, warnings };
  }
  return { isBlocked: blockReason !== null, blockReason, warnings };
}

function formatTimestamp(value: string | null, language: "en" | "vi") {
  if (!value) {
    return language === "vi" ? "Chưa có" : "Not yet";
  }

  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function ControllerClient({
  showAcSection = true,
  showAirFryerSection = true,
  showMicrowaveSection = true,
  title = "Room Controller"
}: {
  showAcSection?: boolean;
  showAirFryerSection?: boolean;
  showMicrowaveSection?: boolean;
  title?: string;
}) {
  const { language, t } = usePortalLanguage();
  const { sessionEmail, login } = usePortalSession();
  const [activeEmail, setActiveEmail] = useState("");
  const [context, setContext] = useState<ControllerContext | null>(null);
  const [airFryerContext, setAirFryerContext] = useState<AirFryerContext | null>(null);
  const [microwaveContext, setMicrowaveContext] = useState<MicrowaveContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<"ON" | "OFF" | null>(null);
  const [startingAirFryer, setStartingAirFryer] = useState(false);
  const [activeLaundryBooking, setActiveLaundryBooking] = useState<LaundryBooking | null>(null);
  const [nextLaundryBooking, setNextLaundryBooking] = useState<LaundryBooking | null>(null);
  const [triggeringLaundry, setTriggeringLaundry] = useState(false);
  const [triggeringMicrowave, setTriggeringMicrowave] = useState(false);
  const [selectedMicrowaveInspection, setSelectedMicrowaveInspection] = useState("");
  const [selectedInspection, setSelectedInspection] = useState<string>("");
  const [clientRecord, setClientRecord] = useState<Record<string, string> | null>(null);
  const [accountLockOverride, setAccountLockOverride] = useState<AccountLockOverride | null>(null);
  const [message, setMessage] = useState("");
  const [comfortSubmitting, setComfortSubmitting] = useState(false);
  const [comfortHelpOpen, setComfortHelpOpen] = useState(false);

  async function loadControllerContext() {
    const resolvedEmail = sessionEmail.trim().toLowerCase();
    if (!resolvedEmail) {
      setMessage(language === "vi" ? "Vui lòng đăng nhập trước." : "Please sign in first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const requests: Promise<unknown>[] = [];

      if (showAcSection) {
        requests.push(fetchJson<ControllerContext>(`${API_BASE_URL}/controller/ac?email=${encodeURIComponent(resolvedEmail)}`));
      }

      if (showAirFryerSection) {
        requests.push(fetchJson<AirFryerContext>(`${API_BASE_URL}/controller/airfryer?email=${encodeURIComponent(resolvedEmail)}`));
      }

      if (showMicrowaveSection) {
        requests.push(fetchJson<MicrowaveContext>(`${API_BASE_URL}/controller/microwave/d2?email=${encodeURIComponent(resolvedEmail)}`));
      }

      const results = await Promise.all(requests);
      let offset = 0;

      if (showAcSection) {
        setContext(results[offset] as ControllerContext);
        offset += 1;
      } else {
        setContext(null);
      }

      if (showAirFryerSection) {
        setAirFryerContext(results[offset] as AirFryerContext);
        offset += 1;
      } else {
        setAirFryerContext(null);
      }

      if (showMicrowaveSection) {
        setMicrowaveContext(results[offset] as MicrowaveContext);
        offset += 1;
      } else {
        setMicrowaveContext(null);
      }

      const [laundryData, clientResult, overrideResult] = await Promise.allSettled([
        fetchJson<{ active: LaundryBooking | null; next: LaundryBooking | null }>(`${API_BASE_URL}/controller/laundry?email=${encodeURIComponent(resolvedEmail)}`),
        fetchJson<Record<string, string>>(`${API_BASE_URL}/clients?email=${encodeURIComponent(resolvedEmail)}`),
        fetchJson<{ override?: AccountLockOverride | null }>(`${API_BASE_URL}/account-lock-override?email=${encodeURIComponent(resolvedEmail)}`)
      ]);

      if (laundryData.status === "fulfilled") {
        setActiveLaundryBooking(laundryData.value.active);
        setNextLaundryBooking(laundryData.value.next);
      }
      if (clientResult.status === "fulfilled") {
        setClientRecord(clientResult.value);
      }
      if (overrideResult.status === "fulfilled") {
        setAccountLockOverride(overrideResult.value.override ?? null);
      }

      setActiveEmail(resolvedEmail);
      login(resolvedEmail);
      setMessage(language === "vi" ? "Đã tải bộ điều khiển cho tài khoản của bạn." : "Loaded your controls.");
    } catch (error) {
      setContext(null);
      setAirFryerContext(null);
      setMicrowaveContext(null);
      setActiveLaundryBooking(null);
      setNextLaundryBooking(null);
      setAccountLockOverride(null);
      setMessage(error instanceof Error ? error.message : "Unable to load controls.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!sessionEmail.trim()) {
      setContext(null);
      setAirFryerContext(null);
      setMicrowaveContext(null);
      setActiveEmail("");
      return;
    }

    void loadControllerContext();
  }, [sessionEmail, showAcSection, showAirFryerSection, showMicrowaveSection]);

  async function sendCommand(action: "ON" | "OFF") {
    if (!activeEmail) {
      return;
    }

    setSubmittingAction(action);
    setMessage("");

    try {
      const result = await fetchJson<{ requestedAt: string }>(`${API_BASE_URL}/controller/ac/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          action
        })
      });

      setContext((current) =>
        current && current.room
          ? {
              ...current,
              room: {
                ...current.room,
                lastRequestedAction: action,
                lastRequestedAt: result.requestedAt
              }
            }
          : current
      );

      setMessage(
        action === "ON"
          ? language === "vi"
            ? "Đã gửi lệnh bật máy lạnh."
            : "AC turn-on request sent."
          : language === "vi"
            ? "Đã gửi lệnh tắt máy lạnh."
            : "AC turn-off request sent."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send AC command.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function submitComfortVote(vote: "HOT" | "COLD") {
    if (!activeEmail || isBlocked) {
      return;
    }
    setComfortSubmitting(true);
    setMessage("");
    try {
      const result = await fetchJson<{
        roomId: string;
        roomLabel: string;
        occupantCount: number;
        hotCount: number;
        coldCount: number;
        myVote: "HOT" | "COLD";
        majorityHot: boolean;
        majorityCold: boolean;
      }>(`${API_BASE_URL}/controller/ac/comfort-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: activeEmail, vote })
      });
      setContext((current) =>
        current && current.room
          ? {
              ...current,
              comfort: {
                roomId: result.roomId,
                roomLabel: result.roomLabel,
                occupantCount: result.occupantCount,
                hotCount: result.hotCount,
                coldCount: result.coldCount,
                myVote: result.myVote,
                majorityHot: result.majorityHot,
                majorityCold: result.majorityCold
              }
            }
          : current
      );
      setMessage(
        language === "vi"
          ? "Đã gửi phản hồi nhiệt độ. Nếu đa số cùng phòng đồng ý, quản lý sẽ được thông báo."
          : "Temperature feedback sent. If a majority of your room agrees, managers will be notified."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send comfort vote.");
    } finally {
      setComfortSubmitting(false);
    }
  }

  async function startAirFryer() {
    if (!activeEmail || !selectedInspection) {
      return;
    }

    setStartingAirFryer(true);
    setMessage("");

    try {
      await fetchJson<{ ok: true }>(`${API_BASE_URL}/controller/airfryer/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          inspection: selectedInspection
        })
      });

      const nextAirFryerContext = await fetchJson<AirFryerContext>(
        `${API_BASE_URL}/controller/airfryer?email=${encodeURIComponent(activeEmail)}`
      );
      setAirFryerContext(nextAirFryerContext);
      setSelectedInspection("");
      setMessage(language === "vi" ? "Đã bắt đầu lượt sử dụng nồi chiên không dầu." : "Air fryer use started.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start air fryer use.");
    } finally {
      setStartingAirFryer(false);
    }
  }

  async function triggerMicrowave() {
    if (!activeEmail || !selectedMicrowaveInspection) return;
    setTriggeringMicrowave(true);
    setMessage("");
    try {
      await fetchJson<{ ok: true }>(`${API_BASE_URL}/controller/microwave/d2/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: activeEmail, inspection: selectedMicrowaveInspection })
      });
      setSelectedMicrowaveInspection("");
      setMessage(language === "vi" ? "Lò vi sóng đã được bật." : "Microwave turned on.");
      // Refresh status to show cooldown
      const updated = await fetchJson<MicrowaveContext>(`${API_BASE_URL}/controller/microwave/d2?email=${encodeURIComponent(activeEmail)}`);
      setMicrowaveContext(updated);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to trigger microwave.");
    } finally {
      setTriggeringMicrowave(false);
    }
  }

  async function triggerLaundry() {
    if (!activeEmail || !activeLaundryBooking) {
      return;
    }

    setTriggeringLaundry(true);
    setMessage("");

    try {
      await fetchJson<{ ok: true }>(`${API_BASE_URL}/laundry/manual-trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: activeEmail,
          machineId: activeLaundryBooking.calendarId
        })
      });

      setMessage(language === "vi" ? "Đã kích hoạt máy giặt/sấy thành công." : "Laundry machine triggered successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to trigger laundry machine.");
    } finally {
      setTriggeringLaundry(false);
    }
  }

  const { isBlocked, blockReason, warnings } = useMemo(
    () => getAccountStatus(clientRecord, accountLockOverride),
    [accountLockOverride, clientRecord]
  );

  const acResidentDetailsBody = useMemo(() => {
    if (!context) return "";
    return [
      `${t("controllerGuestLabel")}: ${context.name || context.email}`,
      `${t("branchLabel")}: ${context.branchId}`,
      `${t("bedLabel")}: ${context.bed || "—"}`,
      `${t("roomLabel")}: ${context.roomCode || "—"}`,
      `${t("controllerContractLabel")}: ${context.contractCode || "—"}`
    ].join("\n");
  }, [context, t]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-900">{title}</h1>
      </div>

      {isBlocked && blockReason ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <div className="font-semibold">{language === "vi" ? "Tài khoản bị tạm khóa dịch vụ" : "Service access restricted"}</div>
          <div className="mt-1">{blockReason}</div>
        </section>
      ) : warnings.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <div className="font-semibold">{language === "vi" ? "Lưu ý tài khoản" : "Account notice"}</div>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-slate-700">
          {loading
            ? language === "vi"
              ? "Đang tải bộ điều khiển..."
              : "Loading your controls..."
            : language === "vi"
              ? "Bộ điều khiển tự động tải theo tài khoản đang đăng nhập."
              : "Your controls load automatically from your signed-in account."}
        </div>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>

      {context || airFryerContext ? (
        <div className="space-y-6">
          {showAcSection && context ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-900">{t("controllerAllowedRoomHeading")}</h2>
                <InlineHelp
                  label={t("controllerResidentDetailsHelp")}
                  title={t("controllerResidentDetailsTitle")}
                  body={acResidentDetailsBody}
                />
              </div>

              {context.room ? (
                <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-semibold text-emerald-900">{context.room.label}</p>
                  <p className="mt-1 text-sm text-emerald-800">
                    {language === "vi" ? "Lệnh gần nhất" : "Last request"}:{" "}
                    {context.room.lastRequestedAction
                      ? `${context.room.lastRequestedAction} · ${formatTimestamp(context.room.lastRequestedAt, language)}`
                      : formatTimestamp(context.room.lastRequestedAt, language)}
                  </p>
                  {!context.restrictions.canTurnOnNow ? (
                    <p className="mt-2 text-sm text-amber-700">
                      {language === "vi"
                        ? "Người dùng không được bật máy lạnh từ 7:00 sáng đến 10:00 sáng mỗi ngày, trừ Chủ nhật."
                        : context.restrictions.turnOnBlockedReason}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void sendCommand("ON")}
                      disabled={isBlocked || submittingAction !== null || !context.room.iftttConfigured || !context.restrictions.canTurnOnNow}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {submittingAction === "ON" ? (language === "vi" ? "Đang gửi..." : "Sending...") : language === "vi" ? "Bật máy lạnh" : "Turn AC on"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendCommand("OFF")}
                      disabled={isBlocked || submittingAction !== null || !context.room.iftttConfigured}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {submittingAction === "OFF" ? (language === "vi" ? "Đang gửi..." : "Sending...") : language === "vi" ? "Tắt máy lạnh" : "Turn AC off"}
                    </button>
                  </div>

                  <div className="mt-6 border-t border-emerald-200 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-emerald-900">{t("controllerComfortTitle")}</p>
                      <button
                        type="button"
                        id="controller-comfort-help-trigger"
                        aria-expanded={comfortHelpOpen}
                        aria-controls="controller-comfort-help-panel"
                        onClick={() => setComfortHelpOpen((v) => !v)}
                        className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full border border-emerald-600/40 bg-white text-sm font-bold text-emerald-900 shadow-sm hover:bg-emerald-100/80 dark:border-emerald-500/50 dark:bg-emerald-950/60 dark:text-emerald-50 dark:hover:bg-emerald-900/50"
                        title={t("controllerComfortHelpTitle", "How room temperature feedback works")}
                      >
                        ?
                      </button>
                    </div>
                    {comfortHelpOpen ? (
                      <p
                        id="controller-comfort-help-panel"
                        role="region"
                        aria-labelledby="controller-comfort-help-trigger"
                        className="mt-2 rounded-lg border border-emerald-200/90 bg-white/80 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-50"
                      >
                        {t(
                          "controllerComfortHelp",
                          "Tap if the AC feels too hot or too cold. If more than half of residents in this room choose the same option, managers get a notification to adjust the setpoint."
                        )}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void submitComfortVote("HOT")}
                        disabled={isBlocked || comfortSubmitting}
                        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                          context.comfort?.myVote === "HOT"
                            ? "bg-orange-600 text-white ring-2 ring-orange-300"
                            : "bg-orange-100 text-orange-900 hover:bg-orange-200"
                        }`}
                      >
                        {comfortSubmitting
                          ? t("controllerComfortSending")
                          : language === "vi"
                            ? "Quá nóng"
                            : "Too hot"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitComfortVote("COLD")}
                        disabled={isBlocked || comfortSubmitting}
                        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                          context.comfort?.myVote === "COLD"
                            ? "bg-sky-600 text-white ring-2 ring-sky-300"
                            : "bg-sky-100 text-sky-900 hover:bg-sky-200"
                        }`}
                      >
                        {comfortSubmitting
                          ? t("controllerComfortSending")
                          : language === "vi"
                            ? "Quá lạnh"
                            : "Too cold"}
                      </button>
                    </div>
                    {context.comfort && context.comfort.occupantCount > 0 ? (
                      <p className="mt-2 text-xs text-emerald-800">
                        {t("controllerComfortCounts", undefined, {
                          n: context.comfort.occupantCount,
                          hot: context.comfort.hotCount,
                          cold: context.comfort.coldCount
                        })}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">
                    {language === "vi"
                      ? "Chưa có cấu hình phòng máy lạnh cho khách này."
                      : "No AC room mapping is configured for this user yet."}
                  </p>
                  <ul className="mt-2 space-y-1">
                    <li>Branch: {context.mappingHint.branchId}</li>
                    <li>Bed: {context.mappingHint.bed || "-"}</li>
                    <li>Room: {context.mappingHint.roomCode || "-"}</li>
                    <li>Contract: {context.mappingHint.contractCode || "-"}</li>
                  </ul>
                </div>
              )}
            </section>
          ) : null}

          {showMicrowaveSection && microwaveContext?.eligible ? (
            <section className="rounded-2xl border border-orange-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {language === "vi" ? "Lò vi sóng D2" : "D2 Microwave"}
              </h2>
              <>
                  <p className="mt-2 text-sm text-slate-600">
                    {language === "vi"
                      ? `Thiết bị dùng chung với thời gian chờ ${microwaveContext.cooldownMinutes} phút mỗi lượt.`
                      : `Shared appliance with a ${microwaveContext.cooldownMinutes}-minute cooldown per use.`}
                  </p>

                  <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                    <div>
                      <span className="font-medium">{language === "vi" ? "Trạng thái" : "Status"}:</span>{" "}
                      {microwaveContext.status.availableNow
                        ? (language === "vi" ? "Sẵn sàng" : "Available now")
                        : (language === "vi" ? "Đang được sử dụng" : "Currently in use")}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Có thể dùng lại lúc" : "Available again"}:</span>{" "}
                      {formatTimestamp(microwaveContext.status.availableAt, language)}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Lượt gần nhất" : "Last use"}:</span>{" "}
                      {formatTimestamp(microwaveContext.status.lastUse?.startedAt ?? null, language)}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Người dùng gần nhất" : "Last user"}:</span>{" "}
                      {microwaveContext.status.lastUse?.startedByName || microwaveContext.status.lastUse?.startedByEmail || "-"}
                    </div>
                  </div>

                  {microwaveContext.status.currentUse ? (
                    <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                      <p className="font-semibold">
                        {language === "vi"
                          ? `${microwaveContext.status.currentUse.startedByName || microwaveContext.status.currentUse.startedByEmail} đang sử dụng lò vi sóng.`
                          : `${microwaveContext.status.currentUse.startedByName || microwaveContext.status.currentUse.startedByEmail} is currently using the microwave.`}
                      </p>
                      <p className="mt-1">
                        {language === "vi" ? "Bắt đầu" : "Started"}:{" "}
                        {formatTimestamp(microwaveContext.status.currentUse.startedAt, language)}
                      </p>
                      <p className="mt-1">
                        {language === "vi" ? "Có thể dùng lại sau" : "Available again after"}:{" "}
                        {formatTimestamp(microwaveContext.status.currentUse.availableAt, language)}
                      </p>
                    </div>
                  ) : null}

                  {!microwaveContext.status.currentUse && (
                    <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
                      <p className="text-xs font-bold text-orange-900 uppercase tracking-tight">{language === "vi" ? "Kiểm tra trước khi dùng *" : "Pre-use Inspection *"}</p>
                      <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
                        {[
                          { vi: "Sạch / Clean", value: "Clean" },
                          { vi: "Dơ / Dirty", value: "Dirty" },
                          { vi: "Hư hỏng / Damage", value: "Damage" }
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setSelectedMicrowaveInspection(opt.vi)}
                            className={`flex items-center justify-between rounded-lg border p-3 text-left transition-all ${
                              selectedMicrowaveInspection === opt.vi
                                ? "border-orange-500 bg-white ring-2 ring-orange-200"
                                : "border-orange-100 bg-white/50 hover:bg-white"
                            }`}
                          >
                            <span className={selectedMicrowaveInspection === opt.vi ? "font-bold text-orange-900" : "text-slate-600"}>
                              {opt.vi}
                            </span>
                            {selectedMicrowaveInspection === opt.vi && (
                              <svg className="h-4 w-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] leading-relaxed text-orange-800 font-medium">
                        {language === "vi"
                          ? "Bật lò vi sóng. Nhớ kiểm tra trước/sau khi sử dụng và đậy thức ăn bạn nhé. Nếu phát hiện hư hỏng hoặc bẩn, vui lòng báo ngay cho Cozoro."
                          : "Turning on the microwave. Remember to check before/after use and cover your food. If you find damage or dirt, please report it to Cozoro immediately."}
                      </p>
                      <button
                        type="button"
                        onClick={() => void triggerMicrowave()}
                        disabled={triggeringMicrowave || !selectedMicrowaveInspection}
                        className="mt-4 w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white shadow-lg shadow-orange-100 hover:bg-orange-600 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {triggeringMicrowave
                          ? (language === "vi" ? "Đang bật..." : "Turning on...")
                          : (language === "vi" ? "BẬT LÒ VI SÓNG" : "TURN ON MICROWAVE")}
                      </button>
                    </div>
                  )}
                </>
            </section>
          ) : null}

          {showAirFryerSection && airFryerContext?.eligible ? (
            <section className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                {language === "vi" ? "Nồi chiên không dầu D7" : "D7 Air Fryer"}
              </h2>
              <>
                  <p className="mt-2 text-sm text-slate-700">
                    {language === "vi"
                      ? `Thiết bị dùng chung với thời gian chờ ${airFryerContext.cooldownMinutes} phút mỗi lượt.`
                      : `Shared appliance with a ${airFryerContext.cooldownMinutes}-minute cooldown per use.`}
                  </p>

                  <div className="mt-4 grid gap-3 text-sm text-slate-900 md:grid-cols-2">
                    <div>
                      <span className="font-medium text-slate-800">{language === "vi" ? "Trạng thái" : "Status"}:</span>{" "}
                      {airFryerContext.status.availableNow
                        ? language === "vi"
                          ? "Sẵn sàng"
                          : "Available now"
                        : language === "vi"
                          ? "Đang được sử dụng"
                          : "Currently in use"}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Có thể dùng lại lúc" : "Available again"}:</span>{" "}
                      {formatTimestamp(airFryerContext.status.availableAt, language)}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Lượt gần nhất" : "Last use"}:</span>{" "}
                      {formatTimestamp(airFryerContext.status.lastUse?.startedAt ?? null, language)}
                    </div>
                    <div>
                      <span className="font-medium">{language === "vi" ? "Người dùng gần nhất" : "Last user"}:</span>{" "}
                      {airFryerContext.status.lastUse?.startedByName || airFryerContext.status.lastUse?.startedByEmail || "-"}
                    </div>
                  </div>

                  {airFryerContext.status.currentUse ? (
                    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-900">
                      <p className="font-semibold">
                        {language === "vi"
                          ? `${airFryerContext.status.currentUse.startedByName || airFryerContext.status.currentUse.startedByEmail} đang sử dụng nồi chiên không dầu.`
                          : `${airFryerContext.status.currentUse.startedByName || airFryerContext.status.currentUse.startedByEmail} is currently using the air fryer.`}
                      </p>
                      <p className="mt-1">
                        {language === "vi" ? "Bắt đầu" : "Started"}:{" "}
                        {formatTimestamp(airFryerContext.status.currentUse.startedAt, language)}
                      </p>
                      <p className="mt-1">
                        {language === "vi" ? "Có thể dùng lại sau" : "Available again after"}:{" "}
                        {formatTimestamp(airFryerContext.status.currentUse.availableAt, language)}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-5 space-y-5">
                    {!airFryerContext.status.currentUse && airFryerContext.status.availableNow && (
                      <div className="rounded-xl border border-amber-300 bg-white p-4 shadow-sm">
                        <p className="text-xs font-bold uppercase tracking-tight text-slate-900">Inspection *</p>
                        <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
                          {[
                            { vi: "Dơ / Chưa rửa / Dirty", value: "Dirty" },
                            { vi: "Sạch / Clean", value: "Clean" },
                            { vi: "Hư hỏng móp méo / Broken", value: "Broken" },
                            { vi: "Chưa rút điện / Unplugged", value: "Unplugged" }
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setSelectedInspection(opt.vi)}
                              className={`flex items-center justify-between rounded-lg border p-3 text-left transition-all ${
                                selectedInspection === opt.vi
                                  ? "border-amber-500 bg-amber-50 ring-2 ring-amber-300"
                                  : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100"
                              }`}
                            >
                              <span
                                className={
                                  selectedInspection === opt.vi ? "font-bold text-slate-950" : "font-medium text-slate-900"
                                }
                              >
                                {opt.vi}
                              </span>
                              {selectedInspection === opt.vi && (
                                <svg className="h-4 w-4 shrink-0 text-amber-700" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              )}
                            </button>
                          ))}
                        </div>
                        <p className="mt-4 text-xs leading-relaxed font-medium text-slate-900">
                          {language === "vi"
                            ? "Vui lòng nêu tình trạng nồi chiên không dầu trước khi bạn sử dụng. Cozoro sẽ dựa vào lịch sử sử dụng để tính toán hao phí để tăng tuổi thọ cho nồi chiên. Nếu bạn phát hiện nồi dơ hoặc có dấu hiệu hư hỏng xin báo NGAY cho Cozoro biết. Việc không thông báo hoặc thông báo trễ có thể sẽ dẫn đến phí hư hại dành cho bạn."
                            : "Please state the condition of the airfryer before you use it. Cozoro will rely on use history to calculate wear and tear to increase the life of the fryer. If you find the pot dirty or showing signs of damage, please report it IMMEDIATELY to Cozoro. Failure to notify or late notification may result in a damage fee for you."}
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void startAirFryer()}
                      disabled={isBlocked || startingAirFryer || !airFryerContext.status.availableNow || !selectedInspection}
                      className="w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white shadow-lg shadow-amber-100 hover:bg-amber-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {startingAirFryer 
                        ? (language === "vi" ? "Đang xử lý..." : "Processing...") 
                        : (language === "vi" ? "BẮT ĐẦU SỬ DỤNG" : "START USING NOW")}
                    </button>
                  </div>
                </>
            </section>
          ) : null}

          <section className="rounded-2xl border border-sky-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">
              {language === "vi" ? "Máy giặt & sấy tự phục vụ" : "Self-service Laundry"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {language === "vi" 
                ? "Nút kích hoạt chỉ hiển thị khi bạn có lịch đặt đang diễn ra."
                : "The trigger button is only available during your active booking window."}
            </p>

            {activeLaundryBooking ? (
              <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-sky-900">{activeLaundryBooking.calendarSummary}</p>
                    <p className="mt-1 text-xs text-sky-800">
                      {language === "vi" ? "Lịch đặt" : "Booking"}: {activeLaundryBooking.summary}
                    </p>
                    <p className="text-[10px] text-sky-600 mt-0.5">
                      {formatTimestamp(activeLaundryBooking.start, language)} - {formatTimestamp(activeLaundryBooking.end, language)}
                    </p>
                  </div>
                  <div className="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></div>
                </div>

                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => void triggerLaundry()}
                    disabled={triggeringLaundry}
                    className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white shadow-lg shadow-sky-100 hover:bg-sky-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {triggeringLaundry
                      ? (language === "vi" ? "Đang kích hoạt..." : "Triggering...")
                      : (language === "vi" ? "BẮT ĐẦU GIẶT/SẤY" : "START MACHINE NOW")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/50 p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="mt-4 text-sm font-medium text-slate-600">
                  {language === "vi" ? "Không có lịch giặt nào đang diễn ra." : "No active laundry booking found."}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {language === "vi" 
                    ? "Bạn có thể kích hoạt máy khi đến giờ hẹn trong lịch đặt của mình." 
                    : "You can trigger the machine when your scheduled time slot starts."}
                </p>
              </div>
            )}

            {nextLaundryBooking && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {language === "vi" ? "Lịch đặt tiếp theo" : "Next Booking"}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{nextLaundryBooking.calendarSummary}</p>
                    <p className="text-[10px] text-slate-500">
                      {formatTimestamp(nextLaundryBooking.start, language)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
