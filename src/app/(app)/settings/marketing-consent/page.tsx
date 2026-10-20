import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES, type TenantFeatures } from "@/lib/constants";
import { marketingScoringOn } from "@/lib/marketing/config";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { CONSENT_SETTINGS_TIPS } from "@/lib/marketing/consentSettingsTips";
import ConsentClient from "./ConsentClient";

/**
 * Settings -> Marketing -> Consent topics. Gated here as well as in the
 * menu: a workspace without the marketing_scoring program cannot reach it by URL.
 */
export default async function MarketingConsentSettingsPage() {
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
      <SettingsPageHeader
        title="Consent topics"
        info={CONSENT_SETTINGS_TIPS.page}
      />
      <ConsentClient />
    </>
  );
}
