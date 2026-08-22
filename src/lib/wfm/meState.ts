import "server-only";

import { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig, dateKeyInTz, type WfmContext } from "@/lib/wfm/server";
import { type PresenceKind } from "@/lib/wfm/types";
// punchStateAt is the state machine's own derivation -- NOT a local copy. A
// second copy here silently went stale the moment OT/mobile-work kinds were
// added (it would have reported "out" for an employee mid-overtime, offering
// them a check-in the API would then reject). Same function the punch route
// uses, shift-day rollover included, so the button offered and the punch
// accepted always agree.
import { computeDayHours, shiftDayKey, punchStateAt } from "@/lib/wfm/hours";

/**
 * The /wfm/me punch screen's bootstrap payload: who am I, current punch
 * state, today's events and running total, consent status, upcoming
 * roster. Extracted from GET /api/wfm/me/state so the page's server
 * component can compute the SAME payload during the initial render and
 * hand it to MeClient as a prop -- the first paint then shows real data
 * at hydration instead of an empty shell that fetches after the client
 * bundle finishes compiling (the LCP render-delay DevTools flagged).
 * The API route stays as the refresh path (after a punch, month change,
 * regained connectivity).
 */
export async function buildWfmMeState(ctx: WfmContext) {
  const { tenantId, employee, isSupervisor } = ctx;

  if (!employee) {
    return { employee: null, is_supervisor: isSupervisor };
  }

  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);
  const now = new Date();

  const UPCOMING_DAYS = 14;
  const todayStr = dateKeyInTz(now, config.timezone);
  const endStr = dateKeyInTz(new Date(now.getTime() + UPCOMING_DAYS * 24 * 60 * 60 * 1000), config.timezone);

  const [{ data: recent }, { data: shift }, { data: site }, { data: roster }, { data: recheckRows }, { data: faceRow }] = await Promise.all([
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
          .select("id, name, start_time, end_time, grace_minutes, is_night_shift, crosses_midnight")
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
    admin
      .from("wfm_roster_assignments")
      .select("date, shift_id, site_id, is_day_off, note, wfm_shifts(name, start_time, end_time, is_night_shift)")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .gte("date", todayStr)
      .lte("date", endStr)
      .order("date"),
    admin
      .from("wfm_recheck_requests")
      .select("id, target_date, recheck_type, message, status, created_at")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    config.face_punch === "off"
      ? Promise.resolve({ data: null })
      : admin
          .from("wfm_face_enrollments")
          .select("status")
          .eq("tenant_id", tenantId)
          .eq("employee_id", employee.id)
          .maybeSingle(),
  ]);

  const events = recent ?? [];
  const lastEvent = events[events.length - 1] ?? null;
  const state = punchStateAt(
    lastEvent ? { kind: lastEvent.kind as PresenceKind, ts: lastEvent.ts as string } : null,
    now, config.timezone, shift
  );

  // "Today" from THIS employee's shift perspective -- at 2am mid-way
  // through a night shift, that's still yesterday's shift-day.
  const todayKey = shiftDayKey(now, config.timezone, shift);
  const todays = events.filter((e) => shiftDayKey(new Date(e.ts), config.timezone, shift) === todayKey);
  const hours = computeDayHours(todays as { kind: PresenceKind; ts: string }[], now);
  const runningMinutes = config.deduct_breaks ? hours.net_minutes : hours.gross_minutes;

  // Next UPCOMING_DAYS days, one entry each: an explicit roster row for
  // that date if one exists, otherwise the standing shift (employees.shift_id)
  // as a fallback -- rostering is additive, so most days show "standing"
  // until a supervisor actually rosters someone.
  const rosterByDate = new Map((roster ?? []).map((r) => [r.date as string, r]));
  const upcoming: {
    date: string; is_day_off: boolean; shift_name: string | null;
    start_time: string | null; end_time: string | null; is_night_shift: boolean;
    source: "roster" | "standing"; note: string | null;
  }[] = [];
  for (let i = 0; i < UPCOMING_DAYS; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const dateKey = dateKeyInTz(d, config.timezone);
    const rosterRow = rosterByDate.get(dateKey);
    if (rosterRow) {
      const shiftsField = rosterRow.wfm_shifts as
        | { name: string; start_time: string; end_time: string; is_night_shift: boolean }
        | { name: string; start_time: string; end_time: string; is_night_shift: boolean }[]
        | null;
      const s = Array.isArray(shiftsField) ? shiftsField[0] ?? null : shiftsField;
      upcoming.push({
        date: dateKey,
        is_day_off: rosterRow.is_day_off,
        shift_name: s?.name ?? null,
        start_time: s?.start_time ?? null,
        end_time: s?.end_time ?? null,
        is_night_shift: s?.is_night_shift ?? false,
        source: "roster",
        note: rosterRow.note,
      });
    } else {
      upcoming.push({
        date: dateKey,
        is_day_off: false,
        shift_name: shift?.name ?? null,
        start_time: shift?.start_time ?? null,
        end_time: shift?.end_time ?? null,
        is_night_shift: shift?.is_night_shift ?? false,
        source: "standing",
        note: null,
      });
    }
  }

  return {
    employee: {
      id: employee.id,
      full_name: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
      employee_code: employee.employee_code,
      wfm_role: employee.wfm_role,
      consent_recorded_at: employee.consent_recorded_at,
      // Shown read-only on the portal's profile hub (Personal / Employment).
      phone: employee.phone,
      employment_type: employee.employment_type,
    },
    is_supervisor: isSupervisor,
    state,
    today: todays,
    running_minutes: runningMinutes,
    break_minutes: hours.break_minutes,
    home_site: site ?? null,
    shift: shift ?? null,
    timezone: config.timezone,
    punch_types: config.punch_types,
    // The client refuses BEFORE opening the camera rather than letting
    // someone take a selfie and only then be rejected. The punch route is
    // the real enforcement; this is so the refusal happens early.
    require_location: config.require_location || config.geofence_mode === "block",
    selfie_mode: config.selfie_mode,
    // Self-service face setup (client decision 2026-08-20): the Me page
    // offers enrollment when the tenant runs kiosk face punch and this
    // employee hasn't enrolled yet.
    face_punch: config.face_punch,
    face_enrolled: (faceRow as { status?: string } | null)?.status === "active",
    // Supervisor-managed workforce (client decision 2026-08-21): when off,
    // the Me page withdraws self-punch and self-enrollment -- attendance is
    // captured at the kiosk by face. Defaults on for every existing tenant.
    employee_self_service: config.employee_self_service,
    // Account Settings offers "add a passkey" only when the tenant runs it.
    passkey_login: config.passkey_login,
    // So the client can tick the running total live (net vs gross) the same
    // way the server computed running_minutes at load.
    deduct_breaks: config.deduct_breaks,
    upcoming,
    pending_rechecks: recheckRows ?? [],
  };
}

export type WfmMeState = Awaited<ReturnType<typeof buildWfmMeState>>;
