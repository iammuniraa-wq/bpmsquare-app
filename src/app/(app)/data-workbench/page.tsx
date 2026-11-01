import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, requireFeature } from "@/lib/tenant";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { REGISTRY_OBJECT_TYPE, buildObjectSpec, defaultObjectLabel } from "@/lib/import/registrySchema";
import { USERS_SPEC } from "@/lib/import/usersSchema";
import { QUOTE_LINES_SPEC } from "@/lib/import/quoteLinesSchema";
import { PRODUCT_BOM_LINES_SPEC } from "@/lib/import/productBomLinesSchema";
import { CONSENTS_SPEC } from "@/lib/import/consentsSchema";
import { STANDARD_QUOTE_LINES_SPEC } from "@/lib/import/standardQuoteLinesSchema";
import { SALES_ORDER_LINES_SPEC } from "@/lib/import/salesOrderLinesSchema";
import { TENDER_BOQ_LINES_SPEC } from "@/lib/import/tenderBoqLinesSchema";
import { EMPLOYEES_SPEC, buildEmployeesSpec } from "@/lib/import/employeesSchema";
import { requireWorkcenterView } from "@/lib/permissions";
import { featureForObject } from "@/lib/objectFeatures";
import { supplierColumnAvailable, withoutSupplierFields } from "@/lib/products/supplier";
import { DW_CATALOG, DW_OBJECT_IDS, ownedObjectIds, type DwObject } from "@/lib/import/catalog";
import { recentsKey } from "./recents";
import { DW_TIPS } from "./tips";
import type { ImportObjectId, ObjectSpec } from "@/lib/import/types";

// Objects with no FIELD_REGISTRY entry (REGISTRY_OBJECT_TYPE[id] === null) use
// a static, hand-authored spec instead of buildObjectSpec()'s field-config path.
const STATIC_SPECS: Partial<Record<ImportObjectId, ObjectSpec>> = {
  users: USERS_SPEC,
  quote_lines: QUOTE_LINES_SPEC,
  employees: EMPLOYEES_SPEC,
  product_bom_lines: PRODUCT_BOM_LINES_SPEC,
  consents: CONSENTS_SPEC,
  standard_quote_lines: STANDARD_QUOTE_LINES_SPEC,
  sales_order_lines: SALES_ORDER_LINES_SPEC,
  tender_boq_lines: TENDER_BOQ_LINES_SPEC,
};

export default async function DataWorkbenchPage() {
  await requireWorkcenterView("data_workbench");
  await requireFeature("data_workbench");
  const { supabase, tenantId, userId } = await requireTenantUser();

  const [salesConfig, tenant] = await Promise.all([getSalesConfig(supabase, tenantId), getTenant()]);
  // Which objects this tenant may bulk-load at all: the module that owns each object (OBJECT_FEATURE) plus the extra flags
  // the catalog names. The routes behind the screen enforce the same answer.
  const objectOrder = ownedObjectIds(tenant?.features, featureForObject);

  // Catalog order, not alphabetical: the picker groups by module and nests lines under their parent.
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
        const built = buildObjectSpec(id, fieldConfig, salesConfig);
        // Preferred supplier (0132): not offered until the column exists.
        return id === "products" && !(await supplierColumnAvailable(supabase)) ? withoutSupplierFields(built) : built;
      })
    )
  );
  const objects: DwObject[] = specs.map((spec) => ({ spec, catalog: DW_CATALOG[spec.id] }));
  // Never listed (bpmsquarecore 3b), only named when a link or a search asks for one the workspace has not switched on.
  const owned = new Set<ImportObjectId>(objectOrder);
  const unowned = DW_OBJECT_IDS.filter((id) => !owned.has(id)).map((id) => ({ id, label: STATIC_SPECS[id]?.label ?? defaultObjectLabel(id) }));

  return (
    <>
      <TabTitle title="Data Workbench" />
      <PageHeader title="Data Workbench" info={DW_TIPS.page} />
      <DataWorkbenchClient objects={objects} unowned={unowned} recentsKey={recentsKey(tenantId, userId)} />
    </>
  );
}
