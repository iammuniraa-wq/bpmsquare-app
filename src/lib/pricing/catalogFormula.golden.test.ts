import { describe, it, expect } from "vitest";
import { priceDocument, PricingError, type PriceInput, type PriceRule } from "@/lib/pricing-core";
import { getMethodTemplate, flatRateFormula } from "./wizard";

// Golden scenarios for the "Catalog + Formula" technique (pricing-engine-
// architecture.md §19, the Big Blue pressure test, 2026-09-06): a rate
// where a tenant has one negotiated, a cost formula everywhere else, both
// resolved by the SAME most-specific-wins rule the other techniques already
// use -- no new pricing-core primitive. These price REAL-shaped lines
// through the wizard's own template, same as cost-based's golden suite.

const T = getMethodTemplate("catalog_formula");
const ON = "2026-09-06";

const rule = (id: string, component: string, value: number | null, match: Record<string, string> = {}, formula?: string): PriceRule =>
  ({ rule_id: id, component_code: component, match_attributes: match, value, formula: formula ?? null });

function base(rules: PriceRule[], lines: PriceInput["document"]["lines"]): PriceInput {
  return {
    procedure: T.procedure,
    components: T.components,
    rules,
    cost_models: [T.costModel!],
    registry: Object.fromEntries(T.dimensions.map((d) => [d.attribute, d.weight])),
    document: { attributes: { document_type: "quote", "customer": { tier: "A" }, region: "north" }, lines },
    pricing_date: ON,
    currency: "QAR",
  };
}

const RULES: PriceRule[] = [
  // The exact-spec catalog rate -- a negotiated rate for high-volume 16mm.
  rule("cat16", "MATERIAL_RATE", null, { "product.family": "dowel_bar", "product.spec": "16mm", "product.variant": "epoxy" }, "5.75 * ctx.line.quantity"),
  // The family-level fallback: no catalog row for this spec, price from cost.
  rule("fallback", "MATERIAL_RATE", null, { "product.family": "dowel_bar" }, "ctx.cost.material.rate_per_unit * ctx.line.quantity"),
  rule("fr", "FREIGHT", 4500),
  rule("mg", "MARGIN_MARKUP", 12),
  rule("dc", "CUST_DISC", 2),
  rule("fl", "MARGIN_FLOOR", 10),
  rule("tx", "TAX", 0),
];

describe("catalog + formula golden: 16mm epoxy dowel bar (catalog row exists)", () => {
  it("the exact-spec catalog rule outranks the family-level fallback", () => {
    const r = priceDocument(base(RULES, [{
      line_no: 10, quantity: 30_000,
      attributes: { product: { family: "dowel_bar", spec: "16mm", variant: "epoxy" } },
    }]));
    const l = r.lines[0];
    expect(l.components.MATERIAL_RATE).toBe(172_500);     // 5.75 * 30,000, the negotiated rate
    expect(l.subtotals.LANDED_COST).toBe(177_000);          // + 4,500 freight
    expect(l.components.MARGIN_MARKUP).toBeCloseTo(21_240); // 12% of landed
    expect(l.subtotals.NET_1).toBeCloseTo(198_240);
    expect(l.components.CUST_DISC).toBeCloseTo(-3_964.8);   // -2%
    expect(l.subtotals.FINAL).toBeCloseTo(194_275.2);
    const materialStep = l.trace.find((t) => t.component === "MATERIAL_RATE");
    expect(materialStep?.rule_id).toBe("cat16");
  });
});

describe("catalog + formula golden: 18mm epoxy dowel bar (no catalog row)", () => {
  it("falls back to the cost formula and still prices the line", () => {
    const r = priceDocument(base(RULES, [{
      line_no: 10, quantity: 30_000,
      attributes: { product: { family: "dowel_bar", spec: "18mm", variant: "epoxy" } },
    }], ));
    const l = r.lines[0];
    // steel.rate_per_unit defaults to the template's own cost model input (10)
    // -- no product-specific weight formula here, that is a tenant's own
    // formula to write; this proves the FALLBACK RULE fires, not the physics.
    expect(l.components.MATERIAL_RATE).toBe(10 * 30_000);
    const materialStep = l.trace.find((t) => t.component === "MATERIAL_RATE");
    expect(materialStep?.rule_id).toBe("fallback");
    expect(materialStep?.status).toBe("APPLIED");
  });
});

describe("catalog + formula golden: a family with no fallback at all", () => {
  it("never silently zero-prices — a required component with no match is a hard error", () => {
    const noFallback = RULES.filter((r) => r.rule_id !== "fallback");
    expect(() =>
      priceDocument(base(noFallback, [{
        line_no: 10, quantity: 100,
        attributes: { product: { family: "safety_gear", spec: "unlisted_helmet" } },
      }]))
    ).toThrow(PricingError);
  });
});

describe("flatRateFormula", () => {
  it("produces a formula that prices the same as the flat rate it replaces", () => {
    const flat = rule("flat", "MATERIAL_RATE", null, { "product.family": "fastener" }, flatRateFormula(2.4));
    const r = priceDocument(base([flat, ...RULES.filter((x) => x.component_code !== "MATERIAL_RATE")], [{
      line_no: 10, quantity: 500,
      attributes: { product: { family: "fastener" } },
    }]));
    expect(r.lines[0].components.MATERIAL_RATE).toBe(1_200); // 2.4 * 500
  });
});
