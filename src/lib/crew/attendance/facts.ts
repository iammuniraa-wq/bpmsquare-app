// The shapes of attendance facts. Two layers on purpose:
//   1. the READ layer (`AttendanceReads` and the *Like row types): what the lead's runner injects over the existing
//      tenant-scoped WFM readers (getSummaryForRange, getPunchFlagsForRange, ...). Real ids live only here.
//   2. the FACT layer (`SiteFacts`): what plain code and the model see. Every person is an alias; there is no name, code,
//      id, e-mail, phone, selfie path, coordinate or free-text reason anywhere in it (design 5.3 and 5.4).

import type { WfmConfig } from "@/lib/constants";

export const ATTENDANCE_FAMILIES = ["late_cluster", "missing_out_cluster", "far_punches"] as const;
export type AttendanceFamily = (typeof ATTENDANCE_FAMILIES)[number];

export type Sensitivity = "quiet" | "balanced" | "thorough";

/** Distance of a flagged punch from the site, as a multiple of the site radius (design 5.3). Never coordinates. */
export const DISTANCE_BUCKETS = ["<1.5x", "1.5-3x", ">3x"] as const;
export type DistanceBucket = (typeof DISTANCE_BUCKETS)[number];

export type PunchFlagKind = "outside_geofence" | "no_location" | "low_accuracy" | "face_mismatch" | "selfie_required";

// ── READ layer ───────────────────────────────────────────────────────────────

/** Structurally a subset of EmployeeDayRecord (src/lib/wfm/monthlySummary.ts), so getSummaryForRange rows fit as they are. */
export type SummaryDayLike = {
  date: string;
  first_in: string | null;
  late: boolean;
  absent: boolean;
  incomplete: boolean;
  on_leave: { name: string; category: string; half_day: boolean } | null;
  holiday: string | null;
  is_week_off: boolean;
  punches: number;
  standard_minutes: number;
};

/** Structurally a subset of EmployeeMonthSummary. Names and codes are deliberately not part of this type. */
export type SummaryRowLike = {
  employee_id: string;
  employment_type: string;
  shift_name?: string | null;
  site_id: string | null;
  days: SummaryDayLike[];
};

/** One row per flagged punch. The lead's getPunchFlagsForRange supplies a bucket, or a distance and radius to bucket. */
export type PunchFlagRow = {
  employee_id: string;
  /** Shift-day, YYYY-MM-DD. */
  date: string;
  flags: PunchFlagKind[];
  distance_bucket?: DistanceBucket | null;
  distance_m?: number | null;
  radius_m?: number | null;
};

export type SiteInfoLike = {
  id: string;
  radius_m: number;
  /** "HH:MM" when the site's standing shift is known. */
  shift_start?: string | null;
  grace_minutes?: number | null;
};

export type AttendanceConfigLike = Pick<WfmConfig, "timezone" | "week_off_days" | "type_rules"> & {
  employment_types?: { code: string; label: string }[];
};

/**
 * Every function is tenant-scoped by whoever builds it (the tenant id is closed over, never an argument), and none is
 * allowed to return a name. Adapters never call `.from`; they only call these (adapters.test.ts greps for it).
 */
export interface AttendanceReads {
  getConfig(): Promise<AttendanceConfigLike>;
  listSiteIds(): Promise<string[]>;
  getSite(siteId: string): Promise<SiteInfoLike | null>;
  /** People homed or rostered at the site over the range. */
  listSiteEmployeeIds(siteId: string, from: string, to: string): Promise<string[]>;
  getSummaryForRange(from: string, to: string, employeeIds: string[]): Promise<SummaryRowLike[] | null>;
  getPunchFlagsForRange(from: string, to: string, employeeIds: string[]): Promise<PunchFlagRow[]>;
}

/** resolveWfmScope's result, reduced to what the engine needs (src/lib/wfm/scope.ts WfmScope). */
export type ViewerScope = {
  unrestricted: boolean;
  employeeIds: string[] | null;
  siteIds: string[];
};

// ── FACT layer ───────────────────────────────────────────────────────────────

export type DayFact = {
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  /** Expected to work: has a shift, not a week-off, not a holiday, not on a full leave day. */
  expected: boolean;
  present: boolean;
  late: boolean;
  late_minutes: number | null;
  /** A check-in with no check-out on a past day. */
  missing_out: boolean;
  absent: boolean;
  on_leave: boolean;
  holiday: boolean;
  week_off: boolean;
  /** The day record and rulesFor() disagree about this person's week-off. Such a day is never judged. */
  rule_conflict: boolean;
};

export type PunchFlagFact = {
  date: string;
  kind: PunchFlagKind;
  bucket: DistanceBucket | null;
  /** On an outside_geofence fact: the same punch also carried low_accuracy (a weak GPS fix). */
  low_accuracy?: boolean;
};

export type PersonFacts = {
  /** "P1".."Pn", per run. */
  alias: string;
  /** Employment-type code (not personal). */
  type: string;
  days: DayFact[];
  flags: PunchFlagFact[];
};

export type RuleNote = {
  type: string;
  effective_from: string | null;
  /** The weekly-off days the type follows on and after effective_from (or all the time when there is no date). */
  week_off_days: number[];
  /** What it followed before effective_from, i.e. the workspace value. */
  week_off_days_before: number[];
};

export type SiteFacts = {
  site: {
    alias: string;
    shift_start: string | null;
    grace_minutes: number | null;
    radius_m: number;
    /** Free text typed by an admin: data, never instructions. */
    shift_label_untrusted: string | null;
  };
  run: { from: string; to: string; dates: string[]; today: string | null };
  rule_notes: RuleNote[];
  people: PersonFacts[];
};
