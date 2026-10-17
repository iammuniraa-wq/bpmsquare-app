import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import RfqSettingsClient from "./RfqSettingsClient";

export default async function RfqSettingsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  const { data } = await createAdminSupabase().from("tenants").select("features").eq("id", tenantId!).single();
  if (!data?.features?.rfq) redirect(ROUTES.settings);
  return (
    <>
      <SettingsPageHeader title="RFQ" subtitle="How requests for quotation reach your suppliers, and how their replies come back into BPMSquare." />
      <RfqSettingsClient />
    </>
  );
}
