import { describe, expect, it, vi } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import type { QueryableField } from "@/lib/api/query";
import { ASSISTANT_TIPS, DOCK_TIP_LIMIT, usageTip } from "./tips";
import { summarizeRow, trimRows } from "./context";
import { MID_MODEL, billedTokens, modelFor, routeAsk, smallModel, usagePercent } from "./models";
import { AssistantMeter, ASSISTANT_SURFACE } from "./meter";

// The meter takes its two I/O functions as injected dependencies in these tests; the real module (database client) is not loaded.
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn() }));

describe("the explanations behind the i", () => {
  it("every fixed one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(ASSISTANT_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
  it("so do the ones built from figures", () => {
    for (const p of [0, 7, 63, 99, 100]) expect(tipTextProblems(usageTip(p, false)), `${p}`).toEqual([]);
    expect(tipTextProblems(usageTip(0, true))).toEqual([]);
  });
  it("the dock keeps at most three: the header, the usage pill (two wordings) and the web-search question", () => {
    expect(Object.keys(ASSISTANT_TIPS).sort()).toEqual(["header", "overBudget", "usage", "webConsent"]);
    expect(DOCK_TIP_LIMIT).toBe(3);
  });
});

describe("what of a record the assistant is shown", () => {
  const fields: QueryableField[] = [
    { path: "id", type: "string" },
    { path: "name", type: "string", searchable: true },
    { path: "phone", type: "string", sensitive: true },
    { path: "email", type: "string", sensitive: true, searchable: true },
    { path: "account.name", type: "string" },
    { path: "total", type: "number" },
  ];
  const row = { id: "r1", name: "Al-Otaibi", phone: "+966500000000", email: "a@b.sa", account: { name: "Acme" }, total: 1200, custom_data: { cf_secret: "x" }, cost_price: 5, _links: { self: "/api" }, note: null };

  it("drops sensitive fields, undeclared columns and empties", () => {
    const s = summarizeRow(fields, row);
    expect(s).toEqual({ id: "r1", name: "Al-Otaibi", "account.name": "Acme", total: 1200 });
    expect(JSON.stringify(s)).not.toContain("966500000000");
    expect(JSON.stringify(s)).not.toContain("cost_price");
    expect(JSON.stringify(s)).not.toContain("cf_secret");
  });
  it("trims query rows the same way, even when the model never asked for a select", () => {
    expect(trimRows(fields, [row])).toEqual([{ id: "r1", name: "Al-Otaibi", "account.name": "Acme", total: 1200 }]);
  });
  it("reads a row already projected by select", () => {
    expect(trimRows(fields, [{ name: "X", account: { name: "Y" } }])).toEqual([{ name: "X", "account.name": "Y" }]);
  });
  it("cuts a long text", () => {
    const s = summarizeRow([{ path: "name", type: "string" }], { name: "x".repeat(500) });
    expect(String(s.name).length).toBeLessThanOrEqual(200);
  });
});

describe("one model per ask", () => {
  it("a plain read goes to the small model, a comparison or a chart to the mid one", () => {
    expect(routeAsk({ question: "How many open quotations?" }).tier).toBe("small");
    expect(routeAsk({ question: "What is this quote's total?" }).tier).toBe("small");
    expect(routeAsk({ question: "Compare won quotes by month" }).tier).toBe("mid");
    expect(routeAsk({ question: "Why did revenue drop?" }).tier).toBe("mid");
    expect(routeAsk({ question: "Show quote trend over time" }).tier).toBe("mid");
    expect(routeAsk({ question: "x".repeat(300) }).tier).toBe("mid");
  });
  it("a short follow-up to a chart or comparison stays on the mid tier", () => {
    const history = [{ role: "assistant" as const, text: "Here is the trend by month" }];
    expect(routeAsk({ question: "and for 2025?", history }).tier).toBe("mid");
    expect(routeAsk({ question: "and for 2025?", history: [{ role: "assistant", text: "There are 12." }] }).tier).toBe("small");
  });
  it("the mid model is the one the dock has always used; the small one can be switched by one variable", () => {
    expect(modelFor("mid")).toBe(MID_MODEL);
    const before = process.env.ASSISTANT_SMALL_MODEL;
    process.env.ASSISTANT_SMALL_MODEL = "claude-haiku-5-5";
    expect(smallModel()).toBe("claude-haiku-5-5");
    if (before === undefined) delete process.env.ASSISTANT_SMALL_MODEL; else process.env.ASSISTANT_SMALL_MODEL = before;
    expect(smallModel()).not.toBe("claude-haiku-5-5");
  });
});

describe("what a call costs against the allowance", () => {
  it("counts cached input at its price, not at face value", () => {
    expect(billedTokens({ input_tokens: 500, output_tokens: 100 })).toEqual({ input: 500, output: 100 });
    // 10 000 written to the cache cost 12 500; 10 000 read back cost 1 000.
    expect(billedTokens({ input_tokens: 300, cache_creation_input_tokens: 10_000, output_tokens: 50 })).toEqual({ input: 12_800, output: 50 });
    expect(billedTokens({ input_tokens: 300, cache_read_input_tokens: 10_000, output_tokens: 50 })).toEqual({ input: 1_300, output: 50 });
    expect(billedTokens({})).toEqual({ input: 0, output: 0 });
  });
  it("the pill is a whole percent, capped, and 100 when AI is off", () => {
    expect(usagePercent(0, 1000)).toBe(0);
    expect(usagePercent(999, 1000)).toBe(99);
    expect(usagePercent(5000, 1000)).toBe(100);
    expect(usagePercent(10, 0)).toBe(100);
  });
});

describe("the meter", () => {
  const deps = (used: number) => {
    const log = vi.fn(async () => undefined);
    const allowanceFor = vi.fn(async (_t: string, budget: number) => ({ allowed: used < budget, used, budget, remaining: Math.max(0, budget - used) }));
    return { log, allowanceFor, d: { allowanceFor, logUsage: log } };
  };

  it("allows nothing until the allowance has been read", () => {
    const { d } = deps(0);
    expect(new AssistantMeter({ tenantId: "t", userId: "u", budget: 100 }, d).allowed).toBe(false);
  });
  it("reads the allowance for the caller's own tenant, once", async () => {
    const { d, allowanceFor } = deps(10);
    const m = new AssistantMeter({ tenantId: "t-1", userId: "u", budget: 100 }, d);
    expect((await m.open()).allowed).toBe(true);
    expect(allowanceFor).toHaveBeenCalledTimes(1);
    expect(allowanceFor).toHaveBeenCalledWith("t-1", 100);
    expect(m.percent).toBe(10);
  });
  it("logs every call to the assistant surface with the tenant, user and the model that ran", async () => {
    const { d, log } = deps(0);
    const m = new AssistantMeter({ tenantId: "t-1", userId: "u-1", budget: 100_000 }, d);
    await m.open();
    await m.record({ input_tokens: 200, cache_read_input_tokens: 5000, output_tokens: 80 }, "claude-opus-5-5");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "t-1", userId: "u-1", surface: ASSISTANT_SURFACE, inputTokens: 700, outputTokens: 80, model: "claude-opus-5-5",
    }));
    expect(ASSISTANT_SURFACE).toBe("assistant");
    expect(m.usedTokens).toBe(780);
  });
  it("stops the loop inside one ask once the running total reaches the budget", async () => {
    const { d } = deps(0);
    const m = new AssistantMeter({ tenantId: "t", userId: "u", budget: 1000 }, d);
    await m.open();
    expect(m.allowed).toBe(true);
    await m.record({ input_tokens: 900, output_tokens: 200 }, "m");
    expect(m.allowed).toBe(false);
    expect(m.percent).toBe(100);
  });
  it("a wrapped client checks before and logs after, including calls the assistant causes indirectly", async () => {
    const { d, log } = deps(0);
    const m = new AssistantMeter({ tenantId: "t", userId: "u", budget: 10_000 }, d);
    const create = vi.fn(async () => ({ usage: { input_tokens: 40, output_tokens: 10 }, model: "claude-opus-5" }));
    const client = m.wrap({ messages: { create } } as never);
    await expect(client.messages.create({ model: "x", max_tokens: 1, messages: [] })).rejects.toThrow("allowance spent"); // not opened yet
    expect(create).not.toHaveBeenCalled();
    await m.open();
    await client.messages.create({ model: "x", max_tokens: 1, messages: [] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ surface: "assistant", model: "claude-opus-5", inputTokens: 40, outputTokens: 10 }));
  });
});
