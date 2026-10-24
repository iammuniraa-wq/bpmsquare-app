import { describe, it, expect } from "vitest";
import { computeEstimate } from "./compute";
import type { ComputeSuccess } from "./compute";
import { validateTemplate } from "./template";
import { previewEstimate } from "./preview";
import { TILES_FLOOR_STARTER, TILES_STARTERS } from "./starterTemplatesTiles";
import { PORTA_CABIN_STARTER, CABIN_STARTERS } from "./starterTemplatesCabin";
import type { CatalogueStarter } from "./starterTemplatesTiles";

function body(t: CatalogueStarter) {
  return { geometry: t.geometry, inputs: t.inputs, rates: t.rates, rules: t.rules };
}
function run(t: CatalogueStarter, params: Record<string, unknown> = {}, opts = {}): ComputeSuccess {
  const r = computeEstimate(body(t), params, opts);
  if (!r.ok) throw new Error(r.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return r;
}
const line = (r: ComputeSuccess, code: string) => r.lines.find((l) => l.code === code);
const qty = (r: ComputeSuccess, code: string) => line(r, code)?.qty ?? 0;

describe.each([...TILES_STARTERS, ...CABIN_STARTERS])("starter $name", (t) => {
  it("is a valid template with no warnings, a catalogue name, keywords and an icon", () => {
    const v = validateTemplate(body(t));
    expect(v.issues).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(t.keywords.length).toBeGreaterThan(5);
    expect(t.icon).toMatch(/^[a-z]+$/);
    expect(t.description).toMatch(/illustrative/i);
    expect(t.quote_granularity).toBe("group");
  });

  it("prices its defaults, every line costed, nothing waiting for a catalogue product", () => {
    const r = run(t);
    expect(r.complete).toBe(true);
    expect(r.lines.length).toBeGreaterThan(8);
    expect(r.lines.every((l) => l.cost_total !== null && l.cost_total > 0)).toBe(true);
    expect(r.model).not.toBeNull();
    expect(r.summary.cost_total).toBeGreaterThan(0);
  });

  it("gives three quote alternatives, one per option of the flagged select", () => {
    const p = previewEstimate({ template: body(t), granularity: t.quote_granularity, params: {}, margin_pct: 15, vat_pct: 15 });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.view.sections.length).toBeGreaterThanOrEqual(3);
      expect(p.view.total).toBeGreaterThan(0);
    }
  });
});

describe("floor tiles starter", () => {
  const T = TILES_FLOOR_STARTER;
  const base = { room_length_m: 5, room_width_m: 3.5, tile_length_mm: 600, tile_width_mm: 600, grout_mm: 3 };

  it("tile quantity is the order from the layout (cuts and waste included), in m2", () => {
    const r = run(T, base);
    const x = r.model!.extras!;
    expect(x.n_tile).toBe(8 * 5);
    expect(x.n_cut).toBe(9 * 6 - 8 * 5);
    expect(x.n_laid).toBe(54);
    expect(x.n_order).toBe(Math.ceil(54 * 1.05));
    expect(qty(r, "tiles")).toBeCloseTo(x.n_order * 0.36, 3);
    expect(line(r, "tiles")!.element_ref).toBeNull();
  });

  it("adhesive is by floor area and bed thickness, with waste", () => {
    const r = run(T, base);
    expect(qty(r, "adh")).toBeCloseTo(17.5 * 6 * 1.4, 2);
    expect(line(r, "adh")!.qty_gross).toBeCloseTo(17.5 * 6 * 1.4 * 1.05, 2);
    expect(qty(run(T, { ...base, adhesive_bed_mm: 3 }), "adh")).toBeCloseTo(17.5 * 3 * 1.4, 2);
  });

  it("grout is by joint length, joint width and tile thickness", () => {
    const r = run(T, base);
    const joint = r.model!.extras!.len_joint;
    expect(qty(r, "grt")).toBeCloseTo(joint * 0.003 * 0.01 * 1600, 2);
    // smaller tiles mean more joint, so more grout
    const small = run(T, { ...base, tile_length_mm: 300, tile_width_mm: 300 });
    expect(small.model!.extras!.len_joint).toBeGreaterThan(joint);
    expect(qty(small, "grt")).toBeGreaterThan(qty(r, "grt"));
    // no joint, no grout line
    expect(line(run(T, { ...base, grout_mm: 0 }), "grt")).toBeUndefined();
  });

  it("spacers follow the joint length", () => {
    const r = run(T, base);
    expect(qty(r, "spc")).toBe(Math.ceil(r.model!.extras!.len_joint / 0.3));
  });

  it("skirting follows the perimeter less the door, and can be switched off", () => {
    const r = run(T, base);
    expect(qty(r, "skt")).toBeCloseTo(17 - 0.9, 3);
    expect(qty(r, "skl")).toBeCloseTo((17 - 0.9) * 0.12, 3);
    expect(line(run(T, { ...base, include_skirting: false }), "skt")).toBeUndefined();
  });

  it("waterproofing only appears for a wet area", () => {
    expect(line(run(T, base), "wpf")).toBeUndefined();
    expect(qty(run(T, { ...base, include_waterproofing: true }), "wpf")).toBeCloseTo(17.5, 3);
  });

  it("a border adds border tiles", () => {
    expect(line(run(T, base), "bdr")).toBeUndefined();
    const r = run(T, { ...base, border_mm: 100 });
    expect(qty(r, "bdr")).toBeGreaterThan(0);
  });

  it("diagonal costs more than a straight grid: more tiles, more cuts, slower laying", () => {
    const grid = run(T, { ...base, pattern: "grid" });
    const diag = run(T, { ...base, pattern: "diagonal" });
    expect(qty(diag, "tiles")).toBeGreaterThan(qty(grid, "tiles"));
    expect(qty(diag, "cut")).toBeGreaterThan(qty(grid, "cut"));
    expect(qty(diag, "lay")).toBeGreaterThan(qty(grid, "lay"));
    expect(diag.summary.cost_total).toBeGreaterThan(grid.summary.cost_total);
  });

  it("the premium range costs more than basic", () => {
    expect(run(T, { ...base, tile_range: "premium" }).summary.cost_total).toBeGreaterThan(run(T, { ...base, tile_range: "basic" }).summary.cost_total);
    expect(line(run(T, { ...base, tile_range: "basic" }), "range")).toBeUndefined();
  });

  it("an L-shaped room has less floor, so less of everything", () => {
    const rect = run(T, base);
    const ell = run(T, { ...base, cutout_length_m: 2, cutout_width_m: 1.5 });
    expect(ell.model!.extras!.area_floor).toBeCloseTo(17.5 - 3, 3);
    expect(qty(ell, "adh")).toBeLessThan(qty(rect, "adh"));
    expect(ell.summary.cost_total).toBeLessThan(rect.summary.cost_total);
  });

  it("a room that cannot be tiled is refused with a reason", () => {
    const r = computeEstimate(body(T), { ...base, grout_mm: 10, tile_length_mm: 100, tile_width_mm: 100, room_length_m: 100, room_width_m: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].path).toBe("geometry");
  });

  it("the group totals add up to the cost", () => {
    const r = run(T, base);
    expect(r.summary.by_group.map((g) => g.name)).toEqual(["Tiles and materials", "Laying and finishing", "Delivery and site", "Overhead"]);
    expect(r.summary.by_group.reduce((a, g) => a + g.cost, 0)).toBeCloseTo(r.summary.cost_total, 2);
  });
});

describe("porta cabin starter", () => {
  const T = PORTA_CABIN_STARTER;
  const one = { layout: "single", units_along: 1, door_count: 1, window_count: 2, partition_count: 0, fit_out: "standard" };

  it("counts cabin units from the layout", () => {
    expect(qty(run(T, { ...one }), "inst")).toBe(1);
    expect(qty(run(T, { layout: "row", units_along: 3 }), "inst")).toBe(3);
    expect(qty(run(T, { layout: "l_shape", units_along: 2, units_across: 3 }), "inst")).toBe(4);
    expect(qty(run(T, { layout: "stacked", units_along: 2 }), "inst")).toBe(4);
  });

  it("flooring and shell follow the floor area; cladding and roof follow the pieces", () => {
    const r = run(T, one);
    const x = r.model!.extras!;
    expect(qty(r, "shell")).toBeCloseTo(14.4, 3);
    expect(qty(r, "flr")).toBeCloseTo(14.4, 3);
    expect(qty(r, "walls")).toBeCloseTo(x.area_wall, 3);
    expect(qty(r, "roof")).toBeCloseTo(14.4, 3);
    expect(line(r, "walls")!.element_ref).toBeNull();
  });

  it("doors, windows and partitions are the openings and walls that fit", () => {
    const r = run(T, { ...one, door_count: 2, window_count: 3, partition_count: 2 });
    expect(qty(r, "doors")).toBe(2);
    expect(qty(r, "wins")).toBe(3);
    expect(qty(r, "parts")).toBeCloseTo(r.model!.extras!.area_partition, 3);
    expect(r.warnings).toEqual([]);
    const crowded = run(T, { ...one, door_count: 9 });
    expect(qty(crowded, "doors")).toBe(4);
    expect(crowded.warnings.join(" ")).toMatch(/doors/);
  });

  it("joints exist only where units meet", () => {
    expect(line(run(T, one), "jnt")).toBeUndefined();
    expect(qty(run(T, { layout: "row", units_along: 3 }), "jnt")).toBeGreaterThan(0);
  });

  it("electrical points follow the fit-out level: 4, 8 or 12 a cabin", () => {
    expect(qty(run(T, { ...one, fit_out: "basic" }), "elec")).toBe(4);
    expect(qty(run(T, { ...one, fit_out: "standard" }), "elec")).toBe(8);
    expect(qty(run(T, { ...one, fit_out: "premium" }), "elec")).toBe(12);
    expect(qty(run(T, { layout: "row", units_along: 3, fit_out: "premium" }), "elec")).toBe(36);
  });

  it("lining arrives at standard and the premium allowance at premium", () => {
    expect(line(run(T, { ...one, fit_out: "basic" }), "lin")).toBeUndefined();
    expect(qty(run(T, { ...one, fit_out: "standard" }), "lin")).toBeGreaterThan(0);
    expect(line(run(T, { ...one, fit_out: "standard" }), "prem")).toBeUndefined();
    expect(qty(run(T, { ...one, fit_out: "premium" }), "prem")).toBeCloseTo(14.4, 3);
  });

  it("fit-out levels cost more as they go up", () => {
    const c = (f: string) => run(T, { ...one, fit_out: f }).summary.cost_total;
    expect(c("basic")).toBeLessThan(c("standard"));
    expect(c("standard")).toBeLessThan(c("premium"));
  });

  it("air conditioning is one split a cabin, and optional", () => {
    expect(qty(run(T, { layout: "row", units_along: 3 }), "ac")).toBe(3);
    expect(line(run(T, { ...one, include_ac: false }), "ac")).toBeUndefined();
  });

  it("transport follows the units and the distance", () => {
    const r = run(T, { layout: "row", units_along: 3, transport_distance_km: 200 });
    expect(qty(r, "load")).toBe(3);
    expect(qty(r, "haul")).toBe(600);
    expect(qty(run(T, { ...one, transport_distance_km: 0 }), "haul")).toBe(0);
  });

  it("the crane is only for a stacked layout", () => {
    expect(line(run(T, { layout: "row", units_along: 4 }), "crane")).toBeUndefined();
    expect(qty(run(T, { layout: "stacked", units_along: 2 }), "crane")).toBe(1);
  });

  it("wet rooms are priced one by one", () => {
    expect(line(run(T, one), "wet")).toBeUndefined();
    expect(qty(run(T, { ...one, wet_room_count: 2 }), "wet")).toBe(2);
  });

  it("a larger job costs more, and the cost is still the sum of its groups", () => {
    const small = run(T, one);
    const big = run(T, { layout: "row", units_along: 6 });
    expect(big.summary.cost_total).toBeGreaterThan(small.summary.cost_total * 4);
    expect(big.summary.by_group.map((g) => g.name)).toEqual(["Cabin shell and cladding", "Fit-out and services", "Assembly and site installation", "Delivery", "Overhead"]);
    expect(big.summary.by_group.reduce((a, g) => a + g.cost, 0)).toBeCloseTo(big.summary.cost_total, 2);
  });
});
