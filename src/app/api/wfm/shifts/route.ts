import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// GET /api/wfm/shifts — list shifts (supervisor/admin).
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId } = ctx;

  const { data, error } = await supabase
    .from("wfm_shifts")
    .select("id, name, start_time, end_time, grace_minutes, is_night_shift, night_allowance_amount, crosses_midnight, active")
    .eq("tenant_id", tenantId)
    .order("start_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/shifts — create a shift (tenant admin only).
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;

  const body = await request.json().catch(() => null);
  const { name, start_time, end_time, grace_minutes, is_night_shift, night_allowance_amount } =
    (body ?? {}) as {
      name?: string; start_time?: string; end_time?: string;
      grace_minutes?: number; is_night_shift?: boolean; night_allowance_amount?: number;
    };
  if (!name?.trim() || !start_time || !end_time || !TIME_RE.test(start_time) || !TIME_RE.test(end_time)) {
    return NextResponse.json({ error: "name, start_time and end_time (HH:MM) are required" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("wfm_shifts")
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      start_time,
      end_time,
      grace_minutes: typeof grace_minutes === "number" && grace_minutes >= 0 ? Math.round(grace_minutes) : 10,
      is_night_shift: is_night_shift === true,
      night_allowance_amount:
        typeof night_allowance_amount === "number" && night_allowance_amount >= 0 ? night_allowance_amount : 0,
    })
    .select("id, name, start_time, end_time, grace_minutes, is_night_shift, night_allowance_amount, crosses_midnight, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
