"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalLanguage } from "./portal-language";

export type MaintenanceLocationOption = {
  value: string;
  label: string;
};

export function MaintenanceReportModal({
  open,
  email,
  name,
  branch,
  locationOptions,
  initialLocation,
  initialDevice,
  onClose,
  onSuccess
}: {
  open: boolean;
  email: string;
  name?: string;
  branch?: string;
  locationOptions: MaintenanceLocationOption[];
  initialLocation?: string;
  initialDevice?: string;
  onClose: () => void;
  onSuccess?: (summary: { location: string; issue: string; device: string }) => void;
}) {
  const { t } = usePortalLanguage();
  const [reportLocation, setReportLocation] = useState("");
  const [reportIssue, setReportIssue] = useState("");
  const [reportMachine, setReportMachine] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [isReporting, setIsReporting] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setReportLocation(initialLocation ?? "");
    setReportMachine(initialDevice ?? "");
    setCustomLocation("");
    setReportIssue("");
    setStatus("");
  }, [open, initialLocation, initialDevice]);

  if (!open) {
    return null;
  }

  const finalLocation = reportLocation === "OTHER" ? customLocation.trim() : reportLocation;

  async function handleReportSubmit() {
    if (!finalLocation || !reportIssue.trim()) {
      setStatus(t("fillRequiredFields", "Please fill in location and issue description."));
      return;
    }

    setIsReporting(true);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE_URL}/client/maintenance/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name?.trim() || undefined,
          branch: branch || undefined,
          location: finalLocation,
          issue: reportIssue.trim(),
          machineDevice: reportMachine.trim() || undefined
        })
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setStatus(data.error || t("unableToSubmitReport", "Unable to submit report."));
        return;
      }

      onSuccess?.({
        location: finalLocation,
        issue: reportIssue.trim(),
        device: reportMachine.trim()
      });
      onClose();
    } catch {
      setStatus(t("unableToSubmitReport", "Unable to submit report."));
    } finally {
      setIsReporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{t("maintenanceReport", "Maintenance Report")}</h2>
            <p className="text-xs text-slate-500">{t("reportSubtext", "Submit a ticket to earn 5000 coins.")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-slate-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 text-slate-400">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("location", "Location")}</label>
            <select
              value={reportLocation}
              onChange={(event) => setReportLocation(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">{t("selectLocation", "Select location...")}</option>
              {locationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="OTHER">{t("otherLocation", "Other...")}</option>
            </select>
          </div>

          {reportLocation === "OTHER" ? (
            <input
              type="text"
              placeholder={t("specificLocationPlaceholder", "e.g. Balcony 3rd floor...")}
              value={customLocation}
              onChange={(event) => setCustomLocation(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          ) : null}

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("machineDevice", "Device (Optional)")}</label>
            <input
              type="text"
              placeholder={t("machinePlaceholder", "e.g. Washer D7, AC...")}
              value={reportMachine}
              onChange={(event) => setReportMachine(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("issueDescription", "Issue Description")}</label>
            <textarea
              placeholder={t("issuePlaceholder", "What's wrong?")}
              value={reportIssue}
              onChange={(event) => setReportIssue(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          {status ? <p className="text-sm font-medium text-rose-700">{status}</p> : null}

          <div className="pt-2">
            <button
              type="button"
              onClick={() => void handleReportSubmit()}
              disabled={isReporting || !finalLocation || !reportIssue.trim()}
              className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white shadow-lg transition-all hover:bg-slate-800 disabled:opacity-50"
            >
              {isReporting ? t("submitting", "Submitting...") : t("submitReport", "Submit Maintenance Ticket")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
