import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES, type TenantFeatures } from "@/lib/constants";
import { marketingScoringOn } from "@/lib/marketing/config";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { CONSENT_SETTINGS_TIPS } from "@/lib/marketing/consentSettingsTips";
import ConsentClient from "./ConsentClient";

/**
 * Settings -> Marketing -> Consent. Gated here as well as in the
 * menu: a workspace with none of Marketing, the marketing_scoring program or Newsletter Studio cannot reach it by URL.
 * Plain campaigns are gated by consent too, so a workspace with Marketing alone must be able to open it.
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
  const f = data?.features as Partial<TenantFeatures> | undefined;
  // Topics and counting opens serve newsletters too, so Newsletter Studio alone is enough.
  if (!marketingScoringOn(f) && f?.newsletter_studio !== true && f?.marketing !== true) redirect(ROUTES.settings);

  return (
    <>
      <SettingsPageHeader
        title="Consent"
        info={CONSENT_SETTINGS_TIPS.page}
      />
      <ConsentClient />
    </>
  );
}
