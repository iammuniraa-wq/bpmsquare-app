import { describe, it, expect } from "vitest";
import { parseFormula } from "./parser";
import { evaluate, resolveScaleTiered, type EvalContext } from "./evaluator";
import { DslError, LIMITS } from "./ast";

const env = (ctx: Record<string, unknown> = {}, hooks?: Partial<EvalContext["hooks"]>): EvalContext => ({
  ctx,
  hooks: {
    lookup: hooks?.lookup ?? (() => { throw new DslError("no lookup in this test", 0); }),
    subtotal: hooks?.subtotal ?? (() => { throw new DslError("no subtotal in this test", 0); }),
    pricingDate: hooks?.pricingDate ?? (() => "2026-08-15"),
  },
});

const run = (src: string, e: EvalContext = env()) => evaluate(parseFormula(src), e);

describe("DSL parser + evaluator", () => {
  it("respects arithmetic precedence and parentheses", () => {
    expect(run("2 + 3 * 4")).toBe(14);
    expect(run("(2 + 3) * 4")).toBe(20);
    expect(run("10 - 4 - 3")).toBe(3);           // left assoc
    expect(run("-3 * 2")).toBe(-6);              // unary minus
    expect(run("10 % 3")).toBe(1);
  });

  it("handles comparison, boolean logic and ternary", () => {
    expect(run("3 > 2 && 1 <= 1")).toBe(true);
    expect(run("1 == 2 || 2 == 2")).toBe(true);
    expect(run("!false")).toBe(true);
    expect(run("5 > 3 ? 'big' : 'small'")).toBe("big");
    expect(run("false ? 1 : true ? 2 : 3")).toBe(2); // right-assoc ternary
  });

  it("short-circuits logical operators (no eager rhs evaluation)", () => {
    // rhs would throw (division by zero) if evaluated
    expect(run("false && 1 / 0 > 0")).toBe(false);
    expect(run("true || 1 / 0 > 0")).toBe(true);
  });

  it("resolves ctx paths on own properties only, missing → null", () => {
    const e = env({ line: { quantity: 4, weight_kg: 12.5 }, customer: { tier: "A" } });
    expect(run("ctx.line.quantity * 2", e)).toBe(8);
    expect(run("ctx.customer.tier == 'A'", e)).toBe(true);
    expect(run("ctx.customer.missing == null", e)).toBe(true);
    expect(run("ctx.no.such.path == null", e)).toBe(true);
  });

  it("rejects prototype-walking path segments at parse time", () => {
    expect(() => parseFormula("ctx.__proto__.polluted")).toThrow(DslError);
    expect(() => parseFormula("ctx.constructor.name")).toThrow(DslError);
  });

  it("evaluates the Vikas cost-up formula shape", () => {
    const e = env({
      cost: { material: { copper_per_kg: 850 }, salvage: { copper_credit_per_kg: 610 } },
      line: { weight_kg: 20, salvage_weight_kg: 12.4 },
    });
    const total = run(
      "ctx.cost.material.copper_per_kg * ctx.line.weight_kg - ctx.cost.salvage.copper_credit_per_kg * ctx.line.salvage_weight_kg",
      e
    );
    expect(total).toBeCloseTo(850 * 20 - 610 * 12.4, 6);
  });

  it("supports engine hooks: lookup and subtotal", () => {
    const e = env({}, {
      lookup: (code) => (code === "COST" ? 1200 : 0),
      subtotal: (ref) => (ref === "NET_2" ? 1500 : 0),
    });
    expect(run("subtotal('NET_2') - lookup('COST')", e)).toBe(300);
  });

  it("margin floor guard works identically via TOTAL_COST subtotal (mode-independent)", () => {
    const e = env({ policy: { min_margin_abs: 400 } }, {
      subtotal: (ref) => (ref === "NET_2" ? 1500 : ref === "TOTAL_COST" ? 1200 : 0),
    });
    expect(run("subtotal('NET_2') - subtotal('TOTAL_COST') < ctx.policy.min_margin_abs", e)).toBe(true);
  });

  it("resolves tiered scales (last matching tier wins) and errors below the lowest tier", () => {
    const table = [
      { from: 0, value: 100 },
      { from: 1000, value: 92 },
      { from: 5000, value: 85 },
    ];
    expect(resolveScaleTiered(table, 0)).toBe(100);
    expect(resolveScaleTiered(table, 999)).toBe(100);
    expect(resolveScaleTiered(table, 1000)).toBe(92);
    expect(resolveScaleTiered(table, 999999)).toBe(85);
    expect(() => resolveScaleTiered([{ from: 10, value: 1 }], 5)).toThrow(DslError);

    const e = env({ rule: { scale: table }, line: { quantity: 1200 } });
    expect(run("scale(ctx.rule.scale, ctx.line.quantity) * ctx.line.quantity", e)).toBe(92 * 1200);
  });

  it("provides math helpers with argument validation", () => {
    expect(run("min(3, 1, 2)")).toBe(1);
    expect(run("max(3, 1, 2)")).toBe(3);
    expect(run("abs(0 - 7)")).toBe(7);
    expect(run("round(2.345, 2)")).toBe(2.35);
    expect(run("round(2.5)")).toBe(3);
    expect(run("clamp(15, 0, 10)")).toBe(10);
    expect(() => run("round(1, 9)")).toThrow(DslError);
    expect(() => run("clamp(1, 10, 0)")).toThrow(DslError);
  });

  it("handles dates deterministically through hooks", () => {
    expect(run("daysBetween('2026-08-01', pricingDate())")).toBe(14);
    expect(() => run("daysBetween('not-a-date', pricingDate())")).toThrow(DslError);
  });

  it("sums bounded lists by field, treating absent fields as 0", () => {
    const e = env({
      line: { cost_items: [{ amount: 100 }, { amount: 250.5 }, { other: 1 }] },
    });
    expect(run("sum(ctx.line.cost_items, 'amount')", e)).toBeCloseTo(350.5);
    expect(run("count(ctx.line.cost_items)", e)).toBe(3);
    const big = env({ line: { cost_items: Array.from({ length: LIMITS.maxListItems + 1 }, () => ({ amount: 1 })) } });
    expect(() => run("sum(ctx.line.cost_items, 'amount')", big)).toThrow(DslError);
  });

  it("fails loudly on division/modulo by zero and non-numeric operands", () => {
    expect(() => run("1 / 0")).toThrow(DslError);
    expect(() => run("1 % 0")).toThrow(DslError);
    expect(() => run("'a' + 1")).toThrow(DslError);
  });

  it("rejects unknown functions, bare identifiers and trailing input at parse time", () => {
    expect(() => parseFormula("hack(1)")).toThrow(DslError);
    expect(() => parseFormula("quantity * 2")).toThrow(DslError);
    expect(() => parseFormula("1 + 2 3")).toThrow(DslError);
    expect(() => parseFormula("ctx")).toThrow(DslError);
    expect(() => parseFormula("'unterminated")).toThrow(DslError);
  });

  it("enforces the hard limits: formula length, AST depth, eval ops", () => {
    expect(() => parseFormula("1 + ".repeat(LIMITS.maxFormulaLength) + "1")).toThrow(DslError);
    const deep = "(".repeat(LIMITS.maxAstDepth + 1) + "1" + ")".repeat(LIMITS.maxAstDepth + 1);
    expect(() => parseFormula(deep)).toThrow(DslError);
  });

  it("supports comments", () => {
    expect(run("2 + 2 # the answer\n")).toBe(4);
  });
});
