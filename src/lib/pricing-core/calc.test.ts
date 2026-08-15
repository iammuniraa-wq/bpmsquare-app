import { describe, it, expect } from "vitest";
import { priceDocument, resolveScaleGraduated, type PriceInput } from "./calc";
import { PricingError } from "./resolution";
import type { DimensionRegistry, PriceComponent, PriceRule } from "./types";

const REGISTRY: DimensionRegistry = {
  "customer.id": 100, "customer.tier": 30, region: 20, document_type: 15,
};

const component = (code: string, over: Partial<PriceComponent> = {}): PriceComponent => ({
  code, name: code, class: "PRICE", calc_type: "FIXED_AMOUNT", calc_basis: "NET_SO_FAR",
  sign: "BOTH", manual_override: "FORBIDDEN", is_statistical: false, ...over,
});

const rule = (id: string, componentCode: string, over: Partial<PriceRule> = {}): PriceRule => ({
  rule_id: id, component_code: componentCode, match_attributes: {}, value: 0, ...over,
});

// ── Phase-1 exit criterion 1: the SAP-style B2B waterfall (spec §13) ────────

const SAP_STYLE: PriceInput = {
  procedure: {
    procedure_id: "p1",
    entry_mode: "LIST_DOWN",
    steps: [
      { step: 10, component: "LIST_PRICE", required: true },
      { step: 20, component: "CUST_DISC", requirement: "dsl:ctx.customer.tier != null" },
      { step: 30, component: "PROMO_DISC", exclusion_group: "DISCOUNTS_BEST_OF" },
      { step: 40, component: "VOLUME_DISC", exclusion_group: "DISCOUNTS_BEST_OF" },
      { step: 50, subtotal: "NET_1" },
      { step: 70, component: "FREIGHT" },
      { step: 80, subtotal: "NET_2" },
      { step: 90, component: "TAX", calc_basis_ref: "NET_2" },
      { step: 100, subtotal: "FINAL" },
      { step: 110, component: "COST", statistical: true },
      { step: 120, component: "MARGIN", statistical: true, formula: "subtotal('NET_2') - lookup('COST')" },
    ],
  },
  components: [
    component("LIST_PRICE", { calc_type: "PER_UNIT", sign: "POSITIVE" }),
    component("CUST_DISC", { class: "DISCOUNT", calc_type: "PERCENT", sign: "NEGATIVE" }),
    component("PROMO_DISC", { class: "DISCOUNT", calc_type: "PERCENT", sign: "NEGATIVE" }),
    component("VOLUME_DISC", { class: "DISCOUNT", calc_type: "PERCENT", sign: "NEGATIVE" }),
    component("FREIGHT", { class: "FREIGHT", sign: "POSITIVE" }),
    component("TAX", { class: "TAX", calc_type: "PERCENT", sign: "POSITIVE", rounding_rule: { precision: 2, mode: "HALF_UP" } }),
    component("COST", { class: "STATISTICAL", calc_type: "PER_UNIT", is_statistical: true }),
    component("MARGIN", { class: "STATISTICAL", calc_type: "FORMULA", is_statistical: true }),
  ],
  rules: [
    rule("lp", "LIST_PRICE", { value: 100 }),
    rule("cd", "CUST_DISC", { value: -3, match_attributes: { "customer.tier": "A" } }),
    rule("pd", "PROMO_DISC", { value: -2 }),
    rule("vd", "VOLUME_DISC", { value: -4 }),
    rule("fr", "FREIGHT", { value: 50 }),
    rule("tx", "TAX", { value: 18 }),
    rule("co", "COST", { value: 60 }),
  ],
  cost_models: [],
  registry: REGISTRY,
  document: {
    attributes: { document_type: "quote", region: "DACH", customer: { tier: "A" } },
    lines: [{ line_no: 10, quantity: 10 }],
  },
  pricing_date: "2026-08-15",
  currency: "EUR",
};

describe("exit criterion 1 — SAP-style waterfall", () => {
  const result = priceDocument(SAP_STYLE);
  const line = result.lines[0];

  it("computes the full waterfall correctly", () => {
    expect(line.components.LIST_PRICE).toBe(1000);
    expect(line.components.CUST_DISC).toBeCloseTo(-30);
    expect(line.components.VOLUME_DISC).toBeCloseTo(-38.8);   // -4% of 970
    expect(line.subtotals.NET_1).toBeCloseTo(931.2);
    expect(line.components.FREIGHT).toBe(50);
    expect(line.subtotals.NET_2).toBeCloseTo(981.2);
    expect(line.components.TAX).toBeCloseTo(176.62);          // rounded to 2dp
    expect(line.subtotals.FINAL).toBeCloseTo(1157.82);
    expect(line.net).toBeCloseTo(1157.82);
  });

  it("excludes the losing discount with a reason naming the winner", () => {
    const excluded = line.trace.find((t) => t.component === "PROMO_DISC");
    expect(excluded?.status).toBe("EXCLUDED");
    expect(excluded?.reason).toMatch(/DISCOUNTS_BEST_OF/);
    expect(excluded?.reason).toMatch(/VOLUME_DISC/);
  });

  it("keeps statistical lines visible but out of the net", () => {
    expect(line.components.COST).toBe(600);
    expect(line.components.MARGIN).toBeCloseTo(381.2);        // NET_2 - COST
    expect(line.net).toBeCloseTo(1157.82);                    // unchanged by statisticals
  });

  it("records rule identity, specificity and candidates in the trace", () => {
    const disc = line.trace.find((t) => t.component === "CUST_DISC");
    expect(disc?.status).toBe("APPLIED");
    expect(disc?.rule_id).toBe("cd");
    expect(disc?.specificity).toBe(30);
  });

  it("skips the requirement-gated discount when the context lacks the tier", () => {
    const noTier = structuredClone(SAP_STYLE);
    noTier.document.attributes = { document_type: "quote", region: "DACH" };
    const r = priceDocument(noTier);
    const disc = r.lines[0].trace.find((t) => t.component === "CUST_DISC");
    expect(disc?.status).toBe("SKIPPED");
    expect(disc?.reason).toMatch(/requirement/);
  });

  it("hard-fails when a required component has no rule", () => {
    const broken = structuredClone(SAP_STYLE);
    broken.rules = broken.rules.filter((r) => r.component_code !== "LIST_PRICE");
    expect(() => priceDocument(broken)).toThrow(PricingError);
  });
});

// ── Phase-1 exit criterion 2: the Vikas cost-up case (spec §13) ─────────────

const VIKAS: PriceInput = {
  procedure: {
    procedure_id: "p2",
    entry_mode: "COST_UP",
    steps: [
      { step: 10, component: "MATERIAL_COST", cost_model: "COPPER_WORKS", rollup_kind: "MATERIAL" },
      { step: 20, component: "LABOUR_COST", cost_model: "COPPER_WORKS", rollup_kind: "LABOUR" },
      { step: 30, component: "SALVAGE_CREDIT", cost_model: "COPPER_WORKS", rollup_kind: "SALVAGE_CREDIT" },
      { step: 40, subtotal: "TOTAL_COST" },
      { step: 50, component: "MARGIN_MARKUP", calc_basis_ref: "TOTAL_COST" },
      { step: 60, subtotal: "NET_1" },
      { step: 70, component: "CUST_DISC" },
      { step: 80, subtotal: "NET_2" },
      { step: 90, component: "TAX", calc_basis_ref: "NET_2" },
      { step: 100, subtotal: "FINAL" },
    ],
  },
  components: [
    component("MATERIAL_COST", { class: "COST_BUILDUP", calc_type: "COST_ROLLUP", sign: "POSITIVE" }),
    component("LABOUR_COST", { class: "COST_BUILDUP", calc_type: "COST_ROLLUP", sign: "POSITIVE" }),
    component("SALVAGE_CREDIT", { class: "COST_BUILDUP", calc_type: "COST_ROLLUP", sign: "NEGATIVE" }),
    component("MARGIN_MARKUP", { class: "MARKUP", calc_type: "PERCENT", sign: "POSITIVE" }),
    component("CUST_DISC", { class: "DISCOUNT", calc_type: "PERCENT", sign: "NEGATIVE" }),
    component("TAX", { class: "TAX", calc_type: "PERCENT", sign: "POSITIVE", rounding_rule: { precision: 2, mode: "HALF_UP" } }),
  ],
  rules: [
    rule("mm", "MARGIN_MARKUP", { value: 25 }),
    rule("tx", "TAX", { value: 18 }),
    // no CUST_DISC rule — step must SKIP cleanly
  ],
  cost_models: [
    {
      code: "COPPER_WORKS",
      name: "Copper works",
      inputs: [
        // weekly-updatable rates: July rate superseded by August rate
        { path: "material.copper_per_kg", kind: "MATERIAL", value: 820, valid_from: "2026-07-01", valid_to: "2026-07-31" },
        { path: "material.copper_per_kg", kind: "MATERIAL", value: 850, valid_from: "2026-08-01", valid_to: null },
        { path: "labour.electrician_hr", kind: "LABOUR", value: 450, valid_from: null, valid_to: null },
        { path: "salvage.copper_credit_per_kg", kind: "SALVAGE_CREDIT", value: 610, valid_from: null, valid_to: null },
      ],
    },
  ],
  registry: REGISTRY,
  document: {
    attributes: { document_type: "quote" },
    lines: [{
      line_no: 10,
      quantity: 1,
      cost_items: [
        { path: "material.copper_per_kg", qty: 20 },
        { path: "labour.electrician_hr", qty: 16 },
        { path: "salvage.copper_credit_per_kg", qty: 12.4 },
      ],
    }],
  },
  pricing_date: "2026-08-15",
  currency: "INR",
};

describe("exit criterion 2 — Vikas cost-up case", () => {
  const result = priceDocument(VIKAS);
  const line = result.lines[0];

  it("rolls up material and labour from effective-dated rates", () => {
    expect(line.components.MATERIAL_COST).toBe(850 * 20);      // August rate, not July's 820
    expect(line.components.LABOUR_COST).toBe(450 * 16);
  });

  it("shows the salvage deduction as a NEGATIVE trace line (BUG-009 structurally impossible)", () => {
    expect(line.components.SALVAGE_CREDIT).toBeCloseTo(-(610 * 12.4));
    const salvageTrace = line.trace.find((t) => t.component === "SALVAGE_CREDIT");
    expect(salvageTrace?.status).toBe("APPLIED");
    expect(salvageTrace?.result).toBeLessThan(0);
    expect(salvageTrace?.inputs).toEqual([{ path: "salvage.copper_credit_per_kg", rate: 610, qty: 12.4 }]);
  });

  it("marks up on total cost and completes the waterfall", () => {
    const totalCost = 17000 + 7200 - 7564;
    expect(line.subtotals.TOTAL_COST).toBeCloseTo(totalCost);            // 16636
    expect(line.components.MARGIN_MARKUP).toBeCloseTo(totalCost * 0.25); // 4159
    expect(line.subtotals.NET_2).toBeCloseTo(20795);
    expect(line.components.TAX).toBeCloseTo(3743.1);
    expect(line.subtotals.FINAL).toBeCloseTo(24538.1);
  });

  it("skips the discount cleanly when no rule matches", () => {
    const disc = line.trace.find((t) => t.component === "CUST_DISC");
    expect(disc?.status).toBe("SKIPPED");
    expect(disc?.reason).toMatch(/no matching rule/);
  });

  it("prices the July date with the July copper rate (replayability)", () => {
    const july = structuredClone(VIKAS);
    july.pricing_date = "2026-07-15";
    const r = priceDocument(july);
    expect(r.lines[0].components.MATERIAL_COST).toBe(820 * 20);
  });
});

// ── Manual overrides, scales, formula via ctx.cost ──────────────────────────

describe("manual overrides respect component policy", () => {
  const base = (): PriceInput => ({
    procedure: { procedure_id: "p3", entry_mode: "LIST_DOWN", steps: [{ step: 10, component: "LIST_PRICE", required: true }] },
    components: [component("LIST_PRICE", { calc_type: "PER_UNIT", manual_override: "ALLOWED_WITH_REASON" })],
    rules: [rule("lp", "LIST_PRICE", { value: 100 })],
    cost_models: [], registry: REGISTRY,
    document: { lines: [{ line_no: 10, quantity: 2, manual: { LIST_PRICE: { value: 150, reason: "negotiated" } } }] },
    pricing_date: "2026-08-15",
  });

  it("applies an override with a reason and flags it in the trace", () => {
    const r = priceDocument(base());
    expect(r.lines[0].components.LIST_PRICE).toBe(150);
    expect(r.lines[0].trace[0].manual).toBe(true);
  });

  it("rejects a reasonless override under ALLOWED_WITH_REASON and any override under FORBIDDEN", () => {
    const noReason = base();
    noReason.document.lines[0].manual = { LIST_PRICE: { value: 150 } };
    expect(() => priceDocument(noReason)).toThrow(/reason/i);

    const forbidden = base();
    forbidden.components = [component("LIST_PRICE", { calc_type: "PER_UNIT", manual_override: "FORBIDDEN" })];
    expect(() => priceDocument(forbidden)).toThrow(/override/i);
  });
});

describe("scales", () => {
  it("graduated slabs accumulate per band", () => {
    const entries = [{ from: 0, value: 10 }, { from: 100, value: 8 }, { from: 200, value: 5 }];
    expect(resolveScaleGraduated(entries, 50)).toBe(500);
    expect(resolveScaleGraduated(entries, 150)).toBe(100 * 10 + 50 * 8);
    expect(resolveScaleGraduated(entries, 250)).toBe(100 * 10 + 100 * 8 + 50 * 5);
  });

  it("tiered scale prices the whole quantity at the tier rate", () => {
    const input: PriceInput = {
      procedure: { procedure_id: "p4", entry_mode: "LIST_DOWN", steps: [{ step: 10, component: "LIST_PRICE", required: true }] },
      components: [component("LIST_PRICE", { calc_type: "SCALE_TIERED", calc_basis: "QUANTITY" })],
      rules: [rule("sc", "LIST_PRICE", { value: null, scale: { entries: [{ from: 0, value: 100 }, { from: 1000, value: 92 }] } })],
      cost_models: [], registry: REGISTRY,
      document: { lines: [{ line_no: 10, quantity: 1200 }] },
      pricing_date: "2026-08-15",
    };
    expect(priceDocument(input).lines[0].components.LIST_PRICE).toBe(92 * 1200);
  });
});
