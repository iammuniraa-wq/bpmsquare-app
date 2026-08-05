import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig, dateKeyInTz, zonedTimestamp } from "@/lib/wfm/server";
import type { PresenceKind, PunchState } from "@/lib/wfm/types";

function stateFromLastKind(kind: PresenceKind | null): PunchState {
  if (kind === "check_in" || kind === "break_end") return "in";
  if (kind === "break_start") return "break";
  return "out";
}

// GET /api/wfm/live-board — today's attendance per employee: state,
// first-in/last-out, late and absent computation, geofence flags.
// Polled by the supervisor live board (~30 s).
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;

  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);
  const now = new Date();
  const todayKey = dateKeyInTz(now, config.timezone);

  const [{ data: employees }, { data: shifts }, { data: sites }, { data: events }, { data: holidays }, { data: leaves }] =
    await Promise.all([
      admin
        .from("employees")
        .select("id, employee_code, first_name, last_name, employment_type, wfm_role, shift_id, site_id, status")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("first_name"),
      admin.from("wfm_shifts").select("*").eq("tenant_id", tenantId),
      admin.from("wfm_sites").select("id, name, active").eq("tenant_id", tenantId),
      admin
        .from("wfm_presence_events")
        .select("id, employee_id, kind, ts, site_id, within_geofence, selfie_path, flags")
        .eq("tenant_id", tenantId)
        .is("superseded_by", null)
        // 36h window covers night shifts that started yesterday
        .gte("ts", new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString())
        .order("ts", { ascending: true }),
      admin.from("wfm_holidays").select("date, applies_to").eq("tenant_id", tenantId).eq("date", todayKey),
      admin
        .from("wfm_leave_records")
        .select("employee_id, half_day")
        .eq("tenant_id", tenantId)
        .lte("date_from", todayKey)
        .gte("date_to", todayKey),
    ]);

  const shiftById = new Map((shifts ?? []).map((s) => [s.id, s]));
  const siteById = new Map((sites ?? []).map((s) => [s.id, s]));
  const leavesByEmp = new Map((leaves ?? []).map((l) => [l.employee_id, l]));

  const eventsByEmp = new Map<string, NonNullable<typeof events>>();
  for (const e of events ?? []) {
    const key = e.employee_id as string;
    if (!eventsByEmp.has(key)) eventsByEmp.set(key, []);
    eventsByEmp.get(key)!.push(e);
  }

  // 0=Sunday … 6=Saturday, evaluated in the tenant timezone
  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: config.timezone, weekday: "short" }).format(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  const isWeekOff = config.week_off_days.includes(weekday);

  const rows = (employees ?? []).map((emp) => {
    const empEvents = (eventsByEmp.get(emp.id) ?? []).filter(
      (e) => dateKeyInTz(new Date(e.ts), config.timezone) === todayKey
    );
    const lastKind = (empEvents[empEvents.length - 1]?.kind as PresenceKind) ?? null;
    const state = stateFromLastKind(lastKind);
    const firstIn = empEvents.find((e) => e.kind === "check_in") ?? null;
    const lastOut = [...empEvents].reverse().find((e) => e.kind === "check_out") ?? null;

    const shift = emp.shift_id ? shiftById.get(emp.shift_id) : null;
    const onLeave = leavesByEmp.has(emp.id);
    const holiday = (holidays ?? []).some(
      (h) => h.applies_to === "all" || h.applies_to === emp.employment_type
    );

    let late = false;
    let absent = false;
    if (shift && !onLeave && !holiday && !isWeekOff) {
      const graceEnd = new Date(
        zonedTimestamp(todayKey, shift.start_time, config.timezone).getTime() +
          shift.grace_minutes * 60 * 1000
      );
      if (firstIn) {
        late = new Date(firstIn.ts).getTime() > graceEnd.getTime();
      } else if (now.getTime() > graceEnd.getTime()) {
        absent = true;
      }
    }

    const outsideGeofence = empEvents.some((e) => e.within_geofence === false);

    return {
      employee_id: emp.id,
      employee_code: emp.employee_code,
      full_name: [emp.first_name, emp.last_name].filter(Boolean).join(" "),
      employment_type: emp.employment_type,
      home_site_id: emp.site_id,
      home_site_name: emp.site_id ? (siteById.get(emp.site_id)?.name ?? null) : null,
      shift_name: shift?.name ?? null,
      state,
      first_in: firstIn?.ts ?? null,
      last_out: lastOut?.ts ?? null,
      late,
      absent,
      on_leave: onLeave,
      outside_geofence: outsideGeofence,
      punches: empEvents.length,
    };
  });

  return NextResponse.json({
    date: todayKey,
    timezone: config.timezone,
    is_week_off: isWeekOff,
    is_holiday: (holidays ?? []).length > 0,
    sites: (sites ?? []).filter((s) => s.active),
    rows,
  });
}
