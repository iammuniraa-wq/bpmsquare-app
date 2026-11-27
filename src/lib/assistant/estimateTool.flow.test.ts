import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
});

// Estimates are made in the Estimator, never from the chat: the assistant must not say it made one, and explain_estimate is the one
// thing it does with a saved estimate, from the stored figures only. The model and the database are replaced.

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => { throw new Error("no database in this test"); },
  requireTenantUser: async () => { throw new Error("not used"); },
  createServerSupabase: async () => { throw new Error("not used"); },
}));

const EST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FOREIGN = "ffffffff-ffff-4fff-8fff-ffffffffffff";
vi.mock("@/lib/api/listSources", () => ({
  LIST_SOURCES: {
    estimates: {
      label: "Estimates", description: "estimates", relatedWorkcenter: "estimates",
      fields: [{ path: "id", type: "string" }, { path: "ref", type: "string", searchable: true }, { path: "name", type: "string", searchable: true }, { path: "status", type: "string" }],
      load: async () => [
        { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ref: "EST-0001", name: "Sand excavation", status: "draft" },
        { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", ref: "EST-0002", name: "Other workspace job", status: "draft" },
      ],
    },
  },
}));
vi.mock("@/lib/ai/reportCompile", () => ({ compileAndRun: vi.fn() }));
vi.mock("@/lib/marketing/leads/queries", () => ({ listScoredLeads: vi.fn(async () => ({ leads: [], pending: false })) }));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn() }));

import { askAssistant, type AssistantAskCtx } from "@/lib/ai/assistant";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { AssistantMeter } from "./meter";
import type { PermissionSet } from "@/lib/permissions";
import { ESTIMATE_CREATE_ANSWER, isEstimateCreateAsk } from "./estimateTool";

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const ON = { ai_assistant: true, ai_assistant_actions: true, next_experience: true, estimator: true, accounts: true };
const CURRENCY = { code: "SAR", symbol: "SAR", grouping: "standard" } as never;

type Reply = { content: unknown[]; stop_reason: string; usage: Record<string, number> };
const text = (t: string): Reply => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } });
const toolUse = (name: string, input: unknown, id = "tu1"): Reply => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 40 } });

const estimateRow = (over: Row = {}): Row => ({
  id: EST, tenant_id: T1, ref: "EST-0001", name: "Sand excavation", status: "draft", template_id: "tpl-1", template_version: 2,
  account_id: "acc-1", contact_id: null, standard_quote_id: null, currency: "SAR", margin_pct: 10,
  totals: {
    cost_total: 1000, margin_pct: 10, margin_amount: 100, price: 1100, vat_pct: 15, vat: 165, price_incl_vat: 1265,
    by_group: [{ key: "earth", name: "Earthworks", cost: 700 }, { key: "haul", name: "Haulage", cost: 300 }],
    by_component: {},
  },
  ...over,
});

function setup(opts: { features?: Record<string, boolean>; perms?: PermissionSet; replies?: Reply[]; route?: string; estimates?: Row[]; lines?: Row[] } = {}) {
  const db = fakeAdmin({
    estimates: opts.estimates ?? [estimateRow()],
    estimate_lines: opts.lines ?? [
      { id: "l1", tenant_id: T1, estimate_id: EST, sort_order: 1, code: "EXC", description: "Excavate", qty: 800, cost_total: 700, unit_cost: 0.875, group_key: "earth" },
      { id: "l2", tenant_id: T1, estimate_id: EST, sort_order: 2, code: "HAUL", description: "Haul away", qty: 800, cost_total: 300, unit_cost: 0.375, group_key: "haul" },
      { id: "l3", tenant_id: T1, estimate_id: EST, sort_order: 3, code: "SHORE", description: "Shoring", qty: 1, cost_total: null, unit_cost: null, group_key: "earth" },
    ],
    estimate_templates: [{ id: "tpl-1", tenant_id: T1, name: "Bulk excavation", version: 3 }],
    accounts: [{ id: "acc-1", tenant_id: T1, name: "Al-Otaibi Contracting" }],
    contacts: [], standard_quotes: [], field_overrides: [], field_rules: [], custom_fields: [],
    tenants: [{ id: T1, features: ON, config: {} }], assistant_actions: [], change_log: [],
  });
  const replies = [...(opts.replies ?? [text("ok")])];
  const params: Record<string, unknown>[] = [];
  const create = vi.fn(async (p: Record<string, unknown>) => {
    params.push(JSON.parse(JSON.stringify(p)));
    const r = replies.shift();
    if (!r) throw new Error("no scripted reply left");
    return r;
  });
  const meter = new AssistantMeter({ tenantId: T1, userId: "user-1", budget: 1_000_000 }, {
    allowanceFor: vi.fn(async () => ({ allowed: true, used: 0, budget: 1_000_000, remaining: 1_000_000 })),
    logUsage: vi.fn(async () => {}) as never,
  });
  const ctx: AssistantAskCtx = {
    supabase: db.client, tenantId: T1, perms: opts.perms ?? ALL, currency: CURRENCY, features: opts.features ?? ON,
    isAdmin: (opts.perms ?? ALL).unrestricted, route: opts.route ?? null, meter,
    anthropic: { messages: { create } } as unknown as Anthropic, now: new Date("2026-11-27T09:00:00Z"), userId: "user-1",
  };
  return { ctx, db, params, create };
}
const ask = (q: string) => [{ role: "user" as const, text: q }];
const toolNames = (p: Record<string, unknown>) => (p.tools as { name: string }[]).map((t) => t.name);
const stable = (p: Record<string, unknown>) => (p.system as { text: string }[])[0].text;

beforeEach(() => { vi.clearAllMocks(); });

describe("asking for an estimate", () => {
  const Q = "Create an estimate for excavating 800 m3 of sand";

  const BUTTON = [{ id: "create:/estimates/new", label: "New Estimate", href: "/estimates/new" }];
  const fixed = (reply: Awaited<ReturnType<typeof askAssistant>>) => {
    expect(reply.answer).toBe(ESTIMATE_CREATE_ANSWER);
    expect(reply.cards).toEqual(BUTTON);
    expect(reply.card).toBeUndefined();
    expect(reply.autoFollow).toBeUndefined();
  };

  it("whatever the model writes is replaced by the fixed sentence and the one button", async () => {
    for (const said of [
      "Here you go.",
      "I can't create it. Use the button above to open the Estimator.",
      "Estimates are made in the Estimator. For tender OPP-0040 I can make one there.",
      "",
    ]) {
      const s = setup({ replies: [text(said)] });
      fixed(await askAssistant(ask(Q), s.ctx));
      expect(s.db.tables.estimates).toHaveLength(1);
    }
  });

  it("a button to the Estimates list is never shown: no other navigation card survives", async () => {
    const s = setup({ replies: [toolUse("navigate", { target: "nav:/estimates", asked_for: "Estimates" }), text("Open Estimates with the button above.")] });
    fixed(await askAssistant(ask(Q), s.ctx));
    expect(s.create).toHaveBeenCalledTimes(1);
  });

  it("a record looked up on the way adds no second button", async () => {
    const s = setup({ replies: [toolUse("open_record", { object: "estimate", query: "EST-0001" }), text("Here is a similar one.")] });
    fixed(await askAssistant(ask(Q), s.ctx));
  });

  it("the fixed sentence names no tender and does not say where the button is", () => {
    expect(ESTIMATE_CREATE_ANSWER).not.toMatch(/tender|OPP-|button|above|below/i);
  });

  it("another question about estimates keeps the model's own answer", async () => {
    const s = setup({ replies: [text("There is 1 draft estimate.")] });
    const reply = await askAssistant(ask("How many new estimates are draft?"), s.ctx);
    expect(reply.answer).toBe("There is 1 draft estimate.");
    expect(reply.cards).toBeUndefined();
  });

  it("the cached prompt tells the model it cannot create or change an estimate", async () => {
    const s = setup();
    await askAssistant(ask(Q), s.ctx);
    expect(stable(s.params[0])).toContain("you cannot create or change an estimate from this chat");
    expect(stable(s.params[0])).toContain("never write that it was created");
  });

  it("a request to create one is told apart from other asks", () => {
    for (const q of [
      "Create an estimate for excavating 800 m3 of sand", "start a new estimate", "new estimate", "Can you make me a quick cost estimate for 800 m³ of sand?",
      "I need an excavation estimate", "please prepare an estimate for a boundary wall",
    ]) expect(isEstimateCreateAsk(q), q).toBe(true);
    for (const q of [
      "Explain how this price is built", "how many estimates are draft?", "How many new estimates this month?", "Show new estimates", "Did we create any estimates this week?",
      "How do I create an estimate?", "Create a quote from this estimate", "make a standard quote from the estimate EST-0001", "Create an estimate template",
      "Add a line to the estimate", "make this estimate cheaper", "Can you estimate 800 m3 of sand?", "Create an RFQ for the estimate",
    ]) expect(isEstimateCreateAsk(q), q).toBe(false);
  });
});

describe("explain_estimate", () => {
  it("is offered only with the module on and a view grant", async () => {
    const on = setup();
    await askAssistant(ask("hello"), on.ctx);
    expect(toolNames(on.params[0])).toContain("explain_estimate");
    const off = setup({ features: { ...ON, estimator: false } });
    await askAssistant(ask("hello"), off.ctx);
    expect(toolNames(off.params[0])).not.toContain("explain_estimate");
    expect(stable(off.params[0])).not.toContain("ESTIMATES:");
    const noGrant = setup({ perms: { unrestricted: false, grants: new Map([["accounts", { workcenter: "accounts", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) } });
    await askAssistant(ask("hello"), noGrant.ctx);
    expect(toolNames(noGrant.params[0])).not.toContain("explain_estimate");
  });

  it("returns the saved figures by reference, and no unit cost", async () => {
    const s = setup({ replies: [toolUse("explain_estimate", { estimate: "EST-0001" }), text("It adds 1,000 cost and 10% margin.")] });
    await askAssistant(ask("Explain how the price of EST-0001 is built"), s.ctx);
    const result = JSON.stringify(s.params[1].messages);
    for (const part of ["Sand excavation", "Bulk excavation", "Al-Otaibi Contracting", "Earthworks", "Haulage", "\\\"cost_total\\\":1000", "\\\"margin_pct\\\":10", "\\\"price_before_vat\\\":1100", "\\\"vat_pct\\\":15", "\\\"price_including_vat\\\":1265", "\\\"lines_without_price\\\":1", "SHORE"]) {
      expect(result, part).toContain(part);
    }
    expect(result).toContain("\\\"quote\\\":null");
    expect(result).not.toContain("unit_cost");
    expect(result).not.toContain("0.875");
  });

  it("gives the customer's figures as the price, and no second one: 12,749.69 reads as 12,750 / 1,913 / 14,663", async () => {
    const s = setup({
      estimates: [estimateRow({ totals: { cost_total: 11590.63, margin_pct: 10, margin_amount: 1159.06, price: 12749.69, vat_pct: 15, vat: 1912.45, price_incl_vat: 14662.14, by_group: [], by_component: {} } })],
      replies: [toolUse("explain_estimate", { estimate: "EST-0001" }), text("ok")],
    });
    await askAssistant(ask("Explain how the price of EST-0001 is built"), s.ctx);
    const result = JSON.stringify(s.params[1].messages);
    for (const part of ["\\\"price_before_vat\\\":12750", "\\\"vat_amount\\\":1913", "\\\"price_including_vat\\\":14663", "\\\"cost_total\\\":11590.63", "\\\"margin_pct\\\":10"]) {
      expect(result, part).toContain(part);
    }
    for (const other of ["12749.69", "14662", "1912"]) expect(result, other).not.toContain(other);
  });

  it("uses the estimate that is open when none is named", async () => {
    const s = setup({ route: `/estimates/${EST}`, replies: [toolUse("explain_estimate", {}), text("ok")] });
    await askAssistant(ask("Explain how this price is built"), s.ctx);
    expect(JSON.stringify(s.params[1].messages)).toContain("EST-0001");
  });

  it("an estimate of another workspace is not found, even when its reference is known", async () => {
    const s = setup({
      estimates: [estimateRow(), estimateRow({ id: FOREIGN, tenant_id: T2, ref: "EST-0002", name: "Other workspace job" })],
      replies: [toolUse("explain_estimate", { estimate: "EST-0002" }), text("No such estimate.")],
    });
    await askAssistant(ask("Explain EST-0002"), s.ctx);
    const result = JSON.stringify(s.params[1].messages);
    expect(result).toContain("No estimate matched");
    expect(result).not.toContain("cost_total");
  });

  it("reports a quote that was made from the estimate", async () => {
    const s = setup({
      estimates: [estimateRow({ standard_quote_id: "sq-1" })],
      replies: [toolUse("explain_estimate", { estimate: "EST-0001" }), text("ok")],
    });
    s.db.tables.standard_quotes.push({ id: "sq-1", tenant_id: T1, ref: "SQ-0007", status: "draft" });
    await askAssistant(ask("Explain EST-0001"), s.ctx);
    expect(JSON.stringify(s.params[1].messages)).toContain("SQ-0007");
  });
});
