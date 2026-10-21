import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { priceDocument, type PriceInput, type PriceRule, type CostModel, type CostSourceDef, type CostCandidate } from "@/lib/pricing-core";
import { getMethodTemplate } from "./wizard";
import { routeToArea, quoteLineContext } from "./routing";
import { costItemsForProduct, productCostCandidate, PURCHASE_PATH } from "./costSheet";
import { flattenContext } from "@/lib/pricing-core";
import { productPriceListRule, extraDimensionWeight } from "./productPriceList";
import {
  DEMO_BOOKS, DEMO_COST_INPUTS, DEMO_DIMENSIONS, DEMO_PRODUCTS, DEMO_QTY_BREAKS, DEMO_ROUTING_RULES, PANEL_PRODUCT, renderSeedSql,
  type DemoBook,
} from "../../../scripts/pricing-demo-books";

// The demo Price Books (docs/pricing-engine-architecture.md "Demo pricing")
// priced through the same pieces a Standard Quote line uses: the line's
// context, the router, the cost sheet and the engine. The seed SQL is
// generated from this same data, and the last test fails if it drifts.

const ON = "2026-10-19";
const REGISTRY = Object.fromEntries(DEMO_DIMENSIONS.map((d) => [d.attribute, d.weight]));
const COST_SHEET_PRD0007 = [
  { path: "material.rate_per_unit", qty: 18 },
  { path: "labour.rate_per_hour", qty: 12 },
  { path: "salvage.credit_per_unit", qty: 6 },
];

type Prod = { id: string; name: string; category: string; sub: string; uom: string; list: number; cost: number; sheet?: unknown; asOf?: string | null; breaks?: unknown };

const PRODUCTS: Prod[] = [
  ...DEMO_PRODUCTS.map((p): Prod => ({ id: p.ref, ...p, sheet: p.ref === "PRD-0007" ? COST_SHEET_PRD0007 : undefined, breaks: DEMO_QTY_BREAKS[p.ref], asOf: p.ref === "PRD-0009" ? "2026-07-16" : "2026-10-16" })),
  { id: "PRD-0011", ...PANEL_PRODUCT, asOf: null },
];
const byRef = (ref: string) => PRODUCTS.find((p) => p.id === ref)!;
const panel = byRef("PRD-0011");

function bookFor(area: string): DemoBook {
  const b = DEMO_BOOKS.find((x) => x.area === area);
  if (!b) throw new Error(`No demo book for area ${area}`);
  return b;
}

function ctxFor(p: Prod, account?: { type?: string; state?: string }) {
  return quoteLineContext({
    documentType: "standard_quote",
    account: account ? { id: "acc", ...account } : null,
    product: { id: p.id, name: p.name, category: p.category, sub_category: p.sub, list_price: p.list, uom: p.uom, tax_percent: 18 },
  });
}

function priceLine(p: Prod, quantity: number, account?: { type?: string; state?: string }) {
  const ctx = ctxFor(p, account);
  const { area } = routeToArea({ rules: DEMO_ROUTING_RULES }, { ...flattenContext(ctx.header), ...flattenContext(ctx.line) });
  return priceInBook(area, p, quantity, account);
}

function priceInBook(area: string, p: Prod, quantity: number, account?: { type?: string; state?: string }) {
  const ctx = ctxFor(p, account);
  const book = bookFor(area);
  const t = getMethodTemplate(book.method);

  const rules: PriceRule[] = book.rules.map((r, i) => ({
    rule_id: `${book.area}-${i}`, component_code: r.component, match_attributes: r.match, value: r.value ?? null,
    scale: r.scale ? { entries: r.scale } : null, formula: r.formula ?? null, valid_from: r.valid_from ?? null,
  }));
  const costModels: CostModel[] = book.costModel
    ? [{
        code: book.costModel.code, name: book.costModel.name, sources: book.costModel.sources as CostSourceDef[],
        inputs: DEMO_COST_INPUTS.filter((c) => c.model === book.costModel!.code).map((c) => ({ path: c.path, kind: c.kind, value: c.value, as_of: ON })),
      }]
    : [];
  const own = productCostCandidate({ cost_price: p.cost, cost_price_as_of: p.asOf, updated_at: "2026-10-01" });
  const candidates: Record<string, CostCandidate[]> = own ? { [PURCHASE_PATH]: [own] } : {};

  // The product's own price list, exactly as the in-app line pricing adds it.
  const ownList = productPriceListRule({ components: t.components, rules }, { id: p.id, name: p.name, list_price: p.list, qty_breaks: p.breaks });
  const registry = { ...REGISTRY };
  if (ownList) for (const attr of Object.keys(ownList.match_attributes)) registry[attr] ??= extraDimensionWeight(attr, registry);

  const input: PriceInput = {
    procedure: t.procedure, components: t.components, rules: ownList ? [...rules, ownList] : rules, cost_models: costModels, registry,
    document: {
      attributes: ctx.header,
      lines: [{ line_no: 1, quantity, attributes: ctx.line, cost_items: costItemsForProduct({ cost_sheet: p.sheet, cost_price: p.cost }, quantity, candidates) }],
    },
    pricing_date: ON,
  };
  const line = priceDocument(input).lines[0];
  return { area, line, preTax: line.subtotals.NET_2 };
}

describe("demo routing", () => {
  it("sends each demo product to the book the walk-through names", () => {
    const area = (ref: string) => priceLine(byRef(ref), 1).area;
    for (const ref of ["PRD-0001", "PRD-0002", "PRD-0003", "PRD-0004", "PRD-0005", "PRD-0006"]) expect(area(ref)).toBe("catalogue_2026");
    for (const ref of ["PRD-0007", "PRD-0008", "PRD-0009"]) expect(area(ref)).toBe("cost_plus");
    expect(area("PRD-0010")).toBe("catalogue_2026"); // SPARES, but its ROPES sub-category is routed first
    expect(area("PRD-0011")).toBe("formula_pricing"); // MODERNISATION, but CABINS is routed first
  });
});

describe("Catalogue 2026 (list)", () => {
  it("prices the list price for a customer with no discount", () => {
    expect(priceLine(byRef("PRD-0001"), 1).preTax).toBe(1_850_000);
  });

  it("steps down at three units and applies the tier discount (the customer.tier requirement now holds on a quote line)", () => {
    // 3 x 1,813,000 = 5,439,000; OEM 8% off.
    const r = priceLine(byRef("PRD-0001"), 3, { type: "oem" });
    expect(r.line.components.CUST_DISC).toBeCloseTo(-435_120, 2);
    expect(r.preTax).toBeCloseTo(5_003_880, 2);
    expect(priceLine(byRef("PRD-0001"), 3, { type: "direct" }).preTax).toBeCloseTo(5_439_000 * 0.95, 2);
  });

  it("gives a multi-year AMC its own band", () => {
    expect(priceLine(byRef("PRD-0005"), 1).preTax).toBe(96_000);
    expect(priceLine(byRef("PRD-0005"), 3, { type: "direct" }).preTax).toBeCloseTo(91_200 * 3 * 0.95, 2);
    expect(priceLine(byRef("PRD-0006"), 5).preTax).toBe(48_600 * 5);
  });

  it("charges tax on top, which the quote line leaves to the header", () => {
    const r = priceLine(byRef("PRD-0003"), 1);
    expect(r.line.components.TAX).toBeCloseTo(207_000, 2);
    expect(r.line.net).toBeCloseTo(1_357_000, 2);
  });
});

describe("Wire rope: the product's own price list in the Catalogue book", () => {
  const rope = byRef("PRD-0010");

  it("steps down by the product's quantity breaks with no rule in the book", () => {
    expect(priceLine(rope, 40).preTax).toBe(40 * 420);
    expect(priceLine(rope, 150).preTax).toBe(150 * 390);
    expect(priceLine(rope, 600).preTax).toBe(600 * 360);
  });

  it("names the product's price list and the band in the trace", () => {
    const step = priceLine(rope, 150).line.trace.find((t) => t.component === "LIST_PRICE");
    expect(step?.rule_id).toBe("product:PRD-0010:price-list");
    expect(step?.scale_from).toBe(100);
  });

  it("takes the tier discount like any list-priced product, and the regional uplift no longer applies", () => {
    expect(priceLine(rope, 150, { type: "oem" }).preTax).toBeCloseTo(58_500 * 0.92, 2);
    expect(priceLine(rope, 150, { type: "direct" }).preTax).toBeCloseTo(58_500 * 0.95, 2);
    expect(priceLine(rope, 150, { type: "direct", state: "Maharashtra" }).preTax).toBeCloseTo(58_500 * 0.95, 2);
  });

  it("is set on the demo product by seed-products-demo.sql", () => {
    const sql = readFileSync(join(__dirname, "../../../scripts/seed-products-demo.sql"), "utf8");
    const set = /qty_breaks = '(\[[^']*\])'::jsonb/.exec(sql);
    expect(set).not.toBeNull();
    expect(JSON.parse(set![1])).toEqual(DEMO_QTY_BREAKS["PRD-0010"]);
    expect(sql).toMatch(/list_price = 420\.00/);
  });
});

describe("Formula pricing", () => {
  it("prices a panel as rate per m2 times area, with an area discount and a job minimum", () => {
    expect(priceLine(panel, 30).preTax).toBe(30 * 5200);
    expect(priceLine(panel, 60).preTax).toBe(287_040); // 60 x 5,200 x 0.92
    expect(priceLine(panel, 2).preTax).toBe(18_000);   // 10,400 would be under the minimum
    expect(priceLine(panel, 30, { type: "direct", state: "Maharashtra" }).preTax).toBe(162_240);
  });

  it("shows the formula and the values it read in the trace", () => {
    const step = priceLine(panel, 30).line.trace.find((t) => t.component === "MATERIAL_RATE");
    expect(step?.status).toBe("APPLIED");
    expect(step?.formula).toContain("ctx.cost.material.ss_panel_per_m2");
    expect(step?.values_used?.map((v) => v.path)).toContain("ctx.cost.material.ss_panel_per_m2");
  });

  it("an OEM gets 5% off a formula price, and the 0% floor raises no flag", () => {
    const r = priceLine(panel, 30, { type: "oem" });
    expect(r.preTax).toBeCloseTo(30 * 5200 * 0.95, 2);
    expect(r.line.flags).toEqual([]);
  });

  it("falls back to the catalogue price on the product when no formula is written for it", () => {
    const other: Prod = { id: "PRD-X", name: "Spare thing", category: "SPARES", sub: "OTHER", uom: "Nos", list: 1000, cost: 700 };
    expect(priceInBook("formula_pricing", other, 4).preTax).toBe(4000);
  });
});

describe("Cost plus", () => {
  it("adds the 25% default markup to a bought-in product's cost", () => {
    const r = priceLine(byRef("PRD-0008"), 2);
    expect(r.line.subtotals.TOTAL_COST).toBe(530_000);
    expect(r.line.subtotals.NET_1).toBeCloseTo(662_500, 2);
    expect(r.preTax).toBeCloseTo(662_500, 2);
    expect(r.line.flags).toEqual([]);
  });

  it("uses a different markup for spares, and still prices an ERP cost that is 95 days old", () => {
    expect(priceLine(byRef("PRD-0009"), 1).preTax).toBeCloseTo(82_000 * 1.35, 2);
  });

  it("builds a made part's cost from its cost sheet, then marks services up 40%", () => {
    // 18 x 1,250 + 12 x 1,800 - 6 x 1,200 = 36,900
    const r = priceLine(byRef("PRD-0007"), 1);
    expect(r.line.subtotals.TOTAL_COST).toBe(36_900);
    expect(r.preTax).toBeCloseTo(36_900 * 1.4, 2);
  });

  it("gives an OEM 3% off after the markup", () => {
    expect(priceLine(byRef("PRD-0008"), 1, { type: "oem" }).preTax).toBeCloseTo(331_250 * 0.97, 2);
  });

  it("names where the cost came from in the trace", () => {
    const step = priceLine(byRef("PRD-0008"), 1).line.trace.find((t) => t.component === "PURCHASE_COST");
    expect(step?.inputs?.[0]).toMatchObject({ path: PURCHASE_PATH, source: "PRODUCT_COST", quality: "actual", rate: 265_000 });
  });
});

describe("the seed script", () => {
  it("is exactly what the generator renders from the books (re-run: npx jiti scripts/gen-pricing-demo-seed.ts)", () => {
    const onDisk = readFileSync(join(__dirname, "../../../scripts/seed-pricing-demo.sql"), "utf8").replace(/\r\n/g, "\n");
    expect(onDisk).toBe(renderSeedSql());
  });

  it("names every area it routes to as a book it creates", () => {
    const areas = new Set(DEMO_BOOKS.map((b) => b.area));
    for (const r of DEMO_ROUTING_RULES) expect(areas.has(r.area)).toBe(true);
  });
});
