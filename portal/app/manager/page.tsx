import { ManagerClient } from "../../components/manager-client";

export default async function ManagerPage({
  searchParams
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const view = resolvedSearchParams.view;
  const initialView =
    view === "client_list" ||
    view === "owners_employees" ||
    view === "support_chat" ||
    view === "feedbacks" ||
    view === "admin_cleaning" ||
    view === "scheduling" ||
    view === "controller" ||
    view === "overview"
      ? view
      : "overview";

  return <ManagerClient initialView={initialView} />;
}
