import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendanceReads } from "../attendance/facts";
import type { PlanCtx, RunContext } from "../types";

// Attendance Anomalies wired into the shared runner, over a fixture instead of a database: the schedule gate (a closed day is planned once, a quiet
// workspace costs nothing, a manual run is its own run), the run's preparation (digest as step s1, the alias map, the people addressed) and the
// hand-off of the model's submission to the shared persist shape. The database readers and the tender helpers are mocked.

const h = vi.hoisted(() => ({
  reads: null as unknown,
  ran: false,
  chain: [] as { employeeId: string; userId: string }[],
  admins: [] as string[],
  members: (ids: string[]) => ids,
  hasRun: false,
}));
vi.mock("@/lib/wfm/crewReads", () => ({ attendanceReads: () => { h.ran = true; return h.reads; }, siteCommandChain: async () => h.chain, tenantAdminUserIds: async () => h.admins }));
vi.mock("@/lib/tender/roomServer", () => ({ tenantMemberIds: async (_a: unknown, _t: string, ids: string[]) => h.members(ids) }));
vi.mock("./store", () => ({ hasRunForDay: async () => h.hasRun }));

import { addDays } from "../attendance/dates";
import { loadCases, readsFromInput } from "../attendance/eval/fixtures";
import { referenceSubmission } from "../attendance/eval/reference";
import { attendanceDefinition, attendanceRuntime, type AttendanceSnapshot } from "./attendance";

const cases = loadCases();
const input = (id: string) => cases.find((c) => c.id === id)!.input;
const hasRun = (v: boolean) => { h.hasRun = v; };
const sid = (id: string) => `site-${input(id).site.alias.slice(1).padStart(4, "0")}`;
const SITE_RE = /^attendance\|site:site-\d{4}\|day:\d{4}-\d{2}-\d{2}$/;

function planCtx(id: string, over: Partial<PlanCtx> & { at?: string } = {}): PlanCtx {
  const i = input(id);
  const today = addDays(i.run.to, 1);
  return {
    admin: {} as never, tenantId: "t1", now: new Date(`${today}T${over.at ?? "03:00"}:00+05:30`), timezone: "Asia/Kolkata", trigger: "schedule", features: {},
    settings: { agent_key: "attendance", enabled: true, paused: false, config: {}, monthly_token_cap: null, updated_at: null }, ...over,
  } as PlanCtx;
}

beforeEach(() => { h.ran = false; hasRun(false); h.chain = []; h.admins = []; h.members = (ids) => ids; });

describe("plan: the schedule gate", () => {
  it("reads nothing before the slot (02:00 workspace time)", async () => {
    h.reads = readsFromInput(input("site-level-01-late-three-days"));
    expect(await attendanceDefinition.plan(planCtx("site-level-01-late-three-days", { at: "01:30" }))).toEqual([]);
    expect(h.ran).toBe(false);
  });

  it("reads nothing again once the closed day has been planned", async () => {
    h.reads = readsFromInput(input("site-level-01-late-three-days"));
    hasRun(true);
    expect(await attendanceDefinition.plan(planCtx("site-level-01-late-three-days"))).toEqual([]);
    expect(h.ran).toBe(false);
  });

  it("after the slot, plans one run for a site with something to look at, naming the day that closed", async () => {
    h.reads = readsFromInput(input("site-level-01-late-three-days"));
    const reqs = await attendanceDefinition.plan(planCtx("site-level-01-late-three-days"));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ agent_key: "attendance", trigger: "schedule", scope: { site_id: sid("site-level-01-late-three-days"), to: input("site-level-01-late-three-days").run.to } });
    expect(reqs[0].candidate_ids).toEqual([sid("site-level-01-late-three-days")]);
    expect(reqs[0].dedupe_key).toMatch(SITE_RE);
  });

  it("a quiet workspace is ONE zero-token pass that says what was checked", async () => {
    h.reads = readsFromInput(input("quiet-01-everyone-on-time"));
    const reqs = await attendanceDefinition.plan(planCtx("quiet-01-everyone-on-time"));
    expect(reqs).toHaveLength(1);
    expect(reqs[0].candidate_ids).toEqual([]);
    expect(reqs[0].trigger_ref).toMatch(/^Nothing to report\. 1 site checked$/);
  });

  it("a manual run is its own run, and says so", async () => {
    h.reads = readsFromInput(input("site-level-01-late-three-days"));
    hasRun(true);
    const reqs = await attendanceDefinition.plan(planCtx("site-level-01-late-three-days", { trigger: "manual", at: "10:15" }));
    expect(reqs).toHaveLength(1);
    expect(reqs[0].trigger_ref).toBe("Run now");
    expect(reqs[0].dedupe_key).toMatch(/\|manual:\d{4}-\d{2}-\d{2}T\d{2}$/);
  });

  it("the definition proposes only, the recheck is its one action, and it needs crew, its own flag and WFM", () => {
    expect(attendanceDefinition.autonomy).toBe("propose");
    expect(attendanceDefinition.actions).toEqual(["wfm.recheck"]);
    expect(attendanceDefinition.requires.features).toEqual(["crew", "crew_attendance", "wfm"]);
    expect(attendanceDefinition.triggers.events).toBeUndefined();
    expect(attendanceDefinition.defaults.monthlyTokenCap).toBe(500_000);
  });
});

describe("prepare and the hand-off of a submission", () => {
  async function prepared(id: string, settings: Partial<RunContext["settings"]["config"]> = {}) {
    const i = input(id);
    h.reads = readsFromInput(i);
    const ctx = {
      admin: {} as never, tenantId: "t1", runId: "r1", agentKey: "attendance", scope: { site_id: sid(id), from: i.run.from, to: i.run.to }, now: new Date(),
      timezone: "Asia/Kolkata", candidateIds: new Set([sid(id)]), aliases: null,
      settings: { agent_key: "attendance", enabled: true, paused: false, config: settings, monthly_token_cap: null, updated_at: null },
    } as unknown as RunContext;
    return { i, ctx, p: await attendanceRuntime.prepare(ctx, {} as never) };
  }

  it("builds the digest as step s1, with aliases only, and the alias map that stays server-side", async () => {
    const { p } = await prepared("person-level-06-far-three-times");
    const digest = p.prefetch.output as { candidates: { id: string }[]; site: { alias: string } };
    expect(p.prefetch.name).toBe("attendance digest");
    expect(digest.candidates.length).toBeGreaterThan(0);
    expect(p.user).toContain("<data>");
    expect(p.user).not.toMatch(/emp-\d{4}|site-\d{4}/);
    expect(Object.values(p.aliasMap!.persons)[0]).toMatch(/^emp-/);
    expect(p.aliasMap!.sites[digest.site.alias]).toBe(sid("person-level-06-far-three-times"));
    expect(p.toolIds).toContain(digest.site.alias);
    expect(p.toolIds!.some((x) => /^P\d+$/.test(x))).toBe(true);
  });

  it("keeps the daily strip for the card on the run's snapshot", async () => {
    const { i, p } = await prepared("site-level-01-late-three-days");
    const snap = p.snapshot as unknown as AttendanceSnapshot;
    expect(snap.strip.dates).toHaveLength(14);
    expect(snap.strip.dates[0]).toBe(i.run.from);
    expect(snap.strip.rostered).toHaveLength(14);
    expect(snap.marked).toEqual({});
  });

  it("addresses the site's chain of command and the extra recipients, and leaves out the person a finding is about", async () => {
    h.chain = [{ employeeId: "emp-0004", userId: "u-subject" }, { employeeId: "emp-0900", userId: "u-super" }];
    const { p } = await prepared("person-level-06-far-three-times", { recipient_ids: ["u-extra"] });
    expect(p.seenBy(sid("person-level-06-far-three-times")).sort()).toEqual(["u-extra", "u-subject", "u-super"]);
    expect(p.seenBy("emp-0004").sort()).toEqual(["u-extra", "u-super"]);
  });

  it("a site with nobody set above it is addressed to the workspace admins, so a suggestion never lands with nobody", async () => {
    h.chain = [];
    h.admins = ["u-admin"];
    const { p } = await prepared("person-level-06-far-three-times");
    expect(p.seenBy(sid("person-level-06-far-three-times"))).toEqual(["u-admin"]);
    expect(p.seenBy("emp-0004")).toEqual(["u-admin"]);
  });

  it("reads each thing once per run: the digest and the tools share the site's facts, and two runs share nothing", async () => {
    const i = input("person-level-06-far-three-times");
    const base = readsFromInput(i);
    const calls = { summary: 0 };
    h.reads = { ...base, getSummaryForRange: async (...a: Parameters<typeof base.getSummaryForRange>) => { calls.summary++; return base.getSummaryForRange(...a); } } satisfies AttendanceReads;
    const run = (runId: string) => ({
      admin: {} as never, tenantId: "t1", runId, agentKey: "attendance", scope: { site_id: sid("person-level-06-far-three-times"), from: i.run.from, to: i.run.to }, now: new Date(),
      timezone: "Asia/Kolkata", candidateIds: new Set([sid("person-level-06-far-three-times")]), aliases: null,
      settings: { agent_key: "attendance", enabled: true, paused: false, config: {}, monthly_token_cap: null, updated_at: null },
    }) as unknown as RunContext;
    const one = run("r1");
    const p = await attendanceRuntime.prepare(one, {} as never);
    const toolCtx = { ...one, aliases: new Map(Object.entries(p.aliasMap!.persons)), candidateIds: new Set([...one.candidateIds, ...(p.toolIds ?? [])]) } as RunContext;
    const digestTool = attendanceRuntime.adapters.find((a) => a.key === "attendance_site_digest")!;
    const flagsTool = attendanceRuntime.adapters.find((a) => a.key === "attendance_punch_flags")!;
    expect((await digestTool.run(toolCtx, {})).ok).toBe(true);
    expect((await flagsTool.run(toolCtx, {})).ok).toBe(true);
    expect(calls.summary).toBe(1);
    await attendanceRuntime.prepare(run("r2"), {} as never);
    expect(calls.summary).toBe(2);
  });

  it("validates the model's submission into the shared shape, fills the strip's pattern days, and nothing carries a real id in its text", async () => {
    h.chain = [{ employeeId: "emp-0900", userId: "u-super" }];
    const { p } = await prepared("site-level-06-nine-did-not-check-out");
    const digest = p.prefetch.output as Parameters<typeof referenceSubmission>[0];
    const out = attendanceRuntime.submission!.validate(referenceSubmission(digest), new Map([["s1", digest]]), p);
    expect(out.rejected).toEqual([]);
    expect(out.accepted.length).toBeGreaterThan(0);
    const f = out.accepted[0];
    expect(f.site_id).toBe(sid("site-level-06-nine-did-not-check-out"));
    expect(f.recipient_ids).toEqual(["u-super"]);
    expect(f.title + f.body).not.toMatch(/emp-\d|site-\d/);
    expect(Object.keys((p.snapshot as unknown as AttendanceSnapshot).marked)).toContain(f.fingerprint);
    expect(f.proposal?.action_key).toBe("wfm.recheck");
  });

  it("a malformed answer is rejected with its reason and persists nothing", async () => {
    const { p } = await prepared("quiet-01-everyone-on-time");
    const out = attendanceRuntime.submission!.validate({ nope: true }, new Map(), p);
    expect(out.accepted).toEqual([]);
    expect(out.rejected[0].reason).toMatch(/^malformed/);
  });
});
