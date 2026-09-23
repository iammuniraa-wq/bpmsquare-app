import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { tenantHasFeature } from "@/lib/tenant";
import { getEffectiveFieldConfig } from "@/lib/fieldConfig";
import { buildEmployeesSpec } from "@/lib/import/employeesSchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { Employee } from "@/lib/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Staff records are personal data, so this mirrors the employees import
// route's guard (admin + business_roles) rather than the CRM exports' plain
// requireTenantUser().
export async function POST(request: NextRequest) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "employees");
  if (gate) return gate;
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    return NextResponse.json({ error: "Business Roles isn't enabled for your workspace" }, { status: 403 });
  }

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, employees] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "employee"),
    fetchAllRows<Employee>(supabase, "employees", "*", tenantId),
  ]);
  const spec = buildEmployeesSpec(fieldConfig);

  const rows = employees.map((raw) => {
    const values = rowToExportValues(raw, spec.fields);
    values.id = raw.id;
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}
