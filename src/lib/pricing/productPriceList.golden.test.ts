import { describe, it, expect } from "vitest";
import { priceDocument, type PriceInput, type PriceRule } from "@/lib/pricing-core";
import { getMethodTemplate } from "./wizard";
import { extraDimensionWeight, isProductPriceListRuleId, productPriceListRule, productPriceListRuleId } from "./productPriceList";

// Golden scenarios for a product's own price list (docs/pricing-engine-
// architecture.md §21): the Price list template's LIST_PRICE component, the
// rule the adapter synthesises from products.list_price + qty_breaks, and the
// same engine a quote line uses. Wire rope: 420 per metre, 390 from 100,
// 360 from 500.

const T = getMethodTemplate("price_list");
const ON = "2026-10-20";
const ROPE = { id: "p-rope", sku: "PRT-ROPE-13", name: "Wire Rope 13mm (per metre)", list_price: 420, qty_breaks: [{ from: 100, rate: 390 }, { from: 500, rate: 360 }] };

const rule = (id: string, component: string, value: number, match: Record<string, string> = {}): PriceRule =>
  ({ rule_id: id, component_code: component, match_attributes: match, value });

/** A book's own LIST_PRICE rule: a flat price expressed as a one-tier scale. */
const listRule = (id: string, value: number, match: Record<string, string> = {}): PriceRule =>
  ({ rule_id: id, component_code: "LIST_PRICE", match_attributes: match, value: null, scale: { entries: [{ from: 0, value }] } });

// A book with no LIST_PRICE rule for the rope: only a catch-all list price for
// anything else, the discount, freight and tax.
const BOOK_RULES: PriceRule[] = [
  listRule("catch-all", 1000),
  rule("disc", "CUST_DISC", 0),
  rule("fr", "FREIGHT", 0),
  rule("tx", "TAX", 18),
];
const REGISTRY = Object.fromEntries(T.dimensions.map((d) => [d.attribute, d.weight]));

type TestProduct = { id: string; sku: string; name: string; list_price: number | null; qty_breaks: unknown };

function price(product: TestProduct, quantity: number, bookRules: PriceRule[] = BOOK_RULES, bookRegistry = REGISTRY) {
  const own = productPriceListRule({ components: T.components, rules: bookRules }, product);
  const registry = { ...bookRegistry };
  if (own) for (const attr of Object.keys(own.match_attributes)) registry[attr] ??= extraDimensionWeight(attr, registry);
  const input: PriceInput = {
    procedure: T.procedure,
    components: T.components,
    rules: own ? [...bookRules, own] : bookRules,
    cost_models: [],
    registry,
    document: {
      attributes: { document_type: "standard_quote" },
      lines: [{ line_no: 1, quantity, attributes: { "product.id": product.id, "product.base_model": product.name } }],
    },
    pricing_date: ON,
  };
  const line = priceDocument(input).lines[0];
  return { own, line, unit: line.components.LIST_PRICE / quantity };
}

describe("a product's own price list as an engine rule", () => {
  it("prices the list price below the first break, the break rate from it", () => {
    expect(price(ROPE, 40).unit).toBe(420);
    expect(price(ROPE, 99).unit).toBe(420);
    expect(price(ROPE, 100).unit).toBe(390);
    expect(price(ROPE, 150).unit).toBe(390);
    expect(price(ROPE, 500).unit).toBe(360);
    expect(price(ROPE, 2000).unit).toBe(360);
  });

  it("totals the line at the band's rate for the whole quantity (tiered, not graduated)", () => {
    expect(price(ROPE, 150).line.components.LIST_PRICE).toBe(58_500);
    expect(price(ROPE, 150).line.subtotals.NET_1).toBe(58_500);
  });

  it("skips a band with no rate: the previous band carries on", () => {
    const withBlank = { ...ROPE, qty_breaks: [{ from: 100, rate: 390 }, { from: 200, rate: null }, { from: 500, rate: 360 }] };
    expect(price(withBlank, 250).unit).toBe(390);
    expect(price(withBlank, 600).unit).toBe(360);
    expect(price(withBlank, 40).own?.scale?.entries).toEqual([{ from: 0, value: 420 }, { from: 100, value: 390 }, { from: 500, value: 360 }]);
  });

  it("makes the rule for the call only, with a rule id that names the product", () => {
    const { own } = price(ROPE, 150);
    expect(own).toMatchObject({ rule_id: "product:p-rope:price-list", component_code: "LIST_PRICE", match_attributes: { "product.id": "p-rope" } });
    expect(isProductPriceListRuleId(own!.rule_id)).toBe(true);
    expect(isProductPriceListRuleId("3f0c1c8e-aaaa-bbbb-cccc-123456789012")).toBe(false);
    expect(productPriceListRuleId("x")).toBe("product:x:price-list");
  });

  it("records which band priced the line, for the why chip", () => {
    const step = price(ROPE, 150).line.trace.find((t) => t.component === "LIST_PRICE")!;
    expect(step.rule_id).toBe("product:p-rope:price-list");
    expect(step.scale_from).toBe(100);
    expect(price(ROPE, 40).line.trace.find((t) => t.component === "LIST_PRICE")!.scale_from).toBe(0);
  });

  it("outranks a catch-all list price in the book but not a rule the book wrote for the product", () => {
    expect(price(ROPE, 40).unit).toBe(420); // not the book's catch-all 1000

    const named = [...BOOK_RULES, listRule("rope-by-id", 500, { "product.id": "p-rope" })];
    const byId = price(ROPE, 150, named, { ...REGISTRY, "product.id": 100 });
    expect(byId.own).toBeNull();
    expect(byId.unit).toBe(500);

    const byModel = [...BOOK_RULES, listRule("rope-by-name", 480, { "product.base_model": ROPE.name })];
    const named2 = price(ROPE, 150, byModel, { ...REGISTRY, "product.base_model": 60 });
    expect(named2.own).toBeNull();
    expect(named2.unit).toBe(480);

    const bySku = [...BOOK_RULES, listRule("rope-by-sku", 470, { "product.sku": ROPE.sku })];
    expect(productPriceListRule({ components: T.components, rules: bySku }, ROPE)).toBeNull();
  });

  it("does not inject a rule for another product's book rule", () => {
    const other = [...BOOK_RULES, listRule("other", 99, { "product.id": "someone-else" })];
    expect(productPriceListRule({ components: T.components, rules: other }, ROPE)).not.toBeNull();
  });

  it("injects nothing without a list price, or when the book has no quantity-scaled price", () => {
    expect(productPriceListRule({ components: T.components, rules: BOOK_RULES }, { ...ROPE, list_price: null })).toBeNull();
    expect(productPriceListRule({ components: T.components, rules: BOOK_RULES }, { ...ROPE, list_price: 0 })).toBeNull();
    const costBased = getMethodTemplate("cost_based");
    expect(productPriceListRule({ components: costBased.components, rules: [] }, ROPE)).toBeNull();
  });

  it("a product with a list price and no breaks prices at the list price for any quantity", () => {
    const flat = { ...ROPE, qty_breaks: null };
    expect(price(flat, 1).unit).toBe(420);
    expect(price(flat, 900).unit).toBe(420);
  });

  it("weights the product above its family of dimensions, so it outranks a category or model grouping", () => {
    expect(extraDimensionWeight("product.id", { "product.base_model": 60, "product.category": 30, "customer.id": 100 })).toBe(61);
    expect(extraDimensionWeight("product.id", { "customer.id": 100 })).toBe(1);
  });

  it("still takes the book's customer discount and tax after the product's list price", () => {
    const withDisc = BOOK_RULES.map((r) => (r.rule_id === "disc" ? rule("disc", "CUST_DISC", 5, { "customer.tier": "direct" }) : r));
    const own = productPriceListRule({ components: T.components, rules: withDisc }, ROPE)!;
    const input: PriceInput = {
      procedure: T.procedure, components: T.components, rules: [...withDisc, own], registry: { ...REGISTRY, "product.id": 61 }, cost_models: [],
      document: { attributes: { document_type: "standard_quote", customer: { tier: "direct" } }, lines: [{ line_no: 1, quantity: 150, attributes: { "product.id": ROPE.id } }] },
      pricing_date: ON,
    };
    const l = priceDocument(input).lines[0];
    expect(l.subtotals.NET_1).toBeCloseTo(58_500 * 0.95, 2);
    expect(l.components.TAX).toBeCloseTo(58_500 * 0.95 * 0.18, 2);
  });
});
