"use client";

import { useEffect, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { usePortalSession } from "./portal-session";
import { usePortalLanguage } from "./portal-language";



type SupportConversation = {
  id: string;
  residentEmail: string;
  residentName: string | null;
  status: "OPEN" | "CLOSED";
  lastMessageAt: string;
  createdAt: string;
};

type SupportMessage = {
  id: string;
  senderEmail: string;
  senderName: string | null;
  senderRole: "RESIDENT" | "MANAGER" | "OWNER";
  body: string;
  isAnonymous?: boolean;
  pagePath: string | null;
  createdAt: string;
};

type GroupContext = {
  branchId: string;
  roomLabel: string;
  floor: string;
  groupIds: {
    room: string;
    floor: string;
    branch: string;
  };
};

type ChatTab = "personal" | "room" | "floor" | "branch";


function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function senderLabel(message: SupportMessage, sessionEmail: string) {
  if (message.senderRole === "OWNER" || message.senderRole === "MANAGER") {
    return "Cozoro";
  }

  return message.senderEmail === sessionEmail ? "You" : message.senderName || "Resident";
}

export function SupportClient() {
  const { sessionEmail } = usePortalSession();
  const { t } = usePortalLanguage();


  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  const [activeTab, setActiveTab] = useState<ChatTab>("personal");
  const [groupContext, setGroupContext] = useState<GroupContext | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [overrideGroupId, setOverrideGroupId] = useState<string | null>(null);

  // Maintenance reporting modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportLocation, setReportLocation] = useState("");
  const [reportIssue, setReportIssue] = useState("");
  const [reportMachine, setReportMachine] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [isReporting, setIsReporting] = useState(false);

  // Deep linking support
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab") as ChatTab;
    const groupParam = params.get("groupId");
    if (tabParam && ["personal", "room", "floor", "branch"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
    if (groupParam) {
      setOverrideGroupId(groupParam);
    }
  }, []);




  async function loadConversation() {
    if (!sessionEmail.trim()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setStatus("");

    try {
      // Load group context first if not loaded
      if (!groupContext) {
        const ctxResponse = await fetch(`${API_BASE_URL}/support/group-context?email=${encodeURIComponent(sessionEmail.trim().toLowerCase())}`);
        if (ctxResponse.ok) {
          const ctxData = await ctxResponse.json();
          setGroupContext(ctxData);
        }
      }

      // Check if staff (personal conversation might help, but we can also just check if there's an activeTab shift)
      if (activeTab === "personal") {
        const response = await fetch(
          `${API_BASE_URL}/support/conversation?email=${encodeURIComponent(sessionEmail.trim().toLowerCase())}`
        );
        const data = (await response.json()) as {
          conversation?: SupportConversation;
          messages?: SupportMessage[];
          error?: string;
        };

        if (!response.ok) {
          setStatus(data.error ?? "Unable to load support chat.");
          return;
        }

        setConversation(data.conversation ?? null);
        setMessages(data.messages ?? []);
        
        // Simple heuristic for isStaff
        const anyStaffMsg = data.messages?.some(m => m.senderEmail === sessionEmail.trim().toLowerCase() && (m.senderRole === "MANAGER" || m.senderRole === "OWNER"));
        if (anyStaffMsg) setIsStaff(true);

        if (data.conversation?.id) {
          void fetch(`${API_BASE_URL}/support/conversations/${encodeURIComponent(data.conversation.id)}/read`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email: sessionEmail.trim().toLowerCase()
            })
          });
        }
      } else {
        // Load group messages
        const groupId = overrideGroupId || (groupContext ? groupContext.groupIds[activeTab] : null);
        if (!groupId) {
          if (!groupContext) {
            // Wait for context to lead if not staff
            setLoading(false);
          }
          return;
        }

        const response = await fetch(
          `${API_BASE_URL}/support/group-messages?groupId=${encodeURIComponent(groupId)}&email=${encodeURIComponent(sessionEmail.trim().toLowerCase())}`
        );
        const data = (await response.json()) as { messages?: SupportMessage[]; error?: string };


        if (!response.ok) {
          setStatus(data.error ?? "Unable to load group messages.");
          return;
        }

        setMessages(data.messages ?? []);
        setConversation(null);

        // Mark group as read
        void fetch(`${API_BASE_URL}/support/group-read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: sessionEmail.trim().toLowerCase(),
            groupId
          })
        });
      }

    } catch {
      setStatus("Unable to load chat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConversation();
  }, [sessionEmail, activeTab, groupContext?.groupIds?.room, overrideGroupId]);



  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = draft.trim();
    if (!body) {
      setStatus("Please enter a message first.");
      return;
    }

    setSubmitting(true);
    setStatus("");

    try {
      let response;
      if (activeTab === "personal") {
        response = await fetch(`${API_BASE_URL}/support/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: sessionEmail.trim().toLowerCase(),
            body,
            pagePath: window.location.pathname
          })
        });
      } else {
        const groupId = overrideGroupId || (groupContext ? groupContext.groupIds[activeTab] : null);
        if (!groupId) return;

        response = await fetch(`${API_BASE_URL}/support/group-messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: sessionEmail.trim().toLowerCase(),
            groupId: groupId,
            body,
            isAnonymous
          })
        });
      }


      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(data.error ?? "Unable to send your message.");
        return;
      }

      setDraft("");
      setStatus("Message sent.");
      await loadConversation();
    } catch {
      setStatus("Unable to send your message.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReportSubmit() {
    const finalLocation = reportLocation === "OTHER" ? customLocation : reportLocation;
    if (!finalLocation || !reportIssue) {
      setStatus("Please fill in location and issue description.");
      return;
    }

    setIsReporting(true);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE_URL}/client/maintenance/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: sessionEmail.trim().toLowerCase(),
          location: finalLocation,
          issue: reportIssue,
          machineDevice: reportMachine || undefined
        })
      });

      if (!response.ok) {
        const data = await response.json();
        setStatus(data.error || "Unable to submit report.");
        return;
      }

      setStatus("Report submitted successfully! 5000 coins added to your account.");
      setShowReportModal(false);
      setReportLocation("");
      setCustomLocation("");
      setReportIssue("");
      setReportMachine("");
      
      // Send a system message to the chat
      setDraft(t("reportedIssueSystemMsg", `[System] Reported maintenance issue: ${reportIssue} at ${finalLocation}${reportMachine ? ` (${reportMachine})` : ""}`));
      // We don't auto-submit the message, let the user see the success first
    } catch {
      setStatus("Unable to submit report.");
    } finally {
      setIsReporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{t("residentMessages", "Messages & Community")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("messagesChatDesc", "Communicate with Cozoro staff or connect with your neighbors in group chats.")}
        </p>
        
        <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-100 pb-4">
          <button
            onClick={() => setActiveTab("personal")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              activeTab === "personal" ? "bg-slate-900 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t("personalMessages", "Personal")}
          </button>
          {groupContext && (
            <>
              <button
                onClick={() => setActiveTab("room")}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                  activeTab === "room" ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("room", "Room")} {groupContext.roomLabel}
              </button>
              <button
                onClick={() => setActiveTab("floor")}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                  activeTab === "floor" ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("floor", "Floor")} {groupContext.floor}
              </button>
              <button
                onClick={() => setActiveTab("branch")}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                  activeTab === "branch" ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("branch", "Branch")} {groupContext.branchId}
              </button>
            </>
          )}
        </div>

        {activeTab !== "personal" && (
          <div className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-400">
            {t("publicGroupHistory", "Public group message history")}
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={() => setShowReportModal(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition-all hover:bg-sky-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            {t("reportMalfunction", "Report Malfunction")}
            <span className="ml-1 rounded-md bg-sky-200 px-1.5 py-0.5 text-[10px] uppercase">+5000 Coins</span>
          </button>
        </div>
      </section>

      {showReportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{t("maintenanceReport", "Maintenance Report")}</h2>
                <p className="text-xs text-slate-500">{t("reportSubtext", "Submit a ticket to get it fixed & earn 5000 coins.")}</p>
              </div>
              <button onClick={() => setShowReportModal(false)} className="rounded-full p-1 hover:bg-slate-200">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 text-slate-400">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("location", "Location")}</label>
                <select
                  value={reportLocation}
                  onChange={(e) => setReportLocation(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">{t("selectLocation", "Select location...")}</option>
                  <option value={`Room ${groupContext?.roomLabel || "N/A"}`}>{t("myRoom", "My Room")} ({groupContext?.roomLabel || "..."})</option>
                  <option value={`Kitchen Branch ${groupContext?.branchId || "N/A"}`}>{t("kitchen", "Kitchen")}</option>
                  <option value={`Laundry Branch ${groupContext?.branchId || "N/A"}`}>{t("laundryArea", "Laundry Area")}</option>
                  <option value={`Bathroom Floor ${groupContext?.floor || "N/A"}`}>{t("bathroom", "Bathroom")}</option>
                  <option value="OTHER">{t("otherLocation", "Other (Type below)...")}</option>
                </select>
              </div>

              {reportLocation === "OTHER" && (
                <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                  <input
                    type="text"
                    placeholder={t("specificLocationPlaceholder", "e.g. Balcony 3rd floor, Main entrance...")}
                    value={customLocation}
                    onChange={(e) => setCustomLocation(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("machineDevice", "Machine / Device (Optional)")}</label>
                <input
                  type="text"
                  placeholder={t("machinePlaceholder", "e.g. Washer D7, AC LG, Microwave...")}
                  value={reportMachine}
                  onChange={(e) => setReportMachine(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("issueDescription", "Issue Description")}</label>
                <textarea
                  placeholder={t("issuePlaceholder", "What's wrong? (e.g. Not turning on, leaking, loud noise)")}
                  value={reportIssue}
                  onChange={(e) => setReportIssue(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={() => void handleReportSubmit()}
                  disabled={isReporting || (!reportLocation && !customLocation) || !reportIssue}
                  className="w-full rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white shadow-lg transition-all hover:bg-slate-800 disabled:opacity-50 active:scale-[0.98]"
                >
                  {isReporting ? t("submitting", "Submitting...") : t("submitReport", "Submit Maintenance Ticket")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? <p className="text-sm text-slate-600">Loading your conversation...</p> : null}

        {!loading ? (
          <div className="space-y-3">
            {messages.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">
                No messages yet. Start the conversation and your owner or managers will see it in their shared inbox.
              </div>
            ) : (
              messages.map((message) => {
                const isResident = message.senderRole === "RESIDENT";
                const isCozoroReply = message.senderRole === "OWNER" || message.senderRole === "MANAGER";
                return (
                  <div
                    key={message.id}
                    className={`rounded-2xl border p-4 ${
                      isResident ? "border-sky-200 bg-sky-50" : "border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {isCozoroReply ? (
                          <span
                            aria-hidden="true"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 text-lg shadow-sm"
                            title="Cozoro Bee"
                          >
                            🐝
                          </span>
                        ) : null}
                        <span>{senderLabel(message, sessionEmail.trim().toLowerCase())}</span>
                      </div>
                      <div className="text-xs text-slate-500">{formatDateTime(message.createdAt)}</div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{message.body}</p>
                    {message.pagePath ? (
                      <div className="mt-2 text-xs text-slate-500">Sent from: {message.pagePath}</div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6">
          <label className="block text-sm font-medium text-slate-700">
            {activeTab === "personal" ? t("message", "Message") : `${t(activeTab + "Group", activeTab.charAt(0).toUpperCase() + activeTab.slice(1))} Group`}
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              placeholder={activeTab === "personal" ? t("messagesChatDesc", "Ask a question...") : t("saySomethingToNeighbors", "Say something...")}
            />
          </label>

          {activeTab !== "personal" && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                id="anonymous"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
              />
              <label htmlFor="anonymous" className="text-sm font-medium text-slate-600 cursor-pointer">
                {isStaff ? t("sendAsCozoro", "Send as Cozoro") : t("sendAnonymously", "Send anonymously")}
              </label>
            </div>
          )}



          {status ? <p className="mt-3 text-sm text-slate-700">{status}</p> : null}

          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={submitting || !sessionEmail.trim()}
              className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send message"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
