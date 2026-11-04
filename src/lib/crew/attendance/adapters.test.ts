import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeMonthSummary } from "@/lib/wfm/monthlySummary";
import { bucketOf, loadSiteFacts, weekOffConflict } from "./adapters";
import { assignAliases, aliasOf, emptyAliasMap, leakedStrings, renderWithNames, resolveAlias } from "./alias";
import { minutesAfterStart } from "./dates";
import type { AttendanceReads, PunchFlagRow, SummaryDayLike, SummaryRowLike, ViewerScope } from "./facts";
import { canViewFinding, canViewSite, filterFindings, scopeEmployeeIds } from "./scope";
import { readsFromInput, summaryRowsOf } from "./eval/fixtures";
import type { FixtureInput } from "./eval/types";

// Compile-time: what getSummaryForRange returns is accepted as it is.
const _summaryFits: SummaryRowLike[] = [] as EmployeeMonthSummary[];
void _summaryFits;

const D = (day: number, month = 10) => `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const base = (): FixtureInput => ({
  site: { alias: "S1", shift_start: "09:00", grace_minutes: 10, radius_m: 150 },
  run: { from: D(19), to: D(1, 11) },
  config: { week_off_days: [0] },
  people: [
    { alias: "P1", type: "full_time", days: { [D(27)]: "L20" } },
    { alias: "P2", type: "full_time", days: { [D(28)]: "M" } },
    { alias: "P3", type: "trainee" },
  ],
});

describe("adapters never read a table themselves (design 3.4 rule 2)", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const sources = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "cases" ? [] : sources(join(d, e.name))) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [join(d, e.name)] : []
    );

  it("no engine file calls .from( or touches a client, the network, the environment or the console", () => {
    const files = sources(dir);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const code = readFileSync(f, "utf8");
      expect(code, f).not.toMatch(/\.from\(/);
      expect(code, f).not.toMatch(/createAdminSupabase|createClient|supabase-server|fetch\(|process\.env|console\./);
      expect(code, f).not.toMatch(/\bgetSummaryForRange\(\s*tenant/);
    }
  });
});

describe("aliases", () => {
  it("are stable for the same set of ids whatever order the reads return them in", () => {
    const a = assignAliases(emptyAliasMap(), "person", ["z-9", "a-1", "m-5"]);
    const b = assignAliases(emptyAliasMap(), "person", ["m-5", "z-9", "a-1"]);
    expect(a).toEqual(b);
    expect(a.persons).toEqual({ P1: "a-1", P2: "m-5", P3: "z-9" });
  });

  it("keep their numbers when a person is added, and ignore duplicates", () => {
    const first = assignAliases(emptyAliasMap(), "person", ["b", "c"]);
    const next = assignAliases(first, "person", ["a", "b", "c", "c"]);
    expect(next.persons).toEqual({ P1: "b", P2: "c", P3: "a" });
  });

  it("number sites and people separately and resolve both ways", () => {
    let m = assignAliases(emptyAliasMap(), "site", ["site-x"]);
    m = assignAliases(m, "person", ["emp-1"]);
    expect(aliasOf(m, "site", "site-x")).toBe("S1");
    expect(aliasOf(m, "person", "emp-1")).toBe("P1");
    expect(resolveAlias(m, "P1")).toEqual({ kind: "person", id: "emp-1" });
    expect(resolveAlias(m, "P9")).toBeNull();
  });

  it("names go back only through renderWithNames, and unknown aliases stay", () => {
    expect(renderWithNames("P2 and P7 at S1", (a) => (a === "P2" ? "Asha" : null))).toBe("Asha and P7 at S1");
  });

  it("leakedStrings finds a name anywhere in a serialised value", () => {
    expect(leakedStrings({ a: { b: "hello Meera Rao" } }, ["meera rao", "x"])).toEqual(["meera rao"]);
    expect(leakedStrings({ a: 1 }, ["zzz"])).toEqual([]);
  });
});

describe("loadSiteFacts", () => {
  it("returns aliased facts with no name, code, id, e-mail or coordinate, even when the reads carry them", async () => {
    const input = base();
    const rows = summaryRowsOf(input).map((r, i) => ({
      ...r,
      full_name: ["Meera Rao", "Karan Iyer", "Latha Pillai"][i],
      employee_code: `BIM-77${i}`,
      email: `person${i}@example.test`,
      days: r.days.map((d) => ({ ...d, remarks: "stomach infection, see doctor" })),
    }));
    const reads: AttendanceReads = { ...readsFromInput(input), getSummaryForRange: async (_f, _t, ids) => rows.filter((r) => ids.includes(r.employee_id)) };
    const r = await loadSiteFacts(reads, { siteId: "site-0001", from: input.run.from, to: input.run.to });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const leaks = leakedStrings(r.data.facts, ["Meera Rao", "Karan", "Latha", "BIM-77", "example.test", "stomach", "doctor", "emp-0", "site-0", "latitude", "longitude"]);
    expect(leaks).toEqual([]);
    expect(r.data.facts.people.map((p) => p.alias)).toEqual(["P1", "P2", "P3"]);
    expect(Object.keys(r.data.facts.people[0]).sort()).toEqual(["alias", "days", "flags", "type"]);
    expect(Object.keys(r.data.facts.people[0].days[0]).sort()).toEqual(
      ["absent", "date", "expected", "holiday", "late", "late_minutes", "missing_out", "on_leave", "present", "rule_conflict", "week_off", "weekday"].sort()
    );
  });

  it("derives late minutes from the first check-in and the shift start", async () => {
    const r = await loadSiteFacts(readsFromInput(base()), { siteId: "site-0001", from: D(19), to: D(1, 11) });
    if (!r.ok) throw new Error(r.error);
    const day = r.data.facts.people[0].days.find((d) => d.date === D(27))!;
    expect(day).toMatchObject({ late: true, late_minutes: 20, expected: true });
  });

  it("only reads the people it is allowed to: the viewer's scope narrows what is asked for", async () => {
    const input = base();
    const spy = vi.fn(readsFromInput(input).getSummaryForRange);
    const flagSpy = vi.fn(readsFromInput(input).getPunchFlagsForRange);
    const reads = { ...readsFromInput(input), getSummaryForRange: spy, getPunchFlagsForRange: flagSpy };
    const scope: ViewerScope = { unrestricted: false, employeeIds: ["emp-0001", "emp-0003"], siteIds: ["site-0001"] };
    const r = await loadSiteFacts(reads, { siteId: "site-0001", from: input.run.from, to: input.run.to, viewerScope: scope });
    expect(r.ok).toBe(true);
    expect(spy.mock.calls[0][2]).toEqual(["emp-0001", "emp-0003"]);
    expect(flagSpy.mock.calls[0][2]).toEqual(["emp-0001", "emp-0003"]);
    if (r.ok) expect(r.data.facts.people).toHaveLength(2);
  });

  it("refuses a site outside the viewer's scope before reading anything", async () => {
    const getConfig = vi.fn(async () => ({ timezone: "UTC", week_off_days: [0], type_rules: {} }));
    const reads = { ...readsFromInput(base()), getConfig };
    const scope: ViewerScope = { unrestricted: false, employeeIds: ["emp-0001"], siteIds: ["site-other"] };
    const r = await loadSiteFacts(reads, { siteId: "site-0001", from: D(19), to: D(1, 11), viewerScope: scope });
    expect(r).toEqual({ ok: false, error: "out_of_scope" });
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("drops rows the reads returned but were not asked for", async () => {
    const input = base();
    const all = summaryRowsOf(input);
    const reads = { ...readsFromInput(input), getSummaryForRange: async () => all, listSiteEmployeeIds: async () => ["emp-0001"] };
    const r = await loadSiteFacts(reads, { siteId: "site-0001", from: input.run.from, to: input.run.to });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.facts.people).toHaveLength(1);
  });

  it("an empty scope reads nobody and returns an empty site (no call with an empty id list)", async () => {
    const input = base();
    const spy = vi.fn(readsFromInput(input).getSummaryForRange);
    const scope: ViewerScope = { unrestricted: false, employeeIds: [], siteIds: ["site-0001"] };
    const r = await loadSiteFacts({ ...readsFromInput(input), getSummaryForRange: spy }, { siteId: "site-0001", from: input.run.from, to: input.run.to, viewerScope: scope });
    expect(spy).not.toHaveBeenCalled();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.facts.people).toEqual([]);
  });

  it("reports bad input as an error, not an exception", async () => {
    const reads = readsFromInput(base());
    expect(await loadSiteFacts(reads, { siteId: "site-0001", from: D(5), to: D(1) })).toEqual({ ok: false, error: "invalid_range" });
    expect(await loadSiteFacts(reads, { siteId: "nope", from: D(19), to: D(1, 11) })).toEqual({ ok: false, error: "unknown_site" });
    const nullSummary = { ...reads, getSummaryForRange: async () => null };
    expect(await loadSiteFacts(nullSummary, { siteId: "site-0001", from: D(19), to: D(1, 11) })).toEqual({ ok: false, error: "summary_unavailable" });
  });

  it("keeps only days inside the window and the flags that fall on them", async () => {
    const input = base();
    const flags: PunchFlagRow[] = [
      { employee_id: "emp-0001", date: D(27), flags: ["outside_geofence", "low_accuracy"], distance_bucket: ">3x" },
      { employee_id: "emp-0001", date: D(3), flags: ["outside_geofence"], distance_bucket: ">3x" },
      { employee_id: "emp-0002", date: D(28), flags: ["outside_geofence"], distance_m: 500, radius_m: 150 },
      { employee_id: "emp-0002", date: D(29), flags: ["no_location"] },
    ];
    const r = await loadSiteFacts({ ...readsFromInput(input), getPunchFlagsForRange: async () => flags }, { siteId: "site-0001", from: D(19), to: D(1, 11) });
    if (!r.ok) throw new Error(r.error);
    const [p1, p2] = r.data.facts.people;
    expect(p1.flags).toEqual([
      { date: D(27), kind: "low_accuracy", bucket: null },
      { date: D(27), kind: "outside_geofence", bucket: ">3x", low_accuracy: true },
    ]);
    expect(p2.flags).toEqual([
      { date: D(28), kind: "outside_geofence", bucket: ">3x", low_accuracy: false },
      { date: D(29), kind: "no_location", bucket: null },
    ]);
  });
});

describe("rule check: never judge a day by the wrong rule", () => {
  const cfg = { week_off_days: [0], type_rules: { trainee: { effective_from: D(1, 11), week_off_days: [] as number[] } } };

  it("agreeing record and rule is no conflict, before and after the effective date", () => {
    expect(weekOffConflict("trainee", D(25), true, cfg)).toBe(false); // Sunday before the rule: workspace week-off
    expect(weekOffConflict("trainee", D(1, 11), false, cfg)).toBe(false); // Sunday on the rule's date: working day
    expect(weekOffConflict("full_time", D(1, 11), true, cfg)).toBe(false);
  });

  it("flags a record that applied the new rule to a day before it started, and the reverse", () => {
    expect(weekOffConflict("trainee", D(25), false, cfg)).toBe(true);
    expect(weekOffConflict("trainee", D(1, 11), true, cfg)).toBe(true);
  });

  it("a second Saturday off is not a conflict", () => {
    expect(weekOffConflict("full_time", D(24), true, cfg)).toBe(false); // Saturday 24 Oct, record says off
    expect(weekOffConflict("full_time", D(27), true, cfg)).toBe(true); // a Tuesday off with no rule is
  });

  it("a conflicting day is excluded from late, absence and expectation, and says so", async () => {
    const input = base();
    const rows = summaryRowsOf(input);
    // the summary wrongly treated Sunday 25 Oct as a working day for a Trainee-less full-time person
    rows[0].days = rows[0].days.map((d: SummaryDayLike) => (d.date === D(25) ? { ...d, is_week_off: false, late: true, absent: true, standard_minutes: 480, punches: 1 } : d));
    const r = await loadSiteFacts({ ...readsFromInput(input), getSummaryForRange: async () => rows }, { siteId: "site-0001", from: D(19), to: D(1, 11) });
    if (!r.ok) throw new Error(r.error);
    const day = r.data.facts.people[0].days.find((d) => d.date === D(25))!;
    expect(day).toMatchObject({ rule_conflict: true, expected: false, late: false, absent: false });
  });
});

describe("buckets and clock arithmetic", () => {
  it("bucketOf uses 1.5x and 3x of the radius", () => {
    expect(bucketOf(100, 150)).toBe("<1.5x");
    expect(bucketOf(224, 150)).toBe("<1.5x");
    expect(bucketOf(225, 150)).toBe("1.5-3x");
    expect(bucketOf(450, 150)).toBe("1.5-3x");
    expect(bucketOf(451, 150)).toBe(">3x");
    expect(bucketOf(null, 150)).toBeNull();
    expect(bucketOf(300, 0)).toBeNull();
    expect(bucketOf(Number.NaN, 150)).toBeNull();
  });

  it("minutesAfterStart reads a bare time or an ISO timestamp in the workspace time zone", () => {
    expect(minutesAfterStart("09:25", "09:00", "Asia/Kolkata")).toBe(25);
    expect(minutesAfterStart("2026-10-27T03:55:00Z", "09:00", "Asia/Kolkata")).toBe(25); // 09:25 IST
    expect(minutesAfterStart("08:50", "09:00", "Asia/Kolkata")).toBe(-10);
    expect(minutesAfterStart("not a time", "09:00", "Asia/Kolkata")).toBeNull();
    expect(minutesAfterStart("09:10", null, "Asia/Kolkata")).toBeNull();
    expect(minutesAfterStart(null, "09:00", "Asia/Kolkata")).toBeNull();
  });
});

describe("scope filter (design 5.5)", () => {
  const supervisor: ViewerScope = { unrestricted: false, employeeIds: ["e1", "e2"], siteIds: ["s1"] };
  const admin: ViewerScope = { unrestricted: true, employeeIds: null, siteIds: [] };

  it("narrows employee ids for a supervisor and keeps all for an admin or the system", () => {
    expect(scopeEmployeeIds(["e1", "e2", "e3"], supervisor)).toEqual(["e1", "e2"]);
    expect(scopeEmployeeIds(["e1", "e3"], admin)).toEqual(["e1", "e3"]);
    expect(scopeEmployeeIds(["e1", "e3"], null)).toEqual(["e1", "e3"]);
    expect(scopeEmployeeIds(["e1"], { unrestricted: false, employeeIds: [], siteIds: [] })).toEqual([]);
  });

  it("sites: a supervisor sees only theirs", () => {
    expect(canViewSite("s1", supervisor)).toBe(true);
    expect(canViewSite("s2", supervisor)).toBe(false);
    expect(canViewSite("s2", admin)).toBe(true);
  });

  it("a person-level finding is visible only when the employee is in scope; the supervisor's own finding never is", () => {
    const own = { site_id: "s1", employee_id: "supervisor-self" };
    expect(canViewFinding(own, supervisor)).toBe(false);
    expect(canViewFinding({ site_id: "s1", employee_id: "e1" }, supervisor)).toBe(true);
    expect(canViewFinding({ site_id: "s1", employee_id: "e9" }, supervisor)).toBe(false);
    expect(canViewFinding(own, admin)).toBe(true);
  });

  it("a site-level finding follows the site scope", () => {
    expect(canViewFinding({ site_id: "s1", employee_id: null }, supervisor)).toBe(true);
    expect(canViewFinding({ site_id: "s2", employee_id: null }, supervisor)).toBe(false);
    expect(canViewFinding({ site_id: null, employee_id: null }, supervisor)).toBe(false);
  });

  it("an employee with no scope sees nothing", () => {
    const employee: ViewerScope = { unrestricted: false, employeeIds: ["me"], siteIds: [] };
    expect(canViewFinding({ site_id: "s1", employee_id: null }, employee)).toBe(false);
    expect(filterFindings([{ site_id: "s1", employee_id: null }], employee)).toEqual([]);
  });
});
