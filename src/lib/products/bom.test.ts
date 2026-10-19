import { describe, expect, it } from "vitest";
import {
  MAX_BOM_DEPTH, depthIfAdded, rollUpBom, roundHalfAway, wouldCreateCycle,
  type BomLine, type BomProduct,
} from "./bom";

let n = 0;
const prod = (id: string, cost: number | null, extra: Partial<BomProduct> = {}): BomProduct => ({
  id, name: `Item ${id}`, sku: `SKU-${id}`, item_type: "raw_material", cost_price: cost, cost_price_as_of: "2026-10-01", ...extra,
});
const kit = (id: string): BomProduct => prod(id, null, { item_type: "bom_kit" });
const line = (parent: string, component: string, qty: number, extra: Partial<BomLine> = {}): BomLine => ({
  id: `L${++n}`, parent_product_id: parent, component_product_id: component, qty, scrap_pct: 0, line_kind: "consumed", sort_order: n, ...extra,
});

function setup(products: BomProduct[], lines: BomLine[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  return {
    getProduct: (id: string) => byId.get(id),
    getLines: (id: string) => lines.filter((l) => l.parent_product_id === id),
    lines,
  };
}

describe("rounding", () => {
  it("rounds half away from zero, without the 1.005 float trap", () => {
    expect(roundHalfAway(1.005, 2)).toBe(1.01);
    expect(roundHalfAway(2.5, 0)).toBe(3);
    expect(roundHalfAway(-2.5, 0)).toBe(-3);
    expect(roundHalfAway(-1.005, 2)).toBe(-1.01);
    expect(roundHalfAway(0.00005, 4)).toBe(0.0001);
    expect(roundHalfAway(1e-7, 2)).toBe(0);
  });
});

describe("single level", () => {
  it("adds qty x unit cost per consumed line", () => {
    const { getProduct, getLines } = setup(
      [kit("K"), prod("a", 10), prod("b", 2.5)],
      [line("K", "a", 3), line("K", "b", 4)]
    );
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.total).toBe(40); // 30 + 10
    expect(r.incomplete).toBe(false);
    expect(r.depth).toBe(1);
    expect(r.lines.map((l) => [l.name, l.qty, l.unitCost, l.lineCost, l.source])).toEqual([
      ["Item a", 3, 10, 30, "stored"],
      ["Item b", 4, 2.5, 10, "stored"],
    ]);
  });
  it("is zero and complete for a kit with no lines", () => {
    const { getProduct, getLines } = setup([kit("K")], []);
    expect(rollUpBom("K", getProduct, getLines)).toMatchObject({ total: 0, incomplete: false, depth: 1, lines: [] });
  });
});

describe("scrap", () => {
  it("raises the quantity consumed by the scrap percentage", () => {
    const { getProduct, getLines } = setup([kit("K"), prod("a", 100)], [line("K", "a", 2, { scrap_pct: 5 })]);
    expect(rollUpBom("K", getProduct, getLines).total).toBe(210);
  });
});

describe("consumed vs used", () => {
  it("lists a tool but adds nothing for it, and does not count a costless tool as missing", () => {
    const { getProduct, getLines } = setup(
      [kit("K"), prod("a", 10), prod("tool", 999, { item_type: "tool_equipment" }), prod("jig", null, { item_type: "tool_equipment" })],
      [line("K", "a", 1), line("K", "tool", 1, { line_kind: "used" }), line("K", "jig", 1, { line_kind: "used" })]
    );
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.total).toBe(10);
    expect(r.incomplete).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[1]).toMatchObject({ lineKind: "used", unitCost: 999, lineCost: 0 });
  });
});

describe("missing costs", () => {
  it("never treats a costless component as zero", () => {
    const { getProduct, getLines } = setup([kit("K"), prod("a", 10), prod("x", null)], [line("K", "a", 1), line("K", "x", 5)]);
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.total).toBe(10);
    expect(r.incomplete).toBe(true);
    expect(r.missing).toEqual([{ id: "x", name: "Item x", sku: "SKU-x", parentId: "K" }]);
    expect(r.lines[1]).toMatchObject({ unitCost: null, lineCost: null, source: "missing" });
  });
  it("treats a deleted component as missing", () => {
    const { getProduct, getLines } = setup([kit("K")], [line("K", "ghost", 1)]);
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.incomplete).toBe(true);
    expect(r.missing[0].name).toBe("(item not found)");
  });
  it("a nested kit's missing component makes the parent incomplete too, listed once", () => {
    const { getProduct, getLines } = setup(
      [kit("K"), kit("S"), prod("a", 1), prod("x", null)],
      [line("K", "S", 1), line("K", "x", 1), line("S", "x", 1), line("S", "a", 4)]
    );
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.incomplete).toBe(true);
    expect(r.missing.map((m) => m.id)).toEqual(["x"]);
    expect(r.total).toBe(4);
  });
});

describe("multi-level", () => {
  it("uses a nested kit's rolled-up cost, not its stored one", () => {
    const sub = { ...kit("S"), cost_price: 1 }; // a stale stored cost must be ignored
    const { getProduct, getLines } = setup(
      [kit("K"), sub, prod("a", 10), prod("b", 5)],
      [line("K", "S", 2), line("S", "a", 1), line("S", "b", 2, { scrap_pct: 10 })]
    );
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.lines[0]).toMatchObject({ unitCost: 21, lineCost: 42, source: "rolled_up" });
    expect(r.lines[0].sub?.total).toBe(21);
    expect(r.total).toBe(42);
    expect(r.depth).toBe(2);
  });
  it("falls back to the stored cost for a kit with no lines yet", () => {
    const empty = { ...kit("S"), cost_price: 7 };
    const { getProduct, getLines } = setup([kit("K"), empty], [line("K", "S", 3)]);
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.total).toBe(21);
    expect(r.lines[0].source).toBe("stored");
  });
  it("reports the oldest cost date and undated costs", () => {
    const { getProduct, getLines } = setup(
      [kit("K"), kit("S"), prod("a", 1, { cost_price_as_of: "2026-09-01" }), prod("b", 1, { cost_price_as_of: "2026-10-05T10:00:00Z" }), prod("c", 1, { cost_price_as_of: null })],
      [line("K", "S", 1), line("K", "a", 1), line("S", "b", 1), line("S", "c", 1)]
    );
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.asOf).toBe("2026-09-01");
    expect(r.undated).toBe(1);
  });
  it("counts a shared sub-kit in a diamond once per use, and stays fast", () => {
    const products = [kit("K"), kit("L"), kit("R"), kit("S"), prod("a", 3)];
    const { getProduct, getLines } = setup(products, [line("K", "L", 1), line("K", "R", 1), line("L", "S", 2), line("R", "S", 3), line("S", "a", 1)]);
    expect(rollUpBom("K", getProduct, getLines).total).toBe(15);
  });
});

describe("cycles", () => {
  it("reports a loop instead of recursing forever, and is incomplete", () => {
    const { getProduct, getLines } = setup([kit("A"), kit("B"), prod("x", 1)], [line("A", "B", 1), line("B", "A", 1), line("B", "x", 1)]);
    const r = rollUpBom("A", getProduct, getLines);
    expect(r.errors[0]).toMatchObject({ kind: "cycle" });
    expect(r.incomplete).toBe(true);
  });
  it("wouldCreateCycle: itself, a direct parent, a distant ancestor, and an unrelated item", () => {
    const { getLines } = setup([], [line("A", "B", 1), line("B", "C", 1)]);
    expect(wouldCreateCycle("A", "A", getLines)).toBe(true);
    expect(wouldCreateCycle("B", "A", getLines)).toBe(true);
    expect(wouldCreateCycle("C", "A", getLines)).toBe(true);
    expect(wouldCreateCycle("A", "C", getLines)).toBe(false); // diamond shortcut is fine
    expect(wouldCreateCycle("C", "Z", getLines)).toBe(false);
  });
});

describe("depth cap", () => {
  const chain = (kits: number) => {
    const products: BomProduct[] = [prod("leaf", 1)];
    const lines: BomLine[] = [];
    for (let i = 1; i <= kits; i++) {
      products.push(kit(`k${i}`));
      lines.push(line(`k${i}`, i === kits ? "leaf" : `k${i + 1}`, 1));
    }
    return setup(products, lines);
  };
  it("allows eight levels of kits", () => {
    const { getProduct, getLines } = chain(MAX_BOM_DEPTH);
    const r = rollUpBom("k1", getProduct, getLines);
    expect(r.errors).toEqual([]);
    expect(r.depth).toBe(8);
    expect(r.total).toBe(1);
  });
  it("refuses a ninth level and flags the roll-up incomplete", () => {
    const { getProduct, getLines } = chain(MAX_BOM_DEPTH + 1);
    const r = rollUpBom("k1", getProduct, getLines);
    expect(r.errors[0]).toMatchObject({ kind: "depth" });
    expect(r.incomplete).toBe(true);
  });
  it("depthIfAdded counts levels above the parent, the parent, and below the component", () => {
    const { lines } = chain(3); // k1 > k2 > k3 > leaf
    expect(depthIfAdded("k3", "leaf", lines)).toBe(3);
    expect(depthIfAdded("kX", "k1", lines)).toBe(1 + 3);
    expect(depthIfAdded("k2", "leaf", lines)).toBe(2);
  });
});

describe("money and unit-cost rounding", () => {
  it("rounds each line to 2 dp half away from zero and unit costs to 4 dp", () => {
    const { getProduct, getLines } = setup([kit("K"), prod("a", 0.33335), prod("b", 1.005)], [line("K", "a", 3), line("K", "b", 1)]);
    const r = rollUpBom("K", getProduct, getLines);
    expect(r.lines[0].unitCost).toBe(0.3334);
    expect(r.lines[0].lineCost).toBe(1); // 3 x 0.3334 = 1.0002
    expect(r.lines[1].lineCost).toBe(1.01); // 1.005 -> 1.01, not 1
    expect(r.total).toBe(2.01);
  });
  it("rounds a fractional-scrap line half up", () => {
    const { getProduct, getLines } = setup([kit("K"), prod("a", 2.5)], [line("K", "a", 1, { scrap_pct: 0 })]);
    expect(rollUpBom("K", getProduct, getLines).total).toBe(2.5);
    const t = setup([kit("K"), prod("a", 0.25)], [line("K", "a", 2, { scrap_pct: 1 })]);
    expect(rollUpBom("K", t.getProduct, t.getLines).total).toBe(0.51); // 0.505 -> 0.51
  });
});
