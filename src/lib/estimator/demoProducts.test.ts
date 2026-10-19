import { describe, it, expect } from "vitest";
import { DEMO_PRODUCTS, DEMO_BOM, demoUnitCosts, precastVillaProductTemplate } from "./demoProducts";
import { validateTemplate } from "./template";
import { computeEstimate } from "./compute";

describe("illustrative: demo kits", () => {
  it("rolls each kit up by the products module's own function", () => {
    const c = demoUnitCosts();
    // 0.2 x 1.03 x 330 + 20 x 1.05 x 3.2 + 1 x 1.05 x 38 + 2 x 18 + 0.7 x 18 (the mould set is used, not costed)
    expect(c.get("KIT-WALL-M2")).toBe(223.68);
    expect(c.get("KIT-BOUNDARY-M2")).toBe(68.07);
    expect(c.get("KIT-FRAME-M3")).toBe(1385);
  });
  it("only kits have components, every component exists, and no SKU repeats", () => {
    const skus = DEMO_PRODUCTS.map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
    const kits = new Set(DEMO_PRODUCTS.filter((p) => p.item_type === "bom_kit").map((p) => p.sku));
    for (const l of DEMO_BOM) {
      expect(kits.has(l.kit), l.kit).toBe(true);
      expect(skus.includes(l.component), l.component).toBe(true);
      expect(l.kit).not.toBe(l.component);
    }
    for (const p of DEMO_PRODUCTS) {
      if (p.item_type === "bom_kit") expect(p.cost, p.sku).toBeUndefined();
      else expect(p.cost, p.sku).toBeGreaterThan(0);
    }
  });
});

describe("illustrative: the product-based precast villa template", () => {
  const tpl = precastVillaProductTemplate();
  const body = { geometry: tpl.geometry, inputs: tpl.inputs, rates: tpl.rates, rules: tpl.rules };

  it("validates cleanly, with nothing unused", () => {
    const v = validateTemplate(body);
    expect(v.issues).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("names only products that exist, in the unit they are sold in", () => {
    const bySku = new Map(DEMO_PRODUCTS.map((p) => [p.sku, p]));
    const alias: Record<string, string> = { nos: "nr" };
    const norm = (u: string) => alias[u.toLowerCase()] ?? u.toLowerCase();
    const named = tpl.rules.flatMap((r) => (r.cost.kind === "product" ? [{ rule: r, sku: r.cost.sku! }] : []));
    expect(named.length).toBeGreaterThanOrEqual(10);
    for (const { rule, sku } of named) {
      const p = bySku.get(sku);
      expect(p, `${rule.code} -> ${sku}`).toBeDefined();
      expect(norm(rule.uom), `${rule.code} unit`).toBe(norm(p!.uom));
    }
    // The three BOM kits are used, and the rate-priced remainder is only what is not a catalogue item.
    const kitsUsed = named.filter((n) => bySku.get(n.sku)!.item_type === "bom_kit").map((n) => n.sku).sort();
    expect(kitsUsed).toEqual(["KIT-BOUNDARY-M2", "KIT-FRAME-M3", "KIT-WALL-M2"]);
    expect(tpl.rules.filter((r) => r.cost.kind === "rate").map((r) => r.code)).toEqual(["fin", "mld", "ovh"]);
  });

  it("prices the default villa completely from the catalogue", () => {
    const costs = demoUnitCosts();
    const first = computeEstimate(validateTemplate(body).template!, {}, { margin_pct: 18, vat_pct: 15 });
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    expect(first.unpriced.sort()).toEqual(["bw", "ere", "ew", "fr", "grt", "iw", "plt", "pr", "sea", "sl", "st", "trl"]);
    const unit: Record<string, number> = {};
    for (const l of first.lines) if (l.sku) unit[l.code] = costs.get(l.sku)!;
    const r = computeEstimate(validateTemplate(body).template!, {}, { margin_pct: 18, vat_pct: 15, unit_costs: unit });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.complete).toBe(true);
    // Golden figures for the default villa (the demo seed SQL carries the same numbers).
    const cost = Object.fromEntries(r.lines.map((l) => [l.code, l.cost_total]));
    expect(cost).toMatchObject({ ew: 54112.67, sl: 43424.02, fr: 11080, st: 12400, bw: 9557.03, plt: 11645, trl: 23400, ere: 19200 });
    expect(r.summary.cost_total).toBe(258672.36);
    expect(r.summary.price_incl_vat).toBe(351018.39);
  });
});
