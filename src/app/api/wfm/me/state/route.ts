import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import type { PresenceKind, PunchState } from "@/lib/wfm/types";

function stateFromLastKind(kind: PresenceKind | null): PunchState {
  if (kind === "check_in" || kind === "break_end") return "in";
  if (kind === "break_start") return "break";
  return "out";
}

// GET /api/wfm/me/state — the punch screen's bootstrap: who am I, current
// punch state, today's events and running total, consent status.
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee, isSupervisor } = ctx;

  if (!employee) {
    return NextResponse.json({ employee: null, is_supervisor: isSupervisor });
  }

  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);
  const now = new Date();
  const todayKey = dateKeyInTz(now, config.timezone);

  const [{ data: recent }, { data: shift }, { data: site }] = await Promise.all([
    admin
      .from("wfm_presence_events")
      .select("id, kind, ts, site_id, within_geofence, flags")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .is("superseded_by", null)
      .gte("ts", new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString())
      .order("ts", { ascending: true }),
    employee.shift_id
      ? admin
          .from("wfm_shifts")
          .select("id, name, start_time, end_time, grace_minutes, is_night_shift")
          .eq("id", employee.shift_id)
          .eq("tenant_id", tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    employee.site_id
      ? admin
          .from("wfm_sites")
          .select("id, name")
          .eq("id", employee.site_id)
          .eq("tenant_id", tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const events = recent ?? [];
  const lastKind = (events[events.length - 1]?.kind as PresenceKind) ?? null;
  const state = stateFromLastKind(lastKind);

  const todays = events.filter((e) => dateKeyInTz(new Date(e.ts), config.timezone) === todayKey);
  const firstIn = todays.find((e) => e.kind === "check_in");
  const lastOut = [...todays].reverse().find((e) => e.kind === "check_out");
  const runningMinutes = firstIn
    ? Math.max(
        0,
        Math.round(
          ((state === "out" && lastOut ? new Date(lastOut.ts).getTime() : now.getTime()) -
            new Date(firstIn.ts).getTime()) / 60000
        )
      )
    : 0;

  return NextResponse.json({
    employee: {
      id: employee.id,
      full_name: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
      employee_code: employee.employee_code,
      wfm_role: employee.wfm_role,
      consent_recorded_at: employee.consent_recorded_at,
    },
    is_supervisor: isSupervisor,
    state,
    today: todays,
    running_minutes: runningMinutes,
    home_site: site ?? null,
    shift: shift ?? null,
    timezone: config.timezone,
  });
}
