import { describe, it, expect } from "vitest";
import { flattenContext, computeSpecificity, resolveRules, resolveCostInput, PricingError } from "./resolution";
import type { DimensionRegistry, PriceRule } from "./types";

const REGISTRY: DimensionRegistry = {
  "customer.id": 100,
  "product.id": 80,
  "customer.tier": 30,
  "product.group": 25,
  "region": 20,
  "document_type": 15,
};

const rule = (id: string, attrs: PriceRule["match_attributes"], extra: Partial<PriceRule> = {}): PriceRule => ({
  rule_id: id,
  component_code: "CUST_DISC",
  match_attributes: attrs,
  value: -2,
  ...extra,
});

const CTX = flattenContext({
  document_type: "quote",
  region: "DACH",
  customer: { id: "c-1", tier: "A" },
  product: { id: "p-9", group: "SEALS" },
});

const DATE = "2026-08-15";

describe("flattenContext", () => {
  it("flattens nested objects to dot paths, keeps top-level scalars, skips arrays/nulls", () => {
    const flat = flattenContext({
      document_type: "service_order",
      customer: { tier: "B", tags: ["x"], meta: null },
      line: { weight_kg: 12.5 },
    });
    expect(flat).toEqual({
      document_type: "service_order",
      "customer.tier": "B",
      "line.weight_kg": 12.5,
    });
  });
});

describe("computeSpecificity", () => {
  it("sums registry weights and rejects unregistered dimensions loudly", () => {
    expect(computeSpecificity({ "customer.tier": "A", region: "DACH" }, REGISTRY)).toBe(50);
    expect(() => computeSpecificity({ colour: "red" }, REGISTRY)).toThrow(PricingError);
  });
});

describe("resolveRules — MOST_SPECIFIC", () => {
  it("picks the highest-specificity matching rule and reports candidates considered", () => {
    const candidates = [
      rule("generic", { region: "DACH" }),                                   // 20
      rule("tiered", { "customer.tier": "A", region: "DACH" }),              // 50
      rule("exact", { "customer.id": "c-1" }),                               // 100
      rule("other-customer", { "customer.id": "c-2" }),                      // no match
    ];
    const [winner] = resolveRules(candidates, CTX, REGISTRY, DATE);
    expect(winner.rule.rule_id).toBe("exact");
    expect(winner.specificity).toBe(100);
    expect(winner.candidatesConsidered).toBe(4);
  });

  it("filters by validity window (inclusive bounds)", () => {
    const candidates = [
      rule("expired", { region: "DACH" }, { valid_to: "2026-08-14" }),
      rule("future", { region: "DACH" }, { valid_from: "2026-08-16" }),
      rule("live", { region: "DACH" }, { valid_from: "2026-08-15", valid_to: "2026-08-15" }),
    ];
    const resolved = resolveRules(candidates, CTX, REGISTRY, DATE);
    expect(resolved.map((r) => r.rule.rule_id)).toEqual(["live"]);
  });

  it("returns [] when nothing matches (step simply does not apply)", () => {
    expect(resolveRules([rule("x", { region: "APAC" })], CTX, REGISTRY, DATE)).toEqual([]);
  });

  it("breaks specificity ties by most recent valid_from, then created_at", () => {
    const byValidFrom = resolveRules(
      [
        rule("older", { region: "DACH" }, { valid_from: "2026-01-01" }),
        rule("newer", { region: "DACH" }, { valid_from: "2026-08-01" }),
      ],
      CTX, REGISTRY, DATE
    );
    expect(byValidFrom[0].rule.rule_id).toBe("newer");

    const byCreated = resolveRules(
      [
        rule("created-early", { region: "DACH" }, { valid_from: "2026-08-01", created_at: "2026-08-01T10:00:00Z" }),
        rule("created-late", { region: "DACH" }, { valid_from: "2026-08-01", created_at: "2026-08-02T10:00:00Z" }),
      ],
      CTX, REGISTRY, DATE
    );
    expect(byCreated[0].rule.rule_id).toBe("created-late");
  });

  it("raises AMBIGUOUS_RULE on an unresolvable tie — never silent", () => {
    const twins = [
      rule("twin-a", { region: "DACH" }, { valid_from: "2026-08-01", created_at: "2026-08-01T10:00:00Z" }),
      rule("twin-b", { region: "DACH" }, { valid_from: "2026-08-01", created_at: "2026-08-01T10:00:00Z" }),
    ];
    expect(() => resolveRules(twins, CTX, REGISTRY, DATE)).toThrow(/AMBIGUOUS|tie/i);
  });
});

describe("resolveRules — strategies", () => {
  it("ALL_APPLY stacks every match, ordered by specificity", () => {
    const resolved = resolveRules(
      [
        rule("s1", { region: "DACH" }, { value: 5 }),
        rule("s2", { "customer.tier": "A" }, { value: 3 }),
      ],
      CTX, REGISTRY, DATE, "ALL_APPLY"
    );
    expect(resolved.map((r) => r.rule.rule_id)).toEqual(["s2", "s1"]);
  });

  it("BEST_FOR_CUSTOMER picks the lowest value and rejects non-scalar rules", () => {
    const best = resolveRules(
      [
        rule("shallow", { region: "DACH" }, { value: -2 }),
        rule("deep", { "customer.tier": "A" }, { value: -4 }),
      ],
      CTX, REGISTRY, DATE, "BEST_FOR_CUSTOMER"
    );
    expect(best[0].rule.rule_id).toBe("deep");

    const withFormula = [rule("f", { region: "DACH" }, { value: null, formula: "1+1" })];
    expect(() => resolveRules(withFormula, CTX, REGISTRY, DATE, "BEST_FOR_CUSTOMER")).toThrow(PricingError);
  });
});

describe("in-app consumers via document_type (spec §11.2 client #3)", () => {
  it("routes different rules to quote vs service_order with zero schema change", () => {
    const candidates = [
      rule("quote-disc", { document_type: "quote", region: "DACH" }, { value: -3 }),
      rule("so-surcharge", { document_type: "service_order", region: "DACH" }, { value: 8 }),
      rule("fallback", { region: "DACH" }, { value: -1 }),
    ];

    const quoteCtx = flattenContext({ document_type: "quote", region: "DACH" });
    const soCtx = flattenContext({ document_type: "service_order", region: "DACH" });
    const wfmCtx = flattenContext({ document_type: "wfm_ot", region: "DACH" });

    expect(resolveRules(candidates, quoteCtx, REGISTRY, DATE)[0].rule.rule_id).toBe("quote-disc");
    expect(resolveRules(candidates, soCtx, REGISTRY, DATE)[0].rule.rule_id).toBe("so-surcharge");
    // A module with no specific rule falls back to the generic one.
    expect(resolveRules(candidates, wfmCtx, REGISTRY, DATE)[0].rule.rule_id).toBe("fallback");
  });
});

describe("resolveCostInput (effective-date resolution, spec §3)", () => {
  const inputs = [
    { path: "material.copper_per_kg", value: 820, valid_from: "2026-07-01", valid_to: "2026-07-31" },
    { path: "material.copper_per_kg", value: 850, valid_from: "2026-08-01", valid_to: null },
    { path: "labour.electrician_hr", value: 450, valid_from: null, valid_to: null },
  ];

  it("resolves the rate in force at the pricing date", () => {
    expect(resolveCostInput(inputs, "material.copper_per_kg", "2026-07-15")).toBe(820);
    expect(resolveCostInput(inputs, "material.copper_per_kg", "2026-08-15")).toBe(850);
    expect(resolveCostInput(inputs, "labour.electrician_hr", "2026-08-15")).toBe(450);
    expect(resolveCostInput(inputs, "salvage.copper_credit_per_kg", "2026-08-15")).toBeNull();
  });

  it("prefers the most recent valid_from when windows overlap; identical windows are ambiguous", () => {
    const overlapping = [
      { path: "x", value: 1, valid_from: "2026-01-01", valid_to: null },
      { path: "x", value: 2, valid_from: "2026-06-01", valid_to: null },
    ];
    expect(resolveCostInput(overlapping, "x", "2026-08-15")).toBe(2);

    const twins = [
      { path: "x", value: 1, valid_from: "2026-06-01", valid_to: null },
      { path: "x", value: 2, valid_from: "2026-06-01", valid_to: null },
    ];
    expect(() => resolveCostInput(twins, "x", "2026-08-15")).toThrow(PricingError);
  });
});
