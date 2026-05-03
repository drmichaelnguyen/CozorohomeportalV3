"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
import { formatCozoroDate } from "../lib/date-format";
import { usePortalLanguage } from "./portal-language";
import { usePortalSession } from "./portal-session";

type MaintenanceTicket = {
  id: string;
  reportedAt: string;
  reporterEmail: string;
  branch: string;
  location: string;
  category: string;
  description: string;
  urgency: string;
  status: "reported" | "assigned" | "solved" | "closed";
  mechanicEmail: string;
  solvedAt: string;
  solvedMinutes: number;
  residentSatisfaction: string;
  residentFeedback: string;
};

export function MechanicClient() {
  const { t } = usePortalLanguage();
  const { sessionEmail } = usePortalSession();
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"pending" | "my_tickets" | "history">("pending");
  const [solvingTicketId, setSolvingTicketId] = useState("");
  const [solvedMinutes, setSolvedMinutes] = useState("");

  const loadTickets = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/staff/maintenance/tickets`);
      if (!response.ok) throw new Error("Failed to load tickets");
      const data = await response.json();
      setTickets(data.tickets || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading tickets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTickets();
  }, []);

  const handleUpdate = async (id: string, updates: Partial<MaintenanceTicket>) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/staff/maintenance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      });
      if (!response.ok) throw new Error("Failed to update ticket");
      await loadTickets();
      setSolvingTicketId("");
      setSolvedMinutes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error updating ticket");
      setLoading(false);
    }
  };

  const filteredTickets = tickets.filter((t) => {
    if (activeTab === "pending") return t.status === "reported";
    if (activeTab === "my_tickets") return t.status === "assigned" && t.mechanicEmail === sessionEmail;
    if (activeTab === "history") return t.status === "solved" || t.status === "closed";
    return false;
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t("mechanicDashboard", "Mechanic Dashboard")}</h1>
        <p className="text-slate-600">{t("manageMaintenanceTickets", "Manage and solve maintenance tickets across branches.")}</p>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {(["pending", "my_tickets", "history"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab === "pending" && t("pendingTickets", "Pending")}
            {tab === "my_tickets" && t("myTickets", "My Tasks")}
            {tab === "history" && t("ticketHistory", "History")}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-600 border border-rose-100">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredTickets.map((ticket) => (
          <div key={ticket.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  ticket.urgency === "high" ? "bg-rose-100 text-rose-700" :
                  ticket.urgency === "medium" ? "bg-amber-100 text-amber-700" :
                  "bg-emerald-100 text-emerald-700"
                }`}>
                  {ticket.urgency}
                </span>
                <h3 className="mt-1 font-semibold text-slate-900">{ticket.category}</h3>
              </div>
              <span className="text-xs text-slate-500">{formatCozoroDate(ticket.reportedAt)}</span>
            </div>

            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Branch:</span>
                <span className="font-medium text-slate-900">{ticket.branch}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Location:</span>
                <span className="font-medium text-slate-900">{ticket.location}</span>
              </div>
            </div>

            <p className="text-sm text-slate-600 line-clamp-3 italic">"{ticket.description}"</p>

            <div className="pt-2">
              {ticket.status === "reported" && (
                <button
                  onClick={() => handleUpdate(ticket.id, { status: "assigned", mechanicEmail: sessionEmail })}
                  disabled={loading}
                  className="w-full rounded-2xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 transition-colors"
                >
                  {t("claimTicket", "Claim Task")}
                </button>
              )}
              {ticket.status === "assigned" && (
                <div className="space-y-3">
                  {solvingTicketId === ticket.id ? (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">Minutes Spent</label>
                      <input
                        type="number"
                        value={solvedMinutes}
                        onChange={(e) => setSolvedMinutes(e.target.value)}
                        placeholder="E.g. 30"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUpdate(ticket.id, { status: "solved", solvedMinutes: parseInt(solvedMinutes) || 0 })}
                          disabled={loading || !solvedMinutes}
                          className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                        >
                          Submit
                        </button>
                        <button
                          onClick={() => setSolvingTicketId("")}
                          className="px-3 rounded-xl border border-slate-200 text-sm text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSolvingTicketId(ticket.id)}
                      disabled={loading}
                      className="w-full rounded-2xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                    >
                      {t("markSolved", "Mark Solved")}
                    </button>
                  )}
                </div>
              )}
              {ticket.status === "solved" && (
                <div className="text-center text-sm font-medium text-emerald-600 bg-emerald-50 rounded-2xl py-2">
                  Waiting for resident feedback
                </div>
              )}
              {ticket.status === "closed" && (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Satisfaction:</span>
                    <span className="font-semibold text-slate-900 uppercase">{ticket.residentSatisfaction}</span>
                  </div>
                  {ticket.residentFeedback && (
                    <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg italic">
                      "{ticket.residentFeedback}"
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {!loading && filteredTickets.length === 0 && (
        <div className="text-center py-12 text-slate-500 italic">
          {t("noTicketsFound", "No tickets found in this category.")}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-600" />
        </div>
      )}
    </div>
  );
}
