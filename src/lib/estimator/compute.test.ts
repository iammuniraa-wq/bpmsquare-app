import { describe, it, expect } from "vitest";
import { computeEstimate, summariseLines, roundQty, roundMoney } from "./compute";
import type { ComputeSuccess } from "./compute";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";
import type { EstimateTemplateBody, TemplateRule } from "./types";

function ok(r: ReturnType<typeof computeEstimate>): ComputeSuccess {
  if (!r.ok) throw new Error(r.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return r;
}

// GOLDEN NUMBERS for the reference villa: the starter template's DEFAULT inputs
// (2 floors, 150 m2 per floor, 50 m perimeter, 3 m walls, 0.2 m walls and
// slabs, stairs with 2 flights, 60 m x 2.4 m boundary wall, standard finish).
// Every rate in the template is an illustrative placeholder, so these figures
// pin the ARITHMETIC of the pipeline, not a real price. They were worked by
// hand, e.g. wall panels: 50 * 3 * 2 * 0.2 * (1 - 12/100) = 52.8 m3 net;
// +3% wastage = 54.384 m3 gross; * 320 = 17402.88.
const GOLDEN: [code: string, qty: number, gross: number, unit: number, cost: number][] = [
  ["ewp", 52.8, 54.384, 320, 17402.88],
  ["slb", 42, 43.26, 320, 13843.2],
  ["bem", 13.5, 13.905, 320, 4449.6],
  ["ins", 264, 271.92, 28, 7613.76],
  ["jnt", 226, 226, 12, 2712], // ceil(50/2.4)=21 panels * 3 m * 2 floors + 50 m * 2
  ["fns", 300, 300, 35, 10500],
  ["str", 1.8, 1.854, 320, 593.28],
  ["fix", 168, 168, 25, 4200], // 21 panels * 2 floors * 4 inserts
  ["bwp", 14.4, 14.832, 320, 4746.24],
  ["bwf", 7.2, 7.416, 320, 2373.12],
  ["rbr", 13170, 13565.1, 3.2, 43408.32], // 131.7 m3 total * 100 kg/m3
  ["frm", 2502.3, 2502.3, 4, 10009.2], // 131.7 * 19 m2/m3
  ["mld", 131.7, 131.7, 55, 7243.5],
  ["lab", 592.65, 592.65, 22, 13038.3], // 131.7 * 4.5 h
  ["trl", 15, 15, 1800, 27000], // ceil(131.7 * 2.4 / 22) = ceil(14.37)
  ["crn", 1, 1, 4500, 4500],
  ["ere", 131.7, 131.7, 140, 18438],
  ["ovh", 142133.4, 142133.4, 0.12, 17056.01], // 12% of the factory-side subtotals
];

describe("precast villa starter, reference villa (golden numbers)", () => {
  const r = ok(computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: 15, vat_pct: 15 }));

  it("produces exactly the expected lines in template order", () => {
    expect(r.lines.map((l) => l.code)).toEqual(GOLDEN.map((g) => g[0]));
  });

  it.each(GOLDEN)("line %s", (code, qty, gross, unit, cost) => {
    const l = r.lines.find((x) => x.code === code)!;
    expect(l.qty).toBe(qty);
    expect(l.qty_gross).toBe(gross);
    expect(l.unit_cost).toBe(unit);
    expect(l.cost_total).toBe(cost);
    expect(l.needs_price).toBe(false);
    expect(l.source).toBe("rule");
  });

  it("applies waste only where the rule asks for it", () => {
    const by = (c: string) => r.lines.find((l) => l.code === c)!;
    expect(by("ewp").waste_pct).toBe(3);
    expect(by("jnt").waste_pct).toBe(0);
    expect(by("ere").waste_pct).toBe(0);
  });

  it("drops the two unchosen finish levels and keeps going", () => {
    expect(r.lines.some((l) => l.code === "fnb" || l.code === "fnp")).toBe(false);
  });

  it("rolls up group subtotals", () => {
    const g = Object.fromEntries(r.summary.by_group.map((x) => [x.name, x.cost]));
    expect(g).toEqual({
      Structure: 35695.68,
      Envelope: 20825.76,
      "Stairs & ancillary": 4793.28,
      "Boundary wall": 7119.36,
      Production: 73699.32,
      "Transport & erection": 49938,
      Overhead: 17056.01,
    });
    expect(r.summary.by_group.map((x) => x.wbs_code)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("rolls up the cost build-up by component", () => {
    expect(r.summary.by_component).toEqual({
      materials: 111842.4,
      moulds: 17252.7,
      labour: 13038.3,
      overhead: 17056.01,
      transport: 27000,
      erection: 22938,
      other: 0,
    });
  });

  it("computes cost, margin, price and VAT", () => {
    expect(r.summary.cost_total).toBe(209127.41);
    expect(r.summary.margin_amount).toBe(31369.11); // 15% markup on cost
    expect(r.summary.price).toBe(240496.52);
    expect(r.summary.vat).toBe(36074.48);
    expect(r.summary.price_incl_vat).toBe(276571);
  });

  it("group totals and component totals both add up to the cost", () => {
    const byGroup = roundMoney(r.summary.by_group.reduce((a, g) => a + g.cost, 0));
    const byComp = roundMoney(Object.values(r.summary.by_component).reduce((a, c) => a + c, 0));
    expect(byGroup).toBe(r.summary.cost_total);
    expect(byComp).toBe(r.summary.cost_total);
  });

  it("numbers WBS codes by group then line", () => {
    expect(r.lines.find((l) => l.code === "ewp")!.wbs_code).toBe("1.1");
    expect(r.lines.find((l) => l.code === "bem")!.wbs_code).toBe("1.3");
    expect(r.lines.find((l) => l.code === "ins")!.wbs_code).toBe("2.1");
    expect(r.lines.find((l) => l.code === "ovh")!.wbs_code).toBe("7.1");
  });

  it("is complete (every line priced) and echoes normalised params", () => {
    expect(r.complete).toBe(true);
    expect(r.unpriced).toEqual([]);
    expect(r.params.floors).toBe(2);
    expect(r.params.finish_level).toBe("standard");
  });

  it("is deterministic", () => {
    const again = ok(computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: 15, vat_pct: 15 }));
    expect(JSON.stringify(again)).toBe(JSON.stringify(r));
  });
});

describe("changing inputs", () => {
  it("premium finish and no stairs", () => {
    const r = ok(computeEstimate(PRECAST_VILLA_STARTER, { finish_level: "premium", include_stairs: false }));
    const codes = r.lines.map((l) => l.code);
    expect(codes).toContain("fnp");
    expect(codes).not.toContain("fns");
    expect(codes).not.toContain("str"); // zero stairs -> no line
    expect(r.lines.find((l) => l.code === "fnp")!.cost_total).toBe(19500); // 300 m2 * 65
    // total volume 129.9 m3 -> steel 12990 kg net, +3% = 13379.7 kg, * 3.2
    expect(r.lines.find((l) => l.code === "rbr")!.qty).toBe(12990);
    expect(r.lines.find((l) => l.code === "rbr")!.cost_total).toBe(42815.04);
  });

  it("one more floor adds walls, slabs, steel and loads", () => {
    const two = ok(computeEstimate(PRECAST_VILLA_STARTER, { floors: 2 }));
    const three = ok(computeEstimate(PRECAST_VILLA_STARTER, { floors: 3 }));
    expect(three.lines.find((l) => l.code === "ewp")!.qty).toBe(79.2); // 50*3*3*0.2*0.88
    expect(three.summary.cost_total).toBeGreaterThan(two.summary.cost_total);
  });

  it("a villa with no boundary wall drops those lines and still totals", () => {
    const r = ok(computeEstimate(PRECAST_VILLA_STARTER, { boundary_wall_length_m: 0 }));
    expect(r.lines.some((l) => l.group === "Boundary wall")).toBe(false);
    expect(r.summary.by_group.some((g) => g.name === "Boundary wall")).toBe(false);
  });

  it("zero margin and zero VAT give price == cost", () => {
    const r = ok(computeEstimate(PRECAST_VILLA_STARTER, {}));
    expect(r.summary.price).toBe(r.summary.cost_total);
    expect(r.summary.vat).toBe(0);
    expect(r.summary.price_incl_vat).toBe(r.summary.cost_total);
  });
});

describe("failures are returned, never thrown", () => {
  it("reports invalid inputs", () => {
    const r = computeEstimate(PRECAST_VILLA_STARTER, { floors: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/cannot be above 4/);
  });

  it("reports an invalid template", () => {
    const bad: EstimateTemplateBody = { inputs: [], rates: [], rules: [] };
    expect(computeEstimate(bad, {}).ok).toBe(false);
  });

  it("reports margin and VAT out of range", () => {
    expect(computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: -1 }).ok).toBe(false);
    expect(computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: 5000 }).ok).toBe(false);
    expect(computeEstimate(PRECAST_VILLA_STARTER, {}, { vat_pct: 101 }).ok).toBe(false);
    expect(computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: Number.NaN }).ok).toBe(false);
  });
});

const rule = (over: Partial<TemplateRule> & { code: string }): TemplateRule => ({
  group: "G",
  description: "line",
  uom: "m",
  qty: "1",
  component: "materials",
  cost: { kind: "rate", rate: "r" },
  ...over,
});
const tpl = (rules: TemplateRule[], extra: Partial<EstimateTemplateBody> = {}): EstimateTemplateBody => ({
  inputs: [{ key: "x", label: "X", type: "number", default: 10 }],
  rates: [{ key: "r", label: "R", unit: "per m", value: 2.5 }],
  rules,
  ...extra,
});

describe("evaluation errors", () => {
  it("divide by zero in a rule is a failure naming the rule", () => {
    const r = computeEstimate(tpl([rule({ code: "a", qty: "x / (x - x)" })]), {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0].message).toMatch(/Rule "a" qty: Division by zero/);
    }
  });

  it("a negative quantity is a failure", () => {
    const r = computeEstimate(tpl([rule({ code: "a", qty: "x - 20" })]), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/negative/);
  });

  it("a waste formula that leaves 0..100 is a failure", () => {
    const r = computeEstimate(tpl([rule({ code: "a", waste_pct: "x * 20" })]), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/waste works out to 200%/);
  });
});

describe("rounding", () => {
  it("rounds quantities to 3 dp and money to 2 dp, half away from zero", () => {
    expect(roundQty(1.0005)).toBe(1.001);
    expect(roundQty(2.00049)).toBe(2);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0.125)).toBe(0.13);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });

  it("charges cost on the rounded gross quantity", () => {
    // 1/3 m3 net, 10% waste -> 0.333 net, 0.366 gross (0.3663 rounded), * 3
    const r = ok(computeEstimate(
      tpl([rule({ code: "a", qty: "1 / 3", waste_pct: 10, cost: { kind: "rate", rate: "r3" } })], {
        rates: [{ key: "r3", label: "R3", unit: "per m", value: 3 }],
      }), {}));
    const l = r.lines[0];
    expect(l.qty).toBe(0.333);
    expect(l.qty_gross).toBe(0.366);
    expect(l.cost_total).toBe(1.1); // 0.366 * 3 = 1.098
  });

  it("later formulas read the ROUNDED net quantity", () => {
    const r = ok(computeEstimate(
      tpl([
        rule({ code: "a", qty: "1 / 3" }),
        rule({ code: "b", qty: "qty_a * 3" }),
      ]), {}));
    expect(r.lines[1].qty).toBe(0.999); // 0.333 * 3, not 1
  });
});

describe("product-priced lines (two passes)", () => {
  const body = tpl([
    rule({ code: "panel", group: "Materials", qty: "x", uom: "nr", cost: { kind: "product", sku: "PNL-200" } }),
    rule({ code: "fee", group: "Fees", qty: "sub_materials", uom: "cost", cost: { kind: "rate", rate: "r" } }),
  ]);

  it("first pass leaves product lines unpriced with the SKU", () => {
    const r = ok(computeEstimate(body, {}));
    const p = r.lines.find((l) => l.code === "panel")!;
    expect(p.needs_price).toBe(true);
    expect(p.sku).toBe("PNL-200");
    expect(p.unit_cost).toBeNull();
    expect(p.cost_total).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.unpriced).toEqual(["panel"]);
    // the dependent fee line is simply absent: sub_materials was still 0
    expect(r.lines.some((l) => l.code === "fee")).toBe(false);
    expect(r.summary.cost_total).toBe(0);
  });

  it("second pass with unit costs prices them and feeds sub_ formulas", () => {
    const r = ok(computeEstimate(body, {}, { unit_costs: { panel: 12.5 } }));
    const p = r.lines.find((l) => l.code === "panel")!;
    expect(p.needs_price).toBe(false);
    expect(p.cost_total).toBe(125); // 10 * 12.5
    expect(r.complete).toBe(true);
    const fee = r.lines.find((l) => l.code === "fee")!;
    expect(fee.qty).toBe(125);
    expect(fee.cost_total).toBe(312.5); // 125 * 2.5
    expect(r.summary.cost_total).toBe(437.5);
  });

  it("ignores an invalid supplied unit cost (stays unpriced)", () => {
    const r = ok(computeEstimate(body, {}, { unit_costs: { panel: -5 } }));
    expect(r.complete).toBe(false);
  });
});

describe("element schedule quantities", () => {
  const body = tpl([
    rule({ code: "wall", qty: "x", uom: "m3", element_type: "wall_panel", waste_pct: 2 }),
    rule({ code: "after", qty: "qty_wall * 2" }),
  ]);

  it("replaces the formula, expands to one line per row and keeps downstream maths right", () => {
    const r = ok(computeEstimate(body, {}, {
      schedule: [
        { rule_code: "wall", qty: 4.5, element_ref: "W-01", label: "W-01" },
        { rule_code: "wall", qty: 6, element_ref: "W-02", label: "W-02" },
      ],
    }));
    const walls = r.lines.filter((l) => l.code === "wall");
    expect(walls).toHaveLength(2);
    expect(walls.map((l) => l.source)).toEqual(["schedule", "schedule"]);
    expect(walls.map((l) => l.element_ref)).toEqual(["W-01", "W-02"]);
    expect(walls[0].description).toBe("line - W-01");
    expect(walls[0].qty_gross).toBe(4.59); // 4.5 * 1.02
    expect(walls[0].cost_total).toBe(11.48); // 4.59 * 2.5 = 11.475
    expect(walls[1].qty_gross).toBe(6.12);
    expect(r.lines.find((l) => l.code === "after")!.qty).toBe(21); // (4.5 + 6) * 2
    expect(walls.map((l) => l.wbs_code)).toEqual(["1.1", "1.2"]);
  });

  it("falls back to the formula when the rule has no schedule rows", () => {
    const r = ok(computeEstimate(body, {}, { schedule: [] }));
    expect(r.lines.find((l) => l.code === "wall")!.qty).toBe(10);
    expect(r.lines.find((l) => l.code === "wall")!.source).toBe("rule");
  });

  it("ignores schedule quantities for rules without an element type, with a warning", () => {
    const r = ok(computeEstimate(body, {}, { schedule: [{ rule_code: "after", qty: 5, element_ref: null }, { rule_code: "ghost", qty: 1, element_ref: null }] }));
    expect(r.warnings).toHaveLength(2);
    expect(r.lines.find((l) => l.code === "after")!.qty).toBe(20);
  });

  it("rejects a negative scheduled quantity", () => {
    const r = computeEstimate(body, {}, { schedule: [{ rule_code: "wall", qty: -1, element_ref: null }] });
    expect(r.ok).toBe(false);
  });
});

describe("summariseLines", () => {
  it("totals hand-edited lines by the same rules, treating a missing component as other", () => {
    const s = summariseLines(
      [
        { group: "A", group_key: "a", component: "materials", cost_total: 100.005 },
        { group: "A", group_key: "a", component: null, cost_total: 50 },
        { group: "B", group_key: "b", component: "labour", cost_total: null },
        { group: "B", group_key: "b", component: "labour", cost_total: 10 },
      ],
      { margin_pct: 10, vat_pct: 5 }
    );
    expect(s.by_component.materials).toBe(100.01);
    expect(s.by_component.other).toBe(50);
    expect(s.by_component.labour).toBe(10);
    expect(s.cost_total).toBe(160.01);
    expect(s.by_group).toEqual([
      { key: "a", name: "A", wbs_code: "1", line_count: 2, cost: 150.01 },
      { key: "b", name: "B", wbs_code: "2", line_count: 2, cost: 10 },
    ]);
    expect(s.margin_amount).toBe(16); // 160.01 * 10%
    expect(s.price).toBe(176.01);
    expect(s.vat).toBe(8.8);
  });

  it("an empty estimate totals to zero", () => {
    const s = summariseLines([]);
    expect(s.cost_total).toBe(0);
    expect(s.price_incl_vat).toBe(0);
    expect(s.by_group).toEqual([]);
  });
});
