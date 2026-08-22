import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, requireFeature } from "@/lib/tenant";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { REGISTRY_OBJECT_TYPE, buildObjectSpec } from "@/lib/import/registrySchema";
import { USERS_SPEC } from "@/lib/import/usersSchema";
import { QUOTE_LINES_SPEC } from "@/lib/import/quoteLinesSchema";
import { EMPLOYEES_SPEC, buildEmployeesSpec } from "@/lib/import/employeesSchema";
import { requireWorkcenterView } from "@/lib/permissions";
import type { ImportObjectId, ObjectSpec } from "@/lib/import/types";

// Display order is alphabetical by label (sorted after specs are built,
// since labels are tenant-configurable) -- this list only defines WHICH
// objects exist, not their order.
const OBJECT_ORDER: ImportObjectId[] = [
  "accounts", "contacts", "assets", "suppliers", "products", "quotes", "quote_lines",
  "cases", "work_orders", "invoices", "purchase_orders", "inventory",
  "users", "employees",
];

// Objects with no FIELD_REGISTRY entry (REGISTRY_OBJECT_TYPE[id] === null) use
// a static, hand-authored spec instead of buildObjectSpec()'s field-config path.
const STATIC_SPECS: Partial<Record<ImportObjectId, ObjectSpec>> = {
  users: USERS_SPEC,
  quote_lines: QUOTE_LINES_SPEC,
  employees: EMPLOYEES_SPEC,
};

export default async function DataWorkbenchPage() {
  await requireWorkcenterView("data_workbench");
  await requireFeature("data_workbench");
  const { supabase, tenantId } = await requireTenantUser();

  const [salesConfig, tenant] = await Promise.all([getSalesConfig(supabase, tenantId), getTenant()]);
  const objectOrder = OBJECT_ORDER.filter((id) => {
    if (id === "quote_lines") return tenant?.features?.quote_lines_dw === true;
    if (id === "employees") return tenant?.features?.business_roles === true;
    if (id === "products") return tenant?.features?.products === true;
    return true;
  });

  const specs: ObjectSpec[] = (
    await Promise.all(
      objectOrder.map(async (id): Promise<ObjectSpec> => {
        const registryType = REGISTRY_OBJECT_TYPE[id];
        // Employees has a static spec but still carries tenant custom fields
        // and a read-only code column -- buildEmployeesSpec assembles both,
        // and the export/update routes build through the same function.
        if (id === "employees") {
          return buildEmployeesSpec(await getEffectiveFieldConfig(supabase, tenantId, "employee"));
        }
        if (!registryType) return STATIC_SPECS[id]!;
        const fieldConfig = await getEffectiveFieldConfig(supabase, tenantId, registryType);
        return buildObjectSpec(id, fieldConfig, salesConfig);
      })
    )
  ).sort((a, b) => a.label.localeCompare(b.label));

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
