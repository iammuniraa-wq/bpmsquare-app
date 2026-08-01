import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import ChangeHistoryClient from "./ChangeHistoryClient";

export default async function ChangeHistoryPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.dashboard);
  }
  if (role !== "admin") redirect(ROUTES.dashboard);
  await requireFeature("change_history");

  return (
    <>
      <TabTitle title="Change History" />
      <PageHeader
        title="Change History"
        subtitle="Every create, update, and delete recorded at the moment it happened — filter by object, or a specific record's ID, then download as CSV."
      />
      <ChangeHistoryClient />
    </>
  );
}
