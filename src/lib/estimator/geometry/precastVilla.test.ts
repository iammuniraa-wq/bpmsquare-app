import { describe, it, expect } from "vitest";
import { layoutPrecastVilla, footprint, MAX_PIECES, MIN_FOOTPRINT_SIDE_M } from "./precastVilla";
import { getGeometry, GEOMETRY_KEYS, pieceScope, markRange, familyTotals, geometryIdentifiers, densityFromRates, DEFAULT_DENSITY_T_M3 } from "./index";
import type { GeometryModel } from "./types";

// The reference villa: the inputs the mock-up opens with.
const VILLA = {
  floors: 2, built_up_area_m2: 150, wall_perimeter_m: 50, wall_height_m: 3, ext_wall_thickness_m: 0.2,
  stair_flights: 2, include_stairs: 1, boundary_wall_length_m: 60, boundary_wall_height_m: 2.4,
};

function build(over: Partial<typeof VILLA> = {}): GeometryModel {
  const r = layoutPrecastVilla({ ...VILLA, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.model;
}

// Counts and volumes below are what the reference layout() in
// docs/estimator-reference/layout-and-calc.reference.js produces for these
// inputs (run under node), so this pins the port to the reference behaviour.
describe("precast_villa, reference villa", () => {
  const m = build();
  const by = (code: string) => familyTotals(m, code);

  it("has the footprint recovered from perimeter and area", () => {
    expect(m.w).toBe(15);
    expect(m.d).toBe(10);
    expect(m.warnings).toEqual([]);
  });

  it("emits 137 pieces in the reference counts", () => {
    expect(m.pieces).toHaveLength(137);
    expect(["EW", "PR", "IW", "SL", "FR", "ST", "BW"].map((c) => by(c).n)).toEqual([40, 20, 16, 26, 8, 2, 25]);
  });

  it("matches the reference volumes", () => {
    expect(by("EW").vol).toBeCloseTo(48.384, 3);
    expect(by("PR").vol).toBeCloseTo(5.2704, 3);
    expect(by("IW").vol).toBeCloseTo(14.868, 3);
    expect(by("SL").vol).toBeCloseTo(37.1345, 3);
    expect(by("FR").vol).toBeCloseTo(8, 3);
    expect(by("ST").vol).toBeCloseTo(3.2, 3);
    expect(by("BW").vol).toBeCloseTo(14.04, 3);
    expect(pieceScope(getGeometry("precast_villa")!, m, 2.4).vol_total).toBeCloseTo(130.897, 2);
  });

  it("insulatable external wall area is the net face area (reference 217.728 m2 at 90%)", () => {
    expect(by("EW").area * 0.9).toBeCloseTo(217.728, 2);
  });

  it("numbers marks per family and never repeats one", () => {
    expect(m.pieces[0].id).toBe("FR-01");
    expect(new Set(m.pieces.map((p) => p.id)).size).toBe(m.pieces.length);
    expect(by("EW").first_mark).toBe("EW-01");
    expect(by("EW").last_mark).toBe("EW-40");
    expect(m.pieces.find((p) => p.code === "BW")!.id).toBe("BW-01");
    for (const p of m.pieces) expect(p.id).toMatch(/^[A-Z]{2}-\d{2,}$/);
  });

  it("orders erection steps and names them", () => {
    expect(m.step_names[0]).toBe("Foundation base");
    expect(m.step_names).toContain("Roof: hollow-core planks");
    expect(m.step_names).toContain("Stair flights");
    expect(m.step_names[m.step_names.length - 1]).toBe("Boundary wall");
    const steps = m.pieces.map((p) => p.step);
    expect(Math.max(...steps)).toBe(m.step_names.length - 1);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps); // pieces come out in erection order
  });

  it("cuts one door in the ground-floor front wall and windows elsewhere", () => {
    const doors = m.pieces.filter((p) => p.op?.door);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ code: "EW", floor: 0 });
    expect(doors[0].pos[2]).toBe(5); // front wall at +d/2
    expect(m.pieces.some((p) => p.op && !p.op.door)).toBe(true);
    for (const p of m.pieces.filter((x) => x.code === "EW")) {
      expect(p.vol).toBeGreaterThan(0);
      expect(p.area!).toBeGreaterThan(0);
    }
  });

  it("keeps every number finite and every piece inside a sane box", () => {
    for (const p of m.pieces) {
      for (const v of [...p.pos, p.dims.w, p.dims.h, p.dims.t, p.vol]) expect(Number.isFinite(v)).toBe(true);
      expect(p.vol).toBeGreaterThan(0);
      expect(Math.abs(p.pos[0])).toBeLessThan(30);
      expect(Math.abs(p.pos[2])).toBeLessThan(30);
      expect(p.pos[1]).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(m));
  });
});

describe("variations", () => {
  it("no stairs and no boundary wall drop those families and their steps", () => {
    const m = build({ include_stairs: 0, boundary_wall_length_m: 0 });
    expect(familyTotals(m, "ST").n).toBe(0);
    expect(familyTotals(m, "BW").n).toBe(0);
    expect(m.step_names).not.toContain("Stair flights");
    expect(m.step_names).not.toContain("Boundary wall");
  });

  it("more floors means more pieces, with storey offsets", () => {
    const two = build();
    const three = build({ floors: 3 });
    expect(three.pieces.length).toBeGreaterThan(two.pieces.length);
    expect(Math.max(...three.pieces.map((p) => p.floor))).toBe(2);
  });

  it("boundary wall height changes panel volume and centre height", () => {
    const m = build({ boundary_wall_height_m: 3 });
    const bw = m.pieces.find((p) => p.code === "BW")!;
    expect(bw.dims.h).toBe(3);
    expect(bw.pos[1]).toBe(1.5);
    expect(bw.vol).toBeCloseTo(2.34 * 3 * 0.1, 4);
  });

  it("boundary panels wrap around the plot with quarter-turn rotations", () => {
    const m = build({ boundary_wall_length_m: 200 });
    const rots = new Set(m.pieces.filter((p) => p.code === "BW").map((p) => p.rot));
    expect(rots).toEqual(new Set([0, Math.PI / 2]));
  });
});

describe("degenerate inputs", () => {
  it("a perimeter too short for the area falls back to a square and says so", () => {
    const w: string[] = [];
    const f = footprint(20, 150, w);
    expect(f.w).toBeCloseTo(Math.sqrt(150), 6);
    expect(f.d).toBeCloseTo(f.w, 6);
    expect(w[0]).toMatch(/cannot enclose 150 m2/);
    const m = build({ wall_perimeter_m: 20 });
    expect(m.warnings.join()).toMatch(/cannot enclose/);
    expect(m.pieces.length).toBeGreaterThan(0);
  });

  it("a sliver footprint keeps the area and fixes the short side", () => {
    const w: string[] = [];
    const f = footprint(160, 150, w);
    expect(f.d).toBe(MIN_FOOTPRINT_SIDE_M);
    expect(f.w * f.d).toBeCloseTo(150, 6);
    expect(w[0]).toMatch(/sliver/);
  });

  it("clamps absurd sizes with a warning instead of producing a huge model", () => {
    const m = build({ floors: 50, wall_height_m: 40, ext_wall_thickness_m: 5, stair_flights: 500, boundary_wall_length_m: 99999 });
    expect(Math.max(...m.pieces.map((p) => p.floor))).toBe(5);
    expect(m.warnings.length).toBeGreaterThanOrEqual(5);
    expect(m.pieces.length).toBeLessThanOrEqual(MAX_PIECES);
  });

  it("treats missing or non-finite numbers as the smallest supported value, not NaN", () => {
    const r = layoutPrecastVilla({ floors: Number.NaN, built_up_area_m2: Number.POSITIVE_INFINITY });
    expect(r.ok).toBe(true);
    if (r.ok) for (const p of r.model.pieces) expect(Number.isFinite(p.vol)).toBe(true);
  });

  it("refuses a design that needs too many pieces", () => {
    const r = layoutPrecastVilla({ ...VILLA, floors: 6, built_up_area_m2: 5000, wall_perimeter_m: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/more than 5000 pieces/);
  });
});

describe("registry and piece scope", () => {
  const mod = getGeometry("precast_villa")!;
  const m = build();

  it("resolves keys and rejects unknown ones, including prototype names", () => {
    expect(GEOMETRY_KEYS).toContain("precast_villa");
    expect(mod.label).toMatch(/illustrative/i);
    expect(getGeometry("nope")).toBeNull();
    expect(getGeometry("constructor")).toBeNull();
    expect(getGeometry("__proto__")).toBeNull();
    expect(getGeometry(null)).toBeNull();
    expect(getGeometry(undefined)).toBeNull();
  });

  it("exposes vol_, n_ and area_ for every family plus the totals", () => {
    const ids = geometryIdentifiers(mod);
    expect(ids).toContain("vol_EW");
    expect(ids).toContain("n_SL");
    expect(ids).toContain("area_EW");
    expect(ids).toEqual(expect.arrayContaining(["vol_total", "n_total", "area_total", "weight_total"]));
    expect(ids).toHaveLength(4 + 7 * 3);
  });

  it("builds the scope, with zeros for absent families and weight from density", () => {
    const s = pieceScope(mod, m, 2.4);
    expect(s.n_EW).toBe(40);
    expect(s.n_total).toBe(137);
    expect(s.vol_total).toBeCloseTo(130.897, 2);
    expect(s.weight_total).toBeCloseTo(s.vol_total * 2.4, 2);
    const none = pieceScope(mod, build({ include_stairs: 0 }), 2.4);
    expect(none.vol_ST).toBe(0);
    expect(none.n_ST).toBe(0);
  });

  it("marks: a range for a family, one mark for a single piece, null when absent", () => {
    expect(markRange(m, "EW")).toBe("EW-01..EW-40");
    expect(markRange(build({ stair_flights: 1 }), "ST")).toBe("ST-01");
    expect(markRange(build({ include_stairs: 0 }), "ST")).toBeNull();
  });

  it("density comes from a *_density_t_m3 rate, else 2.4", () => {
    expect(densityFromRates([{ key: "concrete_density_t_m3", value: 2.5 }])).toBe(2.5);
    expect(densityFromRates([{ key: "x", value: 1 }])).toBe(DEFAULT_DENSITY_T_M3);
    expect(densityFromRates([{ key: "density_t_m3", value: -1 }])).toBe(DEFAULT_DENSITY_T_M3);
  });
});
