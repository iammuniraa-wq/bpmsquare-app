// The read-only tool adapters of the Attendance agent (design 3.4). `(ctx, args) => ToolResult`:
//  - the tenant is never an argument (whoever built `reads` closed over it);
//  - an alias the model passes is checked against the run's candidate set; a foreign alias is a tool error, not data;
//  - results are aliased, size-capped, and carry no name, code, id, coordinate or free-text reason.
// Nothing here reads a table: everything comes through the injected `AttendanceReads`.

import { loadSiteFacts } from "./adapters";
import type { AliasMap } from "./alias";
import { addDays, weekdayOf } from "./dates";
import { detectCandidates, siteDayRows, type DetectOptions } from "./detectors";
import { buildDigest, type SiteDigest } from "./digest";
import type { AttendanceReads, SiteFacts, ViewerScope } from "./facts";
import type { ToolResult, ToolSpec } from "./contract";

/** About 6k tokens (design 3.4 rule 3). */
export const RESULT_CHAR_CAP = 24_000;

export const ATTENDANCE_TOOLS: ToolSpec[] = [
  { key: "attendance_site_digest", description: "The digest for this run's site: per-day counts and the plain-rule candidates. Prefetched as step s1.", args: { type: "object", properties: {}, additionalProperties: false } },
  {
    key: "attendance_person_history",
    description: "Per-day records for ONE person named in a candidate (late, missing check-out, absent, leave, holiday, week-off). Alias only.",
    args: { type: "object", required: ["alias"], properties: { alias: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 21 } }, additionalProperties: false },
  },
  {
    key: "attendance_site_baseline",
    description: "Present-to-expected ratio per weekday at this site over the last weeks before the run window.",
    args: { type: "object", properties: { weeks: { type: "integer", minimum: 1, maximum: 8 } }, additionalProperties: false },
  },
  {
    key: "attendance_roster_context",
    description: "Shift start, grace, how many were expected, who had a week-off by employment type, and whether it was a holiday, for one day of the window.",
    args: { type: "object", required: ["date"], properties: { date: { type: "string" } }, additionalProperties: false },
  },
  {
    key: "attendance_punch_flags",
    description: "Counts of punch flags by kind and distance bucket for the site, or for one person named in a candidate. Never coordinates.",
    args: { type: "object", properties: { alias: { type: "string" } }, additionalProperties: false },
  },
];

export type ToolCtx = {
  reads: AttendanceReads;
  run: { siteId: string; from: string; to: string; today?: string | null };
  /** The run's alias map (also what crew_runs.alias_map stores). Grows only when new people are read. */
  aliases: AliasMap;
  detect: DetectOptions;
  /** A supervisor's own "Run now" is read through their scope; the scheduled run passes null. */
  viewerScope?: ViewerScope | null;
};

export type ToolSession = {
  ctx: ToolCtx;
  facts(): Promise<ToolResult<{ facts: SiteFacts; aliases: AliasMap; siteAlias: string }>>;
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
};

const fail = (error: string): ToolResult<never> => ({ ok: false, error });

function capped<T>(data: T): ToolResult<T> {
  return JSON.stringify(data).length > RESULT_CHAR_CAP ? fail("result_too_large") : { ok: true, data };
}

export function createToolSession(ctx: ToolCtx): ToolSession {
  let loaded: Promise<ToolResult<{ facts: SiteFacts; aliases: AliasMap; siteAlias: string }>> | null = null;
  const facts = () =>
    (loaded ??= loadSiteFacts(ctx.reads, { ...ctx.run, viewerScope: ctx.viewerScope, aliases: ctx.aliases }));

  const candidateAliases = async (): Promise<ToolResult<Set<string>>> => {
    const f = await facts();
    if (!f.ok) return f;
    const set = new Set<string>();
    for (const c of detectCandidates(f.data.facts, ctx.detect)) for (const m of c.members) set.add(m);
    return { ok: true, data: set };
  };

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const f = await facts();
    if (!f.ok) return f;
    const { facts: sf } = f.data;

    switch (name) {
      case "attendance_site_digest": {
        const digest: SiteDigest = buildDigest(sf, detectCandidates(sf, ctx.detect));
        return capped(digest);
      }
      case "attendance_person_history": {
        const alias = typeof args.alias === "string" ? args.alias : "";
        const allowed = await candidateAliases();
        if (!allowed.ok) return allowed;
        if (!allowed.data.has(alias)) return fail("unknown_alias");
        const person = sf.people.find((p) => p.alias === alias);
        if (!person) return fail("unknown_alias");
        const n = Math.min(21, Math.max(1, Math.trunc(Number(args.days) || 14)));
        return capped({ alias, type: person.type, days: person.days.slice(-n) });
      }
      case "attendance_site_baseline": {
        const weeks = Math.min(8, Math.max(1, Math.trunc(Number(args.weeks) || 4)));
        const to = addDays(ctx.run.from, -1);
        const from = addDays(ctx.run.from, -7 * weeks);
        const base = await loadSiteFacts(ctx.reads, { siteId: ctx.run.siteId, from, to, viewerScope: ctx.viewerScope, aliases: f.data.aliases });
        if (!base.ok) return base;
        const rows = siteDayRows(base.data.facts);
        const byWeekday = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
          const days = rows.filter((r) => r.weekday === wd && r.rostered > 0);
          const rostered = days.reduce((n, r) => n + r.rostered, 0);
          const present = days.reduce((n, r) => n + Math.min(r.present, r.rostered), 0);
          return { weekday: wd, days: days.length, avg_expected: days.length ? Math.round((rostered / days.length) * 10) / 10 : 0, present_pct: rostered ? Math.round((present / rostered) * 100) : null };
        });
        return capped({ from, to, weeks, by_weekday: byWeekday });
      }
      case "attendance_roster_context": {
        const date = typeof args.date === "string" ? args.date : "";
        if (!sf.run.dates.includes(date)) return fail("date_outside_window");
        const row = siteDayRows(sf).find((r) => r.date === date)!;
        const weekOffByType: Record<string, number> = {};
        let holiday = false;
        for (const p of sf.people) {
          const d = p.days.find((x) => x.date === date);
          if (!d) continue;
          if (d.week_off) weekOffByType[p.type] = (weekOffByType[p.type] ?? 0) + 1;
          if (d.holiday) holiday = true;
        }
        return capped({
          date, weekday: weekdayOf(date), shift_start: sf.site.shift_start, grace_minutes: sf.site.grace_minutes,
          expected: row.rostered, present: row.present, holiday, week_off_by_type: weekOffByType, rule_notes: sf.rule_notes,
        });
      }
      case "attendance_punch_flags": {
        const alias = typeof args.alias === "string" ? args.alias : null;
        let people = sf.people;
        if (alias) {
          const allowed = await candidateAliases();
          if (!allowed.ok) return allowed;
          if (!allowed.data.has(alias)) return fail("unknown_alias");
          people = sf.people.filter((p) => p.alias === alias);
        }
        const counts: Record<string, number> = {};
        const buckets: Record<string, number> = {};
        const days = new Set<string>();
        for (const p of people) {
          for (const fl of p.flags) {
            counts[fl.kind] = (counts[fl.kind] ?? 0) + 1;
            days.add(fl.date);
            if (fl.kind === "outside_geofence" && fl.bucket) buckets[fl.bucket] = (buckets[fl.bucket] ?? 0) + 1;
          }
        }
        return capped({ scope: alias ?? "site", people: alias ? 1 : people.filter((p) => p.flags.length > 0).length, days_with_flags: days.size, counts, outside_by_distance: buckets });
      }
      default:
        return fail("unknown_tool");
    }
  }

  return { ctx, facts, call };
}
