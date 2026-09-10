"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";

export function OwnerCleaningExemption({ actorEmail, targetEmail, language }: {
  actorEmail: string; targetEmail: string; language: string;
}) {
  const [exempt, setExempt] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const vi = language === "vi";

  useEffect(() => {
    const controller = new AbortController();
    setExempt(null);
    setError("");
    const query = new URLSearchParams({ actorEmail, targetEmail });
    void fetch(`${API_BASE_URL}/manager/cleaning-assignment-exemption?${query}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || typeof data.exempt !== "boolean") throw new Error(data.error || "Unable to load cleaning exemption.");
        if (!controller.signal.aborted) setExempt(data.exempt);
      })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load cleaning exemption."); });
    return () => controller.abort();
  }, [actorEmail, targetEmail]);

  async function save(next: boolean) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/manager/cleaning-assignment-exemption`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail, targetEmail, exempt: next })
      });
      const data = await response.json();
      if (!response.ok || typeof data.exempt !== "boolean") throw new Error(data.error || "Unable to save cleaning exemption.");
      setExempt(data.exempt);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save cleaning exemption.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="my-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="flex cursor-pointer items-start gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" checked={exempt === true} disabled={exempt === null || saving}
          onChange={event => void save(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{vi ? "Miễn tự động xếp lịch vệ sinh (đã thỏa thuận)" : "Exempt from automatic cleaning assignments (owner agreement)"}</span>
      </label>
      <p className="mt-2 text-xs text-slate-600">
        {vi
          ? "Áp dụng cho lịch tự động và xếp lịch thay thế cho đến khi bỏ chọn. Không thu phí. Lịch đã có vẫn giữ nguyên."
          : "Excludes future automatic schedules and replacement assignments until unticked. No fee. Existing tasks stay in place."}
      </p>
      {saving && <p role="status" className="mt-1 text-xs text-slate-600">{vi ? "Đang lưu…" : "Saving…"}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
