import { ManagerClient } from "../../components/manager-client";

export default async function ManagerPage({
  searchParams
}: {
  searchParams?: Promise<{ view?: string; chat?: string; settingsSection?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialChatId = resolvedSearchParams.chat?.trim() || undefined;
  const view = resolvedSearchParams.view ?? (initialChatId ? "support_chat" : undefined);
  const openDonations = view === "donations";
  const settingsSection = resolvedSearchParams.settingsSection?.trim();
  const initialSettingsSection =
    settingsSection === "ai_manager" ||
    settingsSection === "ai_usage" ||
    settingsSection === "tools" ||
    settingsSection === "resident_guides" ||
    settingsSection === "pricing"
      ? settingsSection
      : undefined;
  const initialView =
    openDonations ||
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
      ? openDonations
        ? "support_chat"
        : view
      : initialSettingsSection
        ? "settings"
        : "overview";

  return (
    <ManagerClient
      initialView={initialView}
      initialChatId={initialChatId}
      initialSupportSubTab={openDonations ? "donations" : undefined}
      initialSettingsSection={initialSettingsSection}
    />
  );
}
