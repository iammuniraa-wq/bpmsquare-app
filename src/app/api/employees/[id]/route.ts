import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser, createAdminSupabase } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { loadEmployeeImpact, describeImpact } from "@/lib/wfm/employeeImpact";
import { reconcileObsoletePatch } from "@/lib/wfm/obsolete";
import { tenantToday } from "@/lib/wfm/tenantToday";
import { employeesAdminGuard as guard } from "../_guard";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : null);
const cleanText = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await guard());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: before } = await supabase.from("employees").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("first_name" in body) {
    const v = cleanText(body.first_name);
    if (!v) return NextResponse.json({ error: "First name is required" }, { status: 400 });
    patch.first_name = v;
  }
  if ("last_name" in body) patch.last_name = cleanText(body.last_name) ?? "";
  // employee_code is system-generated and immutable after creation (owner
  // decision 2026-08-15) -- deliberately NOT patchable. Format/number-range
  // configuration is the only future influence, via Settings.
  if ("email" in body) patch.email = cleanText(body.email);
  if ("phone" in body) patch.phone = cleanText(body.phone, 50);
  if ("department" in body) patch.department = cleanText(body.department);
  if ("designation" in body) patch.designation = cleanText(body.designation);
  if ("valid_from" in body) patch.valid_from = cleanDate(body.valid_from);
  if ("valid_to" in body) patch.valid_to = cleanDate(body.valid_to);
  if ("status" in body) patch.status = body.status === "inactive" ? "inactive" : "active";
  // Obsolete = inactive + valid_to; keep the two telling one story (making
  // obsolete stamps today, making active again clears that date).
  if ("status" in body || "valid_to" in body) {
    reconcileObsoletePatch(before as { status: string; valid_to: string | null }, patch, await tenantToday(tenantId));
  }
  // Custom-field values (cf_* keys only, same shape the CRM objects accept).
  if (typeof body.custom_data === "object" && body.custom_data !== null && !Array.isArray(body.custom_data)) {
    patch.custom_data = Object.fromEntries(
      Object.entries(body.custom_data as Record<string, unknown>).filter(([k]) => k.startsWith("cf_"))
    );
  }

  const { data, error } = await supabase
    .from("employees")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "An employee with this code already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const changes = diffForLog("employees", before as Record<string, unknown>, patch);
  if (changes.length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "employees", objectId: id,
      objectLabel: `${data.first_name} ${data.last_name}`.trim(),
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await guard());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: employee } = await supabase.from("employees").select("first_name, last_name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!employee) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Every WFM table cascades from employees, so a delete would silently erase
  // the person's punches, leave and overtime (BIM, 2026-10-23). With any work
  // data on file the only way out is Make obsolete. Checked here, not just in
  // the dialog, and fail closed if the counts can't be read.
  let impact;
  try {
    impact = await loadEmployeeImpact(createAdminSupabase(), tenantId, id);
  } catch (e) {
    console.error("employee delete: impact check failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not check this employee's records, so nothing was deleted" }, { status: 500 });
  }
  if (impact.total > 0) {
    return NextResponse.json(
      {
        error: `This employee has ${describeImpact(impact).join(", ")} on file. It can't be deleted; make the employee obsolete instead.`,
        code: "has_work_data",
        impact,
      },
      { status: 409 }
    );
  }

  // tenant_users.employee_id is ON DELETE SET NULL -- deleting the employee
  // record never deletes or locks the login; it just unlinks it. Locking is
  // an explicit, separate action on the business user.
  const { error } = await supabase.from("employees").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "employees", objectId: id,
    objectLabel: `${employee.first_name} ${employee.last_name}`.trim(),
    action: "delete", actorId: user?.id, actorEmail: user?.email,
  });

  return new NextResponse(null, { status: 204 });
}
