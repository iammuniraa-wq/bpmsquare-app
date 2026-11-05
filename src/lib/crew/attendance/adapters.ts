// Fact adapters: read a workspace's attendance for a site and a date range THROUGH INJECTED READS and return aliased facts.
//
// Rules (design 3.4): this file never reads a table itself (adapters.test.ts greps the folder for a database call), the
// tenant is never an argument (whoever builds `reads` closed over it), and personal data is removed here: from here on
// there is an alias, a type code, dates and flags, nothing else.

import { rulesFor } from "@/lib/wfm/typeRules";
import { assignAliases, aliasOf, emptyAliasMap, type AliasMap } from "./alias";
import { dateRange, minutesAfterStart, weekdayOf } from "./dates";
import { scopeEmployeeIds, canViewSite } from "./scope";
import type {
  AttendanceConfigLike,
  AttendanceReads,
  DayFact,
  DistanceBucket,
  PersonFacts,
  PunchFlagFact,
  PunchFlagRow,
  RuleNote,
  SiteFacts,
  SummaryRowLike,
  ViewerScope,
} from "./facts";
import type { ToolResult } from "./contract";

export const MAX_WINDOW_DAYS = 62;
const MAX_PEOPLE_PER_SITE = 400;

/** Distance as a multiple of the radius, in the three buckets of design 5.3. */
export function bucketOf(distanceM: number | null | undefined, radiusM: number | null | undefined): DistanceBucket | null {
  if (distanceM == null || radiusM == null || !(radiusM > 0) || !Number.isFinite(distanceM)) return null;
  const ratio = distanceM / radiusM;
  if (ratio < 1.5) return "<1.5x";
  if (ratio <= 3) return "1.5-3x";
  return ">3x";
}

function cleanLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return s || null;
}

/**
 * The rule check that keeps a day from being judged by the wrong rule. The summary row already applied rulesFor() for the
 * day's date (so a type's rule starts at its effective_from and earlier days keep the workspace rule); this recomputes it
 * and flags a disagreement. A second Saturday off is the one thing rulesFor() does not know, so a Saturday where only
 * the record says "off" is not a conflict.
 */
export function weekOffConflict(
  type: string,
  date: string,
  recordSaysWeekOff: boolean,
  config: Pick<AttendanceConfigLike, "type_rules" | "week_off_days">
): boolean {
  const weekday = weekdayOf(date);
  const ruleSaysOff = rulesFor(type, config, date).week_off_days.includes(weekday);
  if (ruleSaysOff && !recordSaysWeekOff) return true;
  if (!ruleSaysOff && recordSaysWeekOff && weekday !== 6) return true;
  return false;
}

export function ruleNotesFor(types: string[], config: Pick<AttendanceConfigLike, "type_rules" | "week_off_days">): RuleNote[] {
  const out: RuleNote[] = [];
  for (const type of [...new Set(types)].sort()) {
    const configured = rulesFor(type, config, null);
    if (configured.source.week_off_days !== "type") continue;
    out.push({
      type,
      effective_from: config.type_rules?.[type]?.effective_from ?? null,
      week_off_days: configured.week_off_days,
      week_off_days_before: rulesFor(type, config, "0000-01-01").week_off_days,
    });
  }
  return out;
}

function dayFact(
  d: SummaryRowLike["days"][number],
  type: string,
  config: AttendanceConfigLike,
  shiftStart: string | null
): DayFact {
  const conflict = weekOffConflict(type, d.date, d.is_week_off, config);
  const fullLeave = !!d.on_leave && !d.on_leave.half_day;
  const halfLeave = !!d.on_leave && d.on_leave.half_day;
  const holiday = d.holiday !== null && d.holiday !== undefined;
  const expected = !conflict && !d.is_week_off && !holiday && !fullLeave && d.standard_minutes > 0;
  const present = d.punches > 0 || !!d.first_in;
  // late and absent are only judged on a day the person was expected to work; a half-day leave day can start late.
  const late = d.late && expected && !halfLeave;
  return {
    date: d.date,
    weekday: weekdayOf(d.date),
    expected,
    present,
    late,
    late_minutes: late ? minutesAfterStart(d.first_in, shiftStart, config.timezone) : null,
    missing_out: d.incomplete && !conflict,
    absent: d.absent && expected,
    on_leave: fullLeave,
    holiday,
    week_off: d.is_week_off,
    rule_conflict: conflict,
  };
}

function flagFacts(rows: PunchFlagRow[], employeeId: string, dates: Set<string>): PunchFlagFact[] {
  const out: PunchFlagFact[] = [];
  for (const r of rows) {
    if (r.employee_id !== employeeId || !dates.has(r.date)) continue;
    const lowAccuracy = r.flags.includes("low_accuracy");
    for (const kind of new Set(r.flags)) {
      const fact: PunchFlagFact = {
        date: r.date,
        kind,
        bucket: kind === "outside_geofence" ? r.distance_bucket ?? bucketOf(r.distance_m, r.radius_m) : null,
      };
      if (kind === "outside_geofence") fact.low_accuracy = lowAccuracy;
      out.push(fact);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind < b.kind ? -1 : 1));
}

export type LoadedSite = { facts: SiteFacts; aliases: AliasMap; siteAlias: string };

/**
 * Facts for one site over [from, to]. `viewerScope` is null for the scheduled run (system) and the viewer's
 * resolveWfmScope() for a supervisor's "Run now", in which case people and sites outside it are never read.
 */
export async function loadSiteFacts(
  reads: AttendanceReads,
  args: { siteId: string; from: string; to: string; today?: string | null; viewerScope?: ViewerScope | null; aliases?: AliasMap }
): Promise<ToolResult<LoadedSite>> {
  const dates = dateRange(args.from, args.to, MAX_WINDOW_DAYS);
  if (!dates) return { ok: false, error: "invalid_range" };
  const scope = args.viewerScope ?? null;
  if (!canViewSite(args.siteId, scope)) return { ok: false, error: "out_of_scope" };

  const [config, site] = await Promise.all([reads.getConfig(), reads.getSite(args.siteId)]);
  if (!site) return { ok: false, error: "unknown_site" };

  const candidateIds = await reads.listSiteEmployeeIds(args.siteId, args.from, args.to);
  const ids = scopeEmployeeIds(candidateIds, scope).slice(0, MAX_PEOPLE_PER_SITE);
  const idSet = new Set(ids);

  const [rows, flagRows] = ids.length
    ? await Promise.all([reads.getSummaryForRange(args.from, args.to, ids), reads.getPunchFlagsForRange(args.from, args.to, ids)])
    : [[] as SummaryRowLike[], [] as PunchFlagRow[]];
  if (rows === null) return { ok: false, error: "summary_unavailable" };

  // Defence in depth: whatever the reads returned, only people we asked for stay.
  const kept = rows.filter((r) => idSet.has(r.employee_id));
  let aliases = args.aliases ?? emptyAliasMap();
  aliases = assignAliases(aliases, "site", [args.siteId]);
  aliases = assignAliases(aliases, "person", kept.map((r) => r.employee_id));

  const dateSet = new Set(dates);
  const people: PersonFacts[] = kept
    .map((row) => ({
      alias: aliasOf(aliases, "person", row.employee_id) as string,
      type: row.employment_type,
      days: row.days
        .filter((d) => dateSet.has(d.date))
        .map((d) => dayFact(d, row.employment_type, config, site.shift_start ?? null))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
      flags: flagFacts(flagRows, row.employee_id, dateSet),
    }))
    .sort((a, b) => Number(a.alias.slice(1)) - Number(b.alias.slice(1)));

  const label = cleanLabel(kept.map((r) => r.shift_name).find((n) => !!n) ?? null);
  const siteAlias = aliasOf(aliases, "site", args.siteId) as string;
  return {
    ok: true,
    data: {
      aliases,
      siteAlias,
      facts: {
        site: {
          alias: siteAlias,
          shift_start: site.shift_start ?? null,
          grace_minutes: site.grace_minutes ?? null,
          radius_m: site.radius_m,
          shift_label_untrusted: label,
        },
        run: { from: args.from, to: args.to, dates, today: args.today ?? null },
        rule_notes: ruleNotesFor(people.map((p) => p.type), config),
        people,
      },
    },
  };
}
