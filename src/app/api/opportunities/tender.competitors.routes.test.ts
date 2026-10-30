import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, the Competitors tab (migration 0229), against an in-memory database: the gate (flag, standard deal, another
// workspace, view-only), the field allow-list, names that cannot repeat, the one winner and where its name is also written, the stage
// move to Lost and the Outcome save adding the winner by name, the migration pending, and Company insights (the company is the stored
// competitor, never the request; nothing runs when the analysis is not available).

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
  edit: true,
  analysisFeatures: { ai_assistant: true, ai_assistant_web: true } as Record<string, boolean>,
  analysed: [] as Record<string, unknown>[],
  analyseResult: null as unknown,
  config: {} as Record<string, unknown>,
  researchCalls: [] as Record<string, unknown>[],
  researchRun: null as unknown,
  researchError: null as unknown,
}));

const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const uid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: state.config, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
  canViewWorkcenter: () => true,
  canEditWorkcenter: () => state.edit,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) =>
    Object.entries(a).filter(([k, v]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: b[field] ?? null, to })),
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/events/emitters", () => ({
  emitOpportunityStageChanged: async () => {}, emitOpportunityClosed: async () => {}, emitOpportunityUpdated: async () => {}, emitOpportunityCreated: async () => {},
}));
vi.mock("@/lib/analysis/access", async () => {
  const { NextResponse } = await import("next/server");
  return {
    resolveAnalysisAccess: async () => (state.user.id === "anon" ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : { supabase: {}, admin: {}, tenantId: T1, userId: state.user.id, perms: { unrestricted: true, grants: new Map() }, features: state.analysisFeatures, config: {}, budget: 1 }),
  };
});
vi.mock("@/lib/analysis/service", () => ({
  analyseCompany: async (_a: unknown, input: Record<string, unknown>) => { state.analysed.push(input); return state.analyseResult; },
}));
vi.mock("@/lib/tender/competitors/research", () => ({
  runCompetitorResearch: async (_client: unknown, input: Record<string, unknown>) => {
    state.researchCalls.push(input);
    if (state.researchError) throw state.researchError;
    return state.researchRun;
  },
}));
vi.mock("@/lib/assistant/analysisRun", () => ({
  toDock: (card: unknown, i: { cached: boolean; input: Record<string, unknown> }) => ({ card, cached: i.cached, saved: true, notice: null, webDerived: false, digest: "", subject: i.input }),
}));

import { NextRequest } from "next/server";
import { PATCH as stdPatch } from "./[id]/route";
import { GET as listGet, POST as listPost } from "./[id]/competitors/route";
import { PATCH as itemPatch, DELETE as itemDelete } from "./[id]/competitors/[competitorId]/route";
import { POST as insightsPost } from "./[id]/competitors/[competitorId]/insights/route";
import { POST as researchPost } from "./[id]/competitors/research/route";
import { AnalysisResearchError, NO_ANSWER, NO_KEY, NO_SEARCH } from "@/lib/analysis/research";
import { PATCH as outcomePatch } from "./[id]/tender/outcome/route";

const req = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const cctx = (id: string, competitorId: string) => ({ params: Promise.resolve({ id, competitorId }) });
const deal = (id = OPP) => state.db.rows("opportunities").find((o) => o.id === id)!;
const tenderRow = (id = OPP) => state.db.rows("opportunity_tenders").find((t) => t.opportunity_id === id)!;
const comps = (opp = OPP, tenant = T1) => state.db.rows("opportunity_competitors").filter((c) => c.opportunity_id === opp && c.tenant_id === tenant);
const named = (name: string) => comps().find((c) => c.name === name)!;
const add = (body: Record<string, unknown>) => listPost(req("POST", body), ctx(OPP));

function oppRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, tenant_id: T1, ref: `OPP-${id.slice(-1)}`, title: "Valves for Plant 4", account_id: "acc", contact_id: null, stage: "estimating", outcome: "open", loss_reason: null,
    loss_note: null, probability: 25, probability_override: null, owner_id: ME, team: [], expected_close: null, amount: 0, currency: "SAR", competitor: null, custom_data: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null, ...over,
  };
}
const tenderFor = (opportunity_id: string, tenant_id = T1) => ({
  opportunity_id, tenant_id, tender_no: `ARB-${opportunity_id.slice(-1)}`, issuer_name: "Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z", bid_bond_amount: null,
  bid_bond_currency: null, bid_bond_expiry: null, addenda_count: 0, decision: "go", decision_reason: null, decided_by: null, decided_at: null, source_email_id: null,
  custom_data: null, reminders_sent: [], bond_status: "held", bond_released_at: null, bond_released_by: null, award_value: null, winning_bidder: null, award_date: null,
  outcome_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
});
const compRow = (n: number, name: string, over: Record<string, unknown> = {}) => ({
  id: uid(n), tenant_id: T1, opportunity_id: OPP, name, website: null, country: null, expected_price: null, strengths: null, notes: null, is_winner: false, sort: n,
  created_by: ME, created_at: `2026-10-0${n}T00:00:00Z`, updated_at: `2026-10-0${n}T00:00:00Z`, ...over,
});

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "kamco.example.com" }, { id: T2, slug: "other", name: "Other", is_demo: false, config: {}, custom_domain: null }],
    tenant_users: [{ tenant_id: T1, user_id: ME, role: "member", display_name: "S. Khan" }],
    opportunities: [oppRow(OPP_STD, { stage: "qualify" }), oppRow(OPP), oppRow(OPP_OTHER), oppRow(OPP_T2, { tenant_id: T2 })],
    opportunity_tenders: [tenderFor(OPP), tenderFor(OPP_OTHER), tenderFor(OPP_T2, T2)],
    opportunity_lines: [],
  });
  // The two unique indexes of the migration: a name once per deal (any case), one winner per deal.
  state.db.unique("opportunity_competitors", (e, n) => e.opportunity_id === n.opportunity_id && String(e.name).toLowerCase() === String(n.name).toLowerCase());
  state.features = { pipeline: true, gcc_tender: true };
  state.analysisFeatures = { ai_assistant: true, ai_assistant_web: true };
  state.touched = []; state.changes = []; state.analysed = [];
  state.config = {}; state.researchCalls = []; state.researchError = null; state.researchRun = null;
  state.analyseResult = { ok: true, card: { name: "Rival Co" }, cached: false, saved: true, pendingDb: false };
  state.edit = true;
  state.role = "member";
  state.user = { id: ME, email: "me@t1.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the gate: flag off, a standard deal, another workspace, view-only", () => {
  const everyRoute = () => [
    listGet(req("GET"), ctx(OPP)), listPost(req("POST", { name: "X" }), ctx(OPP)), itemPatch(req("PATCH", { notes: "x" }), cctx(OPP, uid(1))),
    itemDelete(req("DELETE"), cctx(OPP, uid(1))), insightsPost(req("POST", {}), cctx(OPP, uid(1))),
  ];

  it("with gcc_tender off every route answers 404 and no table is read", async () => {
    state.features = { pipeline: true };
    expect((await Promise.all(everyRoute())).map((r) => r.status)).toEqual(Array(5).fill(404));
    expect(state.touched).toEqual([]);
  });

  it("a standard deal and another workspace's deal are a 404 and never reach the new table", async () => {
    state.db.rows("opportunity_competitors").push(compRow(1, "Rival Co", { tenant_id: T2, opportunity_id: OPP_T2 }));
    for (const opp of [OPP_STD, OPP_T2]) {
      expect((await listGet(req("GET"), ctx(opp))).status).toBe(404);
      expect((await listPost(req("POST", { name: "X" }), ctx(opp))).status).toBe(404);
      expect((await itemPatch(req("PATCH", { notes: "x" }), cctx(opp, uid(1)))).status).toBe(404);
    }
    expect(state.touched).not.toContain("opportunity_competitors");
    expect(comps(OPP_T2, T2)).toHaveLength(1);
  });

  it("a view-only person can read but cannot add, change, remove or analyse", async () => {
    state.db.rows("opportunity_competitors").push(compRow(1, "Rival Co"));
    state.edit = false;
    expect((await listGet(req("GET"), ctx(OPP))).status).toBe(200);
    expect((await add({ name: "X" })).status).toBe(403);
    expect((await itemPatch(req("PATCH", { notes: "x" }), cctx(OPP, uid(1)))).status).toBe(403);
    expect((await itemDelete(req("DELETE"), cctx(OPP, uid(1)))).status).toBe(403);
    expect((await insightsPost(req("POST", {}), cctx(OPP, uid(1)))).status).toBe(403);
    expect(comps()).toHaveLength(1);
    expect(state.analysed).toEqual([]);
  });
});

describe("adding and listing", () => {
  it("saves the allow-listed fields for this workspace and deal, normalises the website, and logs it", async () => {
    const res = await add({
      name: "  Rival   Co ", website: "www.Rival.com/about/?utm=1", country: "Saudi Arabia", expected_price: "lower", strengths: "Local presence", notes: "Won the last two",
      tenant_id: T2, opportunity_id: OPP_OTHER, is_winner: true, created_by: "someone-else",
    });
    expect(res.status).toBe(201);
    expect(comps()).toHaveLength(1);
    expect(comps(OPP_OTHER)).toHaveLength(0);
    expect(comps()[0]).toMatchObject({
      tenant_id: T1, opportunity_id: OPP, name: "Rival Co", website: "https://www.rival.com/about", country: "Saudi Arabia", expected_price: "lower",
      strengths: "Local presence", notes: "Won the last two", created_by: ME,
    });
    expect(comps()[0].is_winner).toBeUndefined();
    expect(state.changes).toEqual([expect.objectContaining({ objectType: "opportunity_competitors", objectId: OPP, changes: [{ field: "competitor added", from: null, to: "Rival Co" }] })]);
  });

  it("refuses a missing name, a bad price view, an address that is not a website, and overlong text", async () => {
    expect((await add({ country: "KSA" })).status).toBe(422);
    expect((await add({ name: "  " })).status).toBe(422);
    expect((await add({ name: "X", expected_price: "cheap" })).status).toBe(422);
    expect((await add({ name: "X", website: "javascript:alert(1)" })).status).toBe(422);
    expect((await add({ name: "X", website: "not a site" })).status).toBe(422);
    expect((await add({ name: "X", notes: "n".repeat(2001) })).status).toBe(422);
    expect((await add({ name: "x".repeat(201) })).status).toBe(422);
    expect(comps()).toHaveLength(0);
  });

  it("a name can be on a deal once, whatever the case; the same name on another deal is fine", async () => {
    expect((await add({ name: "Rival Co" })).status).toBe(201);
    expect((await add({ name: "rival co" })).status).toBe(409);
    expect((await listPost(req("POST", { name: "Rival Co" }), ctx(OPP_OTHER))).status).toBe(201);
    expect(comps()).toHaveLength(1);
  });

  it("holds at most 30 per deal", async () => {
    for (let i = 1; i <= 30; i++) state.db.rows("opportunity_competitors").push(compRow(i, `Company ${i}`, { created_at: `2026-10-01T00:00:${String(i).padStart(2, "0")}Z` }));
    expect((await add({ name: "One too many" })).status).toBe(409);
  });

  it("lists this deal's competitors only, the winner first, and says whether insights are available", async () => {
    state.db.rows("opportunity_competitors").push(
      compRow(1, "First"), compRow(2, "Second", { is_winner: true }), compRow(3, "Other deal", { opportunity_id: OPP_OTHER }),
      compRow(4, "Other workspace", { tenant_id: T2 }),
    );
    const body = await (await listGet(req("GET"), ctx(OPP))).json();
    expect(body.competitors.map((c: { name: string }) => c.name)).toEqual(["Second", "First"]);
    expect(body).toMatchObject({ pending: false, insights: { available: true } });
  });

  it("says insights are not available, with the reason, when the analysis is switched off", async () => {
    state.db.rows("opportunity_competitors").push(compRow(1, "First"));
    state.analysisFeatures = {};
    const body = await (await listGet(req("GET"), ctx(OPP))).json();
    expect(body.insights).toMatchObject({ available: false, reason: expect.stringMatching(/not switched on/i) });
  });

  it("answers the plain 'database update' state while the migration is pending, and nothing crashes", async () => {
    state.db.missing.add("opportunity_competitors");
    expect(await (await listGet(req("GET"), ctx(OPP))).json()).toMatchObject({ competitors: [], pending: true });
    const res = await add({ name: "X" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/database update/i);
    expect((await itemPatch(req("PATCH", { notes: "x" }), cctx(OPP, uid(1)))).status).toBe(503);
  });
});

describe("changing and removing", () => {
  beforeEach(() => {
    state.db.rows("opportunity_competitors").push(compRow(1, "Rival Co", { expected_price: "lower" }), compRow(2, "Other Co"));
    state.db.rows("opportunity_competitors").push(compRow(5, "Alien Co", { tenant_id: T2, opportunity_id: OPP_T2 }), compRow(6, "Next door", { opportunity_id: OPP_OTHER }));
  });

  it("edits only the allow-listed fields and logs what changed", async () => {
    const res = await itemPatch(req("PATCH", { expected_price: "higher", notes: "New note", tenant_id: T2, opportunity_id: OPP_OTHER, created_by: "x" }), cctx(OPP, uid(1)));
    expect(res.status).toBe(200);
    expect(comps().find((c) => c.id === uid(1))).toMatchObject({ expected_price: "higher", notes: "New note", tenant_id: T1, opportunity_id: OPP, created_by: ME });
    expect(state.changes[0].changes).toEqual([{ field: "expected price", from: "lower", to: "higher" }, { field: "note", from: null, to: "New note" }]);
    expect((await itemPatch(req("PATCH", {}), cctx(OPP, uid(1)))).status).toBe(422);
    expect((await itemPatch(req("PATCH", { name: "other co" }), cctx(OPP, uid(1)))).status).toBe(409);
  });

  it("another workspace's competitor, or one of another deal, is a 404 and is left alone", async () => {
    expect((await itemPatch(req("PATCH", { notes: "hijack" }), cctx(OPP, uid(5)))).status).toBe(404);
    expect((await itemPatch(req("PATCH", { notes: "hijack" }), cctx(OPP, uid(6)))).status).toBe(404);
    expect((await itemDelete(req("DELETE"), cctx(OPP, uid(5)))).status).toBe(404);
    expect((await itemPatch(req("PATCH", { notes: "x" }), cctx(OPP, "not-an-id"))).status).toBe(404);
    expect(state.db.rows("opportunity_competitors").find((c) => c.id === uid(5))!.notes).toBeNull();
    expect(state.db.rows("opportunity_competitors")).toHaveLength(4);
  });

  it("marking a winner clears the other one and writes the name where the older screens read it", async () => {
    expect((await itemPatch(req("PATCH", { is_winner: true }), cctx(OPP, uid(1)))).status).toBe(200);
    expect(named("Rival Co").is_winner).toBe(true);
    expect(deal()).toMatchObject({ competitor: "Rival Co" });
    expect(tenderRow()).toMatchObject({ winning_bidder: "Rival Co" });
    expect((await itemPatch(req("PATCH", { is_winner: true }), cctx(OPP, uid(2)))).status).toBe(200);
    expect(comps().filter((c) => c.is_winner).map((c) => c.name)).toEqual(["Other Co"]);
    expect(deal().competitor).toBe("Other Co");
    expect(tenderRow().winning_bidder).toBe("Other Co");
    expect(deal(OPP_OTHER).competitor).toBeNull();
    expect(tenderRow(OPP_T2).winning_bidder).toBeNull();
    expect(state.changes.at(-1)?.changes).toEqual([{ field: "winner", from: null, to: "Other Co" }]);
  });

  it("removing the winner mark, or the winner, clears the deal's winner too; another typed name is left alone", async () => {
    await itemPatch(req("PATCH", { is_winner: true }), cctx(OPP, uid(1)));
    await itemPatch(req("PATCH", { is_winner: false }), cctx(OPP, uid(1)));
    expect(named("Rival Co").is_winner).toBe(false);
    expect(deal().competitor).toBeNull();
    expect(tenderRow().winning_bidder).toBeNull();

    await itemPatch(req("PATCH", { is_winner: true }), cctx(OPP, uid(1)));
    expect((await itemDelete(req("DELETE"), cctx(OPP, uid(1)))).status).toBe(204);
    expect(comps().map((c) => c.name)).toEqual(["Other Co"]);
    expect(deal().competitor).toBeNull();

    // The deal names someone else by hand: removing a competitor that is not the winner does not touch it.
    deal().competitor = "Typed By Hand";
    expect((await itemDelete(req("DELETE"), cctx(OPP, uid(2)))).status).toBe(204);
    expect(deal().competitor).toBe("Typed By Hand");
    expect(state.changes.at(-1)?.changes).toEqual([{ field: "competitor removed", from: "Other Co", to: null }]);
  });

  it("renaming the winner keeps the deal saying the same company", async () => {
    await itemPatch(req("PATCH", { is_winner: true }), cctx(OPP, uid(1)));
    await itemPatch(req("PATCH", { name: "Rival Company LLC" }), cctx(OPP, uid(1)));
    expect(deal().competitor).toBe("Rival Company LLC");
    expect(tenderRow().winning_bidder).toBe("Rival Company LLC");
  });
});

describe("who won: the stage move to Lost and the Outcome save", () => {
  const lost = (body: Record<string, unknown>) => stdPatch(req("PATCH", { stage: "bid_lost", loss_reason: "price", ...body }), ctx(OPP));

  it("a typed name that is not on the list is added and marked as the winner", async () => {
    expect((await lost({ competitor: "Rival Co" })).status).toBe(200);
    expect(comps().map((c) => ({ name: c.name, is_winner: c.is_winner, tenant_id: c.tenant_id }))).toEqual([{ name: "Rival Co", is_winner: true, tenant_id: T1 }]);
    expect(deal()).toMatchObject({ stage: "bid_lost", competitor: "Rival Co" });
    expect(tenderRow().winning_bidder).toBe("Rival Co");
    expect(state.changes.find((c) => c.objectType === "opportunity_competitors")?.changes).toEqual([{ field: "competitor added", from: null, to: "Rival Co" }, { field: "winner", from: null, to: "Rival Co" }]);
  });

  it("a picked competitor is marked without a duplicate, whatever the case, and replaces an earlier winner", async () => {
    state.db.rows("opportunity_competitors").push(compRow(1, "Rival Co", { is_winner: true }), compRow(2, "Other Co"));
    expect((await lost({ competitor: "other co" })).status).toBe(200);
    expect(comps()).toHaveLength(2);
    expect(comps().filter((c) => c.is_winner).map((c) => c.name)).toEqual(["Other Co"]);
  });

  it("Lost still needs a name, and a competitor already marked as the winner counts as one", async () => {
    expect((await lost({})).status).toBe(422);
    expect(deal().stage).toBe("estimating");
    state.db.rows("opportunity_competitors").push(compRow(1, "Rival Co", { is_winner: true }));
    expect((await lost({})).status).toBe(200);
    expect(deal().stage).toBe("bid_lost");
  });

  it("a deal that is not lost never adds a winner from a typed competitor, and a standard deal never gets a row", async () => {
    expect((await stdPatch(req("PATCH", { competitor: "Rival Co" }), ctx(OPP))).status).toBe(200);
    expect(comps()).toHaveLength(0);
    expect((await stdPatch(req("PATCH", { stage: "lost", loss_reason: "price", competitor: "Rival Co" }), ctx(OPP_STD))).status).not.toBe(422);
    expect(state.db.rows("opportunity_competitors")).toHaveLength(0);
    expect(deal(OPP_STD).competitor).toBe("Rival Co");
  });

  it("the Outcome save does the same with Won by", async () => {
    deal().stage = "bid_lost"; deal().outcome = "lost"; deal().loss_reason = "other";
    const res = await outcomePatch(req("PATCH", { winning_bidder: "Rival Co", loss_reason: "price" }), ctx(OPP));
    expect(res.status).toBe(200);
    expect(comps().map((c) => [c.name, c.is_winner])).toEqual([["Rival Co", true]]);
    expect(tenderRow().winning_bidder).toBe("Rival Co");
  });

  it("the typed name is kept when the competitors table is not there yet", async () => {
    state.db.missing.add("opportunity_competitors");
    expect((await lost({ competitor: "Rival Co" })).status).toBe(200);
    expect(deal()).toMatchObject({ stage: "bid_lost", competitor: "Rival Co" });
  });
});

describe("Company insights", () => {
  beforeEach(() => {
    state.db.rows("opportunity_competitors").push(
      compRow(1, "Rival Co", { website: "https://www.rival.com/about", country: "Saudi Arabia" }),
      compRow(5, "Alien Co", { tenant_id: T2, opportunity_id: OPP_T2 }),
    );
  });
  const run = (body: unknown = {}, id = uid(1)) => insightsPost(req("POST", body), cctx(OPP, id));

  it("analyses the stored competitor with the person's yes, and never takes the company from the request", async () => {
    const res = await run({ name: "Somebody Else", domain: "evil.test", country: "Elsewhere", account_id: uid(9), allow_web: false });
    expect(res.status).toBe(200);
    expect(state.analysed).toEqual([{ name: "Rival Co", domain: "https://www.rival.com/about", country: "Saudi Arabia", refresh: false, allowWeb: true }]);
    expect(await res.json()).toMatchObject({ analysis: { card: { name: "Rival Co" }, cached: false } });
  });

  it("passes a refresh through and shows the saved card when the service answers with it", async () => {
    state.analyseResult = { ok: true, card: { name: "Rival Co" }, cached: true, saved: true, pendingDb: false };
    expect((await (await run({})).json()).analysis.cached).toBe(true);
    await run({ refresh: true });
    expect(state.analysed.map((a) => a.refresh)).toEqual([false, true]);
  });

  it("a limit or a failure from the service comes back as its plain message", async () => {
    state.analyseResult = { ok: false, status: 429, code: "daily_limit", error: "The daily limit for company analyses is reached. Try again tomorrow." };
    const res = await run();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/daily limit/i);
  });

  it("with the analysis switched off it answers 403 with the reason and runs nothing", async () => {
    state.analysisFeatures = {};
    const res = await run();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not switched on/i);
    expect(state.analysed).toEqual([]);
  });

  it("another workspace's competitor id is a 404 and nothing is analysed", async () => {
    expect((await run({}, uid(5))).status).toBe(404);
    expect((await run({}, uid(77))).status).toBe(404);
    expect(state.analysed).toEqual([]);
  });
});

describe("proposals from market research (migration 0239)", () => {
  const proposed = (n: number, name: string, over: Record<string, unknown> = {}) => compRow(n, name, {
    status: "proposed", origin: "research", evidence: { v: 1, facts: [{ text: "Won an award", kind: "award", source_url: "https://news.example.com/a", source_title: null, published_on: null }], price: null, wins: null, researched_at: "2026-10-29T08:00:00Z", model: "m" },
    ...over,
  });
  const patch = (n: number, body: Record<string, unknown>) => itemPatch(req("PATCH", body), cctx(OPP, uid(n)));

  it("lists the team's competitors first, then the proposals with their evidence, and leaves rejected ones out", async () => {
    state.db.rows("opportunity_competitors").push(proposed(1, "Proposed Co"), compRow(2, "Own Co", { status: "accepted" }), proposed(3, "Rejected Co", { status: "rejected" }));
    const body = await (await listGet(req("GET"), ctx(OPP))).json();
    expect(body.competitors.map((c: { name: string; status: string }) => [c.name, c.status])).toEqual([["Own Co", "accepted"], ["Proposed Co", "proposed"]]);
    expect(body.competitors[1].evidence.facts[0].source_url).toBe("https://news.example.com/a");
    expect(body.researchPending).toBe(false);
  });

  it("a stored fact with a source that is not https never reaches the screen", async () => {
    state.db.rows("opportunity_competitors").push(proposed(1, "Proposed Co", { evidence: { v: 1, facts: [{ text: "x", kind: "award", source_url: "javascript:alert(1)" }], price: null, wins: null } }));
    expect((await (await listGet(req("GET"), ctx(OPP))).json()).competitors[0].evidence).toBeNull();
  });

  it("Accept makes a proposal the team's own, and logs it", async () => {
    state.db.rows("opportunity_competitors").push(proposed(1, "Proposed Co"));
    expect((await patch(1, { status: "accepted" })).status).toBe(200);
    expect(named("Proposed Co")).toMatchObject({ status: "accepted", tenant_id: T1, opportunity_id: OPP });
    expect(state.changes.at(-1)?.changes).toEqual([{ field: "competitor accepted", from: null, to: "Proposed Co" }]);
  });

  it("Reject keeps the row and its name (so research does not propose it again) but hides it, and only a proposal can be rejected", async () => {
    state.db.rows("opportunity_competitors").push(proposed(1, "Proposed Co"), compRow(2, "Own Co"));
    expect((await patch(1, { status: "rejected" })).status).toBe(200);
    expect(comps().find((c) => c.id === uid(1))).toMatchObject({ status: "rejected", name: "Proposed Co" });
    expect((await (await listGet(req("GET"), ctx(OPP))).json()).competitors.map((c: { name: string }) => c.name)).toEqual(["Own Co"]);
    expect((await patch(1, { notes: "x" })).status).toBe(404);
    expect((await patch(2, { status: "rejected" })).status).toBe(409);
    expect(named("Own Co").status ?? "accepted").toBe("accepted");
    expect(state.changes.at(-1)?.changes).toEqual([{ field: "competitor rejected", from: null, to: "Proposed Co" }]);
  });

  it("a proposal cannot be marked as the winner until it is accepted (they can be done together)", async () => {
    state.db.rows("opportunity_competitors").push(proposed(1, "Proposed Co"));
    expect((await patch(1, { is_winner: true })).status).toBe(409);
    expect(named("Proposed Co").is_winner).toBe(false);
    expect(deal().competitor).toBeNull();
    expect((await patch(1, { status: "accepted", is_winner: true })).status).toBe(200);
    expect(named("Proposed Co")).toMatchObject({ status: "accepted", is_winner: true });
    expect(deal().competitor).toBe("Proposed Co");
  });

  it("adding by hand a company that is already proposed is refused; one that was rejected comes back as the team's own", async () => {
    state.db.rows("opportunity_competitors").push(proposed(1, "Proposed Co"), proposed(2, "Rejected Co", { status: "rejected" }));
    const dup = await add({ name: "proposed co" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatch(/already proposed/i);
    expect((await add({ name: "Rejected Co", country: "Oman" })).status).toBe(201);
    expect(comps().filter((c) => c.name === "Rejected Co")).toHaveLength(1);
    expect(named("Rejected Co")).toMatchObject({ status: "accepted", country: "Oman" });
  });

  it("naming a proposed company as who won is the person's yes: it joins the team's list and is marked", async () => {
    state.db.rows("opportunity_competitors").push(proposed(1, "Proposed Co"));
    expect((await stdPatch(req("PATCH", { stage: "bid_lost", loss_reason: "price", competitor: "proposed co" }), ctx(OPP))).status).toBe(200);
    expect(comps()).toHaveLength(1);
    expect(named("Proposed Co")).toMatchObject({ status: "accepted", is_winner: true });
  });

  it("another workspace's proposal, or one of another deal, is a 404 and is left as it was", async () => {
    state.db.rows("opportunity_competitors").push(proposed(5, "Alien Co", { tenant_id: T2, opportunity_id: OPP_T2 }), proposed(6, "Next door", { opportunity_id: OPP_OTHER }));
    expect((await patch(5, { status: "accepted" })).status).toBe(404);
    expect((await patch(6, { status: "accepted" })).status).toBe(404);
    expect(state.db.rows("opportunity_competitors").map((c) => c.status)).toEqual(["proposed", "proposed"]);
  });

  it("a view-only person cannot accept or reject", async () => {
    state.db.rows("opportunity_competitors").push(proposed(1, "Proposed Co"));
    state.edit = false;
    expect((await patch(1, { status: "accepted" })).status).toBe(403);
    expect(named("Proposed Co").status).toBe("proposed");
  });

  it("while 0239 is pending every competitor reads as the team's own, the list still works, and Accept says a database update is needed", async () => {
    state.db.missingColumns.opportunity_competitors = new Set(["status", "origin", "evidence"]);
    state.db.rows("opportunity_competitors").push(compRow(1, "Rival Co"));
    const body = await (await listGet(req("GET"), ctx(OPP))).json();
    expect(body).toMatchObject({ pending: false, researchPending: true });
    expect(body.competitors).toEqual([expect.objectContaining({ name: "Rival Co", status: "accepted", origin: "manual", evidence: null })]);
    expect((await add({ name: "New Co" })).status).toBe(201);
    const res = await patch(1, { status: "accepted" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/migration 0239/);
    expect((await patch(1, { is_winner: true })).status).toBe(200);
  });
});

describe("Suggest from market research", () => {
  const PAGE = "https://news.example.com/jubail-award";
  const ANSWERS = { scope: "supply_install", region: "gcc", issuer_type: "government" };
  const goodRun = (competitors: unknown[] = [{ name: "Rival Co", website: "https://www.rival.com", country: "Saudi Arabia", facts: [{ text: "Won the 2025 Jubail pump award", kind: "award", source_url: PAGE }], price: null, wins: null }]) => ({
    raw: { competitors }, citations: [{ url: PAGE, title: "Jubail awards", snippet: "Rival Co, Saudi Arabia" }, { url: "https://www.rival.com/about", title: "About" }],
    searches: 2, usage: {}, model: "m", tokens: { input: 12_000, output: 800 },
  });
  const go = (body: unknown = { answers: ANSWERS }, id = OPP) => researchPost(req("POST", body), ctx(id));

  beforeEach(() => {
    state.features = { pipeline: true, gcc_tender: true, ai_assistant: true, ai_assistant_web: true };
    state.researchRun = goodRun();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("asks the three questions first and runs nothing, saves nothing and bills nothing until all are answered", async () => {
    const res = await go({});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needs.map((q: { key: string }) => q.key)).toEqual(["scope", "region", "issuer_type"]);
    expect(body.needs[0].options.map((o: { label: string }) => o.label)).toEqual(["Supply only", "Supply and install"]);
    const partial = await (await go({ answers: { scope: "supply" } })).json();
    expect(partial.needs.map((q: { key: string }) => q.key)).toEqual(["region", "issuer_type"]);
    expect(state.researchCalls).toEqual([]);
    expect(comps()).toHaveLength(0);
    expect(state.db.rows("ai_usage_log")).toHaveLength(0);
    expect(tenderRow().custom_data).toBeNull();
  });

  it("the question about the region names the workspace's own country", async () => {
    state.config = { entities: [{ id: "e1", is_default: true, country: "Saudi Arabia" }] };
    const body = await (await go({ answers: { scope: "supply" } })).json();
    expect(body.needs[0].options[0].label).toBe("Saudi Arabia only");
  });

  it("with all three answers it searches once, saves each sourced company as a proposal, keeps the answers on the tender and bills the tokens", async () => {
    const res = await go();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposed: 1, dropped: 0 });
    expect(comps()).toHaveLength(1);
    expect(comps()[0]).toMatchObject({ tenant_id: T1, opportunity_id: OPP, name: "Rival Co", status: "proposed", origin: "research", created_by: ME, website: "https://www.rival.com", country: "Saudi Arabia" });
    expect((comps()[0].evidence as { facts: { source_url: string }[] }).facts[0].source_url).toBe(PAGE);
    expect(comps()[0].is_winner).toBeUndefined();
    expect(tenderRow().custom_data).toMatchObject({ competitor_research: ANSWERS });
    expect(deal().competitor).toBeNull();
    expect(state.db.rows("ai_usage_log")).toEqual([expect.objectContaining({ tenant_id: T1, surface: "competitor_research", study_id: OPP, input_tokens: 12_000, output_tokens: 800 })]);
    expect(state.changes.at(-1)).toMatchObject({ objectType: "opportunity_competitors", action: "create", changes: [{ field: "Proposed from market research", from: null, to: "Rival Co" }] });
    expect(state.researchCalls[0]).toMatchObject({ title: "Valves for Plant 4", tender_no: "ARB-2", issuer_name: "Aramco", ...ANSWERS, items: [], exclude: [] });
  });

  it("saved answers are used next time without asking again, 'fresh' asks again, and the research never becomes a tender field", async () => {
    await go();
    state.db.rows("ai_usage_log").length = 0;
    state.researchRun = goodRun([{ name: "Second Co", facts: [{ text: "Won an award", kind: "award", source_url: PAGE }] }]);
    expect((await go({})).status).toBe(200);
    expect(comps().map((c) => c.name)).toEqual(["Rival Co", "Second Co"]);
    const again = await (await go({ fresh: true })).json();
    expect(again.needs).toHaveLength(3);
    const t = tenderRow();
    for (const col of ["scope", "region", "issuer_type"]) expect(t[col]).toBeUndefined();
  });

  it("sends the BOQ descriptions and every company already on the tender (rejected ones too) so none is proposed again", async () => {
    state.db.rows("tender_boq_lines").push(
      ...Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, tenant_id: T1, opportunity_id: OPP, row_no: i + 1, file_description: `Gate valve DN${100 + i}` })),
      { id: "x", tenant_id: T2, opportunity_id: OPP_T2, row_no: 1, file_description: "Another tenant line" },
    );
    state.db.rows("opportunity_competitors").push(compRow(1, "Own Co"), compRow(2, "Rejected Co", { status: "rejected" }), compRow(3, "Proposed Co", { status: "proposed" }));
    await go();
    const sent = state.researchCalls[0] as { items: string[]; exclude: string[] };
    expect(sent.items).toHaveLength(8);
    expect(sent.items.join(" ")).not.toContain("Another tenant");
    expect([...sent.exclude].sort()).toEqual(["Own Co", "Proposed Co", "Rejected Co"]);
    // The model proposes a rejected company anyway: it is dropped, not saved.
    state.researchRun = goodRun([{ name: "rejected co", facts: [{ text: "Won an award", kind: "award", source_url: PAGE }] }]);
    const res = await (await go()).json();
    expect(res).toMatchObject({ proposed: 0, dropped: 1, notice: "No sourced competitors were found. Nothing was saved." });
    expect(comps().filter((c) => String(c.name).toLowerCase() === "rejected co")).toHaveLength(1);
  });

  it("saves nothing that the pages do not support: an uncited fact drops the company, and zero proposals says so", async () => {
    state.researchRun = goodRun([
      { name: "Made Up Co", facts: [{ text: "The biggest in the Gulf", kind: "profile", source_url: "https://invented.example.com/x" }] },
      { name: "No Source Co", facts: [{ text: "Has 500 staff", kind: "profile" }] },
    ]);
    const res = await (await go()).json();
    expect(res).toEqual({ proposed: 0, dropped: 2, notice: "No sourced competitors were found. Nothing was saved." });
    expect(comps()).toHaveLength(0);
    expect(state.changes.filter((c) => c.objectType === "opportunity_competitors")).toEqual([]);
  });

  it("an invented amount is not stored: the statement stays, the number goes", async () => {
    state.researchRun = goodRun([{ name: "Rival Co", facts: [{ text: "Won an award", kind: "award", source_url: PAGE }], price: { text: "A comparable award was around SAR 1.9 million", amount: 4_000_000, source_url: PAGE } }]);
    await go();
    expect((comps()[0].evidence as { price: { amount: number | null; text: string } }).price).toMatchObject({ amount: null, text: "A comparable award was around SAR 1.9 million" });
  });

  it("is off, with the reason, when web research is not switched on, and nothing is read or run", async () => {
    state.features = { pipeline: true, gcc_tender: true };
    const res = await go();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not switched on/i);
    state.features = { pipeline: true, gcc_tender: true, ai_assistant: true, ai_assistant_web: true };
    state.config = { ai_assistant: { block_external_calls: true } };
    const blocked = await go();
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toMatch(/blocks calls/i);
    expect(state.researchCalls).toEqual([]);
  });

  it("the gate: a standard deal, another workspace, a view-only person and the flag off are all refused before anything runs", async () => {
    expect((await go({ answers: ANSWERS }, OPP_STD)).status).toBe(404);
    expect((await go({ answers: ANSWERS }, OPP_T2)).status).toBe(404);
    state.edit = false;
    expect((await go()).status).toBe(403);
    state.edit = true;
    state.features = { pipeline: true, ai_assistant: true, ai_assistant_web: true };
    expect((await go()).status).toBe(404);
    expect(state.researchCalls).toEqual([]);
    expect(state.db.rows("opportunity_competitors")).toHaveLength(0);
  });

  it("answers 503 with the update line while migration 0239 (or 0229) is pending, before it asks or searches", async () => {
    state.db.missingColumns.opportunity_competitors = new Set(["status", "origin", "evidence"]);
    const res = await go({});
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/migration 0239/);
    state.db.missingColumns.opportunity_competitors = new Set();
    state.db.missing.add("opportunity_competitors");
    expect((await go({})).status).toBe(503);
    expect(state.researchCalls).toEqual([]);
  });

  it("stops at the third run of the day for a tender (the cap counts this tender only), without searching", async () => {
    const at = new Date().toISOString();
    for (let i = 0; i < 3; i++) state.db.rows("ai_usage_log").push({ id: `u${i}`, tenant_id: T1, surface: "competitor_research", study_id: OPP, input_tokens: 1, output_tokens: 1, created_at: at });
    const res = await go();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("Market research ran 3 times today for this tender. Try again tomorrow.");
    expect(state.researchCalls).toEqual([]);
    // Another tender, earlier days and another workspace do not count.
    state.db.rows("ai_usage_log").length = 0;
    for (let i = 0; i < 5; i++) state.db.rows("ai_usage_log").push({ id: `v${i}`, tenant_id: T1, surface: "competitor_research", study_id: OPP_OTHER, input_tokens: 1, output_tokens: 1, created_at: at });
    for (let i = 0; i < 5; i++) state.db.rows("ai_usage_log").push({ id: `w${i}`, tenant_id: T1, surface: "competitor_research", study_id: OPP, input_tokens: 1, output_tokens: 1, created_at: "2026-01-01T00:00:00Z" });
    state.db.rows("ai_usage_log").push({ id: "t2", tenant_id: T2, surface: "competitor_research", study_id: OPP, input_tokens: 1, output_tokens: 1, created_at: at });
    expect((await go()).status).toBe(200);
  });

  it("stops when the month's AI allowance is used, without searching", async () => {
    state.config = { ai_assistant: { monthly_token_budget: 1000 } };
    state.db.rows("ai_usage_log").push({ id: "m1", tenant_id: T1, surface: "assistant", study_id: null, input_tokens: 900, output_tokens: 200, created_at: new Date().toISOString() });
    const res = await go();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("over_budget");
    expect(state.researchCalls).toEqual([]);
  });

  it("a failed search saves nothing and bills nothing: no key 503, unreadable answer or no search 502, too slow 504", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await go()).status).toBe(503);
    process.env.ANTHROPIC_API_KEY = "test-key";
    for (const [message, status] of [[NO_KEY, 503], [NO_ANSWER, 502], [NO_SEARCH, 502], ["The research took too long and was stopped. Nothing was saved.", 504], ["The AI declined this research.", 502]] as const) {
      state.researchError = new AnalysisResearchError(message);
      const res = await go();
      expect(res.status, message).toBe(status);
      expect((await res.json()).error, message).toBe(message);
    }
    state.researchError = new Error("socket hang up");
    expect((await go()).status).toBe(502);
    expect(comps()).toHaveLength(0);
    expect(state.db.rows("ai_usage_log")).toHaveLength(0);
  });

  it("never reads the request for the workspace, the deal, the status or the evidence", async () => {
    await go({ answers: ANSWERS, tenant_id: T2, opportunity_id: OPP_OTHER, status: "accepted", evidence: { v: 1 } });
    expect(comps(OPP_OTHER)).toHaveLength(0);
    expect(comps(OPP, T2)).toHaveLength(0);
    expect(comps()[0].status).toBe("proposed");
  });

  it("holds the 30-per-tender limit: proposals beyond it are left out, not saved", async () => {
    for (let i = 1; i <= 29; i++) state.db.rows("opportunity_competitors").push(compRow(i, `Company ${i}`, { created_at: `2026-10-01T00:00:${String(i).padStart(2, "0")}Z` }));
    state.researchRun = goodRun([
      { name: "New One", facts: [{ text: "Won an award", kind: "award", source_url: PAGE }] },
      { name: "New Two", facts: [{ text: "Won another award", kind: "award", source_url: PAGE }] },
    ]);
    expect(await (await go()).json()).toMatchObject({ proposed: 1, dropped: 1 });
    expect(comps()).toHaveLength(30);
  });
});
