"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

type TransferBed = {
  bedNumber: number;
  status: string;
  pricing: { monthlyPrice: number; deposit: number };
};

type TransferRoom = {
  room: string;
  floor: string;
  beds: TransferBed[];
};

type TransferAvailability = {
  branchId: "D2" | "D7";
  contractEndDate: string;
  currentBranch: "D2" | "D7";
  currentBed: number | null;
  availableBeds: number;
  rooms: TransferRoom[];
};

export function ContractTransfer({
  email,
  currentBranch,
  currentBed,
  contractEndDate,
  onSubmitted
}: {
  email: string;
  currentBranch: string;
  currentBed: number | null;
  contractEndDate: string;
  onSubmitted: () => void;
}) {
  const { t, language } = usePortalLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<"D2" | "D7">(
    currentBranch === "D7" ? "D7" : "D2"
  );
  const [availability, setAvailability] = useState<TransferAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedBed, setSelectedBed] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [fullName, setFullName] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [countdown, setCountdown] = useState(15);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  const normalizedBranch = currentBranch === "D7" ? "D7" : "D2";

  const loadAvailability = useCallback(async () => {
    setAvailabilityLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/clients/contracts/transfer/availability?email=${encodeURIComponent(email)}&branchId=${selectedBranch}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load beds");
      setAvailability(data as TransferAvailability);
      setSelectedBed(null);
    } catch (err: unknown) {
      setAvailability(null);
      setError(err instanceof Error ? err.message : "Unable to load available beds.");
    } finally {
      setAvailabilityLoading(false);
    }
  }, [email, selectedBranch]);

  useEffect(() => {
    if (!isExpanded) return;
    void loadAvailability();
  }, [isExpanded, loadAvailability]);

  useEffect(() => {
    if (isExpanded && canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
      }
    }
  }, [isExpanded]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (isSuccess && countdown > 0) {
      timer = setInterval(() => setCountdown((prev) => prev - 1), 1000);
    } else if (isSuccess && countdown === 0) {
      onSubmitted();
    }
    return () => clearInterval(timer);
  }, [isSuccess, countdown, onSubmitted]);

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

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const touch = "touches" in e && e.touches.length > 0 ? e.touches[0] : null;
    const clientX = "clientX" in e ? e.clientX : touch?.clientX ?? 0;
    const clientY = "clientY" in e ? e.clientY : touch?.clientY ?? 0;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

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

  async function handleSubmit() {
    if (!selectedBed) {
      setError(t("contractTransferPickBed"));
      return;
    }
    if (!agreed || !hasSignature || !fullName.trim()) {
      setError(t("mustSignAndAgree"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/clients/contracts/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          newBranchId: selectedBranch,
          newBedNumber: selectedBed,
          clientSignatureDataUrl: canvasRef.current?.toDataURL("image/png"),
          clientSignatureTimestamp: new Date().toISOString()
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to submit transfer request");
      }

      setIsSuccess(true);
      setCountdown(15);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  if (isSuccess) {
    return (
      <div className="mb-6 rounded-3xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center text-center space-y-4">
          <h2 className="text-2xl font-bold text-emerald-900">{t("contractTransferSubmitted")}</h2>
          <p className="text-sm text-emerald-800 max-w-md">{t("contractTransferPendingApproval")}</p>
          <button
            type="button"
            onClick={() => {
              setIsExpanded(false);
              setIsSuccess(false);
              onSubmitted();
            }}
            className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            {t("gotIt")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-3xl border border-sky-300 bg-sky-50 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-sky-900">{t("contractTransferTitle")}</h2>
          <p className="text-sm text-sky-800 mt-1">
            {t("contractTransferDesc", {
              branch: normalizedBranch,
              bed: currentBed != null ? String(currentBed) : "—",
              end: contractEndDate || "—"
            })}
          </p>
        </div>
        {!isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="shrink-0 rounded-full bg-sky-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
          >
            {t("contractTransferStart")}
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-8 pt-6 border-t border-sky-200 space-y-6 max-w-2xl">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-sky-700 mb-2">
              {t("contractTransferNewBranch")}
            </label>
            <div className="flex gap-2">
              {(["D2", "D7"] as const).map((branch) => (
                <button
                  key={branch}
                  type="button"
                  disabled={loading}
                  onClick={() => setSelectedBranch(branch)}
                  className={`rounded-full px-5 py-2 text-sm font-semibold border-2 ${
                    selectedBranch === branch
                      ? "border-sky-600 bg-sky-100 text-sky-900"
                      : "border-sky-200 bg-white text-sky-800"
                  }`}
                >
                  {branch}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-sky-700">
                {t("contractTransferPickBed")}
              </label>
              <button
                type="button"
                onClick={() => void loadAvailability()}
                disabled={availabilityLoading}
                className="text-xs font-semibold text-sky-700 underline disabled:opacity-50"
              >
                {availabilityLoading ? t("processing") : t("contractTransferRefresh")}
              </button>
            </div>
            {availabilityLoading ? (
              <p className="text-sm text-sky-700">{t("processing")}</p>
            ) : availability && availability.rooms.length > 0 ? (
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {availability.rooms.map((room) => (
                  <div key={room.room} className="rounded-xl border border-sky-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-600 mb-2">
                      {t("contractTransferRoom", { room: room.room, floor: room.floor })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {room.beds.map((bed) => (
                        <button
                          key={bed.bedNumber}
                          type="button"
                          disabled={loading}
                          onClick={() => setSelectedBed(bed.bedNumber)}
                          className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold ${
                            selectedBed === bed.bedNumber
                              ? "border-sky-600 bg-sky-100 text-sky-900"
                              : "border-slate-200 text-slate-800 hover:border-sky-400"
                          }`}
                        >
                          {t("bedLabel")} {bed.bedNumber}{" "}
                          <span className="text-xs font-normal text-slate-500">
                            {bed.pricing.monthlyPrice.toLocaleString(language === "vi" ? "vi-VN" : "en-US")}₫
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-sky-800">{t("contractTransferNoBeds")}</p>
            )}
          </div>

          {selectedBed != null && (
            <p className="text-sm font-semibold text-sky-900">
              {t("contractTransferSummary", {
                branch: selectedBranch,
                bed: String(selectedBed),
                end: contractEndDate || availability?.contractEndDate || "—"
              })}
            </p>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-sky-700 mb-2">
              {t("yourFullName")}
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={loading}
              className="w-full rounded-2xl border border-sky-300 bg-white px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-sky-700 mb-2 flex justify-between">
              <span>{t("signatureLabel")}</span>
              {hasSignature && (
                <button type="button" onClick={clearSignature} className="text-sky-600 underline text-xs">
                  {t("clearSignature")}
                </button>
              )}
            </label>
            <div className="relative rounded-2xl border-2 border-dashed border-sky-300 bg-white p-1 h-32">
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

          <label className="flex items-start gap-4 cursor-pointer bg-white/50 p-4 rounded-2xl border border-sky-200">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
            <span className="text-sm font-medium text-sky-950">{t("contractAgreeTermsFormal")}</span>
          </label>

          {error && <p className="text-sm text-rose-600 font-bold">✕ {error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !selectedBed || !agreed || !hasSignature || !fullName.trim()}
              className="flex-1 rounded-full bg-slate-900 px-8 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {loading ? t("processing") : t("contractTransferSubmit")}
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              disabled={loading}
              className="px-6 py-3 text-sm font-bold text-sky-900"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
