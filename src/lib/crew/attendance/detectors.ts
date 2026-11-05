// The plain detectors (design 5.3). Pure functions over aliased SiteFacts: no model, no database, no clock.
// A detector outputs CANDIDATES; the model triages them. A person is never named by a candidate unless the same pattern
// is not already explained by the whole site, which is what keeps "a site-level cause is more likely than a personal one"
// a rule of the code and not a hope about the prompt.
//
// Rules by employment type are honoured through the facts: `expected`, `week_off` and `rule_conflict` come from the day
// records (which applied rulesFor() for each date, so a rule starts at its effective_from and earlier days keep the
// workspace rule) cross-checked in adapters.ts. Nothing here knows what a Sunday is.

import { weekdayOf } from "./dates";
import { thresholdsFor, type Thresholds } from "./thresholds";
import { ATTENDANCE_FAMILIES, type AttendanceFamily, type DayFact, type DistanceBucket, type PersonFacts, type Sensitivity, type SiteFacts } from "./facts";

export type Candidate = {
  id: string;
  family: AttendanceFamily;
  level: "site" | "person";
  /** Site alias. */
  site: string;
  /** Person alias, person-level only. */
  person: string | null;
  /** Person-level: the person. Site-level missing-out only: the people a recheck list may target. Otherwise empty. */
  members: string[];
  /** Employment-type code, person-level only. */
  type: string | null;
  /** Dates the pattern is made of. */
  days: string[];
  /** Site-level: distinct people involved. Person-level: 1. */
  people_affected: number;
  /** Site-level late / missing-out: the largest number expected (late) or present (missing-out) on one of those days. */
  headcount: number;
  /** Person-level: the person's own count after the days the whole site explains are taken out. */
  count: number;
  /** The window the count was taken over, in shift-days. */
  window_days: number;
  /** Person-level: how many of the person's marks fell on days the site showed the same thing (taken out of `count`). */
  site_explained_days: number;
  /** Site-level only: true. Person-level: false by construction (a candidate exists only when the site does not explain it). */
  site_pattern: boolean;
  person_eligible: boolean;
  /** Late: the middle late-by in minutes over the marks, when known. */
  median_late_minutes: number | null;
  weekdays: number[];
  /** Site-level: affected people per employment type. */
  by_type: Record<string, number>;
  /** Far punches only. */
  buckets: Record<DistanceBucket, number> | null;
  low_accuracy_count: number;
};

export type SiteDayRow = {
  date: string;
  weekday: number;
  rostered: number;
  present: number;
  late: number;
  missing_out: number;
  outside: number;
};

const usable = (d: DayFact) => !d.rule_conflict;

export function siteDayRows(facts: SiteFacts): SiteDayRow[] {
  return facts.run.dates.map((date) => {
    let rostered = 0, present = 0, late = 0, missing = 0, outside = 0;
    for (const p of facts.people) {
      const d = p.days.find((x) => x.date === date);
      if (d && usable(d)) {
        if (d.expected) rostered++;
        if (d.present) present++;
        if (d.late) late++;
        if (d.missing_out) missing++;
      }
      outside += p.flags.filter((f) => f.date === date && f.kind === "outside_geofence").length;
    }
    
    return { date, weekday: weekdayOf(date), rostered, present, late, missing_out: missing, outside };
  });
}

const lastN = <T,>(a: T[], n: number): T[] => a.slice(Math.max(0, a.length - n));

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const uniq = <T,>(a: T[]) => [...new Set(a)];

type Blank = Omit<Candidate, "id" | "family" | "level" | "site">;
const blank = (): Blank => ({
  person: null, type: null, members: [], days: [], people_affected: 0, headcount: 0, count: 0, window_days: 0, site_explained_days: 0,
  site_pattern: false, person_eligible: false, median_late_minutes: null, weekdays: [], by_type: {}, buckets: null, low_accuracy_count: 0,
});

// ── late ────────────────────────────────────────────────────────────────────

function lateClusterDays(rows: SiteDayRow[], t: Thresholds["late"]): string[] {
  return rows.filter((r) => r.rostered > 0 && r.late >= t.siteDayMinPeople && r.late >= t.siteDayMinShare * r.rostered).map((r) => r.date);
}

function detectLate(facts: SiteFacts, t: Thresholds, rows: SiteDayRow[]): Omit<Candidate, "id">[] {
  const out: Omit<Candidate, "id">[] = [];
  const windowDates = lastN(facts.run.dates, t.late.personWindowDays);
  const inWin = new Set(windowDates);
  const clusterDays = lateClusterDays(rows.filter((r) => inWin.has(r.date)), t.late);

  if (clusterDays.length >= t.late.siteMinDays) {
    const lateDays = (p: PersonFacts) => p.days.filter((d) => clusterDays.includes(d.date) && d.late && usable(d));
    const involved = facts.people.filter((p) => lateDays(p).length > 0);
    const minutes = involved.flatMap((p) => lateDays(p).map((d) => d.late_minutes)).filter((m): m is number => m !== null);
    const byType: Record<string, number> = {};
    for (const p of involved) byType[p.type] = (byType[p.type] ?? 0) + 1;
    out.push({
      ...blank(), family: "late_cluster", level: "site", site: facts.site.alias, days: clusterDays, people_affected: involved.length,
      headcount: Math.max(...rows.filter((r) => clusterDays.includes(r.date)).map((r) => r.rostered)),
      window_days: windowDates.length, site_pattern: true, median_late_minutes: median(minutes),
      weekdays: uniq(clusterDays.map((d) => rows.find((r) => r.date === d)!.weekday)).sort(), by_type: byType,
    });
  }

  for (const p of facts.people) {
    const marks = p.days.filter((d) => inWin.has(d.date) && d.late && usable(d));
    const own = marks.filter((d) => !clusterDays.includes(d.date));
    if (own.length < t.late.personCount) continue;
    out.push({
      ...blank(), family: "late_cluster", level: "person", site: facts.site.alias, person: p.alias, type: p.type,
      days: own.map((d) => d.date), people_affected: 1, count: own.length, window_days: windowDates.length,
      site_explained_days: marks.length - own.length, person_eligible: true,
      median_late_minutes: median(own.map((d) => d.late_minutes).filter((m): m is number => m !== null)),
      weekdays: uniq(own.map((d) => d.weekday)).sort(),
    });
  }
  return out;
}

// ── missing check-out ───────────────────────────────────────────────────────

function missingClusterDays(rows: SiteDayRow[], t: Thresholds["missingOut"]): string[] {
  return rows.filter((r) => r.present > 0 && r.missing_out >= t.siteDayMinPeople && r.missing_out >= t.siteDayMinShare * r.present).map((r) => r.date);
}

function detectMissingOut(facts: SiteFacts, t: Thresholds, rows: SiteDayRow[]): Omit<Candidate, "id">[] {
  const out: Omit<Candidate, "id">[] = [];
  const windowDates = lastN(facts.run.dates, t.missingOut.personWindowDays);
  const inWin = new Set(windowDates);
  const clusterDays = missingClusterDays(rows.filter((r) => inWin.has(r.date)), t.missingOut);

  if (clusterDays.length >= t.missingOut.siteMinDays) {
    const involved = facts.people.filter((p) => p.days.some((d) => clusterDays.includes(d.date) && d.missing_out && usable(d)));
    const byType: Record<string, number> = {};
    for (const p of involved) byType[p.type] = (byType[p.type] ?? 0) + 1;
    out.push({
      ...blank(), family: "missing_out_cluster", level: "site", site: facts.site.alias, days: clusterDays, people_affected: involved.length, members: involved.map((p) => p.alias),
      headcount: Math.max(...rows.filter((r) => clusterDays.includes(r.date)).map((r) => r.present)),
      window_days: windowDates.length, site_pattern: true,
      weekdays: uniq(clusterDays.map((d) => rows.find((r) => r.date === d)!.weekday)).sort(), by_type: byType,
    });
  }

  for (const p of facts.people) {
    const marks = p.days.filter((d) => inWin.has(d.date) && d.missing_out && usable(d));
    const own = marks.filter((d) => !clusterDays.includes(d.date));
    if (own.length < t.missingOut.personCount) continue;
    out.push({
      ...blank(), family: "missing_out_cluster", level: "person", site: facts.site.alias, person: p.alias, type: p.type,
      days: own.map((d) => d.date), people_affected: 1, count: own.length, window_days: windowDates.length,
      site_explained_days: marks.length - own.length, person_eligible: true,
      weekdays: uniq(own.map((d) => d.weekday)).sort(),
    });
  }
  return out;
}

// ── far punches ─────────────────────────────────────────────────────────────

const emptyBuckets = (): Record<DistanceBucket, number> => ({ "<1.5x": 0, "1.5-3x": 0, ">3x": 0 });

function detectFar(facts: SiteFacts, t: Thresholds): Omit<Candidate, "id">[] {
  const out: Omit<Candidate, "id">[] = [];
  const windowDates = lastN(facts.run.dates, t.far.windowDays);
  const inWin = new Set(windowDates);
  const outside = facts.people.map((p) => ({ p, f: p.flags.filter((x) => x.kind === "outside_geofence" && inWin.has(x.date)) }));
  const involved = outside.filter((o) => o.f.length > 0);
  const total = involved.reduce((n, o) => n + o.f.length, 0);

  const sitePattern = involved.length >= t.far.sitePeopleMin && total >= t.far.siteTotalMin;
  if (sitePattern) {
    const buckets = emptyBuckets();
    let low = 0;
    for (const o of involved) for (const f of o.f) { if (f.bucket) buckets[f.bucket]++; if (f.low_accuracy) low++; }
    const byType: Record<string, number> = {};
    for (const o of involved) byType[o.p.type] = (byType[o.p.type] ?? 0) + 1;
    const days = uniq(involved.flatMap((o) => o.f.map((f) => f.date))).sort();
    out.push({
      ...blank(), family: "far_punches", level: "site", site: facts.site.alias, days, people_affected: involved.length, count: total,
      window_days: windowDates.length, site_pattern: true, buckets, low_accuracy_count: low, by_type: byType,
      weekdays: uniq(days.map((d) => weekdayOf(d))).sort(),
    });
    return out; // the site's pin or radius explains every person's punches: no person candidate
  }

  for (const o of involved) {
    const far = o.f.filter((f) => f.bucket === "1.5-3x" || f.bucket === ">3x");
    if (far.length < t.far.personCount) continue;
    const low = far.filter((f) => f.low_accuracy).length;
    if (low / far.length > t.far.maxLowAccuracyShare) continue;
    const buckets = emptyBuckets();
    for (const f of far) buckets[f.bucket as DistanceBucket]++;
    const days = uniq(far.map((f) => f.date)).sort();
    out.push({
      ...blank(), family: "far_punches", level: "person", site: facts.site.alias, person: o.p.alias, type: o.p.type, days,
      people_affected: 1, count: far.length, window_days: windowDates.length, person_eligible: true, buckets, low_accuracy_count: low,
      weekdays: uniq(days.map((d) => weekdayOf(d))).sort(),
    });
  }
  return out;
}

// ── plan gate ───────────────────────────────────────────────────────────────

export type DetectOptions = {
  sensitivity?: Sensitivity;
  /** A family set to false is not run. Absent = on. */
  families?: Partial<Record<AttendanceFamily, boolean>>;
};

const FAMILY_ORDER: Record<AttendanceFamily, number> = { late_cluster: 0, missing_out_cluster: 1, far_punches: 2 };

export function detectCandidates(facts: SiteFacts, opts: DetectOptions = {}): Candidate[] {
  const t = thresholdsFor(opts.sensitivity);
  const on = (f: AttendanceFamily) => opts.families?.[f] !== false;
  const rows = siteDayRows(facts);
  const found = [
    ...(on("late_cluster") ? detectLate(facts, t, rows) : []),
    ...(on("missing_out_cluster") ? detectMissingOut(facts, t, rows) : []),
    ...(on("far_punches") ? detectFar(facts, t) : []),
  ];
  found.sort((a, b) =>
    a.level !== b.level ? (a.level === "site" ? -1 : 1)
    : FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family]
    || b.count - a.count || b.people_affected - a.people_affected
    || (a.person ?? "").localeCompare(b.person ?? "", "en", { numeric: true })
  );
  return found.slice(0, t.maxCandidates).map((c, i) => ({ ...c, members: c.person ? [c.person] : c.members, id: `c${i + 1}` }));
}

export type PlanDecision = {
  /** False means no model run is worth starting: 0 tokens. */
  start: boolean;
  candidates: Candidate[];
  checked: { people: number; days: number };
};

export function planSite(facts: SiteFacts, opts: DetectOptions = {}): PlanDecision {
  const candidates = detectCandidates(facts, opts);
  return { start: candidates.length > 0, candidates, checked: { people: facts.people.length, days: facts.run.dates.length } };
}

export { ATTENDANCE_FAMILIES };
