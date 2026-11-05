// Evaluation fixtures (design 7). A case is a fixed, invented, aliased week of attendance for one site plus what a good answer
// must and must not contain. No database and no model is needed to LOAD a case: the plain parts (facts, detectors, digest) are
// computed from `input` through the real adapters, and the model, when the harness runs it, receives that digest as step s1.
//
// Day codes (a person's `days` map holds exceptions only; an expected day with no entry is "P", a day nobody was expected
// to work with no entry is "no punch"):
//   P        on time, checked out            L<min>   late by <min> minutes, checked out
//   M        on time, no check-out           LM<min>  late and no check-out
//   A        absent on a day expected        V        full-day leave
//   X        punched in and out on a day nobody was expected to work (week-off work)   XM  the same, no check-out
// Whether a day is "expected" comes from rulesFor(type, config, date) and `holidays`: a Trainee's Sunday is a working day only
// from the rule's effective_from, exactly as in the monthly summary.

import type { AttendanceFamily, DistanceBucket, PunchFlagKind, Sensitivity } from "../facts";

export type FixturePunchFlag = { date: string; kind: PunchFlagKind; bucket?: DistanceBucket; low_accuracy?: boolean };

export type FixturePerson = {
  alias: string;
  type: string;
  days?: Record<string, string>;
  flags?: FixturePunchFlag[];
};

export type FixtureInput = {
  site: { alias: string; shift_start: string; grace_minutes: number; radius_m: number; shift_label?: string };
  run: { from: string; to: string; sensitivity?: Sensitivity };
  config: {
    week_off_days: number[];
    type_rules?: Record<string, { effective_from?: string; week_off_days?: number[] }>;
  };
  holidays?: string[];
  people: FixturePerson[];
};

export type MustFlag = {
  kind: AttendanceFamily;
  level: "site" | "person";
  /** Person alias for a person-level flag. */
  subject?: string;
  /** Fields of the matching candidate the finding must cite, e.g. "people_affected". */
  must_cite: string[];
};

export type MustNotFlag = {
  kind?: AttendanceFamily;
  level?: "site" | "person";
  subject?: string;
  reason: string;
};

export type ExpectedCandidate = { family: AttendanceFamily; level: "site" | "person"; subject?: string };

export type EvalCase = {
  id: string;
  tags: string[];
  description: string;
  input: FixtureInput;
  expect: {
    /** What the plain detectors must produce from `input` (tested in vitest, no model). */
    expected_candidates: ExpectedCandidate[];
    must_flag: MustFlag[];
    must_not_flag: MustNotFlag[];
    must_gap: string[];
    max_findings: number;
    /** 0 on every quiet, site-level, Trainee and adversarial case (the release gate). */
    max_person_findings: number;
    proposals: { allowed: ("wfm.recheck" | "site_note")[]; forbidden_target_aliases: string[] };
  };
};

export const CASE_TAGS = ["site-level", "person-level", "quiet", "trainee", "adversarial"] as const;
export type CaseTag = (typeof CASE_TAGS)[number];

/** Minimum number of cases per tag (design 7). */
export const MIN_CASES: Record<CaseTag, number> = { "site-level": 14, "person-level": 8, quiet: 10, trainee: 4, adversarial: 4 };
