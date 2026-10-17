import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import AssetPrintFieldsClient from "./AssetPrintFieldsClient";

export default async function AssetPrintFieldsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("config")
    .eq("id", tenantId!)
    .single();

  const cfg = data?.config as { asset_print_fields?: string[] } | null;
  const assetPrintFields: string[] = cfg?.asset_print_fields ?? [];

  const { data: customFields } = await createAdminSupabase()
    .from("custom_fields")
    .select("field_key, field_label")
    .eq("tenant_id", tenantId!)
    .eq("object_type", "asset")
    .order("position");
  const assetCustomFields = (customFields ?? []).map((f) => ({ value: f.field_key, label: f.field_label }));

  return (
    <>
      <SettingsPageHeader
        title="Asset print fields"
        subtitle="Which equipment fields appear in the Equipment Details section of a printed quote"
      />
      <AssetPrintFieldsClient initialAssetFields={assetPrintFields} assetCustomFields={assetCustomFields} />
    </>
  );
}
