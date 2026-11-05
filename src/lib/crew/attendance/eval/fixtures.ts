// Turns a fixture into fake `AttendanceReads` and, through the REAL adapters and detectors, into the tool results the model
// would receive. No database, no network, no model. Used by the vitest suite and by the lead's `crew:eval` harness.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSiteFacts } from "../adapters";
import type { AliasMap } from "../alias";
import { addDays, dateRange, weekdayOf } from "../dates";
import { detectCandidates, type Candidate } from "../detectors";
import { buildDigest, type SiteDigest } from "../digest";
import type { AttendanceReads, PunchFlagRow, SiteFacts, SummaryDayLike, SummaryRowLike } from "../facts";
import { rulesFor } from "@/lib/wfm/typeRules";
import type { WfmTypeRules } from "@/lib/constants";
import type { EvalCase, FixtureInput } from "./types";

const idFor = (alias: string) => `emp-${alias.slice(1).padStart(4, "0")}`;
const siteIdFor = (alias: string) => `site-${alias.slice(1).padStart(4, "0")}`;

function minutesToHHMM(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function startMinutes(shiftStart: string): number {
  const [h, m] = shiftStart.split(":").map(Number);
  return h * 60 + m;
}

function configOf(input: FixtureInput) {
  return {
    timezone: "Asia/Kolkata",
    week_off_days: input.config.week_off_days,
    type_rules: (input.config.type_rules ?? {}) as Record<string, WfmTypeRules>,
    employment_types: [] as { code: string; label: string }[],
  };
}

/** Summary rows exactly as getSummaryForRange would return them for this fixture (rules applied per date). */
export function summaryRowsOf(input: FixtureInput): SummaryRowLike[] {
  const dates = dateRange(input.run.from, input.run.to)!;
  const config = configOf(input);
  const holidays = new Set(input.holidays ?? []);
  const start = startMinutes(input.site.shift_start);
  return input.people.map((p) => ({
    employee_id: idFor(p.alias),
    employment_type: p.type,
    shift_name: input.site.shift_label ?? null,
    site_id: siteIdFor(input.site.alias),
    days: dates.map((date): SummaryDayLike => {
      const weekOff = rulesFor(p.type, config, date).week_off_days.includes(weekdayOf(date));
      const holiday = holidays.has(date);
      const code = p.days?.[date];
      const onLeave = code === "V";
      const expected = !weekOff && !holiday && !onLeave;
      const base: SummaryDayLike = {
        date, first_in: null, late: false, absent: false, incomplete: false,
        on_leave: onLeave ? { name: "Leave", category: "paid", half_day: false } : null,
        holiday: holiday ? "Holiday" : null, is_week_off: weekOff, punches: 0, standard_minutes: expected ? 480 : 0,
      };
      const c = code ?? (expected ? "P" : "");
      if (c === "" || c === "V") return base;
      if (c === "A") return { ...base, absent: expected };
      if (c === "X" || c === "P") return { ...base, first_in: minutesToHHMM(start), punches: 2 };
      if (c === "XM") return { ...base, first_in: minutesToHHMM(start), punches: 1, incomplete: true };
      if (c === "M") return { ...base, first_in: minutesToHHMM(start), punches: 1, incomplete: true };
      const late = /^L(M?)(\d+)$/.exec(c);
      if (late) {
        return { ...base, first_in: minutesToHHMM(start + Number(late[2])), punches: late[1] ? 1 : 2, late: expected, incomplete: !!late[1] };
      }
      throw new Error(`unknown day code '${c}' for ${p.alias} on ${date}`);
    }),
  }));
}

export function punchFlagRowsOf(input: FixtureInput): PunchFlagRow[] {
  const out: PunchFlagRow[] = [];
  for (const p of input.people) {
    for (const f of p.flags ?? []) {
      const flags: PunchFlagRow["flags"] = [f.kind];
      if (f.low_accuracy && f.kind !== "low_accuracy") flags.push("low_accuracy");
      out.push({ employee_id: idFor(p.alias), date: f.date, flags, distance_bucket: f.bucket ?? null });
    }
  }
  return out;
}

export function readsFromInput(input: FixtureInput): AttendanceReads {
  const rows = summaryRowsOf(input);
  const flags = punchFlagRowsOf(input);
  const siteId = siteIdFor(input.site.alias);
  return {
    getConfig: async () => configOf(input),
    listSiteIds: async () => [siteId],
    getSite: async (id) => (id === siteId ? { id, radius_m: input.site.radius_m, shift_start: input.site.shift_start, grace_minutes: input.site.grace_minutes } : null),
    listSiteEmployeeIds: async () => input.people.map((p) => idFor(p.alias)),
    getSummaryForRange: async (_from, _to, ids) => rows.filter((r) => ids.includes(r.employee_id)),
    getPunchFlagsForRange: async (_from, _to, ids) => flags.filter((f) => ids.includes(f.employee_id)),
  };
}

/** The alias map that makes a fixture's own aliases (P4 ...) come out unchanged. */
export function aliasMapOf(input: FixtureInput): AliasMap {
  return {
    persons: Object.fromEntries(input.people.map((p) => [p.alias, idFor(p.alias)])),
    sites: { [input.site.alias]: siteIdFor(input.site.alias) },
  };
}

export type BuiltCase = { facts: SiteFacts; candidates: Candidate[]; digest: SiteDigest; toolResults: Record<string, unknown>; aliases: AliasMap };

/** Fixture -> facts -> candidates -> the digest, as step s1. */
export async function buildCase(c: EvalCase): Promise<BuiltCase> {
  const { input } = c;
  const aliases = aliasMapOf(input);
  const loaded = await loadSiteFacts(readsFromInput(input), {
    siteId: siteIdFor(input.site.alias), from: input.run.from, to: input.run.to, today: addDays(input.run.to, 1), aliases,
  });
  if (!loaded.ok) throw new Error(`fixture ${c.id}: ${loaded.error}`);
  const candidates = detectCandidates(loaded.data.facts, { sensitivity: input.run.sensitivity ?? "balanced" });
  const digest = buildDigest(loaded.data.facts, candidates);
  return { facts: loaded.data.facts, candidates, digest, toolResults: { s1: digest }, aliases: loaded.data.aliases };
}

/** Facts for an ad-hoc input (tests build small situations without a full case). */
export async function factsOf(input: FixtureInput): Promise<SiteFacts> {
  const loaded = await loadSiteFacts(readsFromInput(input), {
    siteId: siteIdFor(input.site.alias), from: input.run.from, to: input.run.to, today: addDays(input.run.to, 1), aliases: aliasMapOf(input),
  });
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.data.facts;
}

export const CASES_DIR = fileURLToPath(new URL("./cases", import.meta.url));

export function loadCases(dir: string = CASES_DIR): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as EvalCase);
}
