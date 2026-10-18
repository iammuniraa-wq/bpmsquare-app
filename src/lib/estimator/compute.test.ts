import { describe, it, expect } from "vitest";
import { computeEstimate, summariseLines, roundQty, roundMoney } from "./compute";
import type { ComputeSuccess } from "./compute";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";
import type { EstimateTemplateBody, TemplateRule } from "./types";

function ok(r: ReturnType<typeof computeEstimate>): ComputeSuccess {
  if (!r.ok) throw new Error(r.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return r;
}

// GOLDEN NUMBERS for the reference villa: the starter template defaults
// (2 floors, 150 m2 per floor, 50 m perimeter, 3 m walls, 0.2 m external
// walls, 2 stair flights, 60 m x 2.4 m boundary wall, standard finish), priced
// from the exact piece model (137 pieces, 130.897 m3). The rates are the
// mock-up rates, so the result is checked against the mock-up calc()
// (docs/estimator-reference): cost 174256.34 / price 205622.49 / total
// 236465.86 there; here 174256.59 / 205622.78 / 236466.20. The 25 to 34 cents
// of difference is only that this pipeline rounds every line to the cent and
// every piece total to 3 decimals, where the mock-up carries full floats.
// Every rate is an illustrative placeholder, so the figures pin the ARITHMETIC
// of the pipeline, not a real price. Worked by hand, e.g. wall panels:
// vol_EW 48.384 m3 * 330 = 15966.72; steel: 130.897 m3 * 100 kg = 13089.7 kg * 3.2 = 41887.04.
const GOLDEN: [code: string, qty: number, gross: number, unit: number, cost: number][] = [
  ["iw", 14.868, 14.868, 330, 4906.44],
  ["sl", 37.135, 37.135, 330, 12254.55],
  ["fr", 8, 8, 330, 2640],
  ["ew", 48.384, 48.384, 330, 15966.72],
  ["pr", 5.27, 5.27, 330, 1739.1],
  ["fin", 5.416, 5.416, 330, 1787.28], // (48.384 + 5.27 + 14.04) * (1.08 - 1)
  ["st", 3.2, 3.2, 330, 1056],
  ["bw", 14.04, 14.04, 330, 4633.2],
  ["rbr", 13089.7, 13089.7, 3.2, 41887.04],
  ["mld", 130.897, 130.897, 90, 11780.73],
  ["lab", 458.14, 458.14, 18, 8246.52], // 130.897 * 3.5 h
  ["ins", 217.728, 217.728, 38, 8273.66], // 241.92 m2 of wall face * 0.9
  ["fix", 110, 110, 65, 7150], // ceil(130.897 / 1.2)
  ["trl", 13, 13, 1800, 23400], // ceil(314.153 t / 25 t)
  ["ere", 130.897, 130.897, 120, 15707.64],
  ["ovh", 106897.58, 106897.58, 0.12, 12827.71], // 12% of envelope + structure + stairs + boundary + production
];

describe("precast villa starter, reference villa (golden numbers)", () => {
  const r = ok(computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: 18, vat_pct: 15 }));

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

  it("builds the exact piece model it prices from", () => {
    expect(r.model?.geometry).toBe("precast_villa");
    expect(r.model?.pieces).toHaveLength(137);
    expect(r.warnings).toEqual([]);
  });

  it("marks piece-backed lines with their piece ranges and leaves building-wide lines blank", () => {
    const ref = (c: string) => r.lines.find((l) => l.code === c)!.element_ref;
    expect(ref("ew")).toBe("EW-01..EW-40");
    expect(ref("sl")).toBe("SL-01..SL-26");
    expect(ref("st")).toBe("ST-01..ST-02");
    expect(ref("ins")).toBe("EW-01..EW-40");
    expect(ref("fin")).toBe("EW-01..EW-40, PR-01..PR-20, BW-01..BW-25");
    for (const c of ["rbr", "mld", "lab", "fix", "trl", "ere", "ovh"]) expect(ref(c), c).toBeNull();
  });

  it("the BOM concrete lines sum to the model volume", () => {
    const concrete = ["ew", "pr", "iw", "sl", "fr", "st", "bw"].reduce((a, c) => a + r.lines.find((l) => l.code === c)!.qty, 0);
    const modelVol = r.model!.pieces.reduce((a, p) => a + p.vol, 0);
    expect(Math.abs(concrete - modelVol)).toBeLessThan(0.005);
  });

  it("rolls up group subtotals", () => {
    const g = Object.fromEntries(r.summary.by_group.map((x) => [x.name, x.cost]));
    expect(g).toEqual({
      "External walls and parapet": 19493.1,
      "Structure (floors, beams, inner walls)": 19800.99,
      Stairs: 1056,
      "Boundary wall": 4633.2,
      Production: 61914.29,
      "Insulation and fixings": 15423.66,
      "Delivery and erection": 39107.64,
      Overhead: 12827.71,
    });
    expect(r.summary.by_group.map((x) => x.wbs_code)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("names the sections in plain words, in the order a customer reads them", () => {
    expect(r.summary.by_group.map((x) => x.name)).toEqual([
      "Structure (floors, beams, inner walls)", "External walls and parapet", "Stairs", "Boundary wall",
      "Production", "Insulation and fixings", "Delivery and erection", "Overhead",
    ]);
  });

  it("rolls up the cost build-up by component", () => {
    expect(r.summary.by_component).toEqual({
      materials: 102293.99,
      moulds: 11780.73,
      labour: 8246.52,
      overhead: 12827.71,
      transport: 23400,
      erection: 15707.64,
      other: 0,
    });
  });

  it("computes cost, margin, price and VAT, within cents of the mock-up", () => {
    expect(r.summary.cost_total).toBe(174256.59);
    expect(r.summary.margin_amount).toBe(31366.19); // 18% markup on cost
    expect(r.summary.price).toBe(205622.78);
    expect(r.summary.vat).toBe(30843.42);
    expect(r.summary.price_incl_vat).toBe(236466.2);
    expect(Math.abs(r.summary.cost_total - 174256.34)).toBeLessThan(0.5);
    expect(Math.abs(r.summary.price_incl_vat - 236465.86)).toBeLessThan(0.5);
  });

  it("group totals and component totals both add up to the cost", () => {
    const byGroup = roundMoney(r.summary.by_group.reduce((a, g) => a + g.cost, 0));
    const byComp = roundMoney(Object.values(r.summary.by_component).reduce((a, c) => a + c, 0));
    expect(byGroup).toBe(r.summary.cost_total);
    expect(byComp).toBe(r.summary.cost_total);
  });

  it("numbers WBS codes by group then line", () => {
    expect(r.lines.find((l) => l.code === "iw")!.wbs_code).toBe("1.1");
    expect(r.lines.find((l) => l.code === "ew")!.wbs_code).toBe("2.1");
    expect(r.lines.find((l) => l.code === "fin")!.wbs_code).toBe("2.3");
    expect(r.lines.find((l) => l.code === "ovh")!.wbs_code).toBe("8.1");
  });

  it("is complete (every line priced) and echoes normalised params", () => {
    expect(r.complete).toBe(true);
    expect(r.unpriced).toEqual([]);
    expect(r.params.floors).toBe(2);
    expect(r.params.finish_level).toBe("standard");
  });

  it("is deterministic", () => {
    const again = ok(computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: 18, vat_pct: 15 }));
    expect(JSON.stringify(again)).toBe(JSON.stringify(r));
  });
});

describe("changing inputs", () => {
  it("premium finish and no stairs", () => {
    const r = ok(computeEstimate(PRECAST_VILLA_STARTER, { finish_level: "premium", include_stairs: false }));
    const codes = r.lines.map((l) => l.code);
    expect(codes).not.toContain("st"); // no flights -> no stair pieces -> no line
    // finish premium: (48.384 + 5.27 + 14.04) m3 of visible faces * 0.18 = 12.185 m3 * 330
    expect(r.lines.find((l) => l.code === "fin")!.qty).toBe(12.185);
    expect(r.lines.find((l) => l.code === "fin")!.cost_total).toBe(4021.05);
    // total volume drops by the stairs: 130.897 - 3.2 = 127.697 m3
    expect(r.lines.find((l) => l.code === "mld")!.qty).toBe(127.697);
    expect(r.lines.find((l) => l.code === "rbr")!.qty).toBe(12769.7);
    expect(r.model!.pieces).toHaveLength(135);
  });

  it("basic finish drops the premium line", () => {
    const r = ok(computeEstimate(PRECAST_VILLA_STARTER, { finish_level: "basic" }));
    expect(r.lines.some((l) => l.code === "fin")).toBe(false);
  });

  it("one more floor adds pieces, steel and loads", () => {
    const two = ok(computeEstimate(PRECAST_VILLA_STARTER, { floors: 2 }));
    const three = ok(computeEstimate(PRECAST_VILLA_STARTER, { floors: 3 }));
    expect(three.model!.pieces.length).toBeGreaterThan(two.model!.pieces.length);
    expect(three.lines.find((l) => l.code === "ew")!.qty).toBeGreaterThan(two.lines.find((l) => l.code === "ew")!.qty);
    expect(three.summary.cost_total).toBeGreaterThan(two.summary.cost_total);
  });

  it("a villa with no boundary wall drops those lines, the group and the erection step", () => {
    const r = ok(computeEstimate(PRECAST_VILLA_STARTER, { boundary_wall_length_m: 0 }));
    expect(r.lines.some((l) => l.group === "Boundary wall")).toBe(false);
    expect(r.summary.by_group.some((g) => g.name === "Boundary wall")).toBe(false);
    expect(r.model!.step_names).not.toContain("Boundary wall");
  });

  it("zero margin and zero VAT give price == cost", () => {
    const r = ok(computeEstimate(PRECAST_VILLA_STARTER, {}));
    expect(r.summary.price).toBe(r.summary.cost_total);
    expect(r.summary.vat).toBe(0);
    expect(r.summary.price_incl_vat).toBe(r.summary.cost_total);
  });

  it("surfaces the geometry warnings", () => {
    const r = ok(computeEstimate(PRECAST_VILLA_STARTER, { wall_perimeter_m: 20 }));
    expect(r.warnings.join()).toMatch(/cannot enclose 150 m2/);
  });

  it("fails cleanly when the design needs too many pieces", () => {
    const wide: typeof PRECAST_VILLA_STARTER = {
      ...PRECAST_VILLA_STARTER,
      inputs: PRECAST_VILLA_STARTER.inputs.map((i) => (
        i.key === "floors" ? { ...i, max: 6 }
          : i.key === "built_up_area_m2" ? { ...i, max: 5000 }
            : i.key === "wall_perimeter_m" ? { ...i, max: 1000 }
              : i
      )),
    };
    const r = computeEstimate(wide, { floors: 6, built_up_area_m2: 5000, wall_perimeter_m: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ path: "geometry" });
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
