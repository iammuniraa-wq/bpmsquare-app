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

export type WfmEmploymentType = "full_time" | "contractor";
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

export type PresenceKind = "check_in" | "check_out" | "break_start" | "break_end";
export type PresenceSource = "web_selfie" | "manual_admin" | "correction";

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

// ── Punch state machine: out → in → [break ↔ in]* → out ──────────────────

export type PunchState = "out" | "in" | "break";

const TRANSITIONS: Record<PunchState, Partial<Record<PresenceKind, PunchState>>> = {
  out:   { check_in: "in" },
  in:    { break_start: "break", check_out: "out" },
  break: { break_end: "in", check_out: "out" },
};

export function allowedKinds(state: PunchState): PresenceKind[] {
  return Object.keys(TRANSITIONS[state]) as PresenceKind[];
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
