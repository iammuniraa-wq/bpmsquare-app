import { describe, expect, it } from "vitest";
import { canSeeFinding, canSeeRun, canSeeRuns, type Viewer } from "./visibility";

// Who sees an attendance finding (design 5.5): admins always; a supervisor only once a platform admin has widened the agent, and then only by site scope
// or by the employees in their own subtree, never by being listed. Tender Watch behaves as it did.

const scope = (over: Partial<NonNullable<Viewer["attendance"]>> = {}) => ({ unrestricted: false, employeeIds: ["e1", "e2"], siteIds: ["s1"], ...over });
const sup = (over: Partial<Viewer> = {}): Viewer => ({ role: "member", userId: "u-sup", pipeline: false, attendance: scope(), ...over });
const site = (siteId: string | null) => ({ agent_key: "attendance" as const, recipient_ids: ["u-sup"], site_id: siteId, subject_type: "site", subject_id: siteId ?? "x" });
const person = (employeeId: string, siteId: string | null = "s1") => ({ agent_key: "attendance" as const, recipient_ids: ["u-sup"], site_id: siteId, subject_type: "employee", subject_id: employeeId });

describe("attendance findings", () => {
  it("a workspace admin sees every one, in the shadow period too", () => {
    expect(canSeeFinding({ role: "admin", userId: "a", pipeline: false }, site("s9"), "admins")).toBe(true);
    expect(canSeeFinding({ role: "admin", userId: "a", pipeline: false }, person("e9"), undefined)).toBe(true);
  });

  it("a supervisor sees nothing while the agent is in its admin-only shadow, even when listed and in scope", () => {
    expect(canSeeFinding(sup(), site("s1"), "admins")).toBe(false);
    expect(canSeeFinding(sup(), site("s1"), undefined)).toBe(false);
    expect(canSeeFinding(sup(), person("e1"), undefined)).toBe(false);
  });

  it("once widened, a supervisor sees the sites they supervise and the people in their subtree, and nothing else", () => {
    expect(canSeeFinding(sup(), site("s1"), "deal_teams")).toBe(true);
    expect(canSeeFinding(sup(), site("s2"), "deal_teams")).toBe(false);
    expect(canSeeFinding(sup(), person("e1"), "deal_teams")).toBe(true);
    expect(canSeeFinding(sup(), person("e7"), "deal_teams")).toBe(false);
  });

  it("a supervisor never sees a finding about themselves: their own employee id is not in their scope", () => {
    expect(canSeeFinding(sup({ attendance: scope({ employeeIds: ["e1"] }) }), person("e-self", "s1"), "deal_teams")).toBe(false);
  });

  it("being listed as a recipient is not enough, and a member with no WFM scope sees nothing", () => {
    expect(canSeeFinding(sup({ attendance: null }), site("s1"), "deal_teams")).toBe(false);
    expect(canSeeFinding({ role: "member", userId: "u-sup", pipeline: true }, site("s1"), "deal_teams")).toBe(false);
  });

  it("an unrestricted WFM login (no place in the tree) sees all once widened", () => {
    expect(canSeeFinding(sup({ attendance: scope({ unrestricted: true, employeeIds: null, siteIds: [] }) }), person("e99"), "deal_teams")).toBe(true);
  });
});

describe("attendance runs", () => {
  const run = (siteId?: string) => ({ agent_key: "attendance" as const, scope: siteId ? { site_id: siteId } : {} });
  it("admins see all; a supervisor sees only the runs of their own sites, and only once widened", () => {
    expect(canSeeRun({ role: "admin", userId: "a", pipeline: false }, run("s9"), "admins")).toBe(true);
    expect(canSeeRun(sup(), run("s1"), "admins")).toBe(false);
    expect(canSeeRun(sup(), run("s1"), "deal_teams")).toBe(true);
    expect(canSeeRun(sup(), run("s2"), "deal_teams")).toBe(false);
  });
  it("a pass that looked at no site (a quiet day) names no one and stays with the admins", () => {
    expect(canSeeRun(sup(), run(), "deal_teams")).toBe(false);
    expect(canSeeRun({ role: "admin", userId: "a", pipeline: false }, run(), "admins")).toBe(true);
  });
  it("other agents keep the old rule", () => {
    expect(canSeeRun({ role: "member", userId: "u", pipeline: true }, { agent_key: "tender_watch", scope: {} }, "deal_teams")).toBe(true);
    expect(canSeeRun({ role: "member", userId: "u", pipeline: true }, { agent_key: "tender_watch", scope: {} }, "admins")).toBe(false);
    expect(canSeeRuns({ role: "member" }, undefined)).toBe(false);
  });
});

describe("tender findings are unchanged", () => {
  const t = { agent_key: "tender_watch" as const, recipient_ids: ["u"] };
  it("deal teams see theirs once widened and with the Pipeline workcenter", () => {
    expect(canSeeFinding({ role: "member", userId: "u", pipeline: true }, t, "deal_teams")).toBe(true);
    expect(canSeeFinding({ role: "member", userId: "u", pipeline: false }, t, "deal_teams")).toBe(false);
    expect(canSeeFinding({ role: "member", userId: "u", pipeline: true }, t, "admins")).toBe(false);
    expect(canSeeFinding({ role: "member", userId: "x", pipeline: true }, t, "deal_teams")).toBe(false);
  });
});
