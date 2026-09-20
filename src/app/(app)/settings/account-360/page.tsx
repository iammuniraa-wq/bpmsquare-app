import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES, type TenantFeatures } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import Account360Client from "./Account360Client";

/**
 * Account 360 configuration. Gated at the page level as well as in the
 * settings hub -- a tenant on neither theme that mounts the drawer can't
 * reach this by typing the URL either.
 */
export default async function Account360SettingsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const { data } = await createAdminSupabase()
    .from("tenants").select("features").eq("id", tenantId!).single();
  // Both themes that mount the drawer can configure it -- mirrors
  // tenantHasNovaSurfaces() (lib/tenant.ts) and the tile in the settings hub.
  const feats = data?.features as TenantFeatures | undefined;
  if (feats?.next_experience !== true && feats?.spectacular_theme !== true) redirect(ROUTES.settings);

  return (
    <>
      <PageHeader
        title="Account 360"
        subtitle="Which cards the account drawer shows, and the external sources plugged into it"
      />
      <Account360Client />
    </>
  );
}
