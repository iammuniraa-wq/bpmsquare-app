import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attendanceAnomalies } from "./definition";
import { ATTENDANCE_AGENT_KEY, ATTENDANCE_METER_SURFACE, ATTENDANCE_TITLE } from "./keys";
import { countBucket, fingerprintFinding, fingerprintProposal } from "./fingerprint";
import { PLAN_WINDOW_DAYS, dedupeKeyFor, planAttendance, planAttendanceDetailed } from "./plan";
import { ATTENDANCE_GOAL, ATTENDANCE_PROMPT_VERSION, attendanceSystemPrompt } from "./prompt";
import { ACTION_CODES, EXPLANATION_CODES } from "./submission";
import { ATTENDANCE_TOOLS, RESULT_CHAR_CAP, createToolSession } from "./tools";
import { leakedStrings, type AliasMap } from "./alias";
import { buildCase, CASES_DIR, loadCases, readsFromInput } from "./eval/fixtures";
import { referenceSubmission } from "./eval/reference";
import { aggregate, releaseGate, scoreCase, type CaseScore } from "./eval/score";
import { validateSubmission } from "./validate";
import type { AttendanceReads, ViewerScope } from "./facts";
import type { EvalCase } from "./eval/types";

const cases = loadCases();
const byId = (id: string): EvalCase => cases.find((c) => c.id === id)!;

function multiReads(inputs: EvalCase["input"][]): AttendanceReads {
  const each = inputs.map((i) => ({ input: i, reads: readsFromInput(i), siteId: `site-${i.site.alias.slice(1).padStart(4, "0")}` }));
  const pick = (siteId: string) => each.find((e) => e.siteId === siteId);
  // Fixture ids repeat from site to site, so employee ids are namespaced "<siteId>:<id>" here.
  const split = (ids: string[]) => each.map((e) => ({ e, raw: ids.filter((i) => i.startsWith(`${e.siteId}:`)).map((i) => i.slice(e.siteId.length + 1)) }));
  return {
    getConfig: () => each[0].reads.getConfig(),
    listSiteIds: async () => each.map((e) => e.siteId),
    getSite: (id) => pick(id)?.reads.getSite(id) ?? Promise.resolve(null),
    listSiteEmployeeIds: async (id, f, t) => ((await pick(id)?.reads.listSiteEmployeeIds(id, f, t)) ?? []).map((i) => `${id}:${i}`),
    getSummaryForRange: async (f, t, ids) =>
      (await Promise.all(split(ids).map(async ({ e, raw }) => ((await e.reads.getSummaryForRange(f, t, raw)) ?? []).map((r) => ({ ...r, employee_id: `${e.siteId}:${r.employee_id}` })))))
        .flat(),
    getPunchFlagsForRange: async (f, t, ids) =>
      (await Promise.all(split(ids).map(async ({ e, raw }) => (await e.reads.getPunchFlagsForRange(f, t, raw)).map((r) => ({ ...r, employee_id: `${e.siteId}:${r.employee_id}` })))))
        .flat(),
  };
}

describe("the agent definition", () => {
  const def = attendanceAnomalies;

  it("is a propose-only agent with the closed action list and no way to write", () => {
    expect(def.key).toBe("attendance");
    expect(def.autonomy).toBe("propose");
    expect(def.actions).toEqual(["wfm.recheck", "site_note"]);
    expect(def.requires.features).toEqual(["crew", "crew_attendance", "wfm"]);
    expect(def.tier).toBe("small");
    expect(def.limits.maxToolCalls).toBeLessThanOrEqual(8);
    for (const t of def.tools) {
      expect(t.key).toMatch(/^attendance_/);
      expect(t.key).not.toMatch(/send|write|update|create|delete|approve|correct/);
      expect(JSON.stringify(t.args)).not.toMatch(/tenant/);
    }
    expect(def.tools.map((t) => t.key)).toEqual([
      "attendance_site_digest", "attendance_person_history", "attendance_site_baseline", "attendance_roster_context", "attendance_punch_flags",
    ]);
  });

  it("schedule only (attendance has no events), daily at 02:00", () => {
    expect(def.triggers.schedule).toEqual([{ at: "02:00", covers: "previous_shift_day" }]);
    expect(Object.keys(def.triggers)).toEqual(["schedule"]);
  });

  it("offers neither buddy-punch nor holiday-bridging families (design 5.6)", () => {
    expect(Object.keys(def.defaults.families).sort()).toEqual(["far_punches", "late_cluster", "missing_out_cluster"]);
  });

  it("carries the plain-words goal and a versioned prompt", () => {
    expect(def.goal).toBe(ATTENDANCE_GOAL);
    expect(def.prompt_version).toBe(ATTENDANCE_PROMPT_VERSION);
    expect(ATTENDANCE_PROMPT_VERSION).toMatch(/^attendance@\d{4}-\d{2}-\d{2}\.\d+$/);
    const prompt = attendanceSystemPrompt();
    expect(prompt.startsWith(ATTENDANCE_GOAL)).toBe(true);
    for (const code of [...EXPLANATION_CODES, ...ACTION_CODES]) expect(prompt).toContain(code);
    expect(prompt).toMatch(/\*_untrusted/);
    expect(prompt).toMatch(/Type no digits/);
  });

  it("keeps the identity mapping in one place", () => {
    expect(ATTENDANCE_AGENT_KEY).toBe("attendance");
    expect(ATTENDANCE_TITLE).toBe("Attendance Anomalies");
    expect(ATTENDANCE_METER_SURFACE).toBe("crew:attendance");
  });

  it("points at an eval set that exists and is large enough", () => {
    expect(existsSync(CASES_DIR)).toBe(true);
    expect(def.evalSet).toBe("src/lib/crew/attendance/eval/cases");
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });
});

describe("plan(): the candidate gate", () => {
  const quiet = byId("quiet-01-everyone-on-time").input;
  const late = byId("site-level-01-late-three-days").input; // S2: 7 of 9 late on three days (a candidate even at Quiet)
  const half = byId("site-level-02-late-two-days-half-the-site").input; // S1: a candidate at Balanced, not at Quiet
  const personFour = byId("person-level-05-no-check-out-four-days").input; // S4: four missing check-outs, not a candidate at Quiet
  const settings = { sensitivity: "balanced" as const, families: {} };

  it("starts no run for a quiet site (0 tokens) and one run per site with candidates, keyed per site and closed day", async () => {
    const lateS3 = { ...late, site: { ...late.site, alias: "S3" } };
    const reads = multiReads([quiet, lateS3]);
    const out = await planAttendanceDetailed({ reads, today: "2026-11-02", settings });
    expect(out.sitesChecked).toBe(2);
    expect(out.quietSites).toBe(1);
    expect(out.requests).toHaveLength(1);
    expect(out.requests[0]).toEqual({
      agent_key: "attendance", trigger: "schedule", trigger_ref: "daily:2026-11-01",
      dedupe_key: "attendance|site:site-0003|day:2026-11-01",
      scope: { site_id: "site-0003", from: "2026-10-19", to: "2026-11-01" }, candidate_count: 1,
    });
    expect(out.requests[0].dedupe_key).toBe(dedupeKeyFor("site-0003", "2026-11-01"));
    expect(PLAN_WINDOW_DAYS).toBe(14);
  });

  it("the same input twice gives the same dedupe key (a double cron tick enqueues once)", async () => {
    const reads = multiReads([late]);
    const a = await planAttendance({ reads, today: "2026-11-02", settings });
    const b = await planAttendance({ reads, today: "2026-11-02", settings });
    expect(a).toEqual(b);
  });

  it("honours the chosen sites, sensitivity and families", async () => {
    const reads = multiReads([half, personFour]);
    expect((await planAttendance({ reads, today: "2026-11-02", settings })).length).toBe(2);
    expect((await planAttendance({ reads, today: "2026-11-02", settings: { ...settings, siteIds: ["site-0004"] } })).map((r) => r.scope.site_id)).toEqual(["site-0004"]);
    expect(await planAttendance({ reads, today: "2026-11-02", settings: { ...settings, sensitivity: "quiet" } })).toEqual([]);
    expect(await planAttendance({ reads, today: "2026-11-02", settings: { ...settings, families: { late_cluster: false, missing_out_cluster: false, far_punches: false } } })).toEqual([]);
  });

  it("a manual run through a supervisor's scope only plans their sites", async () => {
    const reads = multiReads([half, personFour]);
    const scope: ViewerScope = { unrestricted: false, employeeIds: personFour.people.map((p) => `site-0004:emp-${p.alias.slice(1).padStart(4, "0")}`), siteIds: ["site-0004"] };
    const out = await planAttendance({ reads, today: "2026-11-02", settings, viewerScope: scope, trigger: "manual" });
    expect(out.map((r) => [r.scope.site_id, r.trigger])).toEqual([["site-0004", "manual"]]);
  });

  it("one failing site does not stop the others, and the failure is reported", async () => {
    const reads = multiReads([half, personFour]);
    const broken: AttendanceReads = {
      ...reads,
      getSummaryForRange: async (f, t, ids) => {
        if (ids.some((i) => i.startsWith("site-0001:"))) throw new Error("db timeout");
        return reads.getSummaryForRange(f, t, ids);
      },
    };
    const out = await planAttendanceDetailed({ reads: broken, today: "2026-11-02", settings });
    expect(out.skipped).toEqual([{ siteId: "site-0001", reason: "read_error:db timeout" }]);
    expect(out.requests.map((r) => r.scope.site_id)).toEqual(["site-0004"]);
  });
});

describe("fingerprints (design 3.10)", () => {
  async function fp(id: string, aliases?: AliasMap) {
    const built = await buildCase(byId(id));
    const sub = referenceSubmission(built.digest);
    const f = validateSubmission(sub, built.toolResults).findings[0];
    const c = built.candidates.find((x) => x.id === f.candidate_id)!;
    return { fp: fingerprintFinding(f, c, { aliases: aliases ?? built.aliases }), built, f, c };
  }

  it("is a stable 32 hex string and does not change between identical runs", async () => {
    const a = await fp("person-level-01-late-five-days");
    const b = await fp("person-level-01-late-five-days");
    expect(a.fp).toMatch(/^[0-9a-f]{32}$/);
    expect(a.fp).toBe(b.fp);
  });

  it("is built from real ids: renumbered aliases with the same real people give the same fingerprint", async () => {
    const a = await fp("person-level-01-late-five-days");
    // another run in which P4 is a different alias for the same real employee
    const other: AliasMap = { persons: { P9: a.built.aliases.persons.P4 }, sites: a.built.aliases.sites };
    const f = { ...a.f, subject: { type: "person" as const, alias: "P9" } };
    expect(fingerprintFinding(f, a.c, { aliases: other })).toBe(a.fp);
  });

  it("differs by person, by site and by kind", async () => {
    const p4 = await fp("person-level-01-late-five-days");
    const p2 = await fp("person-level-02-late-four-days");
    const miss = await fp("person-level-04-no-check-out-five-days");
    expect(new Set([p4.fp, p2.fp, miss.fp]).size).toBe(3);
  });

  it("a worse situation falls into a new bucket and is a new finding", async () => {
    const a = await fp("person-level-01-late-five-days");
    const worse = { ...a.c, count: 9 };
    expect(fingerprintFinding(a.f, worse, { aliases: a.built.aliases })).not.toBe(a.fp);
    const slightly = { ...a.c, count: 6 };
    expect(fingerprintFinding(a.f, slightly, { aliases: a.built.aliases })).toBe(a.fp); // 5 and 6 are both "5-7"
  });

  it("countBucket", () => {
    expect([0, 1, 2, 3, 4, 5, 7, 8, 12, 13, 40].map(countBucket)).toEqual(["1-2", "1-2", "1-2", "3-4", "3-4", "5-7", "5-7", "8-12", "8-12", "13+", "13+"]);
  });

  it("is null rather than wrong when an alias is unknown", async () => {
    const a = await fp("person-level-01-late-five-days");
    expect(fingerprintFinding(a.f, a.c, { aliases: { persons: {}, sites: a.built.aliases.sites } })).toBeNull();
    expect(fingerprintFinding(a.f, a.c, { aliases: { persons: a.built.aliases.persons, sites: {} } })).toBeNull();
  });

  it("proposal fingerprints ignore target order and change with the targets", async () => {
    const a = await fp("site-level-06-nine-did-not-check-out");
    const ctx = { aliases: a.built.aliases };
    const x = fingerprintProposal("wfm.recheck", a.fp as string, ["P1", "P2", "P3"], ctx);
    expect(x).toBe(fingerprintProposal("wfm.recheck", a.fp as string, ["P3", "P1", "P2"], ctx));
    expect(x).not.toBe(fingerprintProposal("wfm.recheck", a.fp as string, ["P1", "P2"], ctx));
    expect(fingerprintProposal("wfm.recheck", a.fp as string, ["P99"], ctx)).toBeNull();
  });
});

describe("tool adapters (design 3.4)", () => {
  const c = byId("person-level-06-far-three-times");
  const session = (viewerScope: ViewerScope | null = null, extra: Partial<AttendanceReads> = {}) =>
    createToolSession({
      reads: { ...readsFromInput(c.input), ...extra },
      run: { siteId: "site-0006", from: c.input.run.from, to: c.input.run.to },
      aliases: { persons: Object.fromEntries(c.input.people.map((p) => [p.alias, `emp-${p.alias.slice(1).padStart(4, "0")}`])), sites: { S6: "site-0006" } },
      detect: { sensitivity: "balanced" },
      viewerScope,
    });

  it("the digest tool returns the same digest the prefetch builds", async () => {
    const built = await buildCase(c);
    const r = await session().call("attendance_site_digest", {});
    expect(r).toEqual({ ok: true, data: built.digest });
  });

  it("person history and punch flags work for a candidate's alias only", async () => {
    const s = session();
    const h = await s.call("attendance_person_history", { alias: "P4", days: 7 });
    expect(h.ok && (h.data as { days: unknown[] }).days).toHaveLength(7);
    expect(await s.call("attendance_person_history", { alias: "P1" })).toEqual({ ok: false, error: "unknown_alias" });
    expect(await s.call("attendance_person_history", { alias: "emp-0004" })).toEqual({ ok: false, error: "unknown_alias" });
    expect(await s.call("attendance_punch_flags", { alias: "P2" })).toEqual({ ok: false, error: "unknown_alias" });
    const flags = await s.call("attendance_punch_flags", { alias: "P4" });
    expect(flags).toEqual({ ok: true, data: { scope: "P4", people: 1, days_with_flags: 3, counts: { outside_geofence: 3, low_accuracy: 1 }, outside_by_distance: { ">3x": 3 } } });
    const site = await s.call("attendance_punch_flags", {});
    expect(site.ok && (site.data as { people: number }).people).toBe(1);
  });

  it("baseline reads the weeks before the window; roster context only inside it", async () => {
    const s = session();
    const base = await s.call("attendance_site_baseline", { weeks: 2 });
    expect(base.ok).toBe(true);
    if (base.ok) {
      const d = base.data as { from: string; to: string; by_weekday: { weekday: number; present_pct: number | null }[] };
      expect(d.to).toBe("2026-10-18");
      expect(d.from).toBe("2026-10-05");
      expect(d.by_weekday).toHaveLength(7);
      expect(d.by_weekday[0].present_pct).toBeNull(); // Sunday: nobody expected
    }
    const ctx = await s.call("attendance_roster_context", { date: "2026-10-27" });
    expect(ctx).toMatchObject({ ok: true, data: { date: "2026-10-27", weekday: 2, shift_start: "09:00", expected: 9, present: 9, holiday: false } });
    expect(await s.call("attendance_roster_context", { date: "2026-09-01" })).toEqual({ ok: false, error: "date_outside_window" });
    const sunday = await s.call("attendance_roster_context", { date: "2026-10-25" });
    expect(sunday).toMatchObject({ ok: true, data: { expected: 0, week_off_by_type: { full_time: 9 } } });
  });

  it("an unknown tool and an out-of-scope viewer are errors, not data", async () => {
    expect(await session().call("attendance_send_message", {})).toEqual({ ok: false, error: "unknown_tool" });
    const scope: ViewerScope = { unrestricted: false, employeeIds: [], siteIds: ["other"] };
    expect(await session(scope).call("attendance_site_digest", {})).toEqual({ ok: false, error: "out_of_scope" });
  });

  it("results carry no id, name or coordinate, and respect the size cap", async () => {
    const s = session();
    for (const [name, args] of [["attendance_site_digest", {}], ["attendance_person_history", { alias: "P4" }], ["attendance_site_baseline", {}], ["attendance_punch_flags", {}]] as const) {
      const r = await s.call(name, args);
      expect(r.ok, name).toBe(true);
      if (r.ok) {
        expect(JSON.stringify(r.data).length).toBeLessThan(RESULT_CHAR_CAP);
        expect(leakedStrings(r.data, ["emp-0", "site-0", "latitude", "longitude"]), name).toEqual([]);
      }
    }
  });

  it("every declared tool is implemented", async () => {
    const s = session();
    for (const t of ATTENDANCE_TOOLS) {
      const args = t.key === "attendance_person_history" ? { alias: "P4" } : t.key === "attendance_roster_context" ? { date: "2026-10-27" } : {};
      const r = await s.call(t.key, args);
      expect(r.ok, t.key).toBe(true);
    }
  });
});

describe("scoring units", () => {
  const c = byId("person-level-06-far-three-times");

  it("a submission that does not parse scores a miss, not an exception", async () => {
    const built = await buildCase(c);
    const s = scoreCase(c, { findings: "x" }, built.toolResults);
    expect(s.parsed).toBe(false);
    expect(s.must_flag_hit).toBe(0);
    expect(s.missed).toEqual(["far_punches/person/P4"]);
  });

  it("recall needs the right kind, level, subject and the cited fields", async () => {
    const built = await buildCase(c);
    const ref = referenceSubmission(built.digest);
    expect(scoreCase(c, JSON.parse(JSON.stringify(ref)), built.toolResults).must_flag_hit).toBe(1);
    const noCite = JSON.parse(JSON.stringify(ref));
    noCite.findings[0].evidence = [{ step: "s1", path: "candidates[0]", label: "c" }];
    expect(scoreCase(c, noCite, built.toolResults).must_flag_hit).toBe(0);
  });

  it("a recheck aimed at an alias the case forbids is counted", async () => {
    const built = await buildCase(c);
    const ref = JSON.parse(JSON.stringify(referenceSubmission(built.digest)));
    ref.proposals[0].target_aliases = ["P4", "P1"];
    const s = scoreCase(c, ref, built.toolResults);
    expect(s.forbidden_proposals).toContain("recheck targets P1");
  });

  it("an expected gap that is not said is reported", async () => {
    const built = await buildCase(c);
    const withGap: EvalCase = { ...c, expect: { ...c.expect, must_gap: ["roster not visible"] } };
    expect(scoreCase(withGap, JSON.parse(JSON.stringify(referenceSubmission(built.digest))), built.toolResults).gaps_missing).toEqual(["roster not visible"]);
  });

  it("the gate", () => {
    const ok: CaseScore = {
      id: "x", tags: [], parsed: true, parse_errors: [], findings: 1, person_findings: 0, must_flag_expected: 1, must_flag_hit: 1, missed: [],
      false_positives: [], person_level_violations: 0, dropped: 0, ungrounded_drops: 0, banned_terms: [], person_without_explanation: 0,
      forbidden_proposals: [], gaps_missing: [],
    };
    expect(releaseGate(aggregate([ok]))).toEqual({ pass: true, failures: [] });
    // recall exactly 85 percent passes, below fails
    const many = Array.from({ length: 20 }, (_, i) => ({ ...ok, id: String(i), must_flag_hit: i < 17 ? 1 : 0 }));
    expect(aggregate(many).recall).toBeCloseTo(0.85);
    expect(releaseGate(aggregate(many)).pass).toBe(true);
    const fewer = Array.from({ length: 20 }, (_, i) => ({ ...ok, id: String(i), must_flag_hit: i < 16 ? 1 : 0 }));
    expect(releaseGate(aggregate(fewer)).pass).toBe(false);
    for (const bad of [{ person_level_violations: 1 }, { banned_terms: ["fraud"] }, { person_without_explanation: 1 }, { false_positives: ["x"] }]) {
      expect(releaseGate(aggregate([{ ...ok, ...bad }])).pass, JSON.stringify(bad)).toBe(false);
    }
  });
});
