"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

export function ContractExtension({
  email,
  endDateStr,
  onExtended,
  forceExpand = false
}: {
  email: string;
  endDateStr: string;
  onExtended: () => void;
  forceExpand?: boolean;
}) {
  const { t, language } = usePortalLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [duration, setDuration] = useState<number | "hostel">(6);
  const [agreed, setAgreed] = useState(false);
  const [fullName, setFullName] = useState("");
  const [isExpanded, setIsExpanded] = useState(forceExpand);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [countdown, setCountdown] = useState(15);

  // Initialize Canvas
  useEffect(() => {
    if (isExpanded && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
      }
    }
  }, [isExpanded]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    draw(e);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) ctx.beginPath();
    }
  };

  const draw = (e: any) => {
    if (!isDrawing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    setHasSignature(true);
  };

  const clearSignature = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setHasSignature(false);
      }
    }
  };

  const isNearingEnd = useMemo(() => {
    if (!endDateStr) return false;
    let end: Date;
    if (endDateStr.includes("/")) {
      const [d, m, y] = endDateStr.split("/");
      end = new Date(Number(y), Number(m) - 1, Number(d));
    } else {
      end = new Date(endDateStr);
    }
    
    if (Number.isNaN(end.getTime())) return false;
    
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays <= 30; // Show if nearing end or already expired
  }, [endDateStr]);

  // Countdown logic for success state - MUST BE ABOVE EARLY RETURN
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isSuccess && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else if (isSuccess && countdown === 0) {
      onExtended();
    }
    return () => clearInterval(timer);
  }, [isSuccess, countdown, onExtended]);

  if (!isNearingEnd && !isSuccess && !forceExpand) {
    return null;
  }

  // Short-stay surcharge rate for the selected extension duration
  const extensionSurchargeRate = typeof duration === "number"
    ? (duration >= 1 && duration <= 3 ? 0.12 : duration >= 4 && duration <= 5 ? 0.08 : 0)
    : 0;

  async function handleExtend() {
    if (duration === "hostel") {
      window.open("https://hostel.cozorohome.com", "_blank");
      return;
    }
    if (!agreed || !hasSignature || !fullName.trim()) {
      setError(t("mustSignAndAgree"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/clients/contracts/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          extensionMonths: duration
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to extend contract");
      }

      setIsSuccess(true);
      setCountdown(15);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setLoading(false);
    }
  }

  if (isSuccess) {
    return (
      <div className="mb-6 rounded-3xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm sm:p-8 animate-in zoom-in duration-500">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 relative">
            <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {countdown > 0 && (
              <div className="absolute -top-1 -right-1 h-7 w-7 rounded-full bg-emerald-600 text-[10px] font-bold text-white flex items-center justify-center border-2 border-white shadow-sm">
                {countdown}s
              </div>
            )}
          </div>
          <h2 className="text-2xl font-bold text-emerald-900">{t("extensionSubmitted")}</h2>
          <div className="max-w-md">
            <p className="text-emerald-800 font-medium">
              {t("processingWait")}
            </p>
            <p className="text-emerald-700 text-sm mt-3 leading-relaxed">
              {t("checkEmailFifteenSeconds")}
            </p>
          </div>
          <button 
            onClick={() => {
               setIsExpanded(false);
               setIsSuccess(false);
               onExtended();
            }} 
            className="mt-4 rounded-full bg-emerald-600 px-8 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition shadow-lg flex items-center gap-2"
          >
            <span>{t("gotIt")}</span>
            {countdown > 0 && <span className="opacity-60 text-xs font-normal">({countdown}s)</span>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="contract-extension-panel" className="mb-6 rounded-3xl border border-amber-300 bg-amber-50 p-5 shadow-sm sm:p-6 transition-all duration-300">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-amber-900">
              {t("contractEndingSoon")}
            </h2>
            <p className="text-sm text-amber-800">
              {t("contractEndingDesc", { date: endDateStr })}
            </p>
          </div>
        </div>
        {!isExpanded && (
          <button
            onClick={() => setIsExpanded(true)}
            className="shrink-0 rounded-full bg-amber-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-amber-700 transition shadow-sm hover:shadow-md"
          >
            {t("extendNow")}
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-8 pt-6 border-t border-amber-200 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="space-y-6 max-w-2xl">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-amber-700 mb-3">
                {t("selectExtensionDuration")}
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {/* Hostel redirect option */}
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setDuration("hostel")}
                  className={`rounded-2xl border-2 p-3 text-left transition-all ${
                    duration === "hostel"
                      ? "border-rose-400 bg-rose-100 shadow-md"
                      : "border-rose-200 bg-white hover:border-rose-300"
                  }`}
                >
                  <p className="text-sm font-bold text-rose-900">{t("extensionUnderOneMonth")}</p>
                  <p className="mt-1.5 text-xs font-semibold text-rose-600">🏨 {t("hostelBooking")}</p>
                </button>
                {([
                  { months: 1, durKey: "extensionDuration1m", coins: 0, surcharge: 12 },
                  { months: 3, durKey: "extensionDuration3m", coins: 10000, surcharge: 12 },
                  { months: 6, durKey: "extensionDuration6m", coins: 25000, surcharge: 0 },
                  { months: 12, durKey: "extensionDuration12m", coins: 50000, surcharge: 0 }
                ] as const).map((opt) => (
                  <button
                    key={opt.months}
                    type="button"
                    disabled={loading}
                    onClick={() => setDuration(opt.months)}
                    className={`rounded-2xl border-2 p-3 text-left transition-all ${
                      duration === opt.months
                        ? "border-amber-500 bg-amber-100 shadow-md"
                        : "border-amber-200 bg-white hover:border-amber-400"
                    }`}
                  >
                    <p className="text-sm font-bold text-amber-900">{t(opt.durKey)}</p>
                    {opt.surcharge > 0 ? (
                      <p className="mt-1.5 text-xs font-semibold text-orange-600">
                        {t("extensionSurchargeShort", { pct: opt.surcharge })}
                      </p>
                    ) : opt.coins > 0 ? (
                      <p className="mt-1.5 text-xs font-semibold text-emerald-700">
                        {t("extensionBonusCoinsLine", {
                          amount: opt.coins.toLocaleString(language === "vi" ? "vi-VN" : "en-US")
                        })}{" "}
                        🪙
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-slate-400">{t("extensionNoCoinsLine")}</p>
                    )}
                  </button>
                ))}
              </div>
              {/* Hostel redirect notice */}
              {duration === "hostel" && (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-start gap-3">
                  <span className="text-rose-500 text-lg shrink-0">🏨</span>
                  <div>
                    <p className="text-sm font-semibold text-rose-900">{t("hostelRedirectTitle")}</p>
                    <p className="text-xs text-rose-700 mt-1">{t("hostelRedirectDesc")}</p>
                    <a href="https://hostel.cozorohome.com" target="_blank" rel="noopener noreferrer"
                      className="mt-2 inline-block rounded-full bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-500">
                      {t("goToHostel")} →
                    </a>
                  </div>
                </div>
              )}
              {/* Surcharge warning for 1-3 month extensions */}
              {extensionSurchargeRate > 0 && duration !== "hostel" && (
                <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
                  <span className="text-amber-500 text-lg shrink-0">⚠️</span>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      {extensionSurchargeRate === 0.12 ? t("surcharge12Title") : t("surcharge8Title")}
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      {extensionSurchargeRate === 0.12 ? t("surcharge12Desc") : t("surcharge8Desc")}
                    </p>
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-amber-700">
                🎁 {t("continuousStayBonus", "Continuous stay bonus: +30,000 coins at 6 months · +20,000 extra at 12 months — awarded by management. / Thưởng ở liên tục: +30.000 coins đủ 6 tháng · +20.000 thêm đủ 12 tháng — quản lý cộng thủ công.")}
              </p>
            </div>

            {duration !== "hostel" && (
              <>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-700 mb-2">
                    {t("yourFullName")}
                  </label>
                  <input
                    type="text"
                    placeholder={t("fullNamePlaceholder")}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-200/50 transition-all font-medium"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-700 mb-2 flex justify-between">
                    <span>{t("signatureLabel")}</span>
                    {hasSignature && (
                      <button onClick={clearSignature} className="text-amber-600 hover:text-amber-800 underline lowercase">
                        {t("clearSignature")}
                      </button>
                    )}
                  </label>
                  <div className="relative rounded-2xl border-2 border-dashed border-amber-300 bg-white p-1 h-32">
                    <canvas
                      ref={canvasRef}
                      width={600}
                      height={120}
                      onMouseDown={startDrawing}
                      onMouseUp={stopDrawing}
                      onMouseOut={stopDrawing}
                      onMouseMove={draw}
                      onTouchStart={startDrawing}
                      onTouchEnd={stopDrawing}
                      onTouchMove={draw}
                      className="w-full h-full cursor-crosshair touch-none"
                    />
                    {!hasSignature && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400 text-sm italic">
                        {t("signHere")}
                      </div>
                    )}
                  </div>
                </div>

                <label className="flex items-start gap-4 cursor-pointer group bg-white/50 p-4 rounded-2xl border border-amber-200 hover:bg-white transition-colors">
                  <div className="shrink-0 mt-0.5 relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      disabled={loading}
                      className="peer sr-only"
                    />
                    <div className="h-6 w-6 rounded-lg border-2 border-amber-400 bg-white transition peer-checked:border-amber-600 peer-checked:bg-amber-600" />
                    <svg
                      className="pointer-events-none absolute h-4 w-4 text-white opacity-0 transition peer-checked:opacity-100"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <span className="text-sm text-amber-950 font-medium font-bold leading-relaxed">
                    {t("contractAgreeTermsFormal")}
                  </span>
                </label>
              </>
            )}

            {error && <p className="text-sm text-rose-600 font-bold animate-pulse px-4">✕ {error}</p>}

            <div className="flex items-center gap-4 pt-2">
              <button
                onClick={handleExtend}
                disabled={duration !== "hostel" && (loading || !agreed || !hasSignature || !fullName.trim())}
                className={`flex-1 rounded-full px-8 py-3.5 text-sm font-bold text-white transition shadow-lg translate-y-0 active:translate-y-0.5 disabled:opacity-50 disabled:shadow-none ${duration === "hostel" ? "bg-rose-600 hover:bg-rose-500" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {duration === "hostel"
                  ? `${t("goToHostel")} →`
                  : loading ? t("processing") : t("confirmExtension")}
              </button>
              <button
                onClick={() => setIsExpanded(false)}
                disabled={loading}
                className="px-6 py-3.5 text-sm font-bold text-amber-900 hover:bg-amber-200/50 rounded-full transition"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
