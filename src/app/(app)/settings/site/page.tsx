import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import IconChip from "@/components/ui/IconChip";
import { Clipboard } from "@/components/Icons";
import SiteSettingsClient from "./SiteSettingsClient";

/** Settings > Site entry: the limits, who is told about a delivery problem and the expense categories. One page, one place for each. */
export default async function SiteSettingsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  const { data } = await createAdminSupabase().from("tenants").select("features").eq("id", tenantId!).single();
  const f = (data?.features ?? {}) as Record<string, boolean>;
  if (f.contract_projects !== true || (f.site_expenses !== true && f.site_receipts !== true)) redirect(ROUTES.settings);
  return (
    <>
      <SettingsPageHeader title="Site entry" subtitle="The limits, who is told about a delivery problem, and the expense categories." icon={<IconChip tone="info"><Clipboard size={18} /></IconChip>} />
      <SiteSettingsClient />
    </>
  );
}
