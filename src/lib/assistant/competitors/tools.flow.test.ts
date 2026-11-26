import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

// The two competitor tools through the whole assistant loop, with the model and the database replaced. What is held here: the tools exist
// only when every gate holds; every figure on the card is computed from this workspace's own rows and another workspace's rows never
// reach it; the model is called once for wording and its text is checked; the card is drawn from fields; the add-a-competitor tool only
// makes a signed confirm card and writes nothing; and after web text is in the conversation it is off.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const { holder, O1, OX } = vi.hoisted(() => ({
  holder: { db: null as unknown as { client: unknown } },
  O1: "aaaaaaaa-0000-4000-8000-000000000034",
  OX: "bbbbbbbb-0000-4000-8000-000000000099",
}));

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => holder.db.client,
  requireTenantUser: async () => { throw new Error("not used"); },
  createServerSupabase: async () => { throw new Error("not used"); },
  getAuthUser: async () => null,
}));
vi.mock("@/lib/api/listSources", () => ({
  LIST_SOURCES: { accounts: { label: "Accounts", description: "companies", relatedWorkcenter: "accounts", fields: [{ path: "id", type: "string" }], load: async () => [] } },
}));
vi.mock("@/lib/ai/reportCompile", () => ({ compileAndRun: vi.fn() }));
vi.mock("@/lib/marketing/leads/queries", () => ({ listScoredLeads: vi.fn(async () => ({ leads: [], pending: false })) }));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn(), askStructuredMetered: vi.fn(), AiError: class extends Error {}, monthlyTokensUsed: async () => 0 }));
vi.mock("@/lib/tender/bids/server", () => ({ currentSnapshot: vi.fn(async () => ({ total: 2_000_000, line_count: 10, lines: [], source_ids: [] })) }));
vi.mock("@/lib/tender/bids/costServer", async (orig) => ({
  ...(await orig<typeof import("@/lib/tender/bids/costServer")>()),
  currentCostSummary: vi.fn(async () => ({ total: 1_800_000, costedLines: 10 })),
}));

import { askAssistant, WEB_LOCKED_TOOLS, type AssistantAskCtx } from "@/lib/ai/assistant";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { verifyToken } from "@/lib/actions/token";
import { AssistantMeter } from "@/lib/assistant/meter";
import type { PermissionSet } from "@/lib/permissions";
import { ALPHA, BETA, COMPETITORS, GAMMA, LOST, OPEN, WON } from "./fixture";
import { PRESS_ROUTE, PROPOSE_ACT, competitorGate } from "./tools";

const NOW = new Date("2026-11-26T09:00:00Z");
const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const grant = (wc: string, canEdit = true) => [wc, { workcenter: wc, canView: true, canCreate: canEdit, canEdit, canDelete: false }] as const;
const PIPELINE_VIEW_ONLY = { unrestricted: false, grants: new Map([grant("pipeline", false)]) } as unknown as PermissionSet;
const PIPELINE_EDIT_ONLY = { unrestricted: false, grants: new Map([grant("pipeline", true)]) } as unknown as PermissionSet;
const FEATURES = { ai_assistant: true, ai_assistant_actions: true, next_experience: true, ai_assistant_web: true, accounts: true, pipeline: true, gcc_tender: true, estimator: true };
const CURRENCY = { code: "SAR", symbol: "SAR", grouping: "standard" } as never;

type Reply = { content: unknown[]; stop_reason: string; usage: Record<string, number> };
const text = (t: string): Reply => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } });
const toolUse = (name: string, input: unknown, id = "tu1"): Reply => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 40 } });

const NARRATIVE = JSON.stringify({
  summary: "OPP-0034 has 3 competitors recorded, and Alpha Builders has beaten you 3 times.",
  position: "Your price now sits at a 10% margin, inside the range of 8% to 10%.",
});

function seed(tenantId: string, dealId: string, ref: string, idBase: number): Record<string, Row[]> {
  const past = [...WON, ...LOST, ...OPEN];
  const opportunities: Row[] = [{ id: dealId, tenant_id: tenantId, ref, title: "Riyadh precast package", outcome: "open", stage: "estimating", currency: "SAR" }];
  const tenders: Row[] = [{ opportunity_id: dealId, tenant_id: tenantId, closing_at: "2026-12-03T12:00:00.000Z", award_value: null, winning_bidder: null }];
  const comps: Row[] = COMPETITORS.map((c, i) => ({ id: `c-${tenantId}-${i}`, opportunity_id: dealId, tenant_id: tenantId, name: c.name, country: c.country, expected_price: c.expectedPrice, is_winner: false, sort: i, created_at: "2026-11-01T00:00:00Z", status: "accepted", origin: "manual", evidence: c.evidence ? { v: 1, facts: c.evidence.facts, price: null, wins: null, researched_at: c.evidence.researchedAt, model: "m" } : null }));
  const versions: Row[] = [];
  const costs: Row[] = [];
  past.forEach((p, i) => {
    const id = `${String(idBase + i).padStart(8, "0")}-0000-4000-8000-000000000001`;
    opportunities.push({ id, tenant_id: tenantId, ref: `OLD-${idBase + i}`, title: "Old", outcome: p.outcome, stage: p.outcome === "open" ? "estimating" : "awarded", currency: p.currency });
    tenders.push({ opportunity_id: id, tenant_id: tenantId, closing_at: null, award_value: p.awardValue, winning_bidder: p.winner });
    p.competitors.forEach((n, j) => comps.push({ id: `p-${tenantId}-${i}-${j}`, opportunity_id: id, tenant_id: tenantId, name: n, status: "accepted" }));
    if (p.ourBid !== null) versions.push({ opportunity_id: id, tenant_id: tenantId, version_no: 1, total: p.ourBid });
    if (p.ourCost !== null) costs.push({ opportunity_id: id, tenant_id: tenantId, version_no: 1, total_cost: p.ourCost });
  });
  return { opportunities, opportunity_tenders: tenders, opportunity_competitors: comps, tender_bid_versions: versions, tender_bid_version_costs: costs };
}

function setup(o: { replies?: Reply[]; perms?: PermissionSet; features?: Record<string, boolean>; extra?: Record<string, Row[]> } = {}) {
  const mine = seed(T1, O1, "OPP-0034", 1);
  // Another workspace with a tender of its own, the same competitor names and its own history: none of it may reach the first one.
  const theirs = seed(T2, OX, "OPP-0099", 50);
  const merged: Record<string, Row[]> = {};
  for (const k of Object.keys(mine)) merged[k] = [...mine[k], ...theirs[k]];
  const db = fakeAdmin({ ...merged, assistant_actions: [], ai_usage_log: [], ...o.extra });
  holder.db = db;
  const params: Record<string, unknown>[] = [];
  const queue = [...(o.replies ?? [text("ok")])];
  const create = vi.fn(async (p: Record<string, unknown>) => {
    params.push(JSON.parse(JSON.stringify(p)));
    const r = queue.shift();
    if (!r) throw new Error("no scripted reply left");
    return r;
  });
  const meter = new AssistantMeter({ tenantId: T1, userId: "user-1", budget: 1_000_000 }, {
    allowanceFor: vi.fn(async () => ({ allowed: true, used: 0, budget: 1_000_000, remaining: 1_000_000 })),
    logUsage: vi.fn(async () => {}) as never,
  });
  const ctx: AssistantAskCtx = {
    supabase: db.client as never, tenantId: T1, userId: "user-1", perms: o.perms ?? ALL, currency: CURRENCY, features: o.features ?? FEATURES, isAdmin: true,
    route: null, meter, anthropic: { messages: { create } } as unknown as Anthropic, now: NOW,
    screenDeps: { loadFields: async () => [] as never },
    web: { enabled: true, userId: "user-1", allow: null, consentQuery: null, consentId: null },
  };
  return { ctx, db, params, create, queue };
}

const ask = (q: string, ...earlier: { role: "user" | "assistant"; text: string; web?: boolean }[]) => [...earlier, { role: "user" as const, text: q }];
const names = (p: Record<string, unknown>) => ((p.tools as { name: string }[]) ?? []).map((t) => t.name);
const systemText = (p: Record<string, unknown>) => (p.system as { text: string }[])[0].text;

beforeEach(() => { vi.clearAllMocks(); });

describe("the tools exist only when every gate holds", () => {
  it("everything on: both tools, and the rule in the prompt", async () => {
    const s = setup();
    await askAssistant(ask("how are we placed on OPP-0034?"), s.ctx);
    expect(names(s.params[0])).toEqual(expect.arrayContaining(["analyse_competitors", "propose_competitor"]));
    expect(systemText(s.params[0])).toContain("15. COMPETITORS");
  });

  it.each([
    ["the tender edition is off", { features: { ...FEATURES, gcc_tender: false } }, false, false],
    ["the Pipeline is off", { features: { ...FEATURES, pipeline: false } }, false, false],
    ["the assistant's actions are off", { features: { ...FEATURES, ai_assistant_actions: false } }, true, false],
    ["Nova is off", { features: { ...FEATURES, next_experience: false } }, true, false],
    ["the person may view the Pipeline but not edit it", { perms: PIPELINE_VIEW_ONLY }, true, false],
    ["the person may not view the Pipeline", { perms: { unrestricted: false, grants: new Map([grant("accounts")]) } as unknown as PermissionSet }, false, false],
  ])("%s", async (_n, o, analyse, propose) => {
    const s = setup(o as never);
    await askAssistant(ask("how are we placed on OPP-0034?"), s.ctx);
    const n = names(s.params[0]);
    expect(n.includes("analyse_competitors")).toBe(analyse);
    expect(n.includes("propose_competitor")).toBe(propose);
    expect(systemText(s.params[0]).includes("15. COMPETITORS")).toBe(analyse);
  });

  it("the write is also off in the gate itself, so a model that calls it anyway is told it does not exist", async () => {
    const s = setup({ features: { ...FEATURES, ai_assistant_actions: false }, replies: [toolUse("propose_competitor", { name: "Delta Co", deal: "OPP-0034" }), text("I cannot add that here.")] });
    const reply = await askAssistant(ask("add Delta Co to OPP-0034"), s.ctx);
    expect(reply.card).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain('unknown tool \\"propose_competitor\\"');
    expect(competitorGate({ features: { ...FEATURES, ai_assistant_actions: false }, perms: ALL, userId: "u" }).propose).toBe(false);
  });

  it("is part of the web lock: after a web answer the write is gone and cannot be called", async () => {
    expect(WEB_LOCKED_TOOLS.has("propose_competitor")).toBe(true);
    const s = setup({ replies: [toolUse("propose_competitor", { name: "Delta Co", deal: "OPP-0034" }), text("Not now.")] });
    const reply = await askAssistant(ask("add Delta Co", { role: "assistant", text: "From the web: ...", web: true }), s.ctx);
    expect(names(s.params[0])).not.toContain("propose_competitor");
    expect(names(s.params[0])).toContain("analyse_competitors");
    expect(reply.card).toBeUndefined();
    expect(holder.db && (s.db.tables.opportunity_competitors as Row[]).filter((r) => r.name === "Delta Co")).toHaveLength(0);
  });
});

describe("analyse_competitors", () => {
  const run = (over: Parameters<typeof setup>[0] = {}, input: Record<string, unknown> = { deal: "OPP-0034" }, narrative: string = NARRATIVE) =>
    (async () => {
      const s = setup({ replies: [toolUse("analyse_competitors", input), text(narrative), text("Here is where you stand. Extra words that should be cut.")], ...over });
      const reply = await askAssistant(ask("what are our chances on OPP-0034 and how low can we go?"), s.ctx);
      return { s, reply };
    })();

  it("returns a card computed from this workspace's own rows, with one sentence beside it", async () => {
    const { s, reply } = await run();
    const card = reply.competitors!;
    expect(card.deal).toMatchObject({ ref: "OPP-0034", price: 2_000_000, cost: 1_800_000, marginPct: 10, daysLeft: 8 });
    expect(card.history).toMatchObject({ decided: 12, wins: 5, losses: 7 });
    expect(card.ladder).toMatchObject({ basis: "history", sample: 12, recommended: { fromPct: 8, toPct: 10, peakPct: 10 } });
    const alpha = card.competitors.find((c) => c.name === ALPHA)!;
    expect(alpha).toMatchObject({ met: 7, theyWon: 3, weWon: 3, typicalGapPct: 5 });
    expect(alpha.web.sources).toBe(2);
    expect(reply.answer).toBe("Here is where you stand.");
    expect(card.writtenBy).toBe("model");
    expect(card.summary).toContain("Alpha Builders has beaten you 3 times");
    expect(s.db.tables.opportunity_competitors.filter((r) => r.name === "Delta Co")).toHaveLength(0);
  });

  it("calls the model for wording once, with the small model and no tools, and meters it", async () => {
    const { s } = await run();
    expect(s.create).toHaveBeenCalledTimes(3);
    const narrative = s.params[1];
    expect(narrative.tools).toBeUndefined();
    expect(narrative.model).toBe("claude-opus-5-5");
    expect(JSON.stringify(narrative.messages)).toContain("<facts>");
    expect(JSON.stringify(narrative.messages)).not.toContain("tenant_id");
  });

  it("hands the chat model figures and names only: none of the saved web text, no ids", async () => {
    const { s } = await run();
    const back = JSON.stringify(s.params[2].messages);
    expect(back).toContain("analysis_result");
    expect(back).toContain("Margin 10%: chance of winning 43.6%");
    expect(back).not.toContain("housing package");
    expect(back).not.toContain(T1);
    expect(back).not.toContain(T2);
  });

  it("a model sentence with a number the computation did not make is replaced by the plain wording", async () => {
    const { reply } = await run({}, { deal: "OPP-0034" }, JSON.stringify({ summary: "You win 77% of the time.", position: "Bid at 17%." }));
    expect(reply.competitors!.writtenBy).toBe("rules");
    expect(reply.competitors!.summary).not.toContain("77");
  });

  it("another workspace's tender is simply not found, and its rows never reach this workspace's history", async () => {
    const other = await run({}, { deal: "OPP-0099" });
    expect(other.reply.competitors).toBeUndefined();
    expect(JSON.stringify(other.s.params[1].messages)).toContain("No tender deal OPP-0099 was found");
    const { reply } = await run();
    expect(reply.competitors!.history.decided).toBe(12);
    expect(reply.competitors!.competitors.find((c) => c.name === ALPHA)!.met).toBe(7);
  });

  it("a competitor that is not on the tender is reported to the model, with the offer to add it", async () => {
    const { s, reply } = await run({}, { deal: "OPP-0034", competitor: "Zeta Ltd" });
    expect(reply.competitors).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("Zeta Ltd is not on the competitor list of OPP-0034");
    expect(JSON.stringify(s.params[1].messages)).toContain("propose_competitor");
  });

  it("puts the competitor asked about first", async () => {
    const { reply } = await run({}, { deal: "OPP-0034", competitor: "gamma works" });
    expect(reply.competitors!.focus).toBe("gamma works");
    expect(reply.competitors!.competitors[0]).toMatchObject({ name: GAMMA, focus: true });
  });

  it("a person who may not see costs gets the starting assumption and no amounts", async () => {
    const { reply } = await run({ perms: PIPELINE_EDIT_ONLY });
    const card = reply.competitors!;
    expect(card.ladder.basis).toBe("prior");
    expect(card.deal.cost).toBeNull();
    expect(card.ladder.rows.every((r) => r.price === null && r.expected === null)).toBe(true);
    expect(JSON.stringify(card)).not.toContain("1800000");
  });

  it("a tender number nobody has is an error, never a guess at the nearest one", async () => {
    const { s, reply } = await run({}, { deal: "not a ref" });
    expect(reply.competitors).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("Give the tender's reference");
  });

  it("one card at a time", async () => {
    const s = setup({ replies: [
      { content: [{ type: "tool_use", id: "a", name: "analyse_competitors", input: { deal: "OPP-0034" } }, { type: "tool_use", id: "b", name: "analyse_competitors", input: { deal: "OPP-0034" } }], stop_reason: "tool_use", usage: {} },
      text(NARRATIVE), text("Done."),
    ] });
    const reply = await askAssistant(ask("analyse OPP-0034 twice"), s.ctx);
    expect(reply.competitors).toBeDefined();
    expect(JSON.stringify(s.params[2].messages)).toContain("one card at a time");
  });
});

describe("propose_competitor", () => {
  const propose = async (input: Record<string, unknown>, over: Parameters<typeof setup>[0] = {}) => {
    const s = setup({ replies: [toolUse("propose_competitor", input), text("Check the card and press Add competitor.")], ...over });
    const reply = await askAssistant(ask("add Delta Co as a competitor on OPP-0034"), s.ctx);
    return { s, reply };
  };

  it("makes a confirm card bound to this person, this workspace and this tender, and writes nothing", async () => {
    const before = JSON.stringify((await propose({ name: "Delta Co", country: "UAE", deal: "OPP-0034" })).s.db.tables.opportunity_competitors);
    const { s, reply } = await propose({ name: "Delta Co", country: "UAE", note: "Strong in precast", deal: "OPP-0034" });
    const card = reply.card!;
    expect(card).toMatchObject({ object: "competitor", action: "create", press: PRESS_ROUTE, primaryLabel: "Add competitor", risk: "write", title: "Add a competitor to OPP-0034" });
    expect(card.fields.map((f) => [f.key, f.value, f.required])).toEqual([["name", "Delta Co", true], ["country", "UAE", false], ["note", "Strong in precast", false]]);
    const v = verifyToken(card.token, { tenantId: T1, userId: "user-1", cardId: card.id });
    expect(v.ok && v.payload.act).toBe(`${PROPOSE_ACT}:${O1}`);
    expect(verifyToken(card.token, { tenantId: T2, userId: "user-1", cardId: card.id }).ok).toBe(false);
    expect(verifyToken(card.token, { tenantId: T1, userId: "user-2", cardId: card.id }).ok).toBe(false);
    expect(JSON.stringify(s.db.tables.opportunity_competitors).includes("Delta Co")).toBe(false);
    expect(before.includes("Delta Co")).toBe(false);
    expect(JSON.stringify(s.params[1].messages)).toContain("Nothing is added until the person presses");
  });

  it.each([
    ["one already on the list", { name: "alpha  builders", deal: "OPP-0034" }, "already on the competitor list of OPP-0034"],
    ["no name", { deal: "OPP-0034" }, "Ask the person which company to add"],
    ["a tender of another workspace", { name: "Delta Co", deal: "OPP-0099" }, "No tender deal OPP-0099 was found"],
  ])("no card for %s", async (_n, input, said) => {
    const { s, reply } = await propose(input);
    expect(reply.card).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain(said);
  });

  it("a name longer than a competitor's name may be is cut to the limit, and the card shows what will be saved", async () => {
    const { reply } = await propose({ name: "x".repeat(300), deal: "OPP-0034" });
    expect(reply.card!.fields[0].value).toHaveLength(200);
  });

  it("a company that is only proposed asks to accept it on the tab; one that was rejected comes back with a notice", async () => {
    const extra = (status: string) => ({ extra: { opportunity_competitors: [
      ...seed(T1, O1, "OPP-0034", 1).opportunity_competitors, ...seed(T2, OX, "OPP-0099", 50).opportunity_competitors,
      { id: "c-x", opportunity_id: O1, tenant_id: T1, name: "Delta Co", status, sort: 9, created_at: "2026-11-02T00:00:00Z" },
    ] } });
    const proposed = await propose({ name: "Delta Co", deal: "OPP-0034" }, extra("proposed"));
    expect(proposed.reply.card).toBeUndefined();
    expect(JSON.stringify(proposed.s.params[1].messages)).toContain("already proposed");
    const rejected = await propose({ name: "Delta Co", deal: "OPP-0034" }, extra("rejected"));
    expect(rejected.reply.card!.notices[0]).toContain("removed from this tender earlier");
  });

  it("one card at a time, shared with every other card", async () => {
    const s = setup({ replies: [
      { content: [{ type: "tool_use", id: "a", name: "propose_competitor", input: { name: "Delta Co", deal: "OPP-0034" } }, { type: "tool_use", id: "b", name: "propose_competitor", input: { name: "Echo Co", deal: "OPP-0034" } }], stop_reason: "tool_use", usage: {} },
      text("Check the card."),
    ] });
    const reply = await askAssistant(ask("add Delta Co and Echo Co"), s.ctx);
    expect(reply.card!.fields[0].value).toBe("Delta Co");
    expect(JSON.stringify(s.params[1].messages)).toContain("one card at a time");
  });

  it("the card id is new every time and the structure is part of the token", async () => {
    const a = (await propose({ name: "Delta Co", deal: "OPP-0034" })).reply.card!;
    const b = (await propose({ name: "Delta Co", deal: "OPP-0034" })).reply.card!;
    expect(a.id).not.toBe(b.id);
    expect(a.token).not.toBe(b.token);
  });
});
