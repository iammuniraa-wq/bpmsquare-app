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
