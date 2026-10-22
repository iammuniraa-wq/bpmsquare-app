import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const auth = vi.hoisted(() => ({ role: "admin" as "admin" | "member", tenantId: "t1", db: null as unknown }));
vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: vi.fn(() => auth.db),
  requireTenantUser: vi.fn(async () => ({ tenantId: auth.tenantId, userId: "admin1", role: auth.role })),
}));
vi.mock("@/lib/coverage/resolve", () => ({
  computeAccountSignals: vi.fn(async () => ({ has_active_amc: false, owned_product_skus: "" })),
  resolveCoverageForAccount: vi.fn(),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb, type Row } from "../testFakeDb";
import { tipTextProblems } from "@/lib/infoTip";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import { GET, PUT } from "@/app/api/settings/marketing-handover/route";
import { runLeadScoringPass } from "./runner";
import { pickOwnerForLead } from "./assign";
import { handoverOf, mergeLifecycle, sanitizeHandover, WEEKDAYS } from "./handover";
import { HANDOVER_TIPS } from "./tips";
import { OVERDUE_AUTHOR } from "./notify";
import { setLeadStage } from "../leadStatus";
import { resolveCoverageForAccount } from "@/lib/coverage/resolve";

const NOW = new Date("2026-10-22T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const ON = { marketing: true, marketing_scoring: true, leads: true };
const U = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const [A1, U1, U2, U3, FOREIGN] = [U(1), U(2), U(3), U(4), U(9)];

function withAuth(client: SupabaseClient, emails: Record<string, string> = {}) {
  (client as unknown as { auth: unknown }).auth = {
    admin: { getUserById: async (id: string) => ({ data: { user: emails[id] ? { id, email: emails[id], user_metadata: {} } : null } }) },
  };
  return client;
}

const ev = (id: string, tenant: string, name: string, contact: string | null, ageHours: number, account = tenant === "t1" ? "a1" : "a2"): Row => ({
  id, tenant_id: tenant, name, contact_id: contact, account_id: account, occurred_at: hoursAgo(ageHours), created_at: hoursAgo(ageHours), payload: {}, depth: 0, dedupe_key: id,
});

function seed(config: Row = {}, extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    tenants: [{ id: "t1", features: ON, config }, { id: "t2", features: ON, config: {} }],
    tenant_users: [
      { tenant_id: "t1", user_id: A1, role: "admin", created_at: "2026-01-01" },
      { tenant_id: "t1", user_id: U1, role: "member", created_at: "2026-01-02" },
      { tenant_id: "t1", user_id: U2, role: "member", created_at: "2026-01-03" },
      { tenant_id: "t2", user_id: FOREIGN, role: "admin", created_at: "2026-01-01" },
    ],
    accounts: [
      { id: "a1", tenant_id: "t1", name: "Gulf Precast", type: "oem", country: "Qatar" },
      { id: "a2", tenant_id: "t2", name: "Other Co", type: "direct", country: "India" },
    ],
    contacts: [
      { id: "c1", tenant_id: "t1", account_id: "a1", name: "Rana", role: "Procurement Manager" },
      { id: "c3", tenant_id: "t1", account_id: "a1", name: "Omar Khan", role: "Clerk" },
      { id: "c2", tenant_id: "t2", account_id: "a2", name: "Someone", role: "Clerk" },
    ],
    leads: [],
    domain_event: [],
    status_profile: [], custom_status: [], status_transition_rule: [], status_history: [], record_comments: [], teams: [], team_members: [],
    ...extra,
  };
}

const AUTO = { marketing: { lifecycle: { auto_create_leads: true } } };
const engaged = (contact: string, tenant = "t1") => [ev(`i-${contact}`, tenant, "email.interest", contact, 2), ev(`c-${contact}`, tenant, "email.clicked", contact, 3)];

describe("leads that appear by themselves", () => {
  it("makes one lead for a person with no open lead who reaches Engaged, and says so in the event stream", async () => {
    const { client, tables } = fakeDb(seed(AUTO, { domain_event: engaged("c3") }));
    const sum = await runLeadScoringPass(client, { now: NOW });
    expect(sum.leads_auto_created).toBe(1);
    expect(tables.leads).toHaveLength(1);
    expect(tables.leads[0]).toMatchObject({ tenant_id: "t1", contact_id: "c3", account_id: "a1", source: "inbound", title: "Interest from Omar Khan" });
    const created = tables.domain_event.filter((e) => e.name === "lead.created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ tenant_id: "t1", contact_id: "c3", lead_id: tables.leads[0].id, source: "runner", payload: { source: "inbound", via: "auto" } });
    expect(typeof tables.leads[0].score).toBe("number");
  });

  it("is idempotent: running again, or after the lead moved on, makes no second lead", async () => {
    const { client, tables } = fakeDb(seed(AUTO, { domain_event: engaged("c3") }));
    await runLeadScoringPass(client, { now: NOW });
    await runLeadScoringPass(client, { now: NOW });
    await runLeadScoringPass(client, { now: new Date(NOW.getTime() + 20 * 60_000) });
    expect(tables.leads).toHaveLength(1);
    expect(tables.domain_event.filter((e) => e.name === "lead.created")).toHaveLength(1);
  });

  it("does nothing while the setting is off (the default)", async () => {
    for (const config of [{}, { marketing: { lifecycle: { auto_create_leads: false } } }, { marketing: { lifecycle: { sla_business_days: 2 } } }]) {
      const { client, tables } = fakeDb(seed(config, { domain_event: engaged("c3") }));
      const sum = await runLeadScoringPass(client, { now: NOW });
      expect(sum.leads_auto_created).toBe(0);
      expect(tables.leads).toHaveLength(0);
    }
  });

  it("makes nothing for a person who already has an open lead", async () => {
    const lead: Row = { id: "l1", tenant_id: "t1", account_id: "a1", contact_id: "c3", title: "Existing", source: "direct", status: "inspecting", score: 40, scored_at: hoursAgo(1) };
    const { client, tables } = fakeDb(seed(AUTO, { domain_event: engaged("c3"), leads: [lead] }));
    const sum = await runLeadScoringPass(client, { now: NOW });
    expect(sum.leads_auto_created).toBe(0);
    expect(tables.leads).toHaveLength(1);
  });

  it("a closed lead does not stand in the way", async () => {
    const lead: Row = { id: "l1", tenant_id: "t1", account_id: "a1", contact_id: "c3", title: "Old", source: "direct", status: "lost", score: 10, scored_at: hoursAgo(100) };
    const { client, tables } = fakeDb(seed(AUTO, { domain_event: engaged("c3"), leads: [lead] }));
    await runLeadScoringPass(client, { now: NOW });
    expect(tables.leads.filter((l) => l.source === "inbound")).toHaveLength(1);
  });

  it("makes nothing for someone who has not reached Engaged", async () => {
    const { client, tables } = fakeDb(seed(AUTO, { domain_event: [ev("o1", "t1", "email.opened", "c3", 1)] }));
    const sum = await runLeadScoringPass(client, { now: NOW });
    expect(sum.leads_auto_created).toBe(0);
    expect(tables.leads).toHaveLength(0);
  });

  it("only ever looks at its own workspace: another workspace's people and the setting of another are untouched", async () => {
    const { client, tables, queries } = fakeDb(seed(AUTO, { domain_event: [...engaged("c3"), ...engaged("c2", "t2")] }));
    await runLeadScoringPass(client, { now: NOW });
    expect(tables.leads.map((l) => l.tenant_id)).toEqual(["t1"]);
    for (const q of queries.filter((x) => x.op === "select" && ["leads", "contacts"].includes(x.table))) expect(q.filters.tenant_id, q.table).toBeDefined();
  });

  it("does not crash while migration 0198 is pending: no lead, no error", async () => {
    const db = fakeDb(seed(AUTO, { domain_event: engaged("c3") }));
    const real = db.client.from.bind(db.client);
    (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as { insert: (r: unknown) => unknown };
      if (t === "leads") q.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: "23514", message: "violates check constraint" } }) }) });
      return q;
    };
    const sum = await runLeadScoringPass(db.client, { now: NOW });
    expect(sum.errors).toBe(0);
    expect(sum.leads_auto_created).toBe(0);
    expect(db.tables.leads).toHaveLength(0);
  });

  it("is reached only from the scoring run, never from a request", () => {
    // git grep reads the index, so this stays fast however large src grows.
    const out = execFileSync("git", ["grep", "-l", "-E", "from \"(@/lib/marketing/leads|[.])/autoCreate\"", "--", "src"], { cwd: join(__dirname, "..", "..", "..", ".."), encoding: "utf8" });
    const users = out.split(/\r?\n/).filter((f) => f && !f.endsWith(".test.ts"));
    expect(users).toEqual(["src/lib/marketing/leads/runner.ts"]);
  });
});

describe("overdue", () => {
  const withLead = (config: Row, features: Row = { ...ON, next_experience: true }, extra: Record<string, Row[]> = {}) => {
    const s = seed(config, {
      leads: [{ id: "l1", tenant_id: "t1", account_id: "a1", contact_id: "c1", title: "Gulf Precast: pumps", source: "campaign", status: "new", owner_user_id: U1, score: 70, scored_at: hoursAgo(1), sla_due_at: hoursAgo(30) }],
      ...extra,
    });
    s.tenants[0].features = features;
    const db = fakeDb(s);
    withAuth(db.client, { [U1]: "Rep@Example.com", [A1]: "boss@example.com", [U2]: "lead@example.com" });
    return db;
  };
  const toReady = async (db: ReturnType<typeof fakeDb>) => {
    await setLeadStage({ tenantId: "t1", leadId: "l1", to: "ready", userId: A1, role: "admin", client: db.client });
    Object.assign(db.tables.leads[0], { sla_due_at: hoursAgo(30) });
  };
  const notices = (db: ReturnType<typeof fakeDb>) => db.tables.record_comments.filter((c) => c.author_email === OVERDUE_AUTHOR);

  beforeEach(() => { vi.mocked(resolveCoverageForAccount).mockReset(); });

  it("tells the owner in the Nova inbox, once, however many times the run sees it", async () => {
    const db = withLead({ marketing: { lifecycle: { overdue_notify: { owner: true } } } });
    await toReady(db);
    const a = await runLeadScoringPass(db.client, { now: NOW });
    await runLeadScoringPass(db.client, { now: NOW });
    await runLeadScoringPass(db.client, { now: new Date(NOW.getTime() + 3_600_000) });
    expect(a.overdue_announced).toBe(1);
    expect(notices(db)).toHaveLength(1);
    expect(notices(db)[0]).toMatchObject({ tenant_id: "t1", object_type: "leads", object_id: "l1", mentions: ["rep@example.com"] });
    expect(String(notices(db)[0].body)).toContain("Overdue: Gulf Precast: pumps");
    expect(db.tables.domain_event.filter((e) => e.name === "lead.sla_breached")).toHaveLength(1);
  });

  it("tells the owner and the team lead together in one message", async () => {
    vi.mocked(resolveCoverageForAccount).mockResolvedValue({ owner: { team: { id: "team1", lead_user_id: U2 } }, overlays: [], services: [] } as never);
    const db = withLead({ marketing: { lifecycle: { overdue_notify: { owner: true, team_lead: true } } } }, { ...ON, next_experience: true, coverage_model: true });
    await toReady(db);
    await runLeadScoringPass(db.client, { now: NOW });
    expect(notices(db)).toHaveLength(1);
    expect([...(notices(db)[0].mentions as string[])].sort()).toEqual(["lead@example.com", "rep@example.com"]);
  });

  it("says nothing when nobody is chosen, when Nova is off, or for a lead that is not overdue", async () => {
    const none = withLead({});
    await toReady(none);
    await runLeadScoringPass(none.client, { now: NOW });
    expect(notices(none)).toHaveLength(0);

    const noNova = withLead({ marketing: { lifecycle: { overdue_notify: { owner: true } } } }, ON);
    await toReady(noNova);
    const sum = await runLeadScoringPass(noNova.client, { now: NOW });
    expect(sum.overdue_flagged).toBe(1);
    expect(notices(noNova)).toHaveLength(0);

    const early = withLead({ marketing: { lifecycle: { overdue_notify: { owner: true } } } });
    await toReady(early);
    Object.assign(early.tables.leads[0], { sla_due_at: new Date(NOW.getTime() + 3_600_000).toISOString() });
    await runLeadScoringPass(early.client, { now: NOW });
    expect(notices(early)).toHaveLength(0);
  });

  it("never mentions someone outside the workspace", async () => {
    const db = withLead({ marketing: { lifecycle: { overdue_notify: { owner: true } } } });
    await toReady(db);
    db.tables.leads[0].owner_user_id = FOREIGN;
    await runLeadScoringPass(db.client, { now: NOW });
    expect(notices(db)).toHaveLength(0);
  });

  it("stops flagging once a salesperson has taken the lead on", async () => {
    const db = withLead({ marketing: { lifecycle: { overdue_notify: { owner: true } } } });
    await toReady(db);
    await setLeadStage({ tenantId: "t1", leadId: "l1", to: "working", userId: U1, role: "admin", client: db.client });
    await runLeadScoringPass(db.client, { now: NOW });
    expect(notices(db)).toHaveLength(0);
  });
});

describe("when no team covers it", () => {
  const cfg = (ids: string[]) => ({ marketing: { lifecycle: { fallback_user_ids: ids } } });
  const lead = { account_id: "a1" };

  it("takes the people on the list in turn, the one given a lead longest ago first", async () => {
    const { client, tables } = fakeDb(seed(cfg([U1, U2])));
    const picks: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await pickOwnerForLead(client, "t1", lead, {}, { config: cfg([U1, U2]) as never });
      expect(r.reason).toBe("fallback_list");
      picks.push(r.owner_user_id);
      tables.leads.push({ id: `n${i}`, tenant_id: "t1", account_id: "a1", owner_user_id: r.owner_user_id, assignment_reason: "fallback_list", assigned_at: hoursAgo(10 - i) });
    }
    expect(picks).toEqual([U1, U2, U1, U2]);
  });

  it("skips a person who has left, ignores another workspace's person, and falls back to the admin when nobody is left", async () => {
    const { client } = fakeDb(seed(cfg([FOREIGN, U2])));
    expect(await pickOwnerForLead(client, "t1", lead, {}, { config: cfg([FOREIGN, U2]) as never })).toMatchObject({ owner_user_id: U2, reason: "fallback_list" });
    expect(await pickOwnerForLead(client, "t1", lead, {}, { config: cfg([FOREIGN]) as never })).toMatchObject({ owner_user_id: A1, reason: "fallback_admin" });
    expect(await pickOwnerForLead(client, "t1", lead, {}, { config: {} })).toMatchObject({ owner_user_id: A1, reason: "fallback_admin" });
  });

  it("only reads this workspace's people and leads", async () => {
    const { client, queries } = fakeDb(seed(cfg([U1])));
    await pickOwnerForLead(client, "t1", lead, {}, { config: cfg([U1]) as never });
    for (const q of queries.filter((x) => ["tenant_users", "leads"].includes(x.table))) expect(q.filters.tenant_id).toBe("t1");
  });

  it("is used when a lead becomes ready, with the reason on the lead", async () => {
    const s = seed(cfg([U2]), { leads: [{ id: "l1", tenant_id: "t1", account_id: "a1", contact_id: "c1", title: "X", source: "campaign", status: "new", owner_user_id: null }] });
    const { client, tables } = fakeDb(s);
    await setLeadStage({ tenantId: "t1", leadId: "l1", to: "ready", userId: A1, role: "admin", client });
    expect(tables.leads[0]).toMatchObject({ owner_user_id: U2, assignment_reason: "fallback_list" });
  });
});

describe("the settings", () => {
  const members = new Set([A1, U1, U2]);
  const good = { sla_business_days: 2, weekly_off: [5, 6], auto_create_leads: true, fallback_user_ids: [U1, U2], overdue_notify: { owner: true, team_lead: false } };

  it("reads defaults from an empty config and the stored values otherwise", () => {
    expect(handoverOf({})).toEqual({ sla_business_days: 1, weekly_off: [0], auto_create_leads: false, fallback_user_ids: [], overdue_notify: { owner: false, team_lead: false } });
    expect(handoverOf({ marketing: { lifecycle: { sla_business_days: 3, weekly_off: [5, 6], auto_create_leads: true } } } as never)).toMatchObject({ sla_business_days: 3, weekly_off: [5, 6], auto_create_leads: true });
    expect(WEEKDAYS).toHaveLength(7);
  });

  it("accepts good settings and refuses bad ones", () => {
    expect(sanitizeHandover(good, members)).toEqual({ ok: true, value: good });
    expect(sanitizeHandover({ ...good, sla_business_days: -1 }, members).ok).toBe(false);
    expect(sanitizeHandover({ ...good, sla_business_days: 99 }, members).ok).toBe(false);
    expect(sanitizeHandover({ ...good, weekly_off: [0, 1, 2, 3, 4, 5, 6] }, members).ok).toBe(false);
    expect(sanitizeHandover({ ...good, weekly_off: "Friday" }, members).ok).toBe(false);
    expect(sanitizeHandover({ ...good, fallback_user_ids: [FOREIGN] }, members)).toMatchObject({ ok: false });
    expect(sanitizeHandover({ ...good, fallback_user_ids: ["not-an-id"] }, members)).toMatchObject({ ok: false });
    expect(sanitizeHandover(null, members).ok).toBe(false);
  });

  it("keeps whatever else the lifecycle block held", () => {
    const merged = mergeLifecycle({ sla_business_days: 1, weekly_off: [0], future_key: 1 } as never, handoverOf({}));
    expect((merged as Record<string, unknown>).future_key).toBe(1);
  });

  it("every explanation fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(HANDOVER_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });

  it("sits in the Marketing group of Settings, for admins of a workspace with the scoring program", () => {
    const e = SETTINGS_MENU.find((x) => x.id === "marketing-leads")!;
    expect(e).toMatchObject({ group: "marketing", adminOnly: true, featureKey: "marketing_scoring", href: "/settings/marketing-leads" });
  });
});

describe("the settings route", () => {
  const put = (body: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }) as never);
  const body = { sla_business_days: 2, weekly_off: [5, 6], auto_create_leads: true, fallback_user_ids: [U1], overdue_notify: { owner: true, team_lead: false } };
  let db: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    auth.role = "admin"; auth.tenantId = "t1";
    db = fakeDb(seed({ marketing: { topics: [], lifecycle: { future_key: 7 } } }));
    withAuth(db.client, { [A1]: "a@x.test", [U1]: "u1@x.test", [U2]: "u2@x.test" });
    auth.db = db.client;
  });

  it("is for admins only", async () => {
    auth.role = "member";
    expect((await GET()).status).toBe(403);
    expect((await put(body)).status).toBe(403);
    expect(db.tables.tenants[0].config).toEqual({ marketing: { topics: [], lifecycle: { future_key: 7 } } });
  });

  it("is not there for a workspace without the scoring program", async () => {
    db.tables.tenants[0].features = { marketing: true };
    expect((await GET()).status).toBe(404);
    expect((await put(body)).status).toBe(404);
  });

  it("lists this workspace's people and no one else's", async () => {
    const r = await GET();
    const j = await r.json() as { people: { user_id: string }[]; settings: { sla_business_days: number } };
    expect(j.people.map((p) => p.user_id).sort()).toEqual([A1, U1, U2].sort());
    expect(j.people.map((p) => p.user_id)).not.toContain(FOREIGN);
    expect(j.settings.sla_business_days).toBe(1);
  });

  it("counts this workspace's teams by how they hand out leads, only when Coverage is on", async () => {
    expect((await (await GET()).json() as { teams: unknown }).teams).toBeNull();
    db.tables.tenants[0].features = { ...ON, coverage_model: true };
    db.tables.teams = [
      { id: "g1", tenant_id: "t1", assignment_mode: "round_robin" }, { id: "g2", tenant_id: "t1", assignment_mode: "lead" },
      { id: "g3", tenant_id: "t1", assignment_mode: "lead" }, { id: "g4", tenant_id: "t2", assignment_mode: "round_robin" },
    ];
    expect((await (await GET()).json() as { teams: unknown }).teams).toEqual({ in_turn: 1, team_lead: 2 });
  });

  it("saves into this workspace's config, keeps its other keys, and ignores a tenant named in the body", async () => {
    const r = await put({ ...body, tenant_id: "t2", tenantId: "t2" });
    expect(r.status).toBe(200);
    const saved = db.tables.tenants.find((t) => t.id === "t1")!.config as { marketing: { topics: unknown[]; lifecycle: Record<string, unknown> } };
    expect(saved.marketing.topics).toEqual([]);
    expect(saved.marketing.lifecycle).toMatchObject({ sla_business_days: 2, weekly_off: [5, 6], auto_create_leads: true, fallback_user_ids: [U1], future_key: 7 });
    expect(db.tables.tenants.find((t) => t.id === "t2")!.config).toEqual({});
  });

  it("refuses a fallback person who belongs to another workspace, and saves nothing", async () => {
    const r = await put({ ...body, fallback_user_ids: [FOREIGN] });
    expect(r.status).toBe(400);
    expect(db.tables.tenants[0].config).toEqual({ marketing: { topics: [], lifecycle: { future_key: 7 } } });
  });

  it("checks people against the signed-in workspace only", async () => {
    await put(body);
    const q = db.queries.filter((x) => x.table === "tenant_users" && x.op === "select");
    expect(q.length).toBeGreaterThan(0);
    for (const x of q) expect(x.filters.tenant_id).toBe("t1");
  });

  it("the route and page take the tenant from the session, never from the request", () => {
    const route = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "settings", "marketing-handover", "route.ts"), "utf8");
    expect(route).toMatch(/loadMarketingSettingsContext\(\)/);
    expect(route).not.toMatch(/body\.tenant|searchParams|tenant_id\s*[:=]\s*(body|json)/);
    const page = readFileSync(join(__dirname, "..", "..", "..", "app", "(app)", "settings", "marketing-leads", "page.tsx"), "utf8");
    expect(page).toMatch(/role !== "admin"\) redirect/);
    expect(page).toMatch(/marketingScoringOn/);
  });
});
