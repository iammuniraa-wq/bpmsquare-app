import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { requireTenantUser } from "@/lib/supabase-server";
import type { CustomFieldDef } from "@/lib/constants";

type CustomFieldRow = {
  object_type: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: string[] | null;
};

export default async function DataWorkbenchPage() {
  const { supabase, tenantId } = await requireTenantUser();

  const { data } = await supabase
    .from("custom_fields")
    .select("object_type, field_key, field_label, field_type, options")
    .eq("tenant_id", tenantId)
    .order("position")
    .order("created_at");

  const customFieldsByObject: Record<string, CustomFieldDef[]> = {};
  for (const row of (data ?? []) as CustomFieldRow[]) {
    const type: CustomFieldDef["type"] =
      row.field_type === "checkbox" ? "boolean"
      : row.field_type === "textarea" ? "text"
      : (row.field_type as CustomFieldDef["type"]);

    (customFieldsByObject[row.object_type] ??= []).push({
      key: row.field_key,
      label: row.field_label,
      type,
      ...(row.options ? { options: row.options } : {}),
    });
  }

  return (
    <>
      <TabTitle title="Data Workbench" />
      <PageHeader
        title="Data Workbench"
        subtitle="Bring accounts, contacts, assets, quotes and users in from Excel or CSV — download a template or upload your own file, match the columns, then review before anything is saved"
      />
      <DataWorkbenchClient customFieldsByObject={customFieldsByObject} />
    </>
  );
}
