import type { WfmConfig } from "@/lib/constants";
import type { WfmShift } from "@/lib/wfm/types";
import { WORKFORCE_TABS, type WorkforceTab } from "@/lib/settingsFolded";

// Pure rules behind Settings > Workforce (batch S5 of docs/design/settings-simplification.md). No React, so tests
// can hold the tab list, the save diff and the payloads without a browser.

export { WORKFORCE_TABS, type WorkforceTab };

export const TAB_LABEL: Record<WorkforceTab, string> = {
  rules: "Rules", shifts: "Shifts", places: "Places", leave: "Leave", alerts: "Alerts", billing: "Billing",
};

/** Billing exists only where project hours can be invoiced; every other workspace sees five tabs. */
export function workforceTabs(projectsOn: boolean): WorkforceTab[] {
  return WORKFORCE_TABS.filter((t) => t !== "billing" || projectsOn);
}

/** Every config key the screen edits. The list screens (shifts, places, leave types) have their own routes. */
export const CONFIG_KEYS = [
  "timezone", "week_off_days", "deduct_breaks", "late_marks_per_half_day", "punch_types", "ot_rate_per_hour",
  "selfie_mode", "selfie_retention_days", "face_punch", "face_login", "face_verification_mode", "passkey_login",
  "employee_self_service", "home_landing", "login_mode", "saturday_rule", "employment_types",
  "geofence_mode", "require_location", "leave_carry_forward",
  "long_day_alert", "break_alert", "holiday_week_alert", "notifications", "costing",
] as const satisfies readonly (keyof WfmConfig)[];

/**
 * Only the keys that differ from what is stored. The PUT route merges what it is given over the stored config, so
 * sending just the changed groups means one tab can never overwrite a setting it did not touch with a stale copy.
 * Costing is left out unless project billing is on, as before.
 */
export function changedConfig(saved: WfmConfig, draft: WfmConfig, projectsOn: boolean): Partial<WfmConfig> {
  const out: Record<string, unknown> = {};
  const next = { ...draft, employment_types: cleanEmploymentTypes(draft.employment_types, saved.employment_types.map((t) => t.code)) };
  for (const k of CONFIG_KEYS) {
    if (k === "costing" && !projectsOn) continue;
    if (JSON.stringify(saved[k]) !== JSON.stringify(next[k])) out[k] = next[k];
  }
  return out as Partial<WfmConfig>;
}

// ── Face: two stored keys, one choice. Sign-in by face needs a face enrolled, which only the tablet flow creates.
export type FaceMode = "off" | "tablet" | "tablet_signin";

export function faceMode(cfg: Pick<WfmConfig, "face_punch" | "face_login">): FaceMode {
  if (cfg.face_punch !== "kiosk") return "off";
  return cfg.face_login ? "tablet_signin" : "tablet";
}

export function withFaceMode(mode: FaceMode): Pick<WfmConfig, "face_punch" | "face_login"> {
  return { face_punch: mode === "off" ? "off" : "kiosk", face_login: mode === "tablet_signin" };
}

// ── Employment types: the label is what people edit; the code is made from it once and never changes.
export function slugCode(label: string, taken: readonly string[]): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "type";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** A new type with no label is what an abandoned "+ Add type" leaves behind, so it is dropped; a stored type keeps its code. */
export function cleanEmploymentTypes(types: WfmConfig["employment_types"], savedCodes: readonly string[]): WfmConfig["employment_types"] {
  const out: WfmConfig["employment_types"] = [];
  for (const t of types) {
    const label = t.label.trim();
    if (!label && !savedCodes.includes(t.code)) continue;
    out.push({ code: t.code, label: label || t.code });
  }
  return out;
}

// ── Alerts: eight stored switches shown as one grid. Supervisors are told when something is submitted, employees
// when it is decided; the clarification thread notifies whichever side did not post, so it is one switch for both.
export type AlertKey = keyof WfmConfig["notifications"];
export type AlertRow = { id: string; label: string; supervisor?: AlertKey; employee?: AlertKey; both?: AlertKey };

export const ALERT_ROWS: AlertRow[] = [
  { id: "late", label: "Late arrival", supervisor: "late_arrival" },
  { id: "correction", label: "Correction", supervisor: "correction_pending", employee: "correction_resolved" },
  { id: "leave", label: "Leave", supervisor: "leave_pending", employee: "leave_resolved" },
  { id: "advance", label: "Overtime or work-from-home request", supervisor: "advance_request_pending" },
  { id: "flagged", label: "Flagged punch", employee: "recheck_flagged" },
  { id: "clarify", label: "Clarification message", both: "clarification_message" },
];

export function alertCount(n: WfmConfig["notifications"]): { on: number; total: number } {
  const keys = ALERT_ROWS.flatMap((r) => [r.supervisor, r.employee, r.both]).filter((k): k is AlertKey => !!k);
  return { on: keys.filter((k) => n[k]).length, total: keys.length };
}

// ── Shifts
export type ShiftDraft = { name: string; start: string; end: string; grace: string; night: boolean; allowance: string; active: boolean };
export const hhmm = (t: string) => t.slice(0, 5);
export const blankShift = (): ShiftDraft => ({ name: "", start: "09:00", end: "18:00", grace: "10", night: false, allowance: "0", active: true });
export const shiftDraftFrom = (s: WfmShift): ShiftDraft => ({
  name: s.name, start: hhmm(s.start_time), end: hhmm(s.end_time), grace: String(s.grace_minutes),
  night: s.is_night_shift, allowance: String(s.night_allowance_amount), active: s.active,
});
export function shiftProblem(d: ShiftDraft): string | null {
  return d.name.trim() ? null : "Give the shift a name.";
}
export function shiftPayload(d: ShiftDraft, isNew: boolean) {
  const body = {
    name: d.name.trim(), start_time: d.start, end_time: d.end,
    grace_minutes: Math.max(0, parseInt(d.grace) || 0),
    is_night_shift: d.night, night_allowance_amount: d.night ? Math.max(0, parseFloat(d.allowance) || 0) : 0,
  };
  return isNew ? body : { ...body, active: d.active };
}

// ── Leave types
export type LeaveCategory = "paid" | "unpaid" | "half_day";
export type LeaveType = {
  id: string; name: string; category: LeaveCategory; active: boolean; annual_quota: number; quota_period: "year" | "month";
  monthly_limit: number | null; paid_days_per_month: number | null;
  records_count: number; requests_count: number; pending_requests: number;
};
export type LeaveDraft = { name: string; category: LeaveCategory; quota: string; per: "year" | "month"; maxMonth: string; paidDays: string; active: boolean };
export const CATEGORY_LABEL: Record<LeaveCategory, string> = { paid: "Paid", unpaid: "Unpaid", half_day: "Half-day" };
export const blankLeave = (): LeaveDraft => ({ name: "", category: "paid", quota: "1", per: "month", maxMonth: "", paidDays: "", active: true });
export const leaveDraftFrom = (t: LeaveType): LeaveDraft => ({
  name: t.name, category: t.category, quota: String(t.annual_quota), per: t.quota_period ?? "year",
  maxMonth: t.monthly_limit === null ? "" : String(t.monthly_limit),
  paidDays: t.paid_days_per_month === null ? "" : String(t.paid_days_per_month), active: t.active,
});
export function leaveProblem(d: LeaveDraft): string | null {
  return d.name.trim() ? null : "Give the leave type a name.";
}
export function leavePayload(d: LeaveDraft, isNew: boolean) {
  const body = {
    name: d.name.trim(), category: d.category, annual_quota: parseFloat(d.quota) || 0, quota_period: d.per,
    // A per-month quota is already the monthly cap, so a separate cap only applies to a yearly quota.
    monthly_limit: d.per === "month" || d.maxMonth.trim() === "" ? null : parseFloat(d.maxMonth),
    paid_days_per_month: d.paidDays.trim() === "" ? null : parseFloat(d.paidDays),
  };
  return isNew ? body : { ...body, active: d.active };
}
export const leaveInUse = (t: Pick<LeaveType, "records_count" | "requests_count">) => t.records_count + t.requests_count;
export function leaveUsage(t: LeaveType): string {
  const parts: string[] = [];
  if (t.records_count) parts.push(`${t.records_count} record${t.records_count === 1 ? "" : "s"}`);
  if (t.requests_count) parts.push(`${t.requests_count} request${t.requests_count === 1 ? "" : "s"}`);
  const base = parts.join(", ");
  return t.pending_requests ? `${base} (${t.pending_requests} pending)` : base;
}

// ── Sites
export type SiteDraft = { name: string; lat: string; lng: string; radius: string; supervisorId: string; approverIds: string[]; active: boolean };
export const blankSite = (): SiteDraft => ({ name: "", lat: "", lng: "", radius: "150", supervisorId: "", approverIds: [], active: true });
export function siteProblem(d: SiteDraft): string | null {
  if (!d.name.trim()) return "Give the site a name.";
  if (isNaN(parseFloat(d.lat)) || isNaN(parseFloat(d.lng))) return "Pick the location: click the map, or type the latitude and longitude.";
  return null;
}
export function sitePayload(d: SiteDraft, isNew: boolean) {
  const body = {
    name: d.name.trim(), lat: parseFloat(d.lat), lng: parseFloat(d.lng), radius_m: parseInt(d.radius) || 150,
    supervisor_id: d.supervisorId || null,
    // The site's own supervisor already approves, so listing them as an extra approver would invite removing them here
    // and assuming it took effect.
    approver_ids: d.approverIds.filter((id) => id !== d.supervisorId),
  };
  return isNew ? body : { ...body, active: d.active };
}
