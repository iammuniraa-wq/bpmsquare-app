import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

// The assistant's loop end to end, with the model and the database replaced. What is checked is the wiring that
// carries the guarantees: the allowance is read before the model is called, every call is logged, a record of
// another workspace is never loaded, sensitive fields never reach the prompt, and a place the caller cannot reach
// is not in what the model can pick.

const { DATA } = vi.hoisted(() => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const QA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const QB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const ACC_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const DATA: Record<string, { quotations: Record<string, unknown>[]; accounts: Record<string, unknown>[] }> = {
    [A]: {
      quotations: [{ id: QA, ref: "SQ-2026-0012", status: "draft", total: 120000, outcome: "open", created_at: "2026-10-01T00:00:00Z", account: { id: ACC_A, name: "Al-Otaibi Contracting" }, internal_margin: 0.31 }],
      accounts: [{ id: ACC_A, name: "Al-Otaibi Contracting", type: "Customer", city: "Riyadh", phone: "+966555123456", email: "buyer@alotaibi.sa", created_at: "2026-01-01T00:00:00Z" }],
    },
    [B]: {
      quotations: [{ id: QB, ref: "SQ-B-0001", status: "sent", total: 5, outcome: "open", created_at: "2026-10-01T00:00:00Z", account: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Other Tenant Ltd" } }],
      accounts: [],
    },
  };
  return { DATA: Object.assign(DATA, { A, B, QA, QB, ACC_A }) };
});

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => { throw new Error("no database in this test"); },
  requireTenantUser: async () => { throw new Error("not used"); },
  createServerSupabase: async () => { throw new Error("not used"); },
}));
vi.mock("@/lib/api/listSources", () => ({
  LIST_SOURCES: {
    quotations: {
      label: "Quotations", description: "quotes", relatedWorkcenter: "quotations",
      fields: [
        { path: "id", type: "string" }, { path: "ref", type: "string", searchable: true }, { path: "status", type: "string" },
        { path: "total", type: "number" }, { path: "outcome", type: "string" }, { path: "created_at", type: "date" },
        { path: "account.id", type: "string" }, { path: "account.name", type: "string", searchable: true },
      ],
      load: async (tenantId: string) => DATA[tenantId]?.quotations ?? [],
    },
    accounts: {
      label: "Accounts", description: "companies", relatedWorkcenter: "accounts",
      fields: [
        { path: "id", type: "string" }, { path: "name", type: "string", searchable: true }, { path: "type", type: "string" }, { path: "city", type: "string" },
        { path: "phone", type: "string", sensitive: true }, { path: "email", type: "string", sensitive: true, searchable: true },
      ],
      load: async (tenantId: string) => DATA[tenantId]?.accounts ?? [],
    },
  },
}));
vi.mock("@/lib/ai/reportCompile", () => ({ compileAndRun: vi.fn() }));
vi.mock("@/lib/marketing/leads/queries", () => ({ listScoredLeads: vi.fn(async () => ({ leads: [], pending: false })) }));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn() }));

import { askAssistant, type AssistantAskCtx } from "@/lib/ai/assistant";
import { OVER_BUDGET_MESSAGE } from "@/lib/ai/usageCap";
import { AssistantMeter } from "./meter";
import type { PermissionSet } from "@/lib/permissions";

const A = (DATA as unknown as Record<string, string>).A;
const B = (DATA as unknown as Record<string, string>).B;
const QA = (DATA as unknown as Record<string, string>).QA;
const QB = (DATA as unknown as Record<string, string>).QB;
const ACC_A = (DATA as unknown as Record<string, string>).ACC_A;

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const ONLY_ACCOUNTS: PermissionSet = {
  unrestricted: false,
  grants: new Map([["accounts", { workcenter: "accounts", canView: true, canCreate: false, canEdit: false, canDelete: false }]]),
};
const FEATURES = { ai_assistant: true, quotations: true, accounts: true, contacts: true };
const CURRENCY = { code: "SAR", symbol: "SAR", grouping: "standard" } as never;
const NOW = new Date("2026-10-21T09:00:00Z");

type Reply = { content: unknown[]; stop_reason: string; usage: Record<string, number>; model?: string };
const text = (t: string, usage: Record<string, number> = { input_tokens: 100, output_tokens: 20 }): Reply => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage });
const toolUse = (name: string, input: unknown, id = "tu1"): Reply => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: { input_tokens: 4000, cache_creation_input_tokens: 9000, output_tokens: 40 } });

function setup(opts: { used?: number; budget?: number; replies?: Reply[]; tenant?: string; perms?: PermissionSet; features?: Record<string, boolean>; route?: string | null } = {}) {
  const events: string[] = [];
  const params: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const replies = [...(opts.replies ?? [text("ok")])];
  const create = vi.fn(async (p: Record<string, unknown>) => {
    events.push("model");
    params.push(JSON.parse(JSON.stringify(p)));
    const r = replies.shift();
    if (!r) throw new Error("no scripted reply left");
    return r;
  });
  const allowanceFor = vi.fn(async (_t: string, budget: number) => {
    events.push("allowance");
    const used = opts.used ?? 0;
    return { allowed: used < budget, used, budget, remaining: Math.max(0, budget - used) };
  });
  const logUsage = vi.fn(async (row: Record<string, unknown>) => { events.push("log"); logs.push(row); });
  const tenantId = opts.tenant ?? A;
  const meter = new AssistantMeter({ tenantId, userId: "user-1", budget: opts.budget ?? 1_000_000 }, { allowanceFor, logUsage: logUsage as never });
  const ctx: AssistantAskCtx = {
    supabase: {} as never, tenantId, perms: opts.perms ?? ALL, currency: CURRENCY,
    features: opts.features ?? FEATURES, isAdmin: (opts.perms ?? ALL).unrestricted,
    route: opts.route ?? null, meter, anthropic: { messages: { create } } as unknown as Anthropic, now: NOW,
  };
  return { ctx, events, params, logs, create, allowanceFor, logUsage };
}
const ask = (q: string) => [{ role: "user" as const, text: q }];

beforeEach(() => { vi.clearAllMocks(); });

describe("the meter around the loop", () => {
  it("reads the allowance before the first model call and logs every call after it", async () => {
    const s = setup({ replies: [toolUse("query_data", { object: "quotations", count_only: true }), text("There is 1.")] });
    const reply = await askAssistant(ask("how many quotes?"), s.ctx);
    expect(reply.answer).toBe("There is 1.");
    expect(s.events).toEqual(["allowance", "model", "log", "model", "log"]);
    expect(s.logs).toHaveLength(2);
    for (const l of s.logs) expect(l).toMatchObject({ tenantId: A, userId: "user-1", surface: "assistant" });
    // 4000 uncached + 9000 written to the cache at 1.25x
    expect(s.logs[0]).toMatchObject({ inputTokens: 4000 + 11250, outputTokens: 40 });
  });

  it("over the allowance: the chat answers with the existing message and no model is called or logged", async () => {
    const s = setup({ used: 2_000_000, budget: 1_500_000 });
    const reply = await askAssistant(ask("total value of open quotations"), s.ctx);
    expect(reply).toMatchObject({ answer: OVER_BUDGET_MESSAGE, overBudget: true });
    expect(s.create).not.toHaveBeenCalled();
    expect(s.logUsage).not.toHaveBeenCalled();
  });

  it("a budget of 0 means no AI", async () => {
    const s = setup({ budget: 0 });
    expect((await askAssistant(ask("how many quotes"), s.ctx)).overBudget).toBe(true);
    expect(s.create).not.toHaveBeenCalled();
  });

  it("opening a screen needs no model and no allowance, so it keeps working when the allowance is spent", async () => {
    const s = setup({ used: 9_000_000, budget: 1000 });
    const reply = await askAssistant(ask("open quotations"), s.ctx);
    expect(reply.cards).toEqual([expect.objectContaining({ href: "/quotations" })]);
    expect(reply.autoFollow).toBe(true);
    expect(s.create).not.toHaveBeenCalled();
    expect(s.allowanceFor).not.toHaveBeenCalled();
    expect(s.logUsage).not.toHaveBeenCalled();
  });

  it("stops mid-ask when the running total passes the budget", async () => {
    const s = setup({ budget: 10_000, replies: [toolUse("query_data", { object: "quotations", count_only: true }), text("never reached")] });
    const reply = await askAssistant(ask("how many quotes?"), s.ctx);
    expect(reply.overBudget).toBe(true);
    expect(s.create).toHaveBeenCalledTimes(1);
  });
});

describe("cost controls", () => {
  it("sends the stable prompt and the tools with a cache breakpoint, and keeps the per-ask parts after it", async () => {
    const s = setup({ route: `/quotations/${QA}` });
    await askAssistant(ask("what is this quote's total"), s.ctx);
    const p = s.params[0] as { system: { text: string; cache_control?: unknown }[]; tools: { name: string; cache_control?: unknown }[] };
    expect(p.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(p.system[1].cache_control).toBeUndefined();
    expect(p.tools.at(-1)?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // Nothing that varies per ask is inside the cached block.
    expect(p.system[0].text).not.toContain("SQ-2026-0012");
    expect(p.system[0].text).not.toContain("2026-10-21");
    expect(p.system[1].text).toContain("2026-10-21");
  });

  it("the cached block is byte-identical across asks, whatever the date or the open record", async () => {
    const first = setup({ route: `/quotations/${QA}` });
    await askAssistant(ask("what is this quote's total"), first.ctx);
    const second = setup({ route: null });
    second.ctx.now = new Date("2026-11-30T09:00:00Z");
    await askAssistant(ask("how many accounts"), second.ctx);
    const text0 = (s: ReturnType<typeof setup>) => (s.params[0] as { system: { text: string }[] }).system[0].text;
    expect(text0(first)).toBe(text0(second));
    expect(JSON.stringify((first.params[0] as { tools: unknown }).tools)).toBe(JSON.stringify((second.params[0] as { tools: unknown }).tools));
  });

  it("a plain read goes to the small model at low effort; a comparison to the mid model", async () => {
    const small = setup();
    const r1 = await askAssistant(ask("how many open quotations?"), small.ctx);
    expect(small.params[0]).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" } });
    expect(r1.routed?.tier).toBe("small");
    const mid = setup();
    const r2 = await askAssistant(ask("compare quotation value by month"), mid.ctx);
    expect(mid.params[0]).toMatchObject({ model: "claude-opus-5" });
    expect((mid.params[0] as Record<string, unknown>).output_config).toBeUndefined();
    expect(r2.routed?.tier).toBe("mid");
  });

  it("query results are trimmed to declared fields and never carry sensitive ones", async () => {
    const s = setup({ replies: [toolUse("query_data", { object: "accounts", limit: 5 }), text("done")] });
    await askAssistant(ask("list accounts"), s.ctx);
    const next = JSON.stringify(s.params[1].messages);
    expect(next).toContain("Al-Otaibi Contracting");
    expect(next).not.toContain("966555123456");
    expect(next).not.toContain("buyer@alotaibi.sa");
    expect(next).not.toContain("_links");
  });
});

describe("page context", () => {
  it("puts a short summary of the open record in the prompt, as data", async () => {
    const s = setup({ route: `/quotations/${QA}` });
    await askAssistant(ask("what is this quote's total"), s.ctx);
    const volatile = (s.params[0] as { system: { text: string }[] }).system[1].text;
    expect(volatile).toContain("SQ-2026-0012 · Al-Otaibi Contracting");
    expect(volatile).toContain("<open_record>");
    expect(volatile).toContain("\"total\":120000");
    expect(volatile).not.toContain("internal_margin");
  });

  it("strips sensitive fields from the summary of an account", async () => {
    const s = setup({ route: `/accounts/${ACC_A}` });
    await askAssistant(ask("who owns this account"), s.ctx);
    const volatile = (s.params[0] as { system: { text: string }[] }).system[1].text;
    expect(volatile).toContain("Riyadh");
    expect(volatile).not.toContain("966555123456");
    expect(volatile).not.toContain("buyer@alotaibi.sa");
  });

  it("refuses a record of another workspace: its id is simply not found among this workspace's rows", async () => {
    const s = setup({ tenant: A, route: `/quotations/${QB}` });
    await askAssistant(ask("what is this quote's total"), s.ctx);
    const volatile = (s.params[0] as { system: { text: string }[] }).system[1].text;
    expect(volatile).not.toContain("<open_record>");
    expect(volatile).not.toContain("SQ-B-0001");
    expect(volatile).not.toContain("Other Tenant");
    // ...and the same route is that tenant's own record for that tenant.
    const own = setup({ tenant: B, route: `/quotations/${QB}` });
    await askAssistant(ask("what is this quote's total"), own.ctx);
    expect((own.params[0] as { system: { text: string }[] }).system[1].text).toContain("SQ-B-0001");
  });

  it("does not load a record of an object the caller may not view", async () => {
    const s = setup({ perms: ONLY_ACCOUNTS, route: `/quotations/${QA}` });
    await askAssistant(ask("what is this quote's total"), s.ctx);
    expect((s.params[0] as { system: { text: string }[] }).system[1].text).not.toContain("SQ-2026-0012");
  });

  it("does not load a record of a module the workspace has not bought", async () => {
    const s = setup({ features: { ai_assistant: true, accounts: true }, route: `/quotations/${QA}` });
    await askAssistant(ask("what is this quote's total"), s.ctx);
    expect((s.params[0] as { system: { text: string }[] }).system[1].text).not.toContain("SQ-2026-0012");
  });
});

describe("navigation", () => {
  const navEnum = (p: Record<string, unknown>) => ((p.tools as { name: string; input_schema: { properties: { target?: { enum: string[] } } } }[]).find((t) => t.name === "navigate")?.input_schema.properties.target?.enum) ?? [];

  it("the model can only pick from places the caller can reach", async () => {
    const s = setup({ perms: ONLY_ACCOUNTS });
    await askAssistant(ask("where do I manage things"), s.ctx);
    expect(navEnum(s.params[0])).toContain("nav:/accounts");
    expect(navEnum(s.params[0])).not.toContain("nav:/quotations");
    expect((s.params[0].system as { text: string }[])[0].text).not.toContain("nav:/quotations");
    const noModule = setup({ features: { ai_assistant: true, accounts: true } });
    await askAssistant(ask("where do I manage things"), noModule.ctx);
    expect(navEnum(noModule.params[0])).not.toContain("nav:/quotations");
  });

  it("a valid pick becomes a card with the server's own path; an id outside the list is refused", async () => {
    const good = setup({ replies: [toolUse("navigate", { target: "nav:/quotations" }), text("Here.")] });
    const r = await askAssistant(ask("please open the quotations overview"), good.ctx);
    expect(r.cards).toEqual([{ id: "nav:/quotations", label: "Open Quotations", href: "/quotations" }]);
    expect(r.autoFollow).toBe(true);

    const bad = setup({ replies: [toolUse("navigate", { target: "https://evil.example" }), text("Sorry.")] });
    const r2 = await askAssistant(ask("where is the thing"), bad.ctx);
    expect(r2.cards).toBeUndefined();
    expect(JSON.stringify(bad.params[1].messages)).toContain("not one of the places");
  });

  it("a question that happens to use the model does not auto-follow", async () => {
    const s = setup({ replies: [toolUse("navigate", { target: "nav:/quotations" }), text("There.")] });
    const r = await askAssistant(ask("where can I see all quotes?"), s.ctx);
    expect(r.cards).toHaveLength(1);
    expect(r.autoFollow).toBeUndefined();
  });

  it("open_record resolves a reference inside this workspace only", async () => {
    const mine = setup({ replies: [toolUse("open_record", { object: "quote", query: "SQ-2026-0012" }), text("Opened.")] });
    const r = await askAssistant(ask("take the Otaibi quote to me"), mine.ctx);
    expect(r.cards?.[0].href).toBe(`/quotations/${QA}`);

    const theirs = setup({ replies: [toolUse("open_record", { object: "quote", query: "SQ-B-0001" }), text("No such quote.")] });
    const r2 = await askAssistant(ask("take the other quote to me"), theirs.ctx);
    expect(r2.cards).toBeUndefined();
    expect(JSON.stringify(theirs.params[1].messages)).toContain("No record matched");
  });

  it("'open quote <ref>' needs no model", async () => {
    const s = setup();
    const r = await askAssistant(ask("open quote SQ-2026-0012"), s.ctx);
    expect(r.cards?.[0].href).toBe(`/quotations/${QA}`);
    expect(r.autoFollow).toBe(true);
    expect(s.create).not.toHaveBeenCalled();
    const other = setup();
    const r2 = await askAssistant(ask("open quote SQ-B-0001"), other.ctx);
    expect(r2.cards).toBeUndefined(); // not this workspace's: falls through to the model
    expect(other.create).toHaveBeenCalled();
  });
});
