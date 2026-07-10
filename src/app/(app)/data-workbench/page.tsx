import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { requireTenantUser } from "@/lib/supabase-server";
import { createAdminSupabase } from "@/lib/supabase-server";

export default async function DataWorkbenchPage() {
  const { tenantId } = await requireTenantUser();
  const admin = createAdminSupabase();

  const { data: cfRows } = await admin
    .from("custom_fields")
    .select("object_type, field_key, field_label, field_type")
    .eq("tenant_id", tenantId)
    .order("position");

  const customFieldsByObject: Record<string, { key: string; label: string; type: "text"|"number"|"date"|"select"|"boolean" }[]> = {};
  for (const row of cfRows ?? []) {
    const mapped = row.field_type === "checkbox" ? "boolean"
      : row.field_type === "textarea" ? "text"
      : (row.field_type as "text"|"number"|"date"|"select"|"boolean");
    if (!customFieldsByObject[row.object_type]) customFieldsByObject[row.object_type] = [];
    customFieldsByObject[row.object_type].push({ key: row.field_key, label: row.field_label, type: mapped });
  }

  return (
    <>
      <TabTitle title="Data Workbench" />
      <PageHeader
        title="Data Workbench"
        subtitle="Import accounts, contacts, assets and users from CSV / Excel — download a template, fill it in, upload and review before committing"
      />
      <DataWorkbenchClient customFieldsByObject={customFieldsByObject} />
    </>
  );
}
