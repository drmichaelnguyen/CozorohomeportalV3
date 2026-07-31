import { ManagerClient } from "../../components/manager-client";

export default async function ManagerPage({
  searchParams
}: {
  searchParams?: Promise<{ view?: string; chat?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialChatId = resolvedSearchParams.chat?.trim() || undefined;
  const view = resolvedSearchParams.view ?? (initialChatId ? "support_chat" : undefined);
  const initialView =
    view === "client_list" ||
    view === "owners_employees" ||
    view === "support_chat" ||
    view === "feedbacks" ||
    view === "admin_cleaning" ||
    view === "scheduling" ||
    view === "controller" ||
    view === "overview" ||
    view === "short_term" ||
    view === "settings"
      ? view
      : "overview";

  return <ManagerClient initialView={initialView} initialChatId={initialChatId} />;
}
