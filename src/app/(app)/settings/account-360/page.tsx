import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES, type TenantFeatures } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import Account360Client from "./Account360Client";

/**
 * Account 360 configuration. Nova-gated at the page level as well as in the
 * settings hub -- a tenant without the flag can't reach this by typing the
 * URL either.
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
  if ((data?.features as TenantFeatures | undefined)?.next_experience !== true) redirect(ROUTES.settings);

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
