import { describe, expect, it } from "vitest";
import type { PlanCtx, RunContext } from "../types";
import { buildCase, loadCases, readsFromInput } from "./eval/fixtures";
import { referenceSubmission } from "./eval/reference";
import {
  buildLeadDefinition, engineSettings, leadPlan, leadToolAdapters, toDraftFindings, toLeadRunRequests, toPersisted, workspaceToday,
} from "./leadBridge";
import { toLeadEvalCase } from "./eval/leadCase";
import { planAttendanceDetailed } from "./plan";
import { getByPath, validateSubmission, type RunFacts } from "./validate";

const cases = loadCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;

describe("time and settings", () => {
  it("reads the workspace-local date", () => {
    const now = new Date("2026-11-01T21:00:00Z");
    expect(workspaceToday(now, "Asia/Kolkata")).toBe("2026-11-02");
    expect(workspaceToday(now, "Asia/Riyadh")).toBe("2026-11-02");
    expect(workspaceToday(now, "America/Los_Angeles")).toBe("2026-11-01");
    expect(workspaceToday(now, "Not/AZone")).toBe("2026-11-01");
  });

  it("maps crew_agent_settings.config onto the engine's settings and ignores unknown families", () => {
    expect(engineSettings({ config: {} })).toEqual({ sensitivity: "balanced", families: {}, siteIds: null });
    expect(
      engineSettings({ config: { sensitivity: "quiet", scope: { site_ids: ["a"] }, families: { far_punches: false, buddy_punch: true, late_cluster: true } } })
    ).toEqual({ sensitivity: "quiet", families: { far_punches: false, late_cluster: true }, siteIds: ["a"] });
    expect(engineSettings({ config: { sensitivity: "wild" as never } }).sensitivity).toBe("balanced");
  });
});

describe("plan(): the shared RunRequest shape", () => {
  const ctxFor = (now = new Date("2026-11-02T03:00:00Z")): PlanCtx =>
    ({ admin: {} as never, tenantId: "t", now, timezone: "Asia/Kolkata", settings: { agent_key: "attendance", enabled: true, paused: false, config: {}, monthly_token_cap: null, updated_at: null }, features: {}, trigger: "schedule" });

  it("a site with candidates becomes a run whose candidate_ids is the site", async () => {
    const c = byId("site-level-01-late-three-days");
    const plan = leadPlan(() => readsFromInput(c.input));
    const out = await plan(ctxFor());
    expect(out).toEqual([{
      agent_key: "attendance", trigger: "schedule", trigger_ref: "Daily pass for 1 Nov",
      scope: { site_id: "site-0002", from: "2026-10-19", to: "2026-11-01" },
      dedupe_key: "attendance|site:site-0002|day:2026-11-01", candidate_ids: ["site-0002"], snapshot: { candidate_count: 1 },
    }]);
  });

  it("all sites quiet: one run with no candidates, recorded as 'Nothing to report. N sites checked'", async () => {
    const c = byId("quiet-01-everyone-on-time");
    const out = await leadPlan(() => readsFromInput(c.input))(ctxFor());
    expect(out).toEqual([{
      agent_key: "attendance", trigger: "schedule", trigger_ref: "Nothing to report. 1 site checked",
      scope: { from: "2026-10-19", to: "2026-11-01" }, dedupe_key: "attendance|quiet|day:2026-11-01", candidate_ids: [], snapshot: { sites_checked: 1, quiet_sites: 1 },
    }]);
  });

  it("no site could be read: nothing is recorded (a failure is not a quiet pass)", async () => {
    const outcome = { requests: [], sitesChecked: 0, quietSites: 0, window: { from: "2026-10-19", to: "2026-11-01" }, skipped: [{ siteId: "x", reason: "read_error:boom" }] };
    expect(toLeadRunRequests(outcome, "schedule")).toEqual([]);
  });

  it("the manual trigger is carried through", async () => {
    const c = byId("site-level-01-late-three-days");
    const outcome = await planAttendanceDetailed({ reads: readsFromInput(c.input), today: "2026-11-02", settings: { sensitivity: "balanced", families: {} } });
    expect(toLeadRunRequests(outcome, "manual")[0].trigger).toBe("manual");
  });
});

describe("the definition in the shared shape", () => {
  const def = buildLeadDefinition(() => readsFromInput(cases[0].input));

  it("is the attendance agent, propose-only, with the two read-only-then-recheck capabilities", () => {
    expect(def.key).toBe("attendance");
    expect(def.autonomy).toBe("propose");
    expect(def.actions).toEqual(["wfm.recheck"]);
    expect(def.tools).toEqual(["attendance_site_digest", "attendance_person_history", "attendance_site_baseline", "attendance_roster_context", "attendance_punch_flags"]);
    expect(def.promptVersion).toMatch(/^attendance@/);
    expect(def.defaults).toEqual({ schedule: { time: "02:00" }, sensitivity: "balanced", monthlyTokenCap: 500_000, retentionDays: 90 });
    expect(def.triggers).toEqual({ schedule: { time: "02:00" } });
  });
});

describe("tool adapters in the shared shape", () => {
  const c = byId("person-level-06-far-three-times");
  const base = {
    admin: {} as never, tenantId: "t", runId: "r1", agentKey: "attendance", now: new Date(), timezone: "Asia/Kolkata", candidateIds: new Set(["site-0006"]),
    settings: { agent_key: "attendance", enabled: true, paused: false, config: {}, monthly_token_cap: null, updated_at: null },
  } as const;
  const run = (over: Partial<RunContext>): RunContext => ({ ...base, scope: { site_id: "site-0006", from: c.input.run.from, to: c.input.run.to }, aliases: new Map(c.input.people.map((p) => [p.alias, `emp-${p.alias.slice(1).padStart(4, "0")}`])), ...over }) as RunContext;
  const adapters = leadToolAdapters(() => readsFromInput(c.input));
  const tool = (key: string) => adapters.find((a) => a.key === key)!;

  it("one adapter per declared tool, with an input schema and no tenant argument", () => {
    expect(adapters).toHaveLength(5);
    for (const a of adapters) {
      expect(a.description.length).toBeGreaterThan(10);
      expect(JSON.stringify(a.inputSchema)).not.toMatch(/tenant/);
    }
  });

  it("serves the digest and answers history only for a candidate's alias", async () => {
    const d = await tool("attendance_site_digest").run(run({}), {});
    expect(d.ok && (d.data as { candidates: unknown[] }).candidates).toHaveLength(1);
    const h = await tool("attendance_person_history").run(run({}), { alias: "P4" });
    expect(h.ok).toBe(true);
    expect(await tool("attendance_person_history").run(run({}), { alias: "P1" })).toEqual({ ok: false, error: "unknown_alias" });
  });

  it("a run without a site scope is an error, not a guess", async () => {
    expect(await tool("attendance_site_digest").run(run({ scope: { from: "2026-10-19", to: "2026-11-01" } }), {})).toEqual({ ok: false, error: "no_site_scope" });
  });
});

describe("validated result -> rows to persist", () => {
  async function persisted(id: string) {
    const built = await buildCase(byId(id));
    const result = validateSubmission(referenceSubmission(built.digest), built.toolResults as RunFacts);
    return { built, result, out: toPersisted(result, built.digest, built.aliases) };
  }

  it("a person-level finding: real subject and site ids, aliases kept in the text, three labelled parts, no href", async () => {
    const { out } = await persisted("person-level-06-far-three-times");
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f).toMatchObject({ agent_key: "attendance", kind: "far_punches", subject_type: "employee", subject_id: "emp-0004", site_id: "site-0006", recipient_ids: [] });
    expect(f.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(f.title).toMatch(/^P4 /);
    expect(f.body.split("\n").map((l) => l.split(":")[0])).toEqual(["What was observed", "What else could explain it", "What you could do"]);
    expect(f.evidence.every((e) => e.href === null)).toBe(true);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]).toMatchObject({ action_key: "wfm.recheck", target_type: "employee", target_id: "emp-0004", finding_index: 0 });
    expect(out.proposals[0].payload).toMatchObject({ employee_ids: ["emp-0004"] });
  });

  it("a site finding is about the site; a recheck list targets the site with the people in the payload", async () => {
    const { out } = await persisted("site-level-06-nine-did-not-check-out");
    expect(out.findings[0]).toMatchObject({ subject_type: "site", subject_id: "site-0002", site_id: "site-0002" });
    expect(out.proposals[0]).toMatchObject({ target_type: "site", target_id: "site-0002" });
    expect((out.proposals[0].payload as { employee_ids: string[] }).employee_ids).toHaveLength(9);
  });

  it("a site note has no place in the shared action list: it is handed back as unmapped, not persisted", async () => {
    const { out } = await persisted("site-level-01-late-three-days");
    expect(out.proposals).toEqual([]);
    expect(out.unmapped).toEqual([{ kind: "site_note", finding_index: 0, message: expect.any(String) }]);
  });

  it("drops a finding whose alias has no real id behind it rather than persisting half of it", async () => {
    const { built, result } = await persisted("person-level-06-far-three-times");
    const noPeople = { persons: {}, sites: built.aliases.sites };
    expect(toPersisted(result, built.digest, noPeople)).toEqual({ findings: [], proposals: [], unmapped: [] });
  });

  it("an empty submission projects to an empty list with its reason", () => {
    const sub = referenceSubmission(
      { site: { alias: "S6" }, candidates: [] } as never
    );
    expect(toDraftFindings(sub)).toEqual({ findings: [], nothing_to_report: expect.any(String) });
  });

  it("toDraftFindings on a real submission", async () => {
    const built = await buildCase(byId("person-level-06-far-three-times"));
    const draft = toDraftFindings(referenceSubmission(built.digest));
    expect(draft.findings).toHaveLength(1);
    expect(draft.findings[0]).toMatchObject({ kind: "far_punches", subject: { type: "person", id: "P4" } });
    expect(draft.findings[0].body_tmpl).toContain("What was observed: ");
    expect(draft.findings[0].proposal).toMatchObject({ action_key: "wfm.recheck", target_id: "P4", recipient_ids: [] });
  });
});

describe("eval cases in the shared shape", () => {
  it("every case converts, cites paths that exist in the digest, and keeps quiet cases quiet", async () => {
    for (const c of cases) {
      const lead = await toLeadEvalCase(c);
      expect(lead.id).toBe(c.id);
      expect(lead.tags.length, c.id).toBeGreaterThan(0);
      expect(lead.today).toBe("2026-11-02");
      const digest = lead.tool_results.attendance_site_digest?.["*"];
      expect(digest, c.id).toBeDefined();
      for (const m of lead.expect.must_flag) {
        expect(m.must_cite?.length, c.id).toBeGreaterThan(0);
        for (const p of m.must_cite ?? []) expect(getByPath({ s1: digest }, p), `${c.id} ${p}`).not.toBeUndefined();
      }
      expect(lead.expect.nothing_to_report).toBe(c.expect.must_flag.length === 0);
    }
  });

  it("tags are translated", async () => {
    const lead = await toLeadEvalCase(byId("trainee-01-sunday-is-a-working-day"));
    expect(lead.tags).toEqual(["trainee"]);
    const person = await toLeadEvalCase(byId("person-level-06-far-three-times"));
    expect(person.tags.sort()).toEqual(["flag_worthy", "person_level"]);
    expect(person.tool_results.attendance_person_history?.P4).toBeDefined();
  });
});
