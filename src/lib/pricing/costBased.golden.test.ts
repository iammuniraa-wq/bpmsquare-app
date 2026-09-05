import { describe, it, expect } from "vitest";
import { priceDocument, PricingError, type PriceInput, type PriceRule } from "@/lib/pricing-core";
import { getMethodTemplate } from "./wizard";
import { costItemsForProduct, productCostCandidate, PURCHASE_PATH } from "./costSheet";

// Golden scenarios for the cost-based technique (spec §17, "each type ships
// with a scenario suite that must stay green"). These price REAL-shaped
// products through the wizard's own template -- the same procedure,
// components and ladder a tenant gets when they pick Cost-based -- so a
// template edit that changes a number breaks a test, not a customer's quote.

const T = getMethodTemplate("cost_based");
const ON = "2026-09-06";

const rule = (id: string, component: string, value: number, match: Record<string, string> = {}): PriceRule =>
  ({ rule_id: id, component_code: component, match_attributes: match, value });

const RULES: PriceRule[] = [
  rule("fr", "FREIGHT", 4, { region: "North" }),
  rule("fr0", "FREIGHT", 0),
  rule("hd", "HANDLING", 1),
  rule("mg", "MARGIN_MARKUP", 25),
  rule("mgA", "MARGIN_MARKUP", 20, { "customer.tier": "A" }),
  rule("dc", "CUST_DISC", 0),
  rule("fl", "MARGIN_FLOOR", 15),
  rule("tx", "TAX", 18),
];

function base(lines: PriceInput["document"]["lines"], rates?: PriceInput["cost_models"][number]["inputs"]): PriceInput {
  const model = T.costModel!;
  return {
    procedure: T.procedure,
    components: T.components,
    rules: RULES,
    cost_models: [{ ...model, inputs: rates ?? model.inputs }],
    registry: Object.fromEntries(T.dimensions.map((d) => [d.attribute, d.weight])),
    document: { attributes: { document_type: "quote", "customer": { tier: "A" }, region: "North" }, lines },
    pricing_date: ON,
    currency: "INR",
  };
}

describe("cost-based golden: made part (motor rewinding 45 kW)", () => {
  // Cost sheet per unit: 18 kg copper, 12 h labour, 6 kg salvage back.
  const product = { cost_sheet: [{ path: "material.rate_per_unit", qty: 18 }, { path: "labour.rate_per_hour", qty: 12 }, { path: "salvage.credit_per_unit", qty: 6 }] };
  const rates = [
    { path: "material.rate_per_unit", kind: "MATERIAL" as const, value: 850, valid_from: "2026-08-01" },
    { path: "labour.rate_per_hour", kind: "LABOUR" as const, value: 450 },
    { path: "salvage.credit_per_unit", kind: "SALVAGE_CREDIT" as const, value: 610 },
  ];

  it("rolls up, credits salvage, lands the cost, marks up by tier and taxes", () => {
    const r = priceDocument(base([{ line_no: 10, quantity: 1, cost_items: costItemsForProduct(product, 1) }], rates));
    const l = r.lines[0];
    expect(l.components.PURCHASE_COST).toBe(0);
    expect(l.components.MATERIAL_COST).toBe(15300);
    expect(l.components.LABOUR_COST).toBe(5400);
    expect(l.components.SALVAGE_CREDIT).toBe(-3660);
    expect(l.subtotals.TOTAL_COST).toBe(17040);
    expect(l.components.FREIGHT).toBeCloseTo(681.6);     // North 4%
    expect(l.components.HANDLING).toBeCloseTo(170.4);
    expect(l.subtotals.LANDED_COST).toBeCloseTo(17892);
    expect(l.components.MARGIN_MARKUP).toBeCloseTo(3578.4); // tier A 20% on landed
    expect(l.subtotals.NET_1).toBeCloseTo(21470.4);
    expect(l.components.TAX).toBeCloseTo(3864.67);
    expect(l.subtotals.FINAL).toBeCloseTo(25335.07);
    expect(l.flags).toEqual([]);                            // 20% ≥ 15% floor
  });

  it("scales the sheet with the quantity and flags the floor when margin is thin", () => {
    const thin = base([{ line_no: 10, quantity: 3, cost_items: costItemsForProduct(product, 3) }], rates);
    thin.rules = RULES.map((x) => (x.rule_id === "mgA" ? { ...x, value: 10 } : x));
    const l = priceDocument(thin).lines[0];
    expect(l.components.MATERIAL_COST).toBe(15300 * 3);
    expect(l.flags[0]).toMatchObject({ code: "MARGIN_FLOOR", policy: "warn", floor_pct: 15, actual_pct: 10 });
  });
});

describe("cost-based golden: bought-in MTS part through the source ladder", () => {
  const product = { id: "p1", cost_price: 265000, cost_price_as_of: "2026-08-25", updated_at: "2026-08-25T00:00:00Z", cost_sheet: null };

  it("uses the product's fresh ERP cost first", () => {
    const own = productCostCandidate(product)!;
    const items = costItemsForProduct(product, 2, { [PURCHASE_PATH]: [own, { source: "RFQ", quality: "confirmed", value: 259000, as_of: "2026-08-20" }] });
    const l = priceDocument(base([{ line_no: 10, quantity: 2, cost_items: items }])).lines[0];
    expect(l.components.PURCHASE_COST).toBe(530000);
    const t = l.trace.find((s) => s.component === "PURCHASE_COST")!;
    expect(t.inputs![0]).toMatchObject({ source: "PRODUCT_COST", quality: "actual", rate: 265000, qty: 2 });
    expect(t.inputs![0].considered!.find((c) => c.source === "RFQ")?.status).toBe("lost");
  });

  it("falls to the RFQ reply when the ERP cost is older than 30 days", () => {
    const stale = productCostCandidate({ ...product, cost_price_as_of: "2026-06-01" })!;
    const items = costItemsForProduct(product, 1, { [PURCHASE_PATH]: [stale, { source: "RFQ", quality: "confirmed", value: 259000, as_of: "2026-08-20" }] });
    const t = priceDocument(base([{ line_no: 10, quantity: 1, cost_items: items }])).lines[0].trace.find((s) => s.component === "PURCHASE_COST")!;
    expect(t.inputs![0]).toMatchObject({ source: "RFQ", rate: 259000 });
    expect(t.inputs![0].considered!.find((c) => c.source === "PRODUCT_COST")).toMatchObject({ status: "stale" });
  });

  it("asks for an RFQ when no source can answer", () => {
    const items = costItemsForProduct({ cost_sheet: null, cost_price: null }, 1, {});
    expect(items).toEqual([{ path: PURCHASE_PATH, qty: 1, kind: "PURCHASE" }]);
    try {
      priceDocument(base([{ line_no: 10, quantity: 1, cost_items: items }]));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PricingError);
      expect((e as PricingError).code).toBe("NO_RATE_IN_FORCE");
      expect((e as PricingError).details?.paths).toEqual([PURCHASE_PATH]);
    }
  });
});
