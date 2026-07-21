import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { REGISTRY_OBJECT_TYPE, buildObjectSpec } from "@/lib/import/registrySchema";
import { USERS_SPEC } from "@/lib/import/usersSchema";
import type { ImportObjectId, ObjectSpec } from "@/lib/import/types";

const OBJECT_ORDER: ImportObjectId[] = [
  "accounts", "contacts", "assets", "suppliers", "quotes",
  "cases", "work_orders", "invoices", "purchase_orders", "inventory",
  "users",
];

export default async function DataWorkbenchPage() {
  const { supabase, tenantId } = await requireTenantUser();

  const salesConfig = await getSalesConfig(supabase, tenantId);

  const specs: ObjectSpec[] = await Promise.all(
    OBJECT_ORDER.map(async (id): Promise<ObjectSpec> => {
      const registryType = REGISTRY_OBJECT_TYPE[id];
      if (!registryType) return USERS_SPEC;
      const fieldConfig = await getEffectiveFieldConfig(supabase, tenantId, registryType);
      return buildObjectSpec(id, fieldConfig, salesConfig);
    })
  );

  return (
    <>
      <TabTitle title="Data Workbench" />
      <PageHeader
        title="Data Workbench"
        subtitle="Bring your data in from Excel or CSV — download a template or upload your own file, match the columns, then review before anything is saved. Templates always match your current field setup."
      />
      <DataWorkbenchClient specs={specs} />
    </>
  );
}
