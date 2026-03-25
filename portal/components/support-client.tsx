"use client";

import { useEffect, useRef, useState } from "react";
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

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
    <div className="flex h-[calc(100vh-140px)] flex-col bg-white md:h-[700px] md:rounded-3xl md:border md:border-slate-200 md:shadow-lg overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-100 bg-white/80 p-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t("residentMessages", "Messages")}</h1>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{activeTab === "personal" ? t("cozoroSupport", "Cozoro Support") : `${activeTab} ${t("community", "Community")}`}</p>
          </div>
          <button
            onClick={() => setShowReportModal(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-[11px] font-bold text-sky-700 transition-all hover:bg-sky-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            {t("report", "Report")}
          </button>
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setActiveTab("personal")}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold transition-all ${
              activeTab === "personal" ? "bg-slate-900 text-white shadow-sm" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
            }`}
          >
            {t("personal", "Personal")}
          </button>
          
          {groupContext && (
            <>
              <button
                onClick={() => setActiveTab("room")}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold transition-all ${
                  activeTab === "room" ? "bg-sky-600 text-white shadow-sm" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                }`}
              >
                {t("room", "Room")} {groupContext.roomLabel}
              </button>
              <button
                onClick={() => setActiveTab("floor")}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold transition-all ${
                  activeTab === "floor" ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                }`}
              >
                {t("floor", "Floor")} {groupContext.floor}
              </button>
              <button
                onClick={() => setActiveTab("branch")}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold transition-all ${
                  activeTab === "branch" ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                }`}
              >
                {t("branch", "Branch")} {groupContext.branchId}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Messages Area */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-slate-50/30 p-4 space-y-4 scroll-smooth"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center p-12 text-center text-slate-400">
            <div className="space-y-3">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
              <p className="text-xs font-medium">{t("loadingMessages", "Loading messages...")}</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-12 text-center text-slate-400">
             <p className="text-xs font-medium max-w-[200px]">{t("startChatDesc", "No messages yet. Start the conversation here.")}</p>
          </div>
        ) : (
          messages.map((message, idx) => {
            const isResident = message.senderRole === "RESIDENT";
            const isMe = message.senderEmail === sessionEmail.trim().toLowerCase();
            const isCozoro = !isResident;
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const sameSender = prevMsg?.senderEmail === message.senderEmail;

            return (
              <div
                key={message.id}
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                {!sameSender && (
                  <span className="mb-1 px-2 text-[10px] font-bold text-slate-400">
                    {isMe ? t("you", "You") : isCozoro ? "Cozoro" : message.senderName || t("neighbor", "Neighbor")}
                  </span>
                )}
                
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    isMe 
                      ? "bg-slate-900 text-white rounded-tr-none" 
                      : isCozoro 
                        ? "bg-amber-100 text-amber-900 border border-amber-200 rounded-tl-none" 
                        : "bg-white text-slate-700 border border-slate-200 rounded-tl-none"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>
                  <div className={`mt-1 text-[9px] ${isMe ? "text-slate-400" : "text-slate-500"}`}>
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </main>

      {/* Footer / Input */}
      <footer className="shrink-0 border-t border-slate-100 bg-white p-4">
        {status && !submitting && (
          <p className="mb-2 text-center text-[10px] font-bold text-slate-400 animate-pulse">{status}</p>
        )}
        
        <form 
          onSubmit={handleSubmit}
          className="relative flex items-end gap-2"
        >
          <div className="relative flex-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={activeTab === "personal" ? t("askAnything", "Ask anything...") : t("saySomething", "Say something...")}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit(e as any);
                }
              }}
              className="w-full max-h-32 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 pr-10 text-sm focus:border-slate-400 focus:bg-white focus:outline-none transition-all"
            />
            {activeTab !== "personal" && (
              <div className="absolute right-3 top-2.5">
                <button
                  type="button"
                  onClick={() => setIsAnonymous(!isAnonymous)}
                  className={`rounded-full p-1 transition-colors ${isAnonymous ? "text-slate-900" : "text-slate-300"}`}
                  title={isAnonymous ? t("anonymousOn", "Anonymous On") : t("anonymousOff", "Anonymous Off")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting || !draft.trim() || !sessionEmail.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
          >
            {submitting ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 rotate-90">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </form>
      </footer>

      {/* Modals moved outside flex box for better layering */}
      {showReportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-300">
            {/* Modal content stays mostly the same but styled better */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{t("maintenanceReport", "Maintenance Report")}</h2>
                <p className="text-xs text-slate-500">{t("reportSubtext", "Submit a ticket to earn 5000 coins.")}</p>
              </div>
              <button onClick={() => setShowReportModal(false)} className="rounded-full p-1 hover:bg-slate-200">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 text-slate-400">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("location", "Location")}</label>
                <select
                  value={reportLocation}
                  onChange={(e) => setReportLocation(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
                >
                  <option value="">{t("selectLocation", "Select location...")}</option>
                  <option value={`Room ${groupContext?.roomLabel || "N/A"}`}>{t("myRoom", "My Room")} ({groupContext?.roomLabel || "..."})</option>
                  <option value={`Kitchen Branch ${groupContext?.branchId || "N/A"}`}>{t("kitchen", "Kitchen")}</option>
                  <option value={`Laundry Branch ${groupContext?.branchId || "N/A"}`}>{t("laundryArea", "Laundry Area")}</option>
                  <option value={`Bathroom Floor ${groupContext?.floor || "N/A"}`}>{t("bathroom", "Bathroom")}</option>
                  <option value="OTHER">{t("otherLocation", "Other...")}</option>
                </select>
              </div>

              {reportLocation === "OTHER" && (
                <input
                  type="text"
                  placeholder={t("specificLocationPlaceholder", "e.g. Balcony 3rd floor...")}
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
                />
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("machineDevice", "Device (Optional)")}</label>
                <input
                  type="text"
                  placeholder={t("machinePlaceholder", "e.g. Washer D7, AC...")}
                  value={reportMachine}
                  onChange={(e) => setReportMachine(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("issueDescription", "Issue Description")}</label>
                <textarea
                  placeholder={t("issuePlaceholder", "What's wrong?")}
                  value={reportIssue}
                  onChange={(e) => setReportIssue(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={() => void handleReportSubmit()}
                  disabled={isReporting || (!reportLocation && !customLocation) || !reportIssue}
                  className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white shadow-lg transition-all hover:bg-slate-800 disabled:opacity-50"
                >
                  {isReporting ? t("submitting", "Submitting...") : t("submitReport", "Submit Maintenance Ticket")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
