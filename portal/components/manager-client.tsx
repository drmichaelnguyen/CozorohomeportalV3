"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { API_BASE_URL } from "../lib/api-base-url";
const MANAGER_EMAILS = new Set(["cozorohome@gmail.com", "dr.trongto@gmail.com"]);
const DEFAULT_MANAGER_EMAIL = "cozorohome@gmail.com";
const DISPUTE_COLUMN = "Khieu nai tu khach hang";
const FINE_TIMESTAMP_COLUMN = "DẤU THỜI GIAN";

type ManagerClientRecord = {
  maHd: string;
  email: string;
  name: string;
  branch: string;
  bed: string;
  gender: string;
  activeStay: string;
  currentCoins: string;
  totalCoins: string;
  recordedMember: string;
  row: Record<string, string>;
};

type FineEntry = {
  row: Record<string, string>;
  parsedTimestamp: string | null;
  parsedDueDate: string | null;
  coinPayment: {
    coinCost: number;
    currentCoins: number;
    canPay: boolean;
    recordedMember: string;
    multiplier: number;
    isPaid: boolean;
  };
};

type PrivilegedAcRoom = {
  id: string;
  label: string;
  branchId: "D2" | "D7";
  roomCodes: string[];
  beds: string[];
  iftttConfigured: boolean;
  lastRequestedAction: "ON" | "OFF" | null;
  lastRequestedAt: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function ManagerClient() {
  const [email, setEmail] = useState(DEFAULT_MANAGER_EMAIL);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [clients, setClients] = useState<ManagerClientRecord[]>([]);
  const [fines, setFines] = useState<FineEntry[]>([]);
  const [selectedMaHd, setSelectedMaHd] = useState("");
  const [search, setSearch] = useState("");
  const [coinDelta, setCoinDelta] = useState("1000");
  const [coinReason, setCoinReason] = useState("Manager coin adjustment");
  const [fineAmount, setFineAmount] = useState("30000");
  const [fineContent, setFineContent] = useState("");
  const [fineDescription, setFineDescription] = useState("");
  const [fineLocation, setFineLocation] = useState("");
  const [fineDueDate, setFineDueDate] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [clientForm, setClientForm] = useState<Record<string, string>>({});
  const [acRooms, setAcRooms] = useState<PrivilegedAcRoom[]>([]);

  const isManager = MANAGER_EMAILS.has(email.trim().toLowerCase());

  const filteredClients = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return clients;
    }

    return clients.filter((client) =>
      [client.name, client.email, client.branch, client.bed, client.maHd]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [clients, search]);

  const selectedClient = useMemo(
    () => filteredClients.find((client) => client.maHd === selectedMaHd) ?? clients.find((client) => client.maHd === selectedMaHd) ?? null,
    [clients, filteredClients, selectedMaHd]
  );

  const disputedFines = useMemo(
    () =>
      fines.filter((entry) => {
        const dispute = (entry.row[DISPUTE_COLUMN] ?? "").trim();
        return dispute.length > 0;
      }),
    [fines]
  );

  function fillClientForm(nextClient: ManagerClientRecord | null) {
    if (!nextClient) {
      setClientForm({});
      return;
    }

    setClientForm(
      Object.fromEntries(
        Object.entries(nextClient.row).filter(([field]) => field !== "Địa chỉ email - Hidden")
      )
    );
  }

  async function loadManagerData(syncFirst = false) {
    setLoading(true);
    setMessage("");

    try {
      if (syncFirst) {
        await Promise.all([
          fetch(`${API_BASE_URL}/clients/sync`, { method: "POST" }),
          fetch(`${API_BASE_URL}/coins/sync`, { method: "POST" }),
          fetch(`${API_BASE_URL}/fines/sync`, { method: "POST" })
        ]);
      }

      const [clientsResponse, finesResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/manager/clients`),
        fetch(`${API_BASE_URL}/manager/fines`)
      ]);

      const clientsData = (await clientsResponse.json()) as { clients?: ManagerClientRecord[]; error?: string };
      const finesData = (await finesResponse.json()) as { entries?: FineEntry[]; error?: string };

      if (!clientsResponse.ok) {
        setMessage(clientsData.error ?? "Unable to load manager clients.");
        return;
      }

      if (!finesResponse.ok) {
        setMessage(finesData.error ?? "Unable to load manager fines.");
        return;
      }

      const nextClients = clientsData.clients ?? [];
      setClients(nextClients);
      setFines(finesData.entries ?? []);
      const nextSelected = nextClients.find((client) => client.maHd === selectedMaHd) ?? nextClients[0] ?? null;
      setSelectedMaHd(nextSelected?.maHd ?? "");
      fillClientForm(nextSelected);
      setMessage(syncFirst ? "Manager data refreshed from the sheet." : "Manager view loaded.");
    } catch {
      setMessage("Unable to load manager data. Make sure the API is running.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAcRooms() {
    try {
      const response = await fetch(`${API_BASE_URL}/controller/ac/rooms`);
      const data = (await response.json()) as { rooms?: PrivilegedAcRoom[]; error?: string };

      if (!response.ok) {
        setMessage(data.error ?? "Unable to load AC rooms.");
        return;
      }

      setAcRooms(data.rooms ?? []);
    } catch {
      setMessage("Unable to load AC rooms.");
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isManager) {
      setMessage("This demo manager view is only enabled for the configured manager email.");
      return;
    }

    void Promise.all([loadManagerData(false), loadAcRooms()]);
  }

  async function sendRoomAcCommand(roomId: string, action: "ON" | "OFF") {
    if (!isManager) {
      setMessage("This demo manager view is only enabled for the configured manager email.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/controller/ac/rooms/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          roomId,
          action
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Unable to send AC command.");
        return;
      }

      await loadAcRooms();
      setMessage(`AC ${action === "ON" ? "turn on" : "turn off"} request sent.`);
    } catch {
      setMessage("Unable to send AC command.");
    } finally {
      setLoading(false);
    }
  }

  async function submitCoinAdjustment() {
    if (!selectedClient) {
      setMessage("Choose a client first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/manager/coins/adjust`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          maHd: selectedClient.maHd,
          delta: Number(coinDelta),
          reason: coinReason,
          operator: email.trim().toLowerCase()
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Unable to adjust coins.");
        return;
      }

      await loadManagerData(true);
      await loadAcRooms();
      setMessage("Coin adjustment saved.");
    } catch {
      setMessage("Unable to adjust coins.");
    } finally {
      setLoading(false);
    }
  }

  async function saveClientInfo() {
    if (!selectedClient) {
      setMessage("Choose a client first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/clients/${encodeURIComponent(selectedClient.maHd)}/sheet-update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(clientForm)
        }
      );

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Unable to save client information.");
        return;
      }

      await loadManagerData(true);
      await loadAcRooms();
      setMessage("Client information updated.");
    } catch {
      setMessage("Unable to save client information.");
    } finally {
      setLoading(false);
    }
  }

  async function submitFine() {
    if (!selectedClient) {
      setMessage("Choose a client first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/manager/fines`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          maHd: selectedClient.maHd,
          amount: Number(fineAmount),
          content: fineContent,
          description: fineDescription,
          location: fineLocation,
          dueDate: fineDueDate || undefined,
          operator: email.trim().toLowerCase()
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Unable to add fine.");
        return;
      }

      setFineContent("");
      setFineDescription("");
      setFineLocation("");
      setFineAmount("30000");
      setFineDueDate("");
      await loadManagerData(true);
      await loadAcRooms();
      setMessage("Fine added.");
    } catch {
      setMessage("Unable to add fine.");
    } finally {
      setLoading(false);
    }
  }

  async function resolveDispute(entry: FineEntry, decision: "KEEP_FINE" | "CANCEL_FINE") {
    setLoading(true);
    setMessage("");
    const key = `${entry.row.EMAIL}-${entry.row[FINE_TIMESTAMP_COLUMN]}-${entry.row["NỘI DUNG VI PHẠM"]}`;

    try {
      const response = await fetch(`${API_BASE_URL}/manager/fines/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: entry.row.EMAIL ?? "",
          timestamp: entry.row[FINE_TIMESTAMP_COLUMN] ?? "",
          content: entry.row["NỘI DUNG VI PHẠM"] ?? "",
          decision,
          note: resolutionNotes[key] ?? "",
          operator: email.trim().toLowerCase()
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Unable to resolve dispute.");
        return;
      }

      await loadManagerData(true);
      await loadAcRooms();
      setMessage(decision === "CANCEL_FINE" ? "Fine cancelled." : "Dispute closed and fine kept.");
    } catch {
      setMessage("Unable to resolve dispute.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Manager View</h1>
        <p className="mt-2 text-sm text-slate-600">
          Owner and admin use the same privileged view here. They can edit the full client profile, adjust coins, add fines, and resolve fine disputes.
        </p>
        <div className="mt-4">
          <Link
            href="/admin-cleaning"
            className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
          >
            Open cleaning scheduler
          </Link>
        </div>

        <form onSubmit={handleLogin} className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Manager Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Demo only"
            />
          </label>

          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Loading..." : "Open manager view"}
            </button>
            <button
              type="button"
              onClick={() => void loadManagerData(true)}
              disabled={loading || !isManager}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              Refresh from sheet
            </button>
            <button
              type="button"
              onClick={() => void loadAcRooms()}
              disabled={loading || !isManager}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              Refresh AC rooms
            </button>
          </div>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-700">{message}</p> : null}
      </section>

      {isManager && clients.length > 0 ? (
        <section className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
          <div className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Clients</h2>
                <span className="text-sm text-slate-500">{clients.length} visible</span>
              </div>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, email, branch, bed, or contract"
                className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <div className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                {filteredClients.map((client) => {
                  const isSelected = client.maHd === selectedMaHd;
                  return (
                    <button
                      key={client.maHd}
                      type="button"
                      onClick={() => {
                        setSelectedMaHd(client.maHd);
                        fillClientForm(client);
                      }}
                      className={`w-full rounded-xl border px-4 py-3 text-left ${
                        isSelected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="font-medium">{client.name || client.maHd}</div>
                      <div className={`text-sm ${isSelected ? "text-emerald-50" : "text-slate-600"}`}>
                        {client.email} | {client.branch || "No branch"} | Bed {client.bed || "-"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Dispute Queue</h2>
              <p className="mt-2 text-sm text-slate-600">
                Managers can keep the fine or cancel it after reviewing the client dispute.
              </p>
              <div className="mt-4 space-y-4">
                {disputedFines.length === 0 ? (
                  <p className="text-sm text-slate-600">No disputed fines are waiting right now.</p>
                ) : (
                  disputedFines.map((entry) => {
                    const key = `${entry.row.EMAIL}-${entry.row[FINE_TIMESTAMP_COLUMN]}-${entry.row["NỘI DUNG VI PHẠM"]}`;
                    return (
                      <div key={key} className="rounded-xl border border-slate-200 p-4">
                        <div className="text-sm font-semibold text-slate-900">{entry.row["NỘI DUNG VI PHẠM"] || "Fine"}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {entry.row.EMAIL || "Unknown email"} | {entry.row.TÊN || "Unknown client"}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          Created: {formatDateTime(entry.parsedTimestamp)}
                        </div>
                        <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                          {entry.row[DISPUTE_COLUMN]}
                        </div>
                        <textarea
                          value={resolutionNotes[key] ?? ""}
                          onChange={(event) =>
                            setResolutionNotes((current) => ({
                              ...current,
                              [key]: event.target.value
                            }))
                          }
                          rows={3}
                          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2"
                          placeholder="Optional manager note"
                        />
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => void resolveDispute(entry, "KEEP_FINE")}
                            disabled={loading}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
                          >
                            Keep fine
                          </button>
                          <button
                            type="button"
                            onClick={() => void resolveDispute(entry, "CANCEL_FINE")}
                            disabled={loading}
                            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                          >
                            Cancel fine
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Selected Client</h2>
                <button
                  type="button"
                  onClick={() => void saveClientInfo()}
                  disabled={loading || !selectedClient}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Save client info
                </button>
              </div>
              {!selectedClient ? (
                <p className="mt-3 text-sm text-slate-600">Choose a client to manage their account.</p>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {Object.keys(clientForm).map((field) => (
                    <label key={field} className="block text-sm font-medium text-slate-700">
                      {field}
                      <input
                        type="text"
                        value={clientForm[field] ?? ""}
                        onChange={(event) =>
                          setClientForm((current) => ({
                            ...current,
                            [field]: event.target.value
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Adjust Coins</h2>
              <p className="mt-2 text-sm text-slate-600">
                Use a positive number to add coins and a negative number to subtract coins.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Coin delta
                  <input
                    type="number"
                    value={coinDelta}
                    onChange={(event) => setCoinDelta(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                  Reason
                  <input
                    type="text"
                    value={coinReason}
                    onChange={(event) => setCoinReason(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void submitCoinAdjustment()}
                disabled={loading || !selectedClient}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Save coin adjustment
              </button>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Add Fine</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Amount
                  <input
                    type="number"
                    min="1"
                    value={fineAmount}
                    onChange={(event) => setFineAmount(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Due date
                  <input
                    type="date"
                    value={fineDueDate}
                    onChange={(event) => setFineDueDate(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                  Fine content
                  <input
                    type="text"
                    value={fineContent}
                    onChange={(event) => setFineContent(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="What rule was violated?"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Location
                  <input
                    type="text"
                    value={fineLocation}
                    onChange={(event) => setFineLocation(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                  Description
                  <textarea
                    value={fineDescription}
                    onChange={(event) => setFineDescription(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void submitFine()}
                disabled={loading || !selectedClient || !fineContent.trim()}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Add fine
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {isManager ? (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">AC Device Control</h2>
          <p className="mt-2 text-sm text-slate-600">
            Admin and owner can control any mapped room AC from here.
          </p>
          {acRooms.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No AC rooms are mapped yet.</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {acRooms.map((room) => (
                <div key={room.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="font-semibold text-slate-900">{room.label}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Branch: {room.branchId}
                    {room.roomCodes.length ? ` | Room ${room.roomCodes.join(", ")}` : ""}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    Beds: {room.beds.length ? room.beds.join(", ") : "-"}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    Last request: {formatDateTime(room.lastRequestedAt)}
                    {room.lastRequestedAction ? ` | ${room.lastRequestedAction}` : ""}
                  </div>
                  {!room.iftttConfigured ? (
                    <p className="mt-2 text-sm text-amber-700">IFTTT is not fully configured for this room.</p>
                  ) : null}
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => void sendRoomAcCommand(room.id, "ON")}
                      disabled={loading || !room.iftttConfigured}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Turn on
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendRoomAcCommand(room.id, "OFF")}
                      disabled={loading || !room.iftttConfigured}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Turn off
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
