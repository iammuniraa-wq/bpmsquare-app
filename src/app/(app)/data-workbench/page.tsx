import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { REGISTRY_OBJECT_TYPE, buildObjectSpec } from "@/lib/import/registrySchema";
import { USERS_SPEC } from "@/lib/import/usersSchema";
import { QUOTE_LINES_SPEC } from "@/lib/import/quoteLinesSchema";
import { requireWorkcenterView } from "@/lib/permissions";
import type { ImportObjectId, ObjectSpec } from "@/lib/import/types";

const OBJECT_ORDER: ImportObjectId[] = [
  "accounts", "contacts", "assets", "suppliers", "quotes", "quote_lines",
  "cases", "work_orders", "invoices", "purchase_orders", "inventory",
  "users",
];

// Objects with no FIELD_REGISTRY entry (REGISTRY_OBJECT_TYPE[id] === null) use
// a static, hand-authored spec instead of buildObjectSpec()'s field-config path.
const STATIC_SPECS: Partial<Record<ImportObjectId, ObjectSpec>> = {
  users: USERS_SPEC,
  quote_lines: QUOTE_LINES_SPEC,
};

export default async function DataWorkbenchPage() {
  await requireWorkcenterView("data_workbench");
  const { supabase, tenantId } = await requireTenantUser();

  const [salesConfig, tenant] = await Promise.all([getSalesConfig(supabase, tenantId), getTenant()]);
  const objectOrder = tenant?.features?.quote_lines_dw ? OBJECT_ORDER : OBJECT_ORDER.filter((id) => id !== "quote_lines");

  const specs: ObjectSpec[] = await Promise.all(
    objectOrder.map(async (id): Promise<ObjectSpec> => {
      const registryType = REGISTRY_OBJECT_TYPE[id];
      if (!registryType) return STATIC_SPECS[id]!;
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
