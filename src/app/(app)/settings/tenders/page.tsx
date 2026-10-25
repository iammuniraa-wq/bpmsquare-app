import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import TendersSettingsClient from "./TendersSettingsClient";

export default async function TendersSettingsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  const { data } = await createAdminSupabase().from("tenants").select("features").eq("id", tenantId!).single();
  if (!data?.features?.gcc_tender) redirect(ROUTES.settings);
  return (
    <>
      <SettingsPageHeader title="Tenders" subtitle="Who approves a bid or no-bid proposal." />
      <TendersSettingsClient />
    </>
  );
}
