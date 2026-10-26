import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import IconChip from "@/components/ui/IconChip";
import { Clipboard } from "@/components/Icons";
import ContractProjectsSettingsClient from "./ContractProjectsSettingsClient";

export default async function ContractProjectsSettingsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  const { data } = await createAdminSupabase().from("tenants").select("features").eq("id", tenantId!).single();
  if (!data?.features?.contract_projects || !data?.features?.gcc_tender) redirect(ROUTES.settings);
  return (
    <>
      <SettingsPageHeader title="Contract projects" subtitle="The lists a project budget uses, and the default margin." icon={<IconChip tone="info"><Clipboard size={18} /></IconChip>} />
      <ContractProjectsSettingsClient />
    </>
  );
}
