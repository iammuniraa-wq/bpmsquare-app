import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { requireTenantUser } from "@/lib/supabase-server";
import { headers } from "next/headers";

export default async function DataWorkbenchPage() {
  await requireTenantUser();

  const hdrs = await headers();
  const cookie = hdrs.get("cookie") ?? "";
  const host = hdrs.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";

  const res = await fetch(`${proto}://${host}/api/settings/custom-fields`, {
    headers: { cookie },
    cache: "no-store",
  });
  const cfRows: { object_type: string; field_key: string; field_label: string; field_type: string }[] =
    res.ok ? await res.json() : [];

  const customFieldsByObject: Record<string, { key: string; label: string; type: "text"|"number"|"date"|"select"|"boolean" }[]> = {};
  for (const row of cfRows) {
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
