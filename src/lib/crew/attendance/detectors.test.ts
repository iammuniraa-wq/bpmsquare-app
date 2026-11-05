import { describe, expect, it } from "vitest";
import { detectCandidates, planSite, siteDayRows } from "./detectors";
import { THRESHOLDS, thresholdsFor } from "./thresholds";
import { factsOf } from "./eval/fixtures";
import type { FixtureInput, FixturePerson } from "./eval/types";
import type { Sensitivity } from "./facts";

const D = (day: number, month = 10) => `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const people = (n: number, type = "full_time", from = 1): FixturePerson[] =>
  Array.from({ length: n }, (_, i) => ({ alias: `P${from + i}`, type, days: {}, flags: [] }));
const mark = (ps: FixturePerson[], aliases: string[], dates: string[], code: string) => {
  for (const a of aliases) for (const d of dates) ps.find((p) => p.alias === a)!.days![d] = code;
};
const input = (ps: FixturePerson[], extra: Partial<FixtureInput> = {}): FixtureInput => ({
  site: { alias: "S1", shift_start: "09:00", grace_minutes: 10, radius_m: 150 },
  run: { from: D(19), to: D(1, 11) },
  config: { week_off_days: [0] },
  people: ps,
  ...extra,
});
const detect = async (ps: FixturePerson[], s: Sensitivity = "balanced", extra: Partial<FixtureInput> = {}) =>
  detectCandidates(await factsOf(input(ps, extra)), { sensitivity: s });
const flag = (ps: FixturePerson[], alias: string, date: string, bucket: ">3x" | "1.5-3x" | "<1.5x" | undefined, low = false) =>
  ps.find((p) => p.alias === alias)!.flags!.push({ date, kind: "outside_geofence", bucket, low_accuracy: low });

describe("sensitivity table", () => {
  it("is pinned: a change here is a conscious change and needs a new eval run", () => {
    expect(THRESHOLDS.balanced).toEqual({
      late: { personCount: 4, personWindowDays: 10, siteDayMinPeople: 3, siteDayMinShare: 0.4, siteMinDays: 2 },
      missingOut: { personCount: 4, personWindowDays: 14, siteDayMinPeople: 3, siteDayMinShare: 0.4, siteMinDays: 1 },
      far: { personCount: 3, windowDays: 14, sitePeopleMin: 3, siteTotalMin: 6, maxLowAccuracyShare: 0.5 },
      maxCandidates: 25,
    });
  });

  it("is monotonic: Quiet asks for more than Balanced, Balanced for more than Thorough", () => {
    const q = THRESHOLDS.quiet, b = THRESHOLDS.balanced, t = THRESHOLDS.thorough;
    for (const f of ["late", "missingOut"] as const) {
      expect(q[f].personCount).toBeGreaterThanOrEqual(b[f].personCount);
      expect(b[f].personCount).toBeGreaterThanOrEqual(t[f].personCount);
      expect(q[f].siteDayMinShare).toBeGreaterThanOrEqual(b[f].siteDayMinShare);
      expect(b[f].siteDayMinShare).toBeGreaterThanOrEqual(t[f].siteDayMinShare);
    }
    expect(q.far.personCount).toBeGreaterThanOrEqual(b.far.personCount);
    expect(b.far.personCount).toBeGreaterThanOrEqual(t.far.personCount);
  });

  it("falls back to Balanced for an unknown or missing value", () => {
    expect(thresholdsFor(undefined)).toBe(THRESHOLDS.balanced);
    expect(thresholdsFor("nonsense" as Sensitivity)).toBe(THRESHOLDS.balanced);
  });
});

describe("late_cluster", () => {
  it("a person needs the sensitivity's count, on days the site did not show the same", async () => {
    const mk = (n: number) => {
      const ps = people(8);
      mark(ps, ["P1"], [D(23), D(26), D(27), D(28), D(29)].slice(0, n), "L20");
      return ps;
    };
    expect(await detect(mk(3))).toEqual([]);
    const four = await detect(mk(4));
    expect(four).toHaveLength(1);
    expect(four[0]).toMatchObject({ family: "late_cluster", level: "person", person: "P1", count: 4, person_eligible: true, site_pattern: false });
    expect(await detect(mk(4), "quiet")).toEqual([]);
    expect((await detect(mk(3), "thorough"))[0]).toMatchObject({ level: "person", person: "P1", count: 3 });
  });

  it("days that belong to a site cluster do not count towards a person", async () => {
    const ps = people(9);
    mark(ps, ["P1", "P2", "P3", "P4"], [D(28)], "L15"); // 4 of 9: a site-day
    mark(ps, ["P1"], [D(23), D(26), D(27)], "L15");
    const c = await detect(ps);
    // P1: 4 marks, one of them on the site-day, so 3 own: below 4. A single site-day is not a site candidate either.
    expect(c).toEqual([]);
  });

  it("a site candidate needs the minimum number of cluster days and names nobody", async () => {
    const one = people(9);
    mark(one, ["P1", "P2", "P3", "P4", "P5"], [D(28)], "L15");
    expect(await detect(one)).toEqual([]);
    const two = people(9);
    mark(two, ["P1", "P2", "P3", "P4", "P5"], [D(28), D(30)], "L15");
    const c = await detect(two);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ level: "site", person: null, members: [], people_affected: 5, days: [D(28), D(30)], site_pattern: true, median_late_minutes: 15 });
  });

  it("a cluster needs a share of the site, not just a count", async () => {
    const ps = people(20);
    mark(ps, ["P1", "P2", "P3"], [D(28), D(30)], "L15"); // 3 of 20 = 15 %
    expect(await detect(ps)).toEqual([]);
  });

  it("only looks at the last ten shift-days", async () => {
    const ps = people(8);
    mark(ps, ["P1"], [D(19), D(20), D(21), D(22)], "L20"); // before the ten-day window (23 Oct onwards)
    expect(await detect(ps)).toEqual([]);
  });

  it("does not judge lateness on a week-off, a holiday or a leave day", async () => {
    const ps = people(8);
    mark(ps, ["P1"], [D(25), D(1, 11)], "X"); // Sundays: week-off work, never late
    mark(ps, ["P2"], [D(26), D(27), D(28), D(29)], "V");
    expect(await detect(ps, "thorough", { holidays: [D(30)] })).toEqual([]);
  });

  it("thorough sensitivity sees three of ten on two days", async () => {
    const ps = people(10);
    mark(ps, ["P1", "P2", "P3"], [D(27), D(28)], "L22");
    expect(await detect(ps)).toEqual([]);
    expect(await detect(ps, "thorough")).toHaveLength(1);
  });
});

describe("missing_out_cluster", () => {
  it("one site-day is enough for the site; names nobody; lists the members for a recheck", async () => {
    const ps = people(12);
    mark(ps, ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"], [D(27)], "M");
    mark(ps, ["P12"], [D(27)], "V");
    const c = await detect(ps);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ family: "missing_out_cluster", level: "site", people_affected: 9, headcount: 11, days: [D(27)] });
    expect(c[0].members).toHaveLength(9);
  });

  it("a person is a candidate only on days outside site clusters", async () => {
    const ps = people(9);
    mark(ps, ["P5"], [D(20), D(22), D(23), D(26)], "M");
    const c = await detect(ps);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ level: "person", person: "P5", count: 4, window_days: 14 });
  });

  it("counts a missing check-out on a week-off day, but needs the count", async () => {
    const ps = people(8);
    mark(ps, ["P2"], [D(25), D(1, 11)], "XM");
    expect(await detect(ps)).toEqual([]);
  });
});

describe("far_punches", () => {
  it("many people just outside the boundary is a site candidate, and no person is a candidate", async () => {
    const ps = people(8);
    for (const a of ["P2", "P5", "P6"]) for (const d of [26, 27]) flag(ps, a, D(d), "1.5-3x");
    const c = await detect(ps);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ family: "far_punches", level: "site", people_affected: 3, count: 6, site_pattern: true });
    expect(c[0].buckets).toEqual({ "<1.5x": 0, "1.5-3x": 6, ">3x": 0 });
  });

  it("one person far away repeatedly is a person candidate with the distance buckets", async () => {
    const ps = people(8);
    flag(ps, "P4", D(27), ">3x"); flag(ps, "P4", D(28), ">3x", true); flag(ps, "P4", D(30), "1.5-3x");
    const c = await detect(ps);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ level: "person", person: "P4", count: 3, low_accuracy_count: 1, buckets: { "<1.5x": 0, "1.5-3x": 1, ">3x": 2 } });
  });

  it("punches under 1.5x the radius, or with an unknown distance, do not make a person", async () => {
    const ps = people(8);
    for (const d of [26, 27, 28, 29]) flag(ps, "P1", D(d), "<1.5x");
    for (const d of [26, 27, 28, 29]) flag(ps, "P2", D(d), undefined);
    expect(await detect(ps)).toEqual([]);
  });

  it("a person whose far punches mostly have a weak GPS fix is dropped", async () => {
    const ps = people(8);
    for (const d of [26, 27, 28]) flag(ps, "P1", D(d), ">3x", true);
    expect(await detect(ps)).toEqual([]);
  });

  it("a single person dominating a site pattern is still a site finding only", async () => {
    const ps = people(9);
    for (const d of [26, 27, 28, 29, 30]) flag(ps, "P3", D(d), "1.5-3x");
    for (const d of [27, 29]) flag(ps, "P4", D(d), "1.5-3x");
    for (const d of [28, 30]) flag(ps, "P7", D(d), "1.5-3x");
    const c = await detect(ps);
    expect(c.map((x) => `${x.level}:${x.person}`)).toEqual(["site:null"]);
  });
});

describe("families, ordering and the plan gate", () => {
  it("a family switched off is not run", async () => {
    const ps = people(9);
    mark(ps, ["P1", "P2", "P3", "P4", "P5"], [D(28), D(30)], "L15");
    const facts = await factsOf(input(ps));
    expect(detectCandidates(facts, { families: { late_cluster: false } })).toEqual([]);
    expect(detectCandidates(facts, { families: { missing_out_cluster: false } })).toHaveLength(1);
  });

  it("orders site candidates before person candidates and numbers them c1..cn", async () => {
    const ps = people(9);
    mark(ps, ["P1", "P2", "P3", "P4", "P5"], [D(28), D(30)], "L15");
    mark(ps, ["P8"], [D(20), D(21), D(22), D(23)], "M");
    const c = await detect(ps);
    expect(c.map((x) => [x.id, x.level, x.family])).toEqual([
      ["c1", "site", "late_cluster"],
      ["c2", "person", "missing_out_cluster"],
    ]);
  });

  it("is deterministic for the same facts", async () => {
    const ps = people(9);
    mark(ps, ["P1", "P2", "P3", "P4", "P5"], [D(28), D(30)], "L15");
    const facts = await factsOf(input(ps));
    expect(detectCandidates(facts)).toEqual(detectCandidates(facts));
  });

  it("a site-wide pattern is one site candidate, not sixty person candidates", async () => {
    const ps = people(60);
    for (const p of ps) mark([p], [p.alias], [D(23), D(24), D(26), D(27), D(28)], "L15");
    const c = await detect(ps);
    expect(c).toHaveLength(1);
    expect(c[0].level).toBe("site");
  });

  it("caps the candidates the model is shown", async () => {
    const ps = people(40);
    const dates = [19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 31].map((d) => D(d));
    ps.forEach((p, i) => mark([p], [p.alias], [0, 3, 6, 9].map((k) => dates[(i + k) % dates.length]), "M"));
    const c = await detect(ps);
    expect(c).toHaveLength(THRESHOLDS.balanced.maxCandidates);
    expect(c.every((x) => x.level === "person")).toBe(true);
    expect(c[0].id).toBe("c1");
    expect(c[24].id).toBe("c25");
  });

  it("planSite starts no run on a quiet site and reports what it checked", async () => {
    const decision = planSite(await factsOf(input(people(9))));
    expect(decision.start).toBe(false);
    expect(decision.candidates).toEqual([]);
    expect(decision.checked).toEqual({ people: 9, days: 14 });
  });

  it("planSite starts a run when a candidate exists", async () => {
    const ps = people(9);
    mark(ps, ["P2"], [D(20), D(22), D(23), D(26)], "M");
    expect(planSite(await factsOf(input(ps))).start).toBe(true);
  });

  it("siteDayRows counts expected, present, late, missing and outside punches per day", async () => {
    const ps = people(5);
    mark(ps, ["P1", "P2"], [D(27)], "L20");
    mark(ps, ["P3"], [D(27)], "M");
    flag(ps, "P4", D(27), ">3x");
    const rows = siteDayRows(await factsOf(input(ps)));
    const row = rows.find((r) => r.date === D(27))!;
    expect(row).toMatchObject({ rostered: 5, present: 5, late: 2, missing_out: 1, outside: 1, weekday: 2 });
    const sunday = rows.find((r) => r.date === D(25))!;
    expect(sunday).toMatchObject({ rostered: 0, present: 0, weekday: 0 });
  });
});

describe("rules by employment type (a Trainee's Sunday)", () => {
  const TRAINEE = { trainee: { effective_from: D(1, 11), week_off_days: [] as number[] } };
  const trainees = () => people(8, "trainee");

  it("Sunday 1 Nov is a working day for Trainees: a missing check-out cluster there IS judged", async () => {
    const ps = trainees();
    mark(ps, ["P1", "P2", "P3", "P4", "P5"], [D(1, 11)], "M");
    const c = await detect(ps, "balanced", { config: { week_off_days: [0], type_rules: TRAINEE } });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ family: "missing_out_cluster", level: "site", people_affected: 5, days: [D(1, 11)] });
  });

  it("the same pattern on Sunday 25 Oct (before the rule's start) is week-off work: late is not judged, expected is false", async () => {
    const ps = trainees();
    mark(ps, ps.map((p) => p.alias), [D(25), D(1, 11)], "L20");
    const facts = await factsOf(input(ps, { config: { week_off_days: [0], type_rules: TRAINEE } }));
    const p1 = facts.people[0];
    expect(p1.days.find((d) => d.date === D(25))).toMatchObject({ week_off: true, expected: false, late: false });
    expect(p1.days.find((d) => d.date === D(1, 11))).toMatchObject({ week_off: false, expected: true, late: true });
    // one working-day cluster only: not a site candidate, and no person candidate
    expect(detectCandidates(facts)).toEqual([]);
  });

  it("without any type rule a Sunday stays a week-off for everyone", async () => {
    const ps = trainees();
    mark(ps, ps.map((p) => p.alias), [D(1, 11)], "L20");
    const facts = await factsOf(input(ps));
    expect(facts.people[0].days.find((d) => d.date === D(1, 11))).toMatchObject({ week_off: true, expected: false, late: false });
    expect(facts.rule_notes).toEqual([]);
  });

  it("tells the model about the rule through the facts, never by a hard-coded day", async () => {
    const facts = await factsOf(input(trainees(), { config: { week_off_days: [0], type_rules: TRAINEE } }));
    expect(facts.rule_notes).toEqual([{ type: "trainee", effective_from: D(1, 11), week_off_days: [], week_off_days_before: [0] }]);
  });
});
