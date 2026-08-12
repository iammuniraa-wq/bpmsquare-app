// WFM entity types — mirror supabase/migrations/0062_wfm_module.sql.
// Client-safe (no server imports); the punch state machine lives here too
// so the PWA button and the punch API validate transitions identically.

export type WfmSite = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  active: boolean;
  /** Who supervises this site (0079). The first hop of the reporting tree:
   * an employee's approver is whoever runs the site they're assigned to.
   * Null = nobody can approve for this site — the Sites screen warns about it
   * rather than silently escalating to a tenant admin. */
  supervisor_id?: string | null;
  /** Joined by wfmSitesPayload for display only. Aliased away from the table
   * name because employees<->wfm_sites now has TWO foreign keys between them
   * (employees.site_id and wfm_sites.supervisor_id), so every embed across
   * that pair must name which one it means. */
  supervisor?: { first_name: string; last_name: string; employee_code: string | null } | null;
};

export type WfmShift = {
  id: string;
  name: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  grace_minutes: number;
  is_night_shift: boolean;
  night_allowance_amount: number;
  crosses_midnight: boolean;
  active: boolean;
};

/** A tenant-configured employment-type CODE (WfmConfig.employment_types).
 * Deliberately a plain string rather than a union: tenants define their own
 * list -- "full_time"/"contractor" are only the seed defaults, and e.g. Vikas
 * also uses "intern". Validation happens against the tenant's configured
 * list at the API boundary, not in the type system. */
export type WfmEmploymentType = string;
export type WfmRole = "employee" | "supervisor";

// The WFM projection of the shared `employees` master-data row (0057 +
// 0062 columns). A login resolves to its employee record via the existing
// tenant_users.employee_id link (Business Users), not a user_id column.
export type WfmEmployee = {
  id: string;
  employee_code: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  status: "active" | "inactive";
  employment_type: WfmEmploymentType;
  shift_id: string | null;
  site_id: string | null;
  wfm_role: WfmRole;
  technician_id: string | null;
  enrolled_photo_path: string | null;
  consent_recorded_at: string | null;
};

export function employeeName(e: Pick<WfmEmployee, "first_name" | "last_name">): string {
  return [e.first_name, e.last_name].filter(Boolean).join(" ");
}

export type WfmLeaveCategory = "paid" | "unpaid" | "half_day";

export type WfmLeaveType = {
  id: string;
  name: string;
  category: WfmLeaveCategory;
  active: boolean;
};

export type WfmLeaveRecord = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  date_from: string; // YYYY-MM-DD
  date_to: string;
  half_day: boolean;
  remarks: string | null;
};

export type WfmHoliday = {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  applies_to: "all" | WfmEmploymentType;
};

// Punch kinds. The first four are the always-on core; the rest are optional
// modes a tenant switches on in Settings -> Workforce (WfmConfig.punch_types),
// modelled on ADP/Adobe Zeiterfassung's single punch-type dropdown rather
// than a button per action.
export type PresenceKind =
  | "check_in" | "check_out" | "break_start" | "break_end"
  | "ot_in" | "ot_out"
  | "mobile_work_start" | "mobile_work_end"
  | "business_trip_start" | "business_trip_end";
export type PresenceSource = "web_selfie" | "manual_admin" | "correction";

/** Kinds that OPEN a regular working session. Mobile work and business trip
 * are ordinary working time recorded under a different label -- the hours
 * engine treats them exactly like check_in/check_out, only the timesheet
 * distinguishes them. OT is deliberately NOT here: it's a separate,
 * separately-approved, separately-paid session (see otSessions in hours.ts). */
export const SESSION_START_KINDS: PresenceKind[] = ["check_in", "mobile_work_start", "business_trip_start"];
export const SESSION_END_KINDS: PresenceKind[] = ["check_out", "mobile_work_end", "business_trip_end"];
export const OT_KINDS: PresenceKind[] = ["ot_in", "ot_out"];

export function isSessionStart(kind: PresenceKind): boolean { return SESSION_START_KINDS.includes(kind); }
export function isSessionEnd(kind: PresenceKind): boolean { return SESSION_END_KINDS.includes(kind); }
export function isOtKind(kind: PresenceKind): boolean { return OT_KINDS.includes(kind); }

/** Optional punch-type groups a tenant can enable; the core four are always on. */
export type PunchTypeGroup = "ot" | "mobile_work" | "business_trip";

export const PUNCH_KIND_LABEL: Record<PresenceKind, string> = {
  check_in: "Check in",
  check_out: "Check out",
  break_start: "Break start",
  break_end: "Break end",
  ot_in: "OT in",
  ot_out: "OT out",
  mobile_work_start: "Mobile work start",
  mobile_work_end: "Mobile work end",
  business_trip_start: "Business trip start",
  business_trip_end: "Business trip end",
};

/** Which optional group a kind belongs to (undefined = always-on core kind). */
export const PUNCH_KIND_GROUP: Partial<Record<PresenceKind, PunchTypeGroup>> = {
  ot_in: "ot", ot_out: "ot",
  mobile_work_start: "mobile_work", mobile_work_end: "mobile_work",
  business_trip_start: "business_trip", business_trip_end: "business_trip",
};

export type PresenceEvent = {
  id: string;
  employee_id: string;
  ts: string; // ISO timestamptz
  kind: PresenceKind;
  source: PresenceSource;
  site_id: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_accuracy_m: number | null;
  within_geofence: boolean | null;
  selfie_path: string | null;
  flags: Record<string, unknown>;
  superseded_by: string | null;
};

export type CorrectionIssue = "missing_check_in" | "missing_check_out" | "wrong_time" | "other";
export type CorrectionStatus = "pending" | "approved" | "rejected";

export type WfmCorrectionRequest = {
  id: string;
  employee_id: string;
  target_date: string; // YYYY-MM-DD
  target_event_id: string | null;
  requested_change: { issue: CorrectionIssue; proposed_ts?: string; kind?: PresenceKind };
  reason_text: string;
  status: CorrectionStatus;
  supervisor_remark: string | null;
  resolved_at: string | null;
  created_at: string;
};

// Employee-initiated leave requests (0064) -- same request/approve shape as
// corrections above; approving inserts a real wfm_leave_records row rather
// than editing anything in place (see 0064's own header comment).
export type LeaveRequestStatus = "pending" | "approved" | "rejected";

export type WfmLeaveRequest = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  date_from: string; // YYYY-MM-DD
  date_to: string;
  half_day: boolean;
  reason_text: string;
  status: LeaveRequestStatus;
  supervisor_remark: string | null;
  resolved_at: string | null;
  leave_record_id: string | null;
  created_at: string;
};

// Overtime sessions (0077). One row per completed ot_in→ot_out pair,
// created when the employee punches OT out. Pay is hour-wise on ACTUAL
// minutes (no rounding, per client), at the tenant's flat ot_rate_per_hour,
// and ONLY once a supervisor approves -- pending/rejected OT is visible to
// everyone but never counted into payable hours or cost.
export type OtSessionStatus = "pending" | "approved" | "rejected";

export type WfmOtSession = {
  id: string;
  employee_id: string;
  /** Shift-day the OT session STARTED on (tenant tz) -- an OT stretch that
   * runs past midnight stays on its start day, so "worked all night" is one
   * payable block rather than two half-days. */
  ot_date: string; // YYYY-MM-DD
  start_event_id: string | null;
  end_event_id: string | null;
  started_at: string;
  ended_at: string;
  minutes: number;
  status: OtSessionStatus;
  supervisor_remark: string | null;
  resolved_at: string | null;
  created_at: string;
};

// Supervisor-initiated recheck requests (0072) -- the other direction from
// corrections above: a supervisor flags a punch/day and the employee
// responds. linked_correction_id is set when the employee's response was
// to file an actual correction (see /api/wfm/corrections' recheck_request_id).
export type RecheckType = "time" | "selfie" | "both";
export type RecheckStatus = "pending" | "responded" | "resolved" | "dismissed";

export type WfmRecheckRequest = {
  id: string;
  employee_id: string;
  target_date: string; // YYYY-MM-DD
  target_event_id: string | null;
  recheck_type: RecheckType;
  supervisor_id: string;
  message: string;
  status: RecheckStatus;
  employee_response_text: string | null;
  employee_responded_at: string | null;
  linked_correction_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

// ── Punch state machine ───────────────────────────────────────────────────
//   out → in → [break ↔ in]* → out          (regular / mobile / trip work)
//   out → ot → out                          (overtime)
//
// OT is reachable ONLY from `out`, which is what enforces the client's rule
// "OT can happen anytime but not between check-in and check-out" -- there is
// no transition into `ot` from `in` or `break`, so it can't be nested inside
// a shift. Structural, not a runtime validation that could be forgotten.

export type PunchState = "out" | "in" | "break" | "ot";

const TRANSITIONS: Record<PunchState, Partial<Record<PresenceKind, PunchState>>> = {
  out:   { check_in: "in", mobile_work_start: "in", business_trip_start: "in", ot_in: "ot" },
  in:    { break_start: "break", check_out: "out", mobile_work_end: "out", business_trip_end: "out" },
  break: { break_end: "in", check_out: "out", mobile_work_end: "out", business_trip_end: "out" },
  ot:    { ot_out: "out" },
};

export function allowedKinds(state: PunchState): PresenceKind[] {
  return Object.keys(TRANSITIONS[state]) as PresenceKind[];
}

/** The current state implied by the most recent non-superseded punch. Shared
 * by the punch API and the /wfm/me bootstrap so both agree on what the
 * employee may do next. */
export function stateFromLastKind(kind: PresenceKind | null): PunchState {
  if (!kind) return "out";
  if (kind === "break_start") return "break";
  if (kind === "ot_in") return "ot";
  if (kind === "break_end" || isSessionStart(kind)) return "in";
  return "out";
}

/** Next state after applying `kind`, or null if the transition is illegal. */
export function applyPunch(state: PunchState, kind: PresenceKind): PunchState | null {
  return TRANSITIONS[state][kind] ?? null;
}

/** Fold a day's non-superseded events (ascending ts) into the current state. */
export function deriveState(events: Pick<PresenceEvent, "kind">[]): PunchState {
  let state: PunchState = "out";
  for (const e of events) {
    state = applyPunch(state, e.kind) ?? state;
  }
  return state;
}
