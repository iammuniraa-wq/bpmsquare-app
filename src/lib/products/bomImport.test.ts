import { describe, expect, it } from "vitest";
import { planBomImport, type BomImportProduct } from "./bomImport";
import type { BomLine } from "./bom";

const P = (id: string, sku: string | null, item_type: string | null, extra: Partial<BomImportProduct> = {}): BomImportProduct => ({
  id, ref: `PRD-${id.toUpperCase()}`, sku, name: `Item ${id}`, item_type, uom: "Nos", ...extra,
});
const products = [
  P("k1", "KIT-1", "bom_kit"), P("k2", "KIT-2", "bom_kit"), P("r1", "RAW-1", "raw_material"), P("r2", "RAW-2", "raw_material", { uom: null }),
  P("f1", "FIN-1", "finished_product"), P("u1", null, null),
  P("d1", "DUP", "raw_material"), P("d2", "DUP", "raw_material"),
];
const row = (rowNum: number, values: Record<string, string>) => ({ rowNum, values });
const plan = (rows: ReturnType<typeof row>[], existing: BomLine[] = [], config = {}) => planBomImport(rows, products, existing, config);

describe("planBomImport", () => {
  it("accepts a valid row, resolving by SKU or by product ID, defaulting the unit from the component", () => {
    const [a, b] = plan([row(2, { parent: "kit-1", component: "RAW-1", qty: "3" }), row(3, { parent: "PRD-K1", component: "PRD-R2", qty: "1.5", uom: "m", scrap_pct: "5", line_kind: "Used (tool)", note: "jig" })]);
    expect(a).toMatchObject({ ok: true, parentId: "k1", componentId: "r1", fields: { qty: 3, uom: "Nos", scrap_pct: 0, line_kind: "consumed", sort_order: 0 } });
    expect(b).toMatchObject({ ok: true, componentId: "r2", fields: { qty: 1.5, uom: "m", scrap_pct: 5, line_kind: "used", note: "jig", sort_order: 1 } });
  });
  it("only a BOM / kit can be the parent, with a message that says what the item is", () => {
    const [a, b] = plan([row(2, { parent: "FIN-1", component: "RAW-1", qty: "1" }), row(3, { parent: "PRD-U1", component: "RAW-1", qty: "1" })]);
    expect(a).toMatchObject({ ok: false });
    expect((a as { reason: string }).reason).toMatch(/Finished product.*only BOM \/ kit/);
    expect((b as { reason: string }).reason).toMatch(/not classified/);
  });
  it("reports unknown and ambiguous products", () => {
    const [a, b, c] = plan([row(2, { parent: "NOPE", component: "RAW-1", qty: "1" }), row(3, { parent: "KIT-1", component: "DUP", qty: "1" }), row(4, { parent: "KIT-1", component: "", qty: "1" })]);
    expect((a as { reason: string }).reason).toMatch(/not found/);
    expect((b as { reason: string }).reason).toMatch(/more than one product/);
    expect((c as { reason: string }).reason).toMatch(/Component is required/);
  });
  it("rejects itself, a bad quantity and a duplicate pair (existing or earlier in the file)", () => {
    const existing: BomLine[] = [{ id: "L1", parent_product_id: "k1", component_product_id: "r2", qty: 1, scrap_pct: 0, line_kind: "consumed", sort_order: 0 }];
    const out = plan([
      row(2, { parent: "KIT-1", component: "KIT-1", qty: "1" }),
      row(3, { parent: "KIT-1", component: "RAW-1", qty: "0" }),
      row(4, { parent: "KIT-1", component: "RAW-2", qty: "1" }),
      row(5, { parent: "KIT-1", component: "RAW-1", qty: "1" }),
      row(6, { parent: "KIT-1", component: "RAW-1", qty: "2" }),
    ], existing);
    expect(out.map((o) => o.ok)).toEqual([false, false, false, true, false]);
    expect((out[1] as { reason: string }).reason).toMatch(/Quantity/);
    expect((out[4] as { reason: string }).reason).toMatch(/already a component/);
  });
  it("catches a loop that only exists across two rows of the file", () => {
    const out = plan([row(2, { parent: "KIT-1", component: "KIT-2", qty: "1" }), row(3, { parent: "KIT-2", component: "KIT-1", qty: "1" })]);
    expect(out[0].ok).toBe(true);
    expect(out[1]).toMatchObject({ ok: false });
    expect((out[1] as { reason: string }).reason).toMatch(/loop/);
  });
  it("catches a loop through an existing line", () => {
    const existing: BomLine[] = [{ id: "L1", parent_product_id: "k2", component_product_id: "k1", qty: 1, scrap_pct: 0, line_kind: "consumed", sort_order: 0 }];
    const [a] = plan([row(2, { parent: "KIT-1", component: "KIT-2", qty: "1" })], existing);
    expect(a).toMatchObject({ ok: false });
  });
  it("honours a renamed or custom kit label in the error text", () => {
    const [a] = plan([row(2, { parent: "FIN-1", component: "RAW-1", qty: "1" })], [], { item_types: { labels: { bom_kit: "Assembly" } } });
    expect((a as { reason: string }).reason).toMatch(/only Assembly items/);
  });
});
