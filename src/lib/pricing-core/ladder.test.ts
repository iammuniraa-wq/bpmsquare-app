import { describe, it, expect } from "vitest";
import { resolveCost, PricingError } from "./resolution";
import { priceDocument, type PriceInput } from "./calc";
import type { CostSourceDef, PriceComponent } from "./types";

// The cost source ladder (spec §17, cost-based step 1): the manufacturer's
// "SAP first, else confirmed RFQ beats calculated, else price list, else
// ask the supplier" as data, resolved deterministically with every
// candidate's fate on record.

const LADDER: CostSourceDef[] = [
  { code: "ERP_COST", tier: 1, quality: "actual", max_age_days: 30 },
  { code: "RFQ", tier: 2, quality: "confirmed" },
  { code: "CCP", tier: 2, quality: "estimate", requirement: "dsl:ctx.line.supplier.ccp == true" },
  { code: "PRICE_LIST", tier: 3, quality: "list" },
];
const ON = "2026-09-06";

describe("resolveCost — the ladder", () => {
  it("takes the ERP cost when it is fresh", () => {
    const r = resolveCost([
      { source: "ERP_COST", value: 1000, as_of: "2026-09-01" },
      { source: "RFQ", value: 980, as_of: "2026-08-20" },
      { source: "PRICE_LIST", value: 1100 },
    ], LADDER, "purchase.unit_cost", ON);
    expect(r.winner).toMatchObject({ value: 1000, source: "ERP_COST", quality: "actual" });
    expect(r.considered.find((c) => c.source === "RFQ")?.status).toBe("lost");
  });

  it("skips a stale ERP cost and falls to tier 2, where confirmed beats calculated", () => {
    const r = resolveCost([
      { source: "ERP_COST", value: 1000, as_of: "2026-07-01" },
      { source: "CCP", value: 950 },
      { source: "RFQ", value: 980, as_of: "2026-08-20" },
    ], LADDER, "purchase.unit_cost", ON, () => true);
    expect(r.winner).toMatchObject({ value: 980, source: "RFQ" });
    const erp = r.considered.find((c) => c.source === "ERP_COST");
    expect(erp?.status).toBe("stale");
    expect(erp?.reason).toMatch(/67 days old, limit 30/);
    expect(r.considered.find((c) => c.source === "CCP")).toMatchObject({ status: "lost", reason: "estimate ranks below confirmed" });
  });

  it("drops a conditional source whose requirement does not hold", () => {
    const r = resolveCost([
      { source: "CCP", value: 950 },
      { source: "PRICE_LIST", value: 1100 },
    ], LADDER, "purchase.unit_cost", ON, () => false);
    expect(r.winner).toMatchObject({ value: 1100, source: "PRICE_LIST" });
    expect(r.considered.find((c) => c.source === "CCP")?.status).toBe("requirement");
  });

  it("returns no winner, with every candidate's reason, when nothing answers", () => {
    const r = resolveCost([
      { source: "ERP_COST", value: 1000, as_of: "2026-01-01" },
      { source: "RFQ", value: 900, valid_to: "2026-06-30" },
    ], LADDER, "purchase.unit_cost", ON);
    expect(r.winner).toBeNull();
    expect(r.considered.map((c) => c.status).sort()).toEqual(["expired", "stale"]);
  });

  it("tries an unlisted source last and never guesses between equals", () => {
    const r = resolveCost([{ value: 700 }, { source: "PRICE_LIST", value: 1100 }], LADDER, "p", ON);
    expect(r.winner?.source).toBe("PRICE_LIST");
    expect(() => resolveCost([
      { source: "RFQ", value: 900, as_of: "2026-08-01" },
      { source: "RFQ", value: 950, as_of: "2026-08-01" },
    ], LADDER, "p", ON)).toThrow(PricingError);
  });

  it("without a ladder, behaves as before: most recent valid_from wins", () => {
    const r = resolveCost([
      { value: 820, valid_from: "2026-07-01", valid_to: "2026-07-31" },
      { value: 850, valid_from: "2026-08-01" },
    ], null, "material.copper_per_kg", "2026-08-15");
    expect(r.winner?.value).toBe(850);
  });
});

// ── A bought-in MTS part through the whole cost-based waterfall ────────────

const comp = (code: string, over: Partial<PriceComponent> = {}): PriceComponent => ({
  code, name: code, class: "PRICE", calc_type: "FIXED_AMOUNT", calc_basis: "NET_SO_FAR",
  sign: "BOTH", manual_override: "FORBIDDEN", is_statistical: false, ...over,
});

function mtsInput(candidates: PriceInput["document"]["lines"][number]["cost_items"]): PriceInput {
  return {
    procedure: {
      procedure_id: "COST_SIMULATOR", entry_mode: "COST_UP",
      steps: [
        { step: 10, component: "PURCHASE_COST", cost_model: "STD", rollup_kind: "PURCHASE" },
        { step: 20, subtotal: "TOTAL_COST" },
        { step: 30, component: "FREIGHT", calc_basis_ref: "TOTAL_COST" },
        { step: 40, subtotal: "LANDED_COST" },
        { step: 50, component: "MARGIN_MARKUP", calc_basis_ref: "LANDED_COST" },
        { step: 60, subtotal: "NET_1" },
        { step: 65, component: "MARGIN_FLOOR", statistical: true, guardrail: { kind: "MARGIN_FLOOR", cost_subtotal: "LANDED_COST", revenue_subtotal: "NET_1", policy: "block" } },
        { step: 70, component: "TAX", calc_basis_ref: "NET_1" },
        { step: 80, subtotal: "FINAL" },
      ],
    },
    components: [
      comp("PURCHASE_COST", { class: "COST_BUILDUP", calc_type: "COST_ROLLUP", calc_basis: "COST_REF", sign: "POSITIVE" }),
      comp("FREIGHT", { class: "FREIGHT", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE" }),
      comp("MARGIN_MARKUP", { class: "MARKUP", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE" }),
      comp("MARGIN_FLOOR", { class: "STATISTICAL", calc_type: "FIXED_AMOUNT", calc_basis: "GROSS", is_statistical: true }),
      comp("TAX", { class: "TAX", calc_type: "PERCENT", calc_basis: "SUBTOTAL_REF", sign: "POSITIVE" }),
    ],
    rules: [
      { rule_id: "fr", component_code: "FREIGHT", match_attributes: {}, value: 4 },
      { rule_id: "mg", component_code: "MARGIN_MARKUP", match_attributes: {}, value: 12 },
      { rule_id: "fl", component_code: "MARGIN_FLOOR", match_attributes: {}, value: 15 },
      { rule_id: "tx", component_code: "TAX", match_attributes: {}, value: 18 },
    ],
    cost_models: [{ code: "STD", name: "Standard", inputs: [], sources: LADDER }],
    registry: { document_type: 15 },
    document: {
      attributes: { document_type: "quote" },
      lines: [{ line_no: 10, quantity: 5, attributes: { supplier: { ccp: false } }, cost_items: candidates }],
    },
    pricing_date: ON,
    currency: "INR",
  };
}

describe("cost-based: bought-in part with a source ladder", () => {
  it("prices from the RFQ reply when the ERP cost is stale, and flags the margin floor", () => {
    const r = priceDocument(mtsInput([{
      path: "purchase.unit_cost", qty: 5, kind: "PURCHASE",
      candidates: [
        { source: "ERP_COST", value: 1000, as_of: "2026-06-01" },
        { source: "RFQ", value: 980, as_of: "2026-08-20", quality: "confirmed" },
        { source: "PRICE_LIST", value: 1100 },
      ],
    }]));
    const line = r.lines[0];
    expect(line.components.PURCHASE_COST).toBe(4900);
    expect(line.subtotals.LANDED_COST).toBeCloseTo(5096);
    expect(line.components.MARGIN_MARKUP).toBeCloseTo(611.52);
    const purchase = line.trace.find((t) => t.component === "PURCHASE_COST");
    expect(purchase?.inputs?.[0]).toMatchObject({ source: "RFQ", quality: "confirmed", rate: 980 });
    expect(purchase?.inputs?.[0].considered?.find((c) => c.source === "ERP_COST")?.status).toBe("stale");
    // 12% markup is below the 15% floor: the line is flagged with the policy.
    expect(line.flags).toEqual([expect.objectContaining({ code: "MARGIN_FLOOR", policy: "block", floor_pct: 15, actual_pct: 12 })]);
  });

  it("refuses to price a part nobody has a cost for, naming the path and what was tried", () => {
    try {
      priceDocument(mtsInput([{ path: "purchase.unit_cost", qty: 5, kind: "PURCHASE", candidates: [{ source: "ERP_COST", value: 1000, as_of: "2026-01-01" }] }]));
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as PricingError;
      expect(err.code).toBe("NO_RATE_IN_FORCE");
      expect(err.details?.paths).toEqual(["purchase.unit_cost"]);
      const missing = err.details?.missing as { considered: { status: string }[] }[];
      expect(missing[0].considered[0].status).toBe("stale");
    }
  });

  it("treats a required cost step with no items as COST_MISSING, never a silent zero", () => {
    const input = mtsInput([]);
    input.procedure.steps[0].required = true;
    expect(() => priceDocument(input)).toThrow(/COST_MISSING|received no PURCHASE/);
  });
});
