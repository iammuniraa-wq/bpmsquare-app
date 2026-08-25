import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// PATCH /api/wfm/shifts/[id] — edit / activate / deactivate (tenant admin only).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.start_time === "string" && TIME_RE.test(body.start_time)) patch.start_time = body.start_time;
  if (typeof body.end_time === "string" && TIME_RE.test(body.end_time)) patch.end_time = body.end_time;
  if (typeof body.grace_minutes === "number" && body.grace_minutes >= 0) patch.grace_minutes = Math.round(body.grace_minutes);
  if (typeof body.is_night_shift === "boolean") patch.is_night_shift = body.is_night_shift;
  if (typeof body.night_allowance_amount === "number" && body.night_allowance_amount >= 0) {
    patch.night_allowance_amount = body.night_allowance_amount;
  }
  if (typeof body.active === "boolean") patch.active = body.active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("wfm_shifts")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id, name, start_time, end_time, grace_minutes, is_night_shift, night_allowance_amount, crosses_midnight, active")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

// DELETE /api/wfm/shifts/[id] — tenant admin only. Both employees.shift_id
// and wfm_roster_assignments.shift_id are `on delete set null` (0062/0072),
// so an unguarded delete wouldn't fail -- it would silently orphan every
// employee still standing on this shift (no shift = no lateness/absence
// computed for them at all, going forward) and silently turn every roster
// day that named it into an explicit DAY OFF (shift_id null means day-off
// there, not "unset"). Both are wrong data, not just messy data, so this
// blocks the delete and names exactly what to reassign first -- the same
// reference-count-before-delete discipline as inventory's delete route.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;
  const { id } = await params;

  const admin = createAdminSupabase();
  const [{ count: employeeCount }, { count: rosterCount }] = await Promise.all([
    admin.from("employees").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("shift_id", id),
    admin.from("wfm_roster_assignments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("shift_id", id),
  ]);
  const refs: string[] = [];
  if (employeeCount) refs.push(`${employeeCount} employee${employeeCount === 1 ? "" : "s"}`);
  if (rosterCount) refs.push(`${rosterCount} roster day${rosterCount === 1 ? "" : "s"}`);
  if (refs.length > 0) {
    return NextResponse.json(
      { error: `Still in use by ${refs.join(" and ")}. Reassign them to another shift first, or deactivate this one instead of deleting it.` },
      { status: 400 }
    );
  }

  const { error, count } = await admin
    .from("wfm_shifts")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
