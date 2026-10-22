import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES, type TenantFeatures } from "@/lib/constants";
import { marketingScoringOn } from "@/lib/marketing/config";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import LeadsClient from "./LeadsClient";

/**
 * Settings -> Marketing -> Leads (tabs Scoring and Hand-over). Gated here as well as in the menu: a workspace without
 * the marketing_scoring program, or a person who is not an admin, cannot reach it by URL.
 */
export default async function MarketingLeadsSettingsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const { data } = await createAdminSupabase().from("tenants").select("features").eq("id", tenantId!).single();
  if (!marketingScoringOn(data?.features as Partial<TenantFeatures> | undefined)) redirect(ROUTES.settings);

  return (
    <>
      <SettingsPageHeader title="Leads" />
      <LeadsClient />
    </>
  );
}
