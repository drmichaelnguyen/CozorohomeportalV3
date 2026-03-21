"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import { usePortalSession } from "./portal-session";

export function FeedbackFab() {
  const pathname = usePathname();
  const { sessionEmail } = usePortalSession();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setStatus("Please enter your feedback first.");
      return;
    }

    setSubmitting(true);
    setStatus("");

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: sessionEmail,
          page: pathname,
          message: trimmedMessage
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(data.error ?? "Unable to send feedback.");
        return;
      }

      setMessage("");
      setStatus("Feedback sent to admin.");
      setTimeout(() => {
        setIsOpen(false);
        setStatus("");
      }, 1200);
    } catch {
      setStatus("Unable to send feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {isOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-950/20" onClick={() => setIsOpen(false)} aria-hidden="true" />
      ) : null}

      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
        {isOpen ? (
          <form
            onSubmit={submitFeedback}
            className="w-[min(24rem,calc(100vw-1.25rem))] rounded-3xl border border-amber-200 bg-white p-4 shadow-2xl sm:w-[min(24rem,calc(100vw-2rem))] sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Send Feedback</h2>
                <p className="mt-1 text-sm text-slate-600">This feedback will be saved for admin review.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600"
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              <div>Page: {pathname}</div>
              <div>User: {sessionEmail || "anonymous"}</div>
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-700">
              What should we improve here?
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                placeholder="Tell admin what is confusing, broken, or missing on this page..."
              />
            </label>

            {status ? <p className="mt-3 text-sm text-slate-700">{status}</p> : null}

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-amber-400 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-300/40 transition hover:bg-amber-300 disabled:opacity-60"
              >
                {submitting ? "Sending..." : "Send feedback"}
              </button>
            </div>
          </form>
        ) : null}

        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          className="rounded-full bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-2xl shadow-amber-300/50 ring-4 ring-amber-200/70 transition hover:-translate-y-0.5 hover:bg-amber-300 sm:px-5"
        >
          Feedback
        </button>
      </div>
    </>
  );
}
