import "server-only";

import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { DEFAULT_WFM_CONFIG, type TenantConfig, type WfmConfig } from "@/lib/constants";
import type { WfmEmployee, WfmSite, PresenceKind, PunchState } from "./types";
import { deriveState } from "./types";
import { computeDayHours, type DayHours } from "./hours";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WfmContext = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  /** This login's employee record (via tenant_users.employee_id), if linked. */
  employee: WfmEmployee | null;
  /** Tenant admins and wfm_role=supervisor employees. */
  isSupervisor: boolean;
};

const EMPLOYEE_COLS =
  "id, employee_code, first_name, last_name, phone, status, employment_type, shift_id, site_id, wfm_role, technician_id, enrolled_photo_path, consent_recorded_at";

/**
 * Auth + feature gate for every /api/wfm/** route. Throws the same
 * { status, message } shape as requireTenantUser() so routes handle both
 * with one catch. WFM tables are read-only under RLS by design — all
 * writes in wfm routes use createAdminSupabase() with explicit tenant
 * filters (see 0062_wfm_module.sql header).
 */
export async function requireWfm(): Promise<WfmContext> {
  const { supabase, tenantId, userId, role } = await requireTenantUser();

  if (!(await tenantHasFeature(supabase, tenantId, "wfm"))) {
    throw { status: 404, message: "Not found" };
  }

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("employee_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  let employee: WfmEmployee | null = null;
  if (membership?.employee_id) {
    const { data } = await supabase
      .from("employees")
      .select(EMPLOYEE_COLS)
      .eq("tenant_id", tenantId)
      .eq("id", membership.employee_id)
      .maybeSingle();
    employee = (data as WfmEmployee | null) ?? null;
  }

  return {
    supabase,
    tenantId,
    userId,
    role,
    employee,
    isSupervisor: role === "admin" || employee?.wfm_role === "supervisor",
  };
}

/** requireWfm + must be an active employee (punch/timesheet/corrections). */
export async function requireWfmEmployee(): Promise<WfmContext & { employee: WfmEmployee }> {
  const ctx = await requireWfm();
  if (!ctx.employee || ctx.employee.status !== "active") {
    throw { status: 403, message: "No active employee profile" };
  }
  return ctx as WfmContext & { employee: WfmEmployee };
}

/** requireWfm + supervisor or admin (live board, corrections queue, management). */
export async function requireWfmSupervisor(): Promise<WfmContext> {
  const ctx = await requireWfm();
  if (!ctx.isSupervisor) throw { status: 403, message: "Forbidden" };
  return ctx;
}

/** Tenant WFM config with defaults filled in. */
export async function getWfmConfig(supabase: SupabaseClient, tenantId: string): Promise<WfmConfig> {
  const { data } = await supabase.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const stored = ((data?.config as TenantConfig | null)?.wfm ?? {}) as Partial<WfmConfig>;
  return { ...DEFAULT_WFM_CONFIG, ...stored };
}

// ── Geofence ─────────────────────────────────────────────────────────────

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Match a punch location against the tenant's active sites. Policy: outside
 * every geofence is flagged, never rejected.
 */
export function matchSite(
  sites: WfmSite[],
  lat: number | null,
  lng: number | null
): { site: WfmSite | null; within: boolean | null } {
  if (lat == null || lng == null) return { site: null, within: null };
  let nearest: WfmSite | null = null;
  let nearestDist = Infinity;
  for (const s of sites) {
    if (!s.active) continue;
    const d = haversineMeters(lat, lng, s.lat, s.lng);
    if (d < nearestDist) {
      nearest = s;
      nearestDist = d;
    }
  }
  if (nearest && nearestDist <= nearest.radius_m) return { site: nearest, within: true };
  // outside all radii: still report the nearest site for supervisor context
  return { site: nearest, within: false };
}

function tzOffsetMs(timezone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcDate).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second
  );
  return asUtc - utcDate.getTime();
}

/** The UTC instant of `time` (HH:MM[:SS]) on `dateKey` (YYYY-MM-DD) in `timezone`. */
export function zonedTimestamp(dateKey: string, time: string, timezone: string): Date {
  const hms = time.length === 5 ? `${time}:00` : time;
  const naive = new Date(`${dateKey}T${hms}Z`);
  return new Date(naive.getTime() - tzOffsetMs(timezone, naive));
}

/** Today's date key (YYYY-MM-DD) in the tenant's timezone. */
export function dateKeyInTz(ts: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ts);
}

// ── FSM bridge ───────────────────────────────────────────────────────────
// The presence-event stream was deliberately designed source-agnostic (see
// 0062_wfm_module.sql) so the Field module could read it without WFM ever
// coupling to `source=web_selfie`. This is the first consumer: technicians
// (src/lib/types.ts Technician) get a live in/break/out signal wherever
// their `employees.technician_id` link exists, alongside their existing
// static `status` field -- which stays untouched, since it's a separate,
// manually-set concept (active/on_leave/inactive as an HR state, not "is
// this person clocked in right now").

/**
 * Current WFM punch state for every technician that has a linked, active
 * employee record. Technicians with no link (or whose tenant has wfm off)
 * simply have no entry in the returned map -- callers should treat a
 * missing key as "no live signal available", not "out".
 */
export async function getTechnicianLiveStates(
  tenantId: string,
  technicianIds: string[]
): Promise<Map<string, PunchState>> {
  const ids = [...new Set(technicianIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const admin = createAdminSupabase();
  const { data: employees } = await admin
    .from("employees")
    .select("id, technician_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("technician_id", ids);

  const empIdByTechId = new Map(
    (employees ?? [])
      .filter((e) => e.technician_id)
      .map((e) => [e.technician_id as string, e.id as string])
  );
  if (empIdByTechId.size === 0) return new Map();

  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const { data: events } = await admin
    .from("wfm_presence_events")
    .select("employee_id, kind, ts")
    .eq("tenant_id", tenantId)
    .in("employee_id", [...empIdByTechId.values()])
    .is("superseded_by", null)
    .gte("ts", since)
    .order("ts", { ascending: true });

  const eventsByEmployee = new Map<string, { kind: PresenceKind }[]>();
  for (const e of events ?? []) {
    const key = e.employee_id as string;
    if (!eventsByEmployee.has(key)) eventsByEmployee.set(key, []);
    eventsByEmployee.get(key)!.push({ kind: e.kind as PresenceKind });
  }

  const result = new Map<string, PunchState>();
  for (const [techId, empId] of empIdByTechId) {
    result.set(techId, deriveState(eventsByEmployee.get(empId) ?? []));
  }
  return result;
}

export type TechnicianDayAttendance = {
  events: { kind: PresenceKind; ts: string; within_geofence: boolean | null }[];
  hours: DayHours;
};

/**
 * A linked technician's actual WFM punches for one calendar day (tenant
 * timezone) -- e.g. a work order's scheduled_for date. Lets a Work Order
 * cross-check its manually-entered VisitLog against tamper-evident
 * attendance data. Returns null when the technician has no linked, active
 * WFM employee (nothing to show, not an error).
 */
export async function getTechnicianAttendanceForDate(
  tenantId: string,
  technicianId: string,
  dateKey: string
): Promise<TechnicianDayAttendance | null> {
  const admin = createAdminSupabase();
  const { data: employee } = await admin
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("technician_id", technicianId)
    .eq("status", "active")
    .maybeSingle();
  if (!employee) return null;

  const config = await getWfmConfig(admin, tenantId);
  const dayStart = zonedTimestamp(dateKey, "00:00", config.timezone);
  const windowStart = new Date(dayStart.getTime() - 12 * 60 * 60 * 1000);
  const windowEnd = new Date(dayStart.getTime() + 36 * 60 * 60 * 1000);

  const { data: events } = await admin
    .from("wfm_presence_events")
    .select("kind, ts, within_geofence")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employee.id)
    .is("superseded_by", null)
    .gte("ts", windowStart.toISOString())
    .lte("ts", windowEnd.toISOString())
    .order("ts", { ascending: true });

  const dayEvents = (events ?? []).filter(
    (e) => dateKeyInTz(new Date(e.ts as string), config.timezone) === dateKey
  ) as TechnicianDayAttendance["events"];

  const endRef = dayEvents.length > 0 ? new Date(dayEvents[dayEvents.length - 1].ts) : dayStart;
  return { events: dayEvents, hours: computeDayHours(dayEvents, endRef) };
}

// ── Live board snapshot ────────────────────────────────────────────────────
// Shared by the /api/wfm/live-board route and the Analytics "today's
// attendance" / "night shift cost" metrics, so both read exactly the same
// late/absent/leave/holiday computation instead of two copies drifting.

export type WfmLiveBoardRow = {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  employment_type: string;
  home_site_id: string | null;
  home_site_name: string | null;
  shift_name: string | null;
  is_night_shift: boolean;
  night_allowance_amount: number;
  state: PunchState;
  first_in: string | null;
  last_out: string | null;
  late: boolean;
  absent: boolean;
  on_leave: boolean;
  outside_geofence: boolean;
  punches: number;
};

export type WfmLiveBoardSnapshot = {
  date: string;
  timezone: string;
  is_week_off: boolean;
  is_holiday: boolean;
  sites: { id: string; name: string; active: boolean }[];
  rows: WfmLiveBoardRow[];
};

function stateFromLastKind(kind: PresenceKind | null): PunchState {
  if (kind === "check_in" || kind === "break_end") return "in";
  if (kind === "break_start") return "break";
  return "out";
}

export async function getWfmLiveBoardSnapshot(tenantId: string): Promise<WfmLiveBoardSnapshot> {
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

  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: config.timezone, weekday: "short" }).format(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  const isWeekOff = config.week_off_days.includes(weekday);

  const rows: WfmLiveBoardRow[] = (employees ?? []).map((emp) => {
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
      is_night_shift: shift?.is_night_shift ?? false,
      night_allowance_amount: shift?.night_allowance_amount ?? 0,
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

  return {
    date: todayKey,
    timezone: config.timezone,
    is_week_off: isWeekOff,
    is_holiday: (holidays ?? []).length > 0,
    sites: ((sites ?? []) as { id: string; name: string; active: boolean }[]).filter((s) => s.active),
    rows,
  };
}
