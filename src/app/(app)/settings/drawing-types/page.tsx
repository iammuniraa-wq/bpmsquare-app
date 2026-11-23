import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import IconChip from "@/components/ui/IconChip";
import { Clipboard } from "@/components/Icons";
import DrawingTypesClient from "./DrawingTypesClient";

export default async function DrawingTypesSettingsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  const { data } = await createAdminSupabase().from("tenants").select("features").eq("id", tenantId!).single();
  if (!data?.features?.drawing_register) redirect(ROUTES.settings);
  return (
    <>
      <SettingsPageHeader title="Drawing types" subtitle="How each kind of drawing is numbered, revised and released." icon={<IconChip tone="info"><Clipboard size={18} /></IconChip>} />
      <DrawingTypesClient />
    </>
  );
}
