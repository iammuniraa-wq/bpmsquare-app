import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// The three price tools through the whole assistant loop, with the model replaced and a real in-memory database underneath, and the press of
// an award card through the real award route. What is held: the tools exist only where every gate holds; the RFQ is found inside the caller's
// workspace only; every figure on the card is the program's and the model's words are checked against them; the award card writes nothing
// until pressed, the press runs the existing route once per line on the person's own session, and a card cannot be forged, replayed or spent
// by someone else.

const state = vi.hoisted(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
  return {
    db: null as unknown as import("@/lib/inbox/testing/memoryDb").MemoryDb,
    user: { id: "11111111-1111-4111-8111-111111111111", email: "me@t1.test" },
    features: {} as Record<string, boolean>,
    changes: [] as { objectType: string; action: string; via: string | null; changes?: { field: string; from: unknown; to: unknown }[] }[],
  };
});

const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: "member", supabase: { from: (t: string) => state.db.from(t) } }),
  createServerSupabase: async () => { throw new Error("not used"); },
}));
vi.mock("@/lib/permissions", async (orig) => ({ ...(await orig<typeof import("@/lib/permissions")>()), resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }) }));
vi.mock("@/lib/tenant", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant")>()),
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
}));
vi.mock("@/lib/objectFeatures", async (orig) => ({ ...(await orig<typeof import("@/lib/objectFeatures")>()), tenantOwnsObject: async () => true }));
vi.mock("@/lib/tenantClock", () => ({
  tenantToday: async () => "2026-11-26", tenantTimezone: async () => "Asia/Riyadh", dateKeyIn: (_tz: string, at: Date = new Date()) => at.toISOString().slice(0, 10),
}));
vi.mock("@/lib/changeLog", async (orig) => {
  const real = await orig<typeof import("@/lib/changeLog")>();
  const { currentVia } = await import("@/lib/actions/via");
  return { ...real, logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push({ ...p, via: currentVia() }); } };
});
vi.mock("@/lib/events/emitters", () => ({ emitRfqSent: async () => {}, emitRfqReplied: async () => {}, emitRfqAwarded: async () => {} }));
vi.mock("@/lib/tender/estimates/writeBack", () => ({ writeAwardedCostToEstimate: async () => ({ written: false, reason: "stand-in" }) }));
vi.mock("@/lib/api/listSources", () => ({
  LIST_SOURCES: {
    accounts: { label: "Accounts", description: "companies", relatedWorkcenter: "accounts", fields: [{ path: "id", type: "string" }, { path: "name", type: "string", searchable: true }], load: async () => [] },
  },
}));
vi.mock("@/lib/ai/reportCompile", () => ({ compileAndRun: vi.fn() }));
vi.mock("@/lib/marketing/leads/queries", () => ({ listScoredLeads: vi.fn(async () => ({ leads: [], pending: false })) }));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn(), askStructuredMetered: vi.fn(), AiError: class extends Error {}, monthlyTokensUsed: async () => 0 }));

import { askAssistant, WEB_LOCKED_TOOLS, type AssistantAskCtx, type AssistantReply } from "@/lib/ai/assistant";
import { AssistantMeter } from "@/lib/assistant/meter";
import { CURRENCIES } from "@/lib/currency";
import { verifyToken, signToken, hashOf } from "@/lib/actions/token";
import type { PermissionSet } from "@/lib/permissions";
import { pressAward, type PressCtx } from "./press";
import { AWARD_ACT, canonicalPlan } from "./plan";
import { LINES, SUPPLIERS, RS, LINE_ID, rid, responses } from "./fixture";
import type { DockAward, DockPriceCompare } from "./types";

// The first press loads the Costing route and everything it imports.
vi.setConfig({ testTimeout: 60_000 });

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const NO_RFQS: PermissionSet = { unrestricted: false, grants: new Map([["accounts", { workcenter: "accounts", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) };
const VIEW_RFQS: PermissionSet = { unrestricted: false, grants: new Map([["rfqs", { workcenter: "rfqs", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) };
const NOW = new Date("2026-11-26T09:00:00Z");
const RFQ = "50000000-0000-4000-8000-000000000001";
const RFQ_T2 = "50000000-0000-4000-8000-000000000002";
const BASE = { ai_assistant: true, rfq: true };
const ACTIONS = { ...BASE, ai_assistant_actions: true, next_experience: true };
const GOOD = "Alpha Supply scores 94.1 of 100 and is the cheapest on 4 of 8 lines. Splitting by line would cost SAR 35,100.00, which is SAR 1,200.00 (3.3%) less than the best single supplier.";

type Reply = { content: unknown[]; stop_reason: string; usage: Record<string, number> };
const text = (t: string): Reply => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } });
const toolUse = (name: string, input: unknown, id = "tu1"): Reply => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 40 } });

function seed() {
  const g = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  state.db = new MemoryDb({
    tenants: [{ id: T1, features: { rfq: true, pipeline: true }, config: { currency: "SAR" } }, { id: T2, features: { rfq: true }, config: { currency: "SAR" } }],
    rfqs: [
      { id: RFQ, tenant_id: T1, ref: "RFQ-0014", title: "Civil package", status: "replied", origin_type: "manual", origin_id: null, respond_by: null },
      { id: RFQ_T2, tenant_id: T2, ref: "RFQ-0099", title: "Theirs", status: "replied", origin_type: "manual", origin_id: null, respond_by: null },
    ],
    rfq_lines: LINES.map((l) => ({
      id: l.id, tenant_id: T1, rfq_id: RFQ, sl_no: l.slNo, description: l.description, uom: l.uom, qty: l.qty, status: "open", awarded_unit_cost: null,
      product_id: l.slNo === 4 ? g(104) : l.slNo === 7 ? g(107) : null, cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null,
    })),
    rfq_suppliers: SUPPLIERS.map((s, i) => ({ id: s.id, tenant_id: T1, rfq_id: RFQ, supplier_id: s.supplierId, status: "replied", reminder_count: 0, last_reminded_at: null, token_nonce: "n", created_at: `2026-11-0${i + 1}T00:00:00Z` })),
    suppliers: SUPPLIERS.map((s) => ({ id: s.supplierId, tenant_id: T1, name: s.name, ref: "SUP-1" })),
    rfq_responses: responses().map((r) => ({ ...r, tenant_id: T1, source: "buyer", is_awarded: false, updated_at: r.submitted_at })),
    products: [
      { id: g(104), tenant_id: T1, name: "Precast pipe 600 mm", sku: "PP-600", cost_price: 80, cost_price_as_of: "2025-12-01", supplier_id: null },
      { id: g(107), tenant_id: T1, name: "Rebar T16", sku: "RB-16", cost_price: 3000, cost_price_as_of: "2026-10-01", supplier_id: null },
    ],
    assistant_actions: [],
  });
  state.db.unique("rfq_line_awards", (e, n) => e.rfq_line_id === n.rfq_line_id && !e.superseded_at && !n.superseded_at);
  state.db.unique("assistant_actions", (e, n) => e.id === n.id);
  state.db.unique("product_suppliers", () => false);
  state.features = { ...ACTIONS };
  state.changes = [];
  state.user = { id: ME, email: "me@t1.test" };
}

function setup(o: { replies?: Reply[]; perms?: PermissionSet; features?: Record<string, boolean>; userId?: string | null; budget?: boolean } = {}) {
  const params: Record<string, unknown>[] = [];
  const queue = [...(o.replies ?? [text("ok")])];
  const create = vi.fn(async (p: Record<string, unknown>) => {
    params.push(JSON.parse(JSON.stringify(p)));
    const r = queue.shift();
    if (!r) throw new Error("no scripted reply left");
    return r;
  });
  const meter = new AssistantMeter({ tenantId: T1, userId: ME, budget: 1_000_000 }, {
    allowanceFor: vi.fn(async () => ({ allowed: true, used: 0, budget: 1_000_000, remaining: 1_000_000 })), logUsage: vi.fn(async () => {}) as never,
  });
  const ctx: AssistantAskCtx = {
    supabase: { from: (t: string) => state.db.from(t) } as never, tenantId: T1, userId: o.userId === null ? undefined : (o.userId ?? ME),
    perms: o.perms ?? ALL, currency: CURRENCIES.SAR, features: o.features ?? { ...ACTIONS }, isAdmin: true, route: null, meter,
    anthropic: { messages: { create } } as unknown as Anthropic, now: NOW, screenDeps: { loadFields: async () => [] as never },
  };
  return { ctx, params, create, queue };
}

const ask = (q: string, ...earlier: { role: "user" | "assistant"; text: string; web?: boolean }[]) => [...earlier, { role: "user" as const, text: q }];
const toolNames = (p: Record<string, unknown>) => ((p.tools as { name: string }[]) ?? []).map((t) => t.name);
const snapshot = () => JSON.stringify(Object.entries(state.db.tables).filter(([, rows]) => rows.length > 0).sort(([a], [b]) => a.localeCompare(b)));
const asCompare = (r: AssistantReply) => r.price as DockPriceCompare;
const asAward = (r: AssistantReply) => r.price as DockAward;

beforeEach(() => {
  seed();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("who has the tools", () => {
  it("compare_quotes needs the RFQ module and the RFQs view; propose_award also the assistant's actions flag and edit rights; price_check the tender edition", async () => {
    const names = async (o: Parameters<typeof setup>[0]) => { const s = setup({ ...o, replies: [text("hi")] }); await askAssistant(ask("hello there"), s.ctx); return (s.params[0] ? toolNames(s.params[0]) : []).filter((n) => ["compare_quotes", "propose_award", "price_check"].includes(n)); };
    expect(await names({ features: { ...BASE } })).toEqual(["compare_quotes"]);
    expect(await names({ features: { ...ACTIONS } })).toEqual(["compare_quotes", "propose_award"]);
    expect(await names({ features: { ...ACTIONS, gcc_tender: true, pipeline: true } })).toEqual(["compare_quotes", "price_check", "propose_award"]);
    expect(await names({ features: { ai_assistant: true } })).toEqual([]);
    expect(await names({ features: { ...ACTIONS }, perms: VIEW_RFQS })).toEqual(["compare_quotes"]);
    expect(await names({ features: { ...ACTIONS }, perms: NO_RFQS })).toEqual([]);
    expect(await names({ features: { ...ACTIONS }, userId: null })).toEqual(["compare_quotes"]);
  });
  it("the rule is in the prompt only when a tool is", async () => {
    const on = setup({ features: { ...BASE }, replies: [text("hi")] });
    await askAssistant(ask("hello there"), on.ctx);
    expect(JSON.stringify(on.params[0].system)).toContain("PRICE COMPARISON");
    const off = setup({ features: { ai_assistant: true }, replies: [text("hi")] });
    await askAssistant(ask("hello there"), off.ctx);
    expect(JSON.stringify(off.params[0].system)).not.toContain("PRICE COMPARISON");
  });
  it("the award tool is locked after a web result, and is not even offered while one is in the recent turns", async () => {
    expect(WEB_LOCKED_TOOLS.has("propose_award")).toBe(true);
    const s = setup({ replies: [text("fine")] });
    await askAssistant(ask("Compare the quotes", { role: "assistant", text: "From the web: ...", web: true }, { role: "user", text: "ok" }), s.ctx);
    expect(toolNames(s.params[0])).toContain("compare_quotes");
    expect(toolNames(s.params[0])).not.toContain("propose_award");
  });
  it("no tool takes a workspace, person or database id from the model", async () => {
    const s = setup({ features: { ...ACTIONS, gcc_tender: true, pipeline: true }, replies: [text("hi")] });
    await askAssistant(ask("hello there"), s.ctx);
    const defs = (s.params[0].tools as { name: string; input_schema: { properties: Record<string, unknown> } }[]).filter((t) => ["compare_quotes", "propose_award", "price_check"].includes(t.name));
    for (const d of defs) expect(Object.keys(d.input_schema.properties).filter((k) => /tenant|user|id$/i.test(k))).toEqual([]);
  });
});

describe("compare_quotes through the loop", () => {
  const compare = (extra: Reply[] = [text(GOOD), text("Alpha Supply is recommended. More on the card.")]) => [toolUse("compare_quotes", { reference: "RFQ-0014" }), ...extra];

  it("returns a card worked out by the program, with the model's two sentences checked against it, and one short sentence beside it", async () => {
    const s = setup({ replies: compare() });
    const r = await askAssistant(ask("Compare the quotes on RFQ-0014"), s.ctx);
    const card = asCompare(r);
    expect(card.kind).toBe("compare");
    expect(card.comparison.suppliers.map((x) => [x.name, x.total, x.score])).toEqual([["Alpha Supply", 36300, 94.1], ["Beta Trading", 36400, 91.7], ["Gamma Industrial", 41400, 86.2]]);
    expect(card.comparison.bestSingle).toMatchObject({ name: "Alpha Supply", total: 36300 });
    expect(card.comparison.split).toMatchObject({ total: 35100, saving: 1200, savingPct: 3.3 });
    expect(card.recommendationText).toBe(GOOD);
    expect(card.recommendationBy).toBe("model");
    expect(r.answer).toBe("Alpha Supply is recommended.");
    expect(card.next.map((n) => n.id)).toEqual(["open-compare", "award-single", "award-split"]);
    expect(card.next[0].target).toBe(`/rfqs/${RFQ}`);
    expect(card.next[1]).toMatchObject({ kind: "ask", question: "Propose awarding RFQ-0014 to Alpha Supply." });
    expect(r.card).toBeUndefined();
  });
  it("the history the next turn sees is the card as text, with no angle bracket in it", async () => {
    const r = await askAssistant(ask("Compare the quotes on RFQ-0014"), setup({ replies: compare() }).ctx);
    expect(asCompare(r).digest).toContain("- Beta Trading: 8 of 8 lines, total SAR 36,400.00");
    expect(asCompare(r).digest).not.toMatch(/[<>]/);
  });
  it("references come from our own history (the product's cost price), the RFQ's own answers excluded", async () => {
    const r = await askAssistant(ask("Compare the quotes on RFQ-0014"), setup({ replies: compare() }).ctx);
    const out = asCompare(r).comparison.risks.filter((x) => x.kind === "outlier").map((x) => x.text);
    expect(out).toEqual([
      "Item 7: Gamma Industrial at SAR 4,200.00 is 40% above your own price of SAR 3,000.00 (Product cost price, 1 Oct 2026).",
      "Item 4: Alpha Supply at SAR 100.00 is 25% above your own price of SAR 80.00 (Product cost price, 1 Dec 2025, stale: 12 months old).",
    ]);
  });
  it("a model sentence with an invented figure is thrown away and the computed one stands in", async () => {
    const r = await askAssistant(ask("Compare the quotes on RFQ-0014"), setup({ replies: compare([text("Alpha Supply saves you SAR 9,999.00 overall."), text("Alpha Supply is recommended.")]) }).ctx);
    expect(asCompare(r).recommendationBy).toBe("computed");
    expect(asCompare(r).recommendationText).toContain("Alpha Supply scores 94.1 of 100");
    expect(asCompare(r).recommendationText).not.toContain("9,999");
  });
  it("the narrative call is on the small model, has no tools and sees only the facts; the tool result is quoted data", async () => {
    const s = setup({ replies: compare() });
    await askAssistant(ask("Compare the quotes on RFQ-0014"), s.ctx);
    expect(s.params).toHaveLength(3);
    expect(s.params[1].tools).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("<facts>");
    expect(JSON.stringify(s.params[1].messages)).not.toContain("Civil package");
    const result = JSON.stringify(s.params[2].messages);
    expect(result).toContain("<price_comparison>");
    expect(result).toContain("ONE short sentence");
  });
  it("only the suppliers the person named are compared", async () => {
    const s = setup({ replies: [toolUse("compare_quotes", { reference: "RFQ-0014", suppliers: ["Alpha", "Beta"] }), text(GOOD), text("Done.")] });
    const r = await askAssistant(ask("Compare Alpha and Beta on RFQ-0014"), s.ctx);
    expect(asCompare(r).comparison.suppliers.map((x) => x.name)).toEqual(["Alpha Supply", "Beta Trading"]);
    expect(asCompare(r).comparison.commonLines).toBe(8);
  });
  it("another workspace's RFQ, and a reference that is not one, are not found and draw no card", async () => {
    for (const reference of ["RFQ-0099", "RFQ-0500", "QT-0001", "OPP-0034"]) {
      const s = setup({ replies: [toolUse("compare_quotes", { reference }), text("I could not find it.")] });
      const r = await askAssistant(ask(`Compare ${reference}`), s.ctx);
      expect(r.price, reference).toBeUndefined();
      expect(JSON.stringify(s.params[1].messages)).toMatch(/There is no|I can compare|Name the RFQ|cannot open deals|no RFQ/);
    }
  });
  it("two RFQs that match words from the title are a question back, never a guess", async () => {
    state.db.rows("rfqs").push({ id: "50000000-0000-4000-8000-000000000003", tenant_id: T1, ref: "RFQ-0015", title: "Civil package, phase 2", status: "sent", origin_type: "manual", origin_id: null });
    const s = setup({ replies: [toolUse("compare_quotes", { reference: "civil package" }), text("Which one?")] });
    const r = await askAssistant(ask("Compare the civil package quotes"), s.ctx);
    expect(r.price).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("matches 2 RFQs: RFQ-0014 (Civil package); RFQ-0015 (Civil package, phase 2). Ask the person which one.");
  });
  it("a draft nobody has answered has nothing to compare", async () => {
    state.db.rows("rfqs").find((x) => x.id === RFQ)!.status = "draft";
    state.db.rows("rfq_suppliers").forEach((x) => { x.status = "pending"; });
    const s = setup({ replies: [toolUse("compare_quotes", { reference: "RFQ-0014" }), text("Nothing yet.")] });
    const r = await askAssistant(ask("Compare RFQ-0014"), s.ctx);
    expect(r.price).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("still a draft and nobody has answered it");
  });
  it("one card per message: a second tool call in the same turn is refused", async () => {
    const two: Reply = { content: [{ type: "tool_use", id: "a", name: "compare_quotes", input: { reference: "RFQ-0014" } }, { type: "tool_use", id: "b", name: "compare_quotes", input: { reference: "RFQ-0014" } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 10 } };
    const s = setup({ replies: [two, text(GOOD), text("Done.")] });
    const r = await askAssistant(ask("Compare RFQ-0014 twice"), s.ctx);
    expect(r.price?.kind).toBe("compare");
    expect(JSON.stringify(s.params[2].messages)).toContain("one card at a time");
  });
  it("is read-only: nothing in the database changed", async () => {
    const before = snapshot();
    await askAssistant(ask("Compare RFQ-0014"), setup({ replies: compare() }).ctx);
    expect(snapshot()).toBe(before);
  });
});

describe("propose_award", () => {
  const propose = (input: Record<string, unknown>) => [toolUse("propose_award", { reference: "RFQ-0014", ...input }), text("Check the card.")];

  it("shows a card that awards nothing: every line to one supplier, the reasons needed, and the figures", async () => {
    const before = snapshot();
    const r = await askAssistant(ask("Award RFQ-0014 to Beta Trading"), setup({ replies: propose({ mode: "single", supplier: "Beta Trading" }) }).ctx);
    const card = asAward(r);
    expect(card.kind).toBe("award");
    expect(card.title).toBe("Award RFQ-0014 to Beta Trading");
    expect(card.lines.map((l) => [l.item, l.cost, l.needsReason])).toEqual([["1", 12, true], ["2", 4.5, false], ["3", 25, true], ["4", 90, false], ["5", 210, true], ["6", 55, true], ["7", 3100, true], ["8", 3000, false]]);
    expect(card.total).toBe(36400);
    expect(card.needsReason).toBe(true);
    expect(card.needsReplace).toBe(false);
    expect(card.pricesRows).toBe(false);
    expect(card.primaryLabel).toBe("Award");
    expect(card.blocked).toBeNull();
    expect(card.notices).toContain("Item 1, 3, 5, 6, 7 are not the lowest valid price. A reason is needed.");
    expect(card.summary).toContain("Nothing is awarded until you press the button.");
    expect(card.compareHref).toBe(`/rfqs/${RFQ}`);
    expect(snapshot()).toBe(before);
    expect(r.card).toBeUndefined();
  });
  it("split by line: each line to its cheapest valid supplier, no reason needed", async () => {
    const r = await askAssistant(ask("Split RFQ-0014 by line"), setup({ replies: propose({ mode: "split" }) }).ctx);
    const card = asAward(r);
    expect(card.lines.map((l) => [l.item, l.supplier])).toEqual([["1", "Alpha Supply"], ["2", "Beta Trading"], ["3", "Alpha Supply"], ["4", "Beta Trading"], ["5", "Gamma Industrial"], ["6", "Alpha Supply"], ["7", "Alpha Supply"], ["8", "Beta Trading"]]);
    expect(card.total).toBe(35100);
    expect(card.needsReason).toBe(false);
    expect(card.title).toBe("Award RFQ-0014 by line");
  });
  it("a supplier that is named twice, or not at all, is a question", async () => {
    const s = setup({ replies: [toolUse("propose_award", { reference: "RFQ-0014", mode: "single", supplier: "Delta" }), text("Which?")] });
    const r = await askAssistant(ask("Award it to Delta"), s.ctx);
    expect(r.price).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain('No priced supplier on RFQ-0014 matches \\"Delta\\"');
  });
  it("is not offered, and refuses if called anyway, without the assistant's actions flag or edit rights", async () => {
    for (const o of [{ features: { ...BASE } }, { features: { ...ACTIONS }, perms: VIEW_RFQS }]) {
      const s = setup({ ...o, replies: propose({ mode: "split" }) });
      const r = await askAssistant(ask("Split RFQ-0014 by line"), s.ctx);
      expect(r.price).toBeUndefined();
      expect(toolNames(s.params[0])).not.toContain("propose_award");
      expect(JSON.stringify(s.params[1].messages)).toContain("not enabled");
    }
  });
  it("another workspace's RFQ is not found", async () => {
    const s = setup({ replies: [toolUse("propose_award", { reference: "RFQ-0099", mode: "split" }), text("No.")] });
    const r = await askAssistant(ask("Award RFQ-0099"), s.ctx);
    expect(r.price).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("There is no RFQ-0099 in this workspace.");
  });
  it("blocks a closed RFQ and says so on the card", async () => {
    state.db.rows("rfqs").find((x) => x.id === RFQ)!.status = "closed";
    const r = await askAssistant(ask("Split RFQ-0014"), setup({ replies: propose({ mode: "split" }) }).ctx);
    expect(asAward(r).blocked).toBe("RFQ-0014 is closed, so it cannot be awarded.");
  });
  it("names an award that already stands and asks for the replacement", async () => {
    state.db.rows("rfq_line_awards").push({ id: "70000000-0000-4000-8000-000000000001", tenant_id: T1, rfq_id: RFQ, rfq_line_id: LINE_ID(2), rfq_supplier_id: RS.A, supplier_id: SUPPLIERS[0].supplierId, response_id: rid("A", 2), chosen_by: ME, chosen_at: "2026-11-20T00:00:00Z", reason: null, not_lowest: true, landed_unit: 5, lowest_valid_unit: 4.5, superseded_at: null, applied_to_deal_at: null, applied_rate: null });
    const r = await askAssistant(ask("Split RFQ-0014"), setup({ replies: propose({ mode: "split" }) }).ctx);
    const card = asAward(r);
    expect(card.needsReplace).toBe(true);
    expect(card.lines.find((l) => l.item === "2")!.alreadyAwarded).toBe(true);
    expect(card.notices).toContain("Item 2 already has an award. Pressing the button replaces it.");
  });
});

describe("award of the lines the person named", () => {
  const noModel = () => setup({ replies: [] });
  const current = () => state.db.rows("rfq_line_awards").filter((a) => !a.superseded_at);

  it("'Award the geotextile line on RFQ-0014 to Beta' is one card with that line alone, with no model, and the press awards only it", async () => {
    const s = noModel();
    const r = await askAssistant(ask("Award the geotextile line on RFQ-0014 to Beta"), s.ctx);
    const c = asAward(r);
    expect(s.create).not.toHaveBeenCalled();
    expect(c.lines.map((l) => [l.item, l.supplier, l.cost, l.needsReason])).toEqual([["2", "Beta Trading", 4.5, false]]);
    expect(c.plan.targets).toHaveLength(1);
    expect(c.total).toBe(900);
    expect(c.notices).toEqual(["Only the lines you named are on this card. The others are not changed."]);
    const out = await pressAward({ admin: { from: (t: string) => state.db.from(t) } as never, tenantId: T1, userId: ME, perms: ALL, features: { ...ACTIONS }, baseUrl: "http://internal.invalid/api/ai/award" }, { card_id: c.id, token: c.token, plan: c.plan });
    expect(out.body).toMatchObject({ ok: true, awarded: 1, of: 1 });
    expect(current().map((a) => a.rfq_line_id)).toEqual([LINE_ID(2)]);
    expect(state.changes.every((x) => x.via === "assistant")).toBe(true);
  });
  it("a named line that is not the lowest still needs a reason", async () => {
    const c = asAward(await askAssistant(ask("Award line 1 on RFQ-0014 to Beta Trading"), noModel().ctx));
    expect(c.lines.map((l) => [l.item, l.needsReason])).toEqual([["1", true]]);
    expect(c.needsReason).toBe(true);
  });
  it("a supplier with no price on the named line gives a card that cannot be pressed", async () => {
    const c = asAward(await askAssistant(ask("Award the ready mix line on RFQ-0014 to Gamma Industrial"), noModel().ctx));
    expect(c.lines).toEqual([]);
    expect(c.blocked).toMatch(/nothing to award: item 6 \(Gamma Industrial did not quote it\)/);
  });
  it("words that match no line say so and list the lines", async () => {
    const r = await askAssistant(ask("Award the asphalt line on RFQ-0014 to Beta Trading"), noModel().ctx);
    expect(r.price).toBeUndefined();
    expect(r.answer).toContain('No line of RFQ-0014 matches "asphalt". Its lines are: 1 HDPE geomembrane 1.5 mm; 2 Geotextile 300 gsm');
  });
  it("the model's tool takes the named lines too", async () => {
    const s = setup({ replies: [toolUse("propose_award", { reference: "RFQ-0014", mode: "single", supplier: "Beta Trading", lines: "geotextile" }), text("Check the card.")] });
    expect(asAward(await askAssistant(ask("could the geotextile go to Beta"), s.ctx)).lines.map((l) => l.item)).toEqual(["2"]);
  });
});

describe("the press of an award card", () => {
  async function card(mode: "single" | "split" = "single", supplier = "Beta Trading"): Promise<DockAward> {
    const s = setup({ replies: [toolUse("propose_award", { reference: "RFQ-0014", mode, supplier }), text("Check the card.")] });
    return asAward(await askAssistant(ask("Award RFQ-0014"), s.ctx));
  }
  const pctx = (over: Partial<PressCtx> = {}): PressCtx => ({
    admin: { from: (t: string) => state.db.from(t) } as never, tenantId: T1, userId: ME, perms: ALL, features: { ...ACTIONS }, baseUrl: "http://internal.invalid/api/ai/award", ...over,
  });
  const press = (c: DockAward, extra: Record<string, unknown> = {}, over: Partial<PressCtx> = {}, deps = {}) =>
    pressAward(pctx(over), { card_id: c.id, token: c.token, plan: c.plan, ...extra }, deps);
  const current = () => state.db.rows("rfq_line_awards").filter((a) => !a.superseded_at);

  it("awards every line through the RFQ's own route, records who and why, and marks the change history 'via assistant'", async () => {
    const c = await card("single", "Beta Trading");
    const out = await press(c, { reason: "Best delivery terms for the whole package" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, awarded: 8, of: 8 });
    expect(current()).toHaveLength(8);
    expect(new Set(current().map((a) => a.supplier_id))).toEqual(new Set([SUPPLIERS[1].supplierId]));
    const byLine = Object.fromEntries(current().map((a) => [a.rfq_line_id as string, a]));
    expect(byLine[LINE_ID(2)]).toMatchObject({ not_lowest: false, reason: null, chosen_by: ME, landed_unit: 4.5 });
    expect(byLine[LINE_ID(1)]).toMatchObject({ not_lowest: true, reason: "Best delivery terms for the whole package", landed_unit: 12, lowest_valid_unit: 10 });
    expect(state.db.rows("rfq_lines").every((l) => l.status === "awarded")).toBe(true);
    expect(state.db.rows("rfqs").find((x) => x.id === RFQ)!.status).toBe("awarded");
    expect(state.changes.length).toBeGreaterThan(0);
    expect(state.changes.every((x) => x.via === "assistant")).toBe(true);
    const row = state.db.rows("assistant_actions")[0];
    expect(row).toMatchObject({ id: c.id, tenant_id: T1, user_id: ME, kind: "update", action_key: AWARD_ACT, status: "done" });
    expect(row.result).toMatchObject({ awarded: 8, of: 8 });
    expect((out.body.next as { target: string }[])[0].target).toBe(`/rfqs/${RFQ}`);
  });
  it("without the reason it asks for one, awards nothing, and the same card can be pressed again with it", async () => {
    const c = await card();
    const no = await press(c);
    expect(no.status).toBe(422);
    expect(no.body).toMatchObject({ ok: false, code: "reason_required", items: ["1", "3", "5", "6", "7"] });
    expect(current()).toHaveLength(0);
    expect(state.db.rows("assistant_actions")).toHaveLength(0); // refused before the card was spent
    expect((await press(c, { reason: "ok" })).status).toBe(422); // under three characters
    expect((await press(c, { reason: "Delivery terms" })).status).toBe(200);
    expect(current()).toHaveLength(8);
  });
  it("a card is single use", async () => {
    const c = await card("split");
    expect((await press(c)).status).toBe(200);
    const again = await press(c);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "already_done" });
    expect(current()).toHaveLength(8);
  });
  it("replacing an award needs the box ticked: the route's own conflict is passed on, then honoured", async () => {
    state.db.rows("rfq_line_awards").push({ id: "70000000-0000-4000-8000-000000000001", tenant_id: T1, rfq_id: RFQ, rfq_line_id: LINE_ID(2), rfq_supplier_id: RS.A, supplier_id: SUPPLIERS[0].supplierId, response_id: rid("A", 2), chosen_by: ME, chosen_at: "2026-11-20T00:00:00Z", reason: "earlier", not_lowest: true, landed_unit: 5, lowest_valid_unit: 4.5, superseded_at: null, applied_to_deal_at: null, applied_rate: null });
    state.db.rows("rfq_lines").find((l) => l.id === LINE_ID(2))!.status = "awarded";
    const c = await card("split");
    expect(c.needsReplace).toBe(true);
    const no = await press(c);
    expect(no.status).toBe(409);
    expect(no.body).toMatchObject({ code: "already_awarded", items: ["2"] });
    expect(current()).toHaveLength(1); // nothing was awarded, not even the lines before it
    const yes = await press(c, { replace: true });
    expect(yes.status).toBe(200);
    expect(current().find((a) => a.rfq_line_id === LINE_ID(2))).toMatchObject({ rfq_supplier_id: RS.B, response_id: rid("B", 2) });
    expect(state.db.rows("rfq_line_awards").filter((a) => a.rfq_line_id === LINE_ID(2))).toHaveLength(2);
  });
  it("a plan that was changed after the card was shown is refused before anything runs", async () => {
    const c = await card("split");
    const swapped = { ...c.plan, targets: c.plan.targets.map((t, i) => (i === 0 ? { ...t, responseId: rid("C", 1) } : t)) };
    const out = await pressAward(pctx(), { card_id: c.id, token: c.token, plan: swapped });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ code: "stale" });
    expect(current()).toHaveLength(0);
    expect(state.db.rows("assistant_actions")).toHaveLength(0);
    const fewer = { ...c.plan, targets: c.plan.targets.slice(0, 1) };
    expect((await pressAward(pctx(), { card_id: c.id, token: c.token, plan: fewer })).status).toBe(409);
  });
  it("a quote that changed after the card was shown makes the card stale, and nothing is awarded", async () => {
    const c = await card("split");
    state.db.rows("rfq_responses").find((r) => r.id === rid("B", 2))!.status = "no_quote";
    const out = await press(c);
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ code: "changed" });
    expect(String(out.body.error)).toContain("item 2");
    expect(current()).toHaveLength(0);
    expect(state.db.rows("assistant_actions")).toHaveLength(0);
  });
  it("a card shown to someone else, in another workspace, with another card's id, expired, or unsigned, is refused", async () => {
    const c = await card("split");
    expect((await press(c, {}, { userId: OTHER })).status).toBe(403);
    expect((await press(c, {}, { tenantId: T2 })).status).toBe(403);
    expect((await pressAward(pctx(), { card_id: "80000000-0000-4000-8000-000000000009", token: c.token, plan: c.plan })).status).toBe(403);
    expect((await press(c, {}, { now: Date.now() + 31 * 60 * 1000 })).status).toBe(410);
    expect((await pressAward(pctx(), { card_id: c.id, token: `${c.token}x`, plan: c.plan })).status).toBe(403);
    const forged = signToken({ cid: c.id, tid: T1, uid: ME, act: "create_account", h: hashOf(canonicalPlan(c.plan)), dup: "", sm: "", pv: {} });
    expect((await pressAward(pctx(), { card_id: c.id, token: forged, plan: c.plan })).status).toBe(403);
    expect(verifyToken(c.token, { tenantId: T1, userId: ME, cardId: c.id }).ok).toBe(true);
    expect(current()).toHaveLength(0);
  });
  it("is refused when the assistant's actions are off, or the person may not edit RFQs, now", async () => {
    const c = await card("split");
    expect((await press(c, {}, { features: { ...BASE } })).status).toBe(403);
    expect((await press(c, {}, { perms: VIEW_RFQS })).status).toBe(403);
    expect(current()).toHaveLength(0);
  });
  it("a workspace whose assistant log table is not there yet awards nothing", async () => {
    const c = await card("split");
    state.db.missing.add("assistant_actions");
    const out = await press(c);
    expect(out.status).toBe(503);
    expect(current()).toHaveLength(0);
  });
  it("a run that stops half way says which lines are done and which line it stopped at, and the card is spent", async () => {
    const c = await card("split");
    let n = 0;
    const call = async () => (++n === 3 ? { status: 409, json: { error: "Line 3 was awarded by someone else a moment ago.", code: "already_awarded" } } : { status: 200, json: { ok: true } });
    const out = await press(c, {}, {}, { call });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, partial: true, awarded: 2, of: 8, stopped_at: "3", error: "Line 3 was awarded by someone else a moment ago." });
    expect(n).toBe(3);
    expect(state.db.rows("assistant_actions")[0]).toMatchObject({ status: "done", result: { awarded: 2, of: 8, stopped_at: "3" } });
    expect((await press(c, {}, {}, { call })).status).toBe(409);
  });
  it("a first line that fails leaves the card usable and reports the route's own reason and status", async () => {
    const c = await card("split");
    const out = await press(c, {}, {}, { call: async () => ({ status: 404, json: { error: "Response not found on this line" } }) });
    expect(out.status).toBe(422);
    expect(out.body).toMatchObject({ ok: false, code: "route_refused", error: "Response not found on this line" });
    expect(state.db.rows("assistant_actions")[0].status).toBe("failed");
  });
  it("a tender card posts to the deal's Costing route with the typed markup, one line at a time", async () => {
    const c = await card("split");
    const deal = "90000000-0000-4000-8000-000000000001";
    const plan = { ...c.plan, route: "tender" as const, dealId: deal };
    const tender: DockAward = { ...c, plan, token: signToken({ cid: c.id, tid: T1, uid: ME, act: AWARD_ACT, h: hashOf(canonicalPlan(plan)), dup: "", sm: c.summary, pv: {} }) };
    const seen: { path: string; body: Record<string, unknown> }[] = [];
    const call = async (p: typeof plan, body: Record<string, unknown>) => { seen.push({ path: p.route === "tender" ? `/api/opportunities/${p.dealId}/tender/costing/award` : "x", body }); return { status: 200, json: { ok: true, priced: [{ item: "1.1", to: 11.5, cost: 10, markup_pct: 15 }] } }; };
    const out = await press(tender, { markup_pct: "12.5" }, { features: { ...ACTIONS, gcc_tender: true } }, { call });
    expect(out.status).toBe(200);
    expect(seen).toHaveLength(8);
    expect(seen[0].path).toBe(`/api/opportunities/${deal}/tender/costing/award`);
    expect(seen[0].body).toEqual({ rfq_id: RFQ, line_id: LINE_ID(1), response_id: rid("A", 1), markup_pct: 12.5 });
    expect((out.body.priced as unknown[]).length).toBe(8);
    expect((out.body.next as { target: string }[])[0].target).toBe(`/pipeline/${deal}?tab=costing`);
  });
  it("a typed markup that is not a number is refused before anything runs", async () => {
    const c = await card("split");
    const plan = { ...c.plan, route: "tender" as const, dealId: "90000000-0000-4000-8000-000000000001" };
    const t: DockAward = { ...c, plan, token: signToken({ cid: c.id, tid: T1, uid: ME, act: AWARD_ACT, h: hashOf(canonicalPlan(plan)), dup: "", sm: "", pv: {} }) };
    const out = await press(t, { markup_pct: "oops" }, { features: { ...ACTIONS, gcc_tender: true } });
    expect(out.status).toBe(422);
    expect(out.body).toMatchObject({ code: "markup" });
    expect(state.db.rows("assistant_actions")).toHaveLength(0);
  });
});

describe("Award and price on a tender's RFQ", () => {
  const OPP = "a0000000-0000-4000-8000-000000000001";
  const RFQ_T = "a0000000-0000-4000-8000-000000000010";
  const LA = "a0000000-0000-4000-8000-000000000021", LB = "a0000000-0000-4000-8000-000000000022";
  const RA = "a0000000-0000-4000-8000-000000000031", RB = "a0000000-0000-4000-8000-000000000032";
  const DA = "a0000000-0000-4000-8000-000000000041", DB = "a0000000-0000-4000-8000-000000000042";
  const BA = "a0000000-0000-4000-8000-000000000051", BB = "a0000000-0000-4000-8000-000000000052";
  const A_LA = "a0000000-0000-4000-8000-000000000061", A_LB = "a0000000-0000-4000-8000-000000000062";
  const B_LA = "a0000000-0000-4000-8000-000000000063", B_LB = "a0000000-0000-4000-8000-000000000064";
  const TENDER = { ...ACTIONS, gcc_tender: true, pipeline: true };
  const ctxPress = (over: Partial<PressCtx> = {}): PressCtx => ({ admin: { from: (t: string) => state.db.from(t) } as never, tenantId: T1, userId: ME, perms: ALL, features: { ...TENDER }, baseUrl: "http://internal.invalid/api/ai/award", ...over });
  const r = (rid2: string, rs: string, line: string, price: number) => ({
    id: rid2, tenant_id: T1, rfq_supplier_id: rs, rfq_line_id: line, status: "quoted", unit_price: price, currency: "SAR", fx_rate: null, lead_time_days: 14, moq: null,
    offered_description: null, valid_until: "2027-01-31", note: null, source: "buyer", is_awarded: false, submitted_at: "2026-11-10T09:00:00Z", updated_at: "2026-11-10T09:00:00Z",
  });

  beforeEach(() => {
    state.features = { ...TENDER };
    state.db.rows("opportunities").push({ id: OPP, tenant_id: T1, ref: "OPP-0002", title: "Package 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: ME, team: [], amount: 0, probability: 25, currency: "SAR" });
    state.db.rows("opportunity_tenders").push({ opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });
    state.db.rows("rfqs").push({ id: RFQ_T, tenant_id: T1, ref: "RFQ-0020", title: "Package 4 supplies", status: "replied", origin_type: "opportunity", origin_id: OPP, origin_label: "Deal OPP-0002", respond_by: null });
    state.db.rows("rfq_lines").push(
      { id: LA, tenant_id: T1, rfq_id: RFQ_T, sl_no: 1, product_id: null, description: "Skirting", uom: "m", qty: 100, status: "open", awarded_unit_cost: null, cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
      { id: LB, tenant_id: T1, rfq_id: RFQ_T, sl_no: 2, product_id: null, description: "Membrane", uom: "m2", qty: 10, status: "open", awarded_unit_cost: null, cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
    );
    state.db.rows("rfq_suppliers").push(
      { id: RA, tenant_id: T1, rfq_id: RFQ_T, supplier_id: SUPPLIERS[0].supplierId, status: "replied", reminder_count: 0, last_reminded_at: null, token_nonce: "n", created_at: "2026-11-01T00:00:00Z" },
      { id: RB, tenant_id: T1, rfq_id: RFQ_T, supplier_id: SUPPLIERS[1].supplierId, status: "replied", reminder_count: 0, last_reminded_at: null, token_nonce: "n", created_at: "2026-11-02T00:00:00Z" },
    );
    state.db.rows("rfq_responses").push(r(A_LA, RA, LA, 10), r(A_LB, RA, LB, 100), r(B_LA, RB, LA, 12), r(B_LB, RB, LB, 90));
    state.db.rows("opportunity_lines").push(
      { id: DA, tenant_id: T1, opportunity_id: OPP, sl_no: "1.1", description: "Skirting", uom: "m", qty: 100, rate: 0, discount_pct: 0, amount: 0, rfq_line_id: LA, is_selected: true },
      { id: DB, tenant_id: T1, opportunity_id: OPP, sl_no: "1.2", description: "Membrane", uom: "m2", qty: 10, rate: 0, discount_pct: 0, amount: 0, rfq_line_id: LB, is_selected: true },
    );
    state.db.rows("tender_boq_lines").push(
      { id: BA, tenant_id: T1, opportunity_id: OPP, line_id: DA, item_no: "1.1", row_no: 8, price_source: null, price_as_of: null, stale_accepted: false, unit_cost: null, markup_pct: null, removed_in_revision: false },
      { id: BB, tenant_id: T1, opportunity_id: OPP, line_id: DB, item_no: "1.2", row_no: 9, price_source: null, price_as_of: null, stale_accepted: false, unit_cost: null, markup_pct: 20, removed_in_revision: false },
    );
  });

  const tenderCard = async (input: Record<string, unknown> = { mode: "split" }, perms: PermissionSet = ALL) => {
    const s = setup({ features: { ...TENDER }, perms, replies: [toolUse("propose_award", { reference: "RFQ-0020", ...input }), text("Check the card.")] });
    return asAward(await askAssistant(ask("Award RFQ-0020"), s.ctx));
  };
  const boq = (id: string) => state.db.rows("tender_boq_lines").find((b) => b.id === id)!;
  const dealLine = (id: string) => state.db.rows("opportunity_lines").find((l) => l.id === id)!;

  it("the card is for the Costing route and shows the cost, the markup the screen would add and the rate", async () => {
    const card = await tenderCard();
    expect(card.plan).toMatchObject({ route: "tender", dealId: OPP, mode: "split" });
    expect(card.pricesRows).toBe(true);
    expect(card.primaryLabel).toBe("Award and price");
    expect(card.markupDefaultPct).toBe(15);
    expect(card.lines.map((l) => [l.item, l.supplier, l.cost, l.markupPct, l.rate])).toEqual([["1", "Alpha Supply", 10, 15, 11.5], ["2", "Beta Trading", 90, 20, 108]]);
    expect(card.total).toBe(1000 + 900);
    expect(card.compareHref).toBe(`/pipeline/${OPP}?tab=costing`);
    expect(card.blocked).toBeNull();
  });
  it("pressing it stores the supplier's price as the row's COST, adds the row's markup, names the RFQ as the source, and writes 'via assistant'", async () => {
    const card = await tenderCard();
    const out = await pressAward(ctxPress(), { card_id: card.id, token: card.token, plan: card.plan });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, awarded: 2, of: 2 });
    expect(boq(BA)).toMatchObject({ unit_cost: 10, markup_pct: 15, price_source: "supplier", price_source_ref: "RFQ-0020, awarded", price_as_of: "2026-11-10" });
    expect(boq(BB)).toMatchObject({ unit_cost: 90, markup_pct: 20, price_source_ref: "RFQ-0020, awarded" });
    expect(dealLine(DA)).toMatchObject({ rate: 11.5, amount: 1150 });
    expect(dealLine(DB)).toMatchObject({ rate: 108, amount: 1080 });
    expect(state.db.rows("rfq_line_awards").filter((a) => !a.superseded_at && a.applied_to_deal_at)).toHaveLength(2);
    expect((out.body.priced as unknown[]).length).toBe(2);
    expect((out.body.next as { target: string }[])[0].target).toBe(`/pipeline/${OPP}?tab=costing`);
    const logged = state.changes.filter((c) => c.objectType === "opportunity_tenders");
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((c) => c.via === "assistant")).toBe(true);
    expect(JSON.stringify(logged.map((c) => c.changes))).not.toMatch(/unit_cost|markup/i); // the history says the rate and its source, never the cost or the markup
    expect(state.db.rows("assistant_actions")[0]).toMatchObject({ status: "done", route: `/api/opportunities/${OPP}/tender/costing/award` });
  });
  it("a markup typed on the card replaces the row's own and the default, and what is awarded is not proposed again", async () => {
    const card = await tenderCard();
    await pressAward(ctxPress(), { card_id: card.id, token: card.token, plan: card.plan, markup_pct: "12.5" });
    expect(boq(BA)).toMatchObject({ unit_cost: 10, markup_pct: 12.5 });
    expect(dealLine(DA).rate).toBe(11.25);
    expect(boq(BB)).toMatchObject({ unit_cost: 90, markup_pct: 12.5 });
    expect(dealLine(DB).rate).toBe(101.25);
    const again = await tenderCard();
    expect(again.lines.length).toBe(0);
    expect(again.blocked).toMatch(/nothing to award/i);
  });
  it("a person who may edit RFQs but only view the deal is shown why, and cannot press", async () => {
    const view: PermissionSet = { unrestricted: false, grants: new Map([
      ["rfqs", { workcenter: "rfqs", canView: true, canCreate: false, canEdit: true, canDelete: false }],
      ["pipeline", { workcenter: "pipeline", canView: true, canCreate: false, canEdit: false, canDelete: false }],
    ]) };
    const card = await tenderCard({ mode: "split" }, view);
    expect(card.blocked).toBe("You can view this deal but not change it.");
    const out = await pressAward(ctxPress({ perms: view }), { card_id: card.id, token: card.token, plan: card.plan });
    expect(out.status).toBe(403);
    expect(boq(BA).unit_cost).toBeNull();
  });
  it("the deal's reference finds its one RFQ; two RFQs on the deal are a question", async () => {
    const one = setup({ features: { ...TENDER }, replies: [toolUse("compare_quotes", { reference: "OPP-0002" }), text(GOOD), text("Done.")] });
    const r1 = await askAssistant(ask("Compare the quotes for OPP-0002"), one.ctx);
    expect(asCompare(r1).comparison.rfq.ref).toBe("RFQ-0020");
    expect(asCompare(r1).next[0].target).toBe(`/pipeline/${OPP}?tab=costing`);
    state.db.rows("rfqs").push({ id: "a0000000-0000-4000-8000-000000000011", tenant_id: T1, ref: "RFQ-0021", title: "Second", status: "sent", origin_type: "opportunity", origin_id: OPP });
    const two = setup({ features: { ...TENDER }, replies: [toolUse("compare_quotes", { reference: "OPP-0002" }), text("Which one?")] });
    const r2 = await askAssistant(ask("Compare the quotes for OPP-0002"), two.ctx);
    expect(r2.price).toBeUndefined();
    expect(JSON.stringify(two.params[1].messages)).toContain("OPP-0002 matches 2 RFQs: RFQ-0020 (Package 4 supplies); RFQ-0021 (Second). Ask the person which one.");
  });
  it("one named line of the deal: the card says its markup and where it comes from, and only that row is priced", async () => {
    state.db.rows("rfqs").push({ id: "a0000000-0000-4000-8000-000000000011", tenant_id: T1, ref: "RFQ-0021", title: "Second", status: "sent", origin_type: "opportunity", origin_id: OPP });
    state.db.rows("rfq_lines").push({ id: "a0000000-0000-4000-8000-000000000023", tenant_id: T1, rfq_id: "a0000000-0000-4000-8000-000000000011", sl_no: 1, product_id: null, description: "Cable", uom: "m", qty: 1, status: "open" });
    const s = setup({ features: { ...TENDER }, replies: [] });
    const c = asAward(await askAssistant(ask("Award the membrane line on OPP-0002 to Beta Trading"), s.ctx));
    expect(c.rfq.ref).toBe("RFQ-0020");
    expect(c.lines.map((l) => [l.item, l.cost, l.markupPct, l.rate])).toEqual([["2", 90, 20, 108]]);
    expect(c.markupNote).toBe("Markup 20%, set on the BOQ row.");
    await pressAward(ctxPress(), { card_id: c.id, token: c.token, plan: c.plan });
    expect(dealLine(DB).rate).toBe(108);
    expect(dealLine(DA).rate).toBe(0);
  });
  it("when the markup differs between lines the card says each one and its source", async () => {
    expect((await tenderCard()).markupNote).toBe("Markup differs between lines: item 1 15% (the workspace default); item 2 20% (set on the BOQ row).");
  });
  it("a deal reference is not resolved for someone who cannot open deals", async () => {
    const s = setup({ features: { ...TENDER }, perms: VIEW_RFQS, replies: [toolUse("compare_quotes", { reference: "OPP-0002" }), text("No.")] });
    const r1 = await askAssistant(ask("Compare OPP-0002"), s.ctx);
    expect(r1.price).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("cannot open deals");
  });
});

describe("price_check on a tender's bill of quantities", () => {
  const OPP = "b0000000-0000-4000-8000-000000000001";
  const P1 = "b0000000-0000-4000-8000-0000000000a1", P2 = "b0000000-0000-4000-8000-0000000000a2";
  const D = (n: number) => `b0000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  const B = (n: number) => `b0000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
  const TENDER = { ...ACTIONS, gcc_tender: true, pipeline: true };

  beforeEach(() => {
    state.db.rows("opportunities").push({ id: OPP, tenant_id: T1, ref: "OPP-0034", title: "Pipeline package", account_id: "acc", stage: "estimating", outcome: "open", owner_id: ME, team: [], amount: 0 });
    state.db.rows("opportunity_tenders").push({ opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });
    state.db.rows("tender_boq_sources").push({ id: "b0000000-0000-4000-8000-0000000003aa", tenant_id: T1, opportunity_id: OPP, version: 1, is_current: true, file_name: "boq.xlsx", storage_path: "x", size_bytes: 1, sheet_name: "BOQ", header_row: 1, header_labels: [], column_map: {}, line_count: 4, uploaded_by: ME, uploaded_at: "2026-10-20T08:00:00Z" });
    state.db.rows("products").push(
      { id: P1, tenant_id: T1, name: "Precast pipe 600 mm", sku: "PP-600", cost_price: 100, cost_price_as_of: "2026-10-15", supplier_id: null },
      { id: P2, tenant_id: T1, name: "Rebar T16", sku: "RB-16", cost_price: 3000, cost_price_as_of: "2026-10-15", supplier_id: null },
    );
    const lines = [
      { n: 1, desc: "Precast pipe 600 mm", pid: P1, rate: 149.5, cost: 130 },
      { n: 2, desc: "Rebar T16", pid: P2, rate: 3450, cost: 3000 },
      { n: 3, desc: "Dewatering", pid: null, rate: 500, cost: 400 },
      { n: 4, desc: "Not priced yet", pid: P1, rate: 0, cost: null },
    ];
    for (const l of lines) {
      state.db.rows("opportunity_lines").push({ id: D(l.n), tenant_id: T1, opportunity_id: OPP, sl_no: `1.${l.n}`, description: l.desc, uom: "m", qty: 10, rate: l.rate, discount_pct: 0, amount: l.rate * 10, product_id: l.pid, is_selected: true });
      state.db.rows("tender_boq_lines").push({
        id: B(l.n), tenant_id: T1, opportunity_id: OPP, source_id: "b0000000-0000-4000-8000-0000000003aa", line_id: D(l.n), item_key: `k${l.n}`, item_no: `1.${l.n}`, cost_code: null, row_no: 7 + l.n,
        file_description: l.desc, file_uom: "m", file_qty: 10, file_rate: null, price_source: l.cost === null ? null : "supplier", price_source_ref: l.cost === null ? null : "RFQ-0005 · Beta Trading",
        price_as_of: l.cost === null ? null : "2026-05-01", stale_accepted: false, unit_cost: l.cost, markup_pct: l.cost === null ? null : 15, removed_in_revision: false,
      });
    }
  });

  const check = async (input: Record<string, unknown>, o: Parameters<typeof setup>[0] = {}) => {
    const s = setup({ features: { ...TENDER }, ...o, replies: [toolUse("price_check", input), text("The pipe is the one to look at.")] });
    return { r: await askAssistant(ask("Are the BOQ rates in line with history on OPP-0034?"), s.ctx), s };
  };

  it("ranks the lines furthest from our own history, a cost against costs, and says how many it could not check", async () => {
    const { r } = await check({ deal: "OPP-0034" });
    const card = r.price as import("./types").DockPriceCheck;
    expect(card.kind).toBe("check");
    expect(card.deal).toMatchObject({ ref: "OPP-0034", title: "Pipeline package" });
    expect(card.rows.map((x) => [x.item, x.basis, x.current, x.reference, x.pct, x.stale])).toEqual([["1.1", "cost", 130, 100, 30, true]]);
    expect(card.checked).toBe(3);
    expect(card.noReference).toBe(1);
    expect(card.next[0].target).toBe(`/pipeline/${OPP}?tab=boq`);
    expect(r.answer).toBe("The pipe is the one to look at.");
  });
  it("is read-only and never reaches another workspace's deal", async () => {
    const before = snapshot();
    const { r, s } = await check({ deal: "OPP-0034" });
    expect(snapshot()).toBe(before);
    state.db.rows("opportunities").push({ id: "b0000000-0000-4000-8000-0000000000ff", tenant_id: T2, ref: "OPP-0900", title: "Theirs", stage: "estimating", outcome: "open" });
    const other = await check({ deal: "OPP-0900" });
    expect(other.r.price).toBeUndefined();
    expect(JSON.stringify(other.s.params[1].messages)).toContain("There is no OPP-0900 in this workspace.");
    expect(r.price?.kind).toBe("check");
    expect(s.params).toHaveLength(2);
  });
  it("is not offered without the tender edition, and answers a missing BOQ in words", async () => {
    const off = setup({ features: { ...ACTIONS }, replies: [text("hi")] });
    await askAssistant(ask("hello there"), off.ctx);
    expect(toolNames(off.params[0])).not.toContain("price_check");
    state.db.rows("tender_boq_sources").length = 0;
    const { r, s } = await check({ deal: "OPP-0034" });
    expect(r.price).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("no bill of quantities uploaded yet");
  });
});

describe("the award card on a flagged supplier", () => {
  const flagBeta = (verdict = "check_first", tenant = T1) => {
    state.db.rows("supplier_checks").push({ id: "b0000000-0000-4000-8000-000000000001", tenant_id: tenant, supplier_id: SUPPLIERS[1].supplierId, checked_at: "2026-11-20T00:00:00Z", verdict, genuine_findings: { signals: [{ id: "x", severity: "high", text: "Shares a bank account with Other Co." }] } });
  };
  async function card(): Promise<DockAward> {
    const s = setup({ replies: [toolUse("propose_award", { reference: "RFQ-0014", mode: "single", supplier: "Beta Trading" }), text("Check the card.")] });
    return asAward(await askAssistant(ask("Award RFQ-0014"), s.ctx));
  }
  const pctx = (): PressCtx => ({ admin: { from: (t: string) => state.db.from(t) } as never, tenantId: T1, userId: ME, perms: ALL, features: { ...ACTIONS }, baseUrl: "http://internal.invalid/api/ai/award" });
  const press = (c: DockAward, extra: Record<string, unknown> = {}, deps = {}) => pressAward(pctx(), { card_id: c.id, token: c.token, plan: c.plan, reason: "Delivery terms for the whole package", ...extra }, deps);
  const current = () => state.db.rows("rfq_line_awards").filter((a) => !a.superseded_at);

  it("the card carries the flagged supplier and its findings; an unflagged or other workspace's check adds nothing", async () => {
    flagBeta("check_first");
    expect((await card()).supplierChecks).toEqual([{ supplierId: SUPPLIERS[1].supplierId, name: SUPPLIERS[1].name, verdict: "check_first", findings: ["Shares a bank account with Other Co"], checkedAt: "2026-11-20T00:00:00Z" }]);
    seed();
    flagBeta("concerning", T2);
    expect((await card()).supplierChecks).toEqual([]);
  });

  it("a forged press without the reason is refused before the card is spent, and nothing is awarded", async () => {
    flagBeta("check_first");
    const c = await card();
    const no = await press(c);
    expect(no.status).toBe(422);
    expect(no.body).toMatchObject({ ok: false, code: "supplier_check_reason" });
    expect(current()).toHaveLength(0);
    expect(state.db.rows("assistant_actions")).toHaveLength(0);
    expect((await press(c, { supplier_check_reason: "no" })).status).toBe(422);
    expect(current()).toHaveLength(0);
  });

  it("the reason the person typed reaches the award route and the change history; the same card then works", async () => {
    flagBeta("check_first");
    const c = await card();
    const seen: Record<string, unknown>[] = [];
    const call = async (_p: unknown, body: Record<string, unknown>) => { seen.push(body); return { status: 200, json: { ok: true } }; };
    const out = await press(c, { supplier_check_reason: "Only one in stock this week" }, { call });
    expect(out.status).toBe(200);
    expect(seen).toHaveLength(8);
    expect(seen.every((b) => b.supplier_check_reason === "Only one in stock this week" && !("supplier_check_ack" in b))).toBe(true);
  });

  it("through the real award route the note is on record 'via assistant'", async () => {
    flagBeta("check_first");
    const out = await press(await card(), { supplier_check_reason: "Only one in stock this week" });
    expect(out.status).toBe(200);
    expect(current()).toHaveLength(8);
    const notes = state.changes.filter((x) => x.changes?.some((ch) => String(ch.to).startsWith("Awarded despite Supplier check")));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((x) => x.via === "assistant")).toBe(true);
  });

  it("a concerning supplier needs the tick as well", async () => {
    flagBeta("concerning");
    const c = await card();
    const no = await press(c, { supplier_check_reason: "Only one in stock this week" });
    expect(no.status).toBe(422);
    expect(no.body).toMatchObject({ code: "supplier_check_ack" });
    expect((await press(c, { supplier_check_reason: "Only one in stock this week", supplier_check_ack: true })).status).toBe(200);
  });

  it("the model is told never to supply the reason", async () => {
    flagBeta("check_first");
    const s = setup({ replies: [toolUse("propose_award", { reference: "RFQ-0014", mode: "single", supplier: "Beta Trading" }), text("Check the card.")] });
    await askAssistant(ask("Award RFQ-0014"), s.ctx);
    expect(JSON.stringify(s.params[1])).toMatch(/Never supply a reason yourself/);
  });
});
