import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { insertRows, readImportBody, type PreparedRow } from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Bulk-load the staff list (e.g. an HR-system export). Creates employee
// master data only -- never a login; Business Users are always created
// one-by-one by an admin from the Business Users screen.
export async function POST(request: NextRequest) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    return NextResponse.json({ error: "Business Roles isn't enabled for your workspace" }, { status: 403 });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    if (!values.first_name?.trim()) {
      outcomes.push({ rowNum, status: "failed", reason: "first_name is required" });
      continue;
    }
    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        first_name: values.first_name.trim().slice(0, 200),
        last_name: values.last_name?.trim().slice(0, 200) || "",
        employee_code: values.employee_code?.trim().slice(0, 50) || null,
        email: values.email?.trim().slice(0, 200) || null,
        phone: values.phone?.trim().slice(0, 50) || null,
        department: values.department?.trim().slice(0, 200) || null,
        designation: values.designation?.trim().slice(0, 200) || null,
        valid_from: values.valid_from && DATE_RE.test(values.valid_from.trim()) ? values.valid_from.trim() : null,
        valid_to: values.valid_to && DATE_RE.test(values.valid_to.trim()) ? values.valid_to.trim() : null,
        status: "active",
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json({ inserted: 0, skipped: 0, failed: outcomes.length, outcomes });

  const user = await getAuthUser();
  const result = await insertRows(supabase, "employees", prepared, outcomes, {
    objectType: "employees",
    labelField: "first_name",
    actorId: user?.id,
    actorEmail: user?.email,
  });

  return NextResponse.json(result);
}
