import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));
vi.mock("@/lib/coverage/resolve", () => ({
  computeAccountSignals: vi.fn(async () => ({ has_active_amc: false, owned_product_skus: "" })),
  resolveCoverageForAccount: vi.fn(),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb, type Row } from "../testFakeDb";
import { scoreLead } from "./scorer";
import { pickOwnerForLead } from "./assign";
import { runLeadScoringPass } from "./runner";
import { buildMarketingCard } from "./account360Card";
import { isWorkspaceMember } from "./people";

const NOW = new Date("2026-10-22T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const ON = { marketing: true, marketing_scoring: true, leads: true };

type Seed = Record<string, Row[]>;

function withAuth(client: SupabaseClient, emails: Record<string, string> = {}) {
  (client as unknown as { auth: unknown }).auth = {
    admin: { getUserById: async (id: string) => ({ data: { user: emails[id] ? { id, email: emails[id], user_metadata: {} } : null } }) },
  };
  return client;
}

function seed(extra: Seed = {}): Seed {
  return {
    tenants: [
      { id: "t1", features: ON, config: {} },
      { id: "t2", features: ON, config: {} },
    ],
    tenant_users: [
      { tenant_id: "t1", user_id: "admin1", role: "admin", created_at: "2026-01-01" },
      { tenant_id: "t2", user_id: "admin2", role: "admin", created_at: "2026-01-01" },
    ],
    accounts: [
      { id: "a1", tenant_id: "t1", name: "Gulf Precast", type: "oem", country: "Qatar", industry: "Construction" },
      { id: "a2", tenant_id: "t2", name: "Other Co", type: "direct", country: "India" },
    ],
    contacts: [
      { id: "c1", tenant_id: "t1", account_id: "a1", name: "Rana", role: "Procurement Manager", department: "Buying" },
      { id: "c2", tenant_id: "t2", account_id: "a2", name: "Someone", role: "Clerk" },
    ],
    leads: [
      { id: "l1", tenant_id: "t1", account_id: "a1", contact_id: "c1", title: "Gulf Precast: pumps", source: "campaign", status: "new", custom_status_id: null, score: null, score_factors: null, scored_at: null, owner_user_id: null, created_at: "2026-10-01" },
      { id: "l2", tenant_id: "t2", account_id: "a2", contact_id: "c2", title: "Other Co lead", source: "direct", status: "new", custom_status_id: null, score: null, score_factors: null, scored_at: null, owner_user_id: null, created_at: "2026-10-01" },
    ],
    domain_event: [],
    status_profile: [], custom_status: [], status_transition_rule: [], status_history: [],
    contracts: [],
    ...extra,
  };
}

const ev = (id: string, tenant: string, name: string, contact: string | null, ageHours: number, over: Row = {}): Row => ({
  id, tenant_id: tenant, name, contact_id: contact, account_id: tenant === "t1" ? "a1" : "a2", occurred_at: hoursAgo(ageHours), created_at: hoursAgo(ageHours),
  payload: {}, depth: 0, dedupe_key: id, ...over,
});

describe("scoring a lead from what its person did", () => {
  it("turns events into a score, stored factors in plain words, and a stage", async () => {
    const { client, tables } = fakeDb(seed({
      domain_event: [
        ev("e1", "t1", "email.clicked", "c1", 2),
        ev("e2", "t1", "email.clicked", "c1", 3),
        ev("e3", "t1", "email.interest", "c1", 4),
        ev("e4", "t1", "quote.opened", "c1", 5),
      ],
    }));
    const r = await scoreLead(client, "t1", "l1", { now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // behaviour ~ 2 clicks + interest + quote opened, plus profile (OEM 10, Gulf 5, buyer role 10)
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.stage).toBe("ready");

    const lead = tables.leads.find((l) => l.id === "l1")!;
    expect(lead.score).toBe(r.score);
    const stored = lead.score_factors as { factors: { label: string; kind: string }[]; rubric_version: number };
    expect(stored.rubric_version).toBe(1);
    const labels = stored.factors.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["Said they are interested", "Opened a quote", "Clicked a link in an email", "OEM account", "Based in the Gulf", "Buyer-type role"]));
    expect(lead.scored_at).toBe(NOW.toISOString());
  });

  it("is a pure recompute: running it again changes nothing and announces nothing twice", async () => {
    const { client, tables } = fakeDb(seed({ domain_event: [ev("e1", "t1", "email.interest", "c1", 2), ev("e2", "t1", "quote.opened", "c1", 3)] }));
    const first = await scoreLead(client, "t1", "l1", { now: NOW });
    const afterFirst = JSON.stringify(tables.leads.find((l) => l.id === "l1"));
    const eventsAfterFirst = tables.domain_event.length;
    const second = await scoreLead(client, "t1", "l1", { now: NOW });
    expect(first.ok && first.moved_to).toBe("ready");
    expect(second.ok && second.moved_to).toBeNull();
    expect(second).toEqual({ ...first, moved_to: null });
    expect(JSON.stringify(tables.leads.find((l) => l.id === "l1"))).toBe(afterFirst);
    expect(tables.domain_event.length).toBe(eventsAfterFirst);
    expect(tables.status_history.length).toBeLessThanOrEqual(1);
  });

  it("lets a score fade as time passes, with no new events", async () => {
    const db = fakeDb(seed({ domain_event: [ev("e1", "t1", "email.clicked", "c1", 24 * 3)] }));
    const early = await scoreLead(db.client, "t1", "l1", { now: NOW });
    const late = await scoreLead(db.client, "t1", "l1", { now: new Date(NOW.getTime() + 28 * 86_400_000) });
    expect(early.ok && late.ok).toBe(true);
    if (early.ok && late.ok) expect(late.score).toBeLessThan(early.score);
  });

  it("ignores the score's own announcements and events past the loop guard", async () => {
    const { client } = fakeDb(seed({
      domain_event: [
        ev("e1", "t1", "lead.scored", "c1", 1, { payload: { score: 99 } }),
        ev("e2", "t1", "email.clicked", "c1", 1, { depth: 3 }),
      ],
    }));
    const r = await scoreLead(client, "t1", "l1", { now: NOW });
    expect(r.ok && r.events_seen).toBe(0);
  });

  it("never reads another workspace's events or leads, even for the same ids", async () => {
    const { client, tables, queries } = fakeDb(seed({
      domain_event: [ev("x1", "t2", "email.interest", "c1", 1), ev("x2", "t2", "quote.opened", "c1", 1)],
    }));
    const mine = await scoreLead(client, "t1", "l1", { now: NOW });
    expect(mine.ok && mine.events_seen).toBe(0);
    // A lead id from the other workspace is simply not found.
    const theirs = await scoreLead(client, "t1", "l2", { now: NOW });
    expect(theirs).toEqual({ ok: false, reason: "not_found" });
    expect(tables.leads.find((l) => l.id === "l2")!.score).toBeNull();
    for (const q of queries.filter((x) => x.op !== "upsert" && x.op !== "insert" && ["domain_event", "leads", "accounts", "contacts"].includes(x.table))) {
      expect(q.filters.tenant_id).toBe("t1");
    }
  });

  it("moves a lead up the early stages, hands it to an owner and starts the response clock", async () => {
    const { client, tables } = fakeDb(seed({ domain_event: [ev("e1", "t1", "email.interest", "c1", 1), ev("e2", "t1", "quote.opened", "c1", 2), ev("e3", "t1", "form.submitted", "c1", 3)] }));
    const r = await scoreLead(client, "t1", "l1", { now: NOW });
    expect(r.ok && r.moved_to).toBe("ready");
    const lead = tables.leads.find((l) => l.id === "l1")!;
    expect(lead.owner_user_id).toBe("admin1");
    expect(lead.assignment_reason).toBe("fallback_admin");
    expect(typeof lead.sla_due_at).toBe("string");
    expect(typeof lead.ready_at).toBe("string");
    expect(tables.domain_event.some((e) => e.name === "lead.assigned" && e.tenant_id === "t1")).toBe(true);
    expect(tables.domain_event.some((e) => e.name === "lead.stage_changed")).toBe(true);
  });

  it("never pulls a lead back down or touches one a person has already taken on", async () => {
    const { client, tables } = fakeDb(seed({ domain_event: [] }));
    tables.leads.find((l) => l.id === "l1")!.status = "inspecting";
    const r = await scoreLead(client, "t1", "l1", { now: NOW });
    expect(r.ok && r.moved_to).toBeNull();
    expect(tables.leads.find((l) => l.id === "l1")!.status).toBe("inspecting");
  });

  it("tells the new owner through the Nova inbox, once, when Nova is on", async () => {
    const s = seed({ domain_event: [ev("e1", "t1", "email.interest", "c1", 1), ev("e2", "t1", "quote.opened", "c1", 2), ev("e3", "t1", "form.submitted", "c1", 3)], record_comments: [] });
    s.tenants[0].features = { ...ON, next_experience: true };
    const { client, tables } = fakeDb(s);
    withAuth(client, { admin1: "Rep@Example.com" });
    await scoreLead(client, "t1", "l1", { now: NOW });
    await scoreLead(client, "t1", "l1", { now: NOW });
    expect(tables.record_comments).toHaveLength(1);
    expect(tables.record_comments[0]).toMatchObject({ tenant_id: "t1", object_type: "leads", object_id: "l1", mentions: ["rep@example.com"] });
  });

  it("writes no notice when Nova is off", async () => {
    const { client, tables } = fakeDb(seed({ domain_event: [ev("e1", "t1", "email.interest", "c1", 1), ev("e2", "t1", "quote.opened", "c1", 2), ev("e3", "t1", "form.submitted", "c1", 3)], record_comments: [] }));
    withAuth(client, { admin1: "rep@example.com" });
    await scoreLead(client, "t1", "l1", { now: NOW });
    expect(tables.record_comments).toHaveLength(0);
  });

  it("degrades cleanly while the lead columns are not there yet", async () => {
    const { client } = fakeDb(seed(), { missingTables: ["leads"] });
    expect(await scoreLead(client, "t1", "l1", { now: NOW })).toMatchObject({ ok: false, reason: "pending" });
  });
});

describe("who gets a ready lead", () => {
  const team = (over: Row = {}): Row => ({ id: "team1", tenant_id: "t1", name: "South", lead_user_id: "lead1", assignment_mode: "lead", last_assigned_user_id: null, ...over });
  const resolver = (t: Row | null) => (async () => (t ? { owner: { team: t }, overlays: [], services: [] } : { owner: null, overlays: [], services: [] })) as never;
  const lead = { account_id: "a1" };

  it("gives it to the owning team's lead by default", async () => {
    const { client } = fakeDb(seed({ teams: [team()] }));
    const r = await pickOwnerForLead(client, "t1", lead, { coverage_model: true }, { resolveCoverage: resolver(team()) });
    expect(r).toEqual({ owner_user_id: "lead1", reason: "team_lead", team_id: "team1" });
  });

  it("takes turns on a round-robin team and remembers whose turn it was", async () => {
    const t = team({ assignment_mode: "round_robin" });
    const { client, tables } = fakeDb(seed({ teams: [t], team_members: ["u3", "u1", "u2"].map((u, i) => ({ id: `m${i}`, tenant_id: "t1", team_id: "team1", user_id: u })) }));
    const picks: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const cur = tables.teams[0];
      const r = await pickOwnerForLead(client, "t1", lead, { coverage_model: true }, { resolveCoverage: resolver({ ...cur }) });
      expect(r.reason).toBe("round_robin");
      picks.push(r.owner_user_id);
    }
    expect(picks).toEqual(["u1", "u2", "u3", "u1"]);
    expect(tables.teams[0].last_assigned_user_id).toBe("u1");
  });

  it("falls back to an admin, and says so, when no coverage matches", async () => {
    const { client } = fakeDb(seed());
    expect(await pickOwnerForLead(client, "t1", lead, { coverage_model: true }, { resolveCoverage: resolver(null) }))
      .toEqual({ owner_user_id: "admin1", reason: "fallback_admin", team_id: null });
    expect(await pickOwnerForLead(client, "t1", lead, {}, {})).toMatchObject({ reason: "fallback_admin" });
  });

  it("shows a gap rather than inventing an owner when the workspace has no admin", async () => {
    const s = seed();
    s.tenant_users = [];
    const { client } = fakeDb(s);
    expect(await pickOwnerForLead(client, "t1", lead, {}, {})).toEqual({ owner_user_id: null, reason: "unassigned", team_id: null });
  });

  it("only ever picks an admin of the same workspace", async () => {
    const { client, queries } = fakeDb(seed());
    const r = await pickOwnerForLead(client, "t2", { account_id: "a2" }, {}, {});
    expect(r.owner_user_id).toBe("admin2");
    expect(queries.filter((q) => q.table === "tenant_users").every((q) => q.filters.tenant_id === "t2")).toBe(true);
  });

  it("checks that an owner belongs to the workspace", async () => {
    const { client } = fakeDb(seed());
    expect(await isWorkspaceMember(client, "t1", "admin1")).toBe(true);
    expect(await isWorkspaceMember(client, "t1", "admin2")).toBe(false);
  });
});

describe("the scoring run", () => {
  const clockAdvancing = (stepMs: number) => { let t = 0; return () => (t += stepMs); };

  it("scores only workspaces that have the program, and never reads the others", async () => {
    const s = seed({ domain_event: [ev("e1", "t1", "email.interest", "c1", 1)] });
    s.tenants.push({ id: "t3", features: { marketing: true, leads: true }, config: {} });
    s.leads.push({ id: "l3", tenant_id: "t3", account_id: "a3", contact_id: null, title: "Off", status: "new", score: null, scored_at: null });
    const { client, tables, queries } = fakeDb(s);
    const sum = await runLeadScoringPass(client, { now: NOW });
    expect(sum.tenants_checked).toBe(2);
    expect(tables.leads.find((l) => l.id === "l1")!.score).not.toBeNull();
    expect(tables.leads.find((l) => l.id === "l3")!.score).toBeNull();
    expect(queries.some((q) => q.filters.tenant_id === "t3")).toBe(false);
  });

  it("is idempotent: a second run over the same moment changes nothing", async () => {
    const { client, tables } = fakeDb(seed({ domain_event: [ev("e1", "t1", "email.interest", "c1", 1), ev("e2", "t1", "email.clicked", "c1", 2)] }));
    await runLeadScoringPass(client, { now: NOW });
    const snapshot = JSON.stringify(tables.leads);
    const events = tables.domain_event.length;
    await runLeadScoringPass(client, { now: NOW });
    expect(JSON.stringify(tables.leads)).toBe(snapshot);
    expect(tables.domain_event.length).toBe(events);
  });

  it("visits the workspace it has not seen for longest first", async () => {
    const s = seed({
      marketing_scoring_state: [
        { tenant_id: "t1", event_cursor_at: hoursAgo(1), last_run_at: hoursAgo(1) },
        { tenant_id: "t2", event_cursor_at: hoursAgo(9), last_run_at: hoursAgo(9) },
      ],
    });
    const { client, queries } = fakeDb(s);
    // Budget for one workspace only.
    const sum = await runLeadScoringPass(client, { now: NOW, budgetMs: 3, clock: clockAdvancing(1) });
    expect(sum.tenants_run).toBe(1);
    expect(sum.budget_exhausted).toBe(true);
    const firstTenantQueried = queries.map((q) => q.filters.tenant_id).find((t) => t === "t1" || t === "t2");
    expect(firstTenantQueried).toBe("t2");
  });

  it("stops starting work when the time is spent and leaves the rest for the next run", async () => {
    const s = seed();
    for (let i = 0; i < 5; i++) s.leads.push({ id: `x${i}`, tenant_id: "t1", account_id: "a1", contact_id: "c1", title: `X${i}`, status: "new", score: null, scored_at: null, created_at: "2026-10-01" });
    const { client, tables } = fakeDb(s);
    const sum = await runLeadScoringPass(client, { now: NOW, budgetMs: 3, clock: clockAdvancing(1) });
    expect(sum.budget_exhausted).toBe(true);
    const scored = tables.leads.filter((l) => l.tenant_id === "t1" && l.scored_at).length;
    expect(scored).toBeGreaterThan(0);
    expect(scored).toBeLessThan(6);
    // The next run finishes the job.
    await runLeadScoringPass(client, { now: NOW });
    expect(tables.leads.filter((l) => l.tenant_id === "t1" && !l.scored_at)).toHaveLength(0);
  });

  it("picks up a lead whose person did something since the last run, and decays old scores", async () => {
    const s = seed({
      domain_event: [ev("e1", "t1", "email.interest", "c1", 0.2)],
      marketing_scoring_state: [{ tenant_id: "t1", event_cursor_at: hoursAgo(1), last_run_at: hoursAgo(1) }],
    });
    s.leads[0].score = 5; s.leads[0].scored_at = hoursAgo(1); // fresh, so only the new event can trigger it
    const { client, tables } = fakeDb(s);
    await runLeadScoringPass(client, { now: NOW });
    expect(tables.leads.find((l) => l.id === "l1")!.score).toBeGreaterThan(5);
    const state = tables.marketing_scoring_state.find((r) => r.tenant_id === "t1")!;
    expect(state.last_run_at).toBe(NOW.toISOString());
    expect(state.event_cursor_at).toBe(hoursAgo(0.2));
  });

  it("flags an overdue ready lead once", async () => {
    const s = seed();
    Object.assign(s.leads[0], { status: "new", sla_due_at: hoursAgo(5), score: 70, scored_at: hoursAgo(1) });
    const { client, tables } = fakeDb(s);
    // A stored 'ready' stage needs the status profile; create it through a stage move first.
    const { setLeadStage } = await import("../leadStatus");
    await setLeadStage({ tenantId: "t1", leadId: "l1", to: "ready", userId: "admin1", role: "admin", client });
    Object.assign(tables.leads[0], { sla_due_at: hoursAgo(5) });
    const a = await runLeadScoringPass(client, { now: NOW });
    const b = await runLeadScoringPass(client, { now: NOW });
    expect(a.overdue_flagged).toBe(1);
    expect(tables.domain_event.filter((e) => e.name === "lead.sla_breached")).toHaveLength(1);
    expect(b.overdue_flagged).toBe(1); // the event write is a no-op the second time
    expect(tables.domain_event.filter((e) => e.name === "lead.sla_breached")).toHaveLength(1);
  });

  it("still works while the bookmark table is not there yet", async () => {
    const { client, tables } = fakeDb(seed({ domain_event: [ev("e1", "t1", "email.interest", "c1", 1)] }), { missingTables: ["marketing_scoring_state"] });
    const sum = await runLeadScoringPass(client, { now: NOW });
    expect(sum.errors).toBe(0);
    expect(tables.leads.find((l) => l.id === "l1")!.score).not.toBeNull();
  });
});

describe("the Account 360 marketing card", () => {
  it("shows the account's best lead and nothing from another workspace", async () => {
    const s = seed();
    Object.assign(s.leads[0], { score: 72, status: "new", sla_due_at: null });
    s.leads.push({ id: "l9", tenant_id: "t2", account_id: "a1", contact_id: null, title: "Foreign", status: "new", score: 99, created_at: "2026-10-02" });
    const { client } = fakeDb(s);
    withAuth(client);
    const card = await buildMarketingCard(client, "t1", "a1");
    expect(card?.id).toBe("marketing");
    expect(card?.stats?.[0].value).toBe("72");
    expect(card?.rows?.[0].title).toBe("Gulf Precast: pumps");
  });

  it("says so when the account has no lead, and is not offered while the columns are missing", async () => {
    const s = seed();
    s.accounts.push({ id: "a5", tenant_id: "t1", name: "Empty", type: "direct" });
    const { client } = fakeDb(s);
    withAuth(client);
    expect((await buildMarketingCard(client, "t1", "a5"))?.empty).toMatch(/Nobody/);
    const broken = fakeDb(seed(), { missingTables: ["leads"] });
    expect(await buildMarketingCard(broken.client, "t1", "a1")).toBeNull();
  });
});
