import { describe, expect, it } from "vitest";
import { GENERIC_KEY, GENERIC_SLOT_KEYS, GEOMETRY_KEYS, getGeometry, layoutGeneric, withGenericRefs } from "./index";
import { MAX_RUN_SEGMENTS, MAX_UNITS, RUN_SEGMENT_M, familyForLine } from "./generic";
import type { GenericArgs, GenericLine } from "./generic";

const lay = (values: Record<string, unknown>, mapping: GenericArgs["mapping"], extra: Partial<GenericArgs> = {}) => layoutGeneric({ values, mapping, ...extra });
const codes = (m: ReturnType<typeof layoutGeneric>) => [...new Set(m.pieces.map((p) => p.code))];
const count = (m: ReturnType<typeof layoutGeneric>, code: string) => m.pieces.filter((p) => p.code === code).length;

describe("the picture built from the inputs", () => {
  it("is not a module a template can name", () => {
    expect(GENERIC_KEY).toBe("generic");
    expect(getGeometry("generic")).toBeNull();
    expect(GEOMETRY_KEYS).not.toContain("generic");
  });

  it("returns an empty model, never throws, when nothing gives a size", () => {
    for (const [values, mapping] of [
      [{}, {}], [{ a: 5 }, {}], [{ a: 0 }, { length: "a" }], [{ a: -3 }, { run: "a" }], [{ a: Number.NaN }, { area: "a" }],
      [{ a: "text" }, { length: "a" }], [{ a: Infinity }, { count: "a" }], [{ w: 3 }, { width: "w" }], [{ h: 3 }, { height: "h" }],
    ] as [Record<string, unknown>, GenericArgs["mapping"]][]) {
      const m = lay(values, mapping);
      expect(m.pieces, JSON.stringify(values)).toEqual([]);
    }
  });

  it("dimensions only: one box of length x width x height, centred", () => {
    const m = lay({ l: 6, w: 4, h: 3 }, { length: "l", width: "w", height: "h" });
    expect(m.pieces).toHaveLength(1);
    const p = m.pieces[0];
    expect(p.code).toBe("FP");
    expect(p.dims).toEqual({ w: 6, h: 3, t: 4 });
    expect(p.vol).toBeCloseTo(72, 6);
    expect(p.pos).toEqual([0, 1.5, 0]);
    expect(m.w).toBe(6);
    expect(m.d).toBe(4);
  });

  it("length and width without a height is a thin floor", () => {
    const m = lay({ l: 5, w: 3.5 }, { length: "l", width: "w" });
    expect(m.pieces[0].dims.h).toBeLessThan(0.3);
  });

  it("run only: a long element along x, cut every 6 m", () => {
    const m = lay({ r: 60 }, { run: "r" });
    expect(codes(m)).toEqual(["RN"]);
    expect(count(m, "RN")).toBe(60 / RUN_SEGMENT_M);
    const xs = m.pieces.map((p) => p.pos[0]);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(0);
    expect(m.pieces.reduce((a, p) => a + p.dims.w, 0)).toBeCloseTo(60, 3);
    expect(m.w).toBe(60);
  });

  it("a single length with no width is a run", () => {
    expect(codes(lay({ l: 30 }, { length: "l" }))).toEqual(["RN"]);
  });

  it("a long run stays readable: bounded segments and a visible section", () => {
    const m = lay({ r: 5000 }, { run: "r" });
    expect(count(m, "RN")).toBeLessThanOrEqual(MAX_RUN_SEGMENTS);
    expect(Math.max(...m.pieces.map((p) => p.dims.t))).toBeGreaterThan(1);
    expect(m.warnings.join(" ")).toContain("thicker");
  });

  it("a fence: a run with a height is a thin tall wall", () => {
    const m = lay({ r: 120, h: 2.4 }, { run: "r", height: "h" });
    expect(m.pieces[0].dims.h).toBe(2.4);
    expect(m.pieces[0].dims.t).toBeLessThan(0.5);
  });

  it("count only: that many boxes in a row, then a grid", () => {
    const row = lay({ n: 4 }, { count: "n" });
    expect(count(row, "UN")).toBe(4);
    expect(new Set(row.pieces.map((p) => p.pos[2])).size).toBe(1);
    const grid = lay({ n: 30 }, { count: "n" });
    expect(count(grid, "UN")).toBe(30);
    expect(new Set(grid.pieces.map((p) => p.pos[2])).size).toBeGreaterThan(1);
  });

  it("count with sizes: units of that size", () => {
    const m = lay({ n: 3, l: 6, w: 2.4, h: 2.6 }, { count: "n", length: "l", width: "w", height: "h" });
    expect(count(m, "UN")).toBe(3);
    expect(m.pieces[0].dims).toEqual({ w: 6, h: 2.6, t: 2.4 });
    expect(codes(m)).toEqual(["UN"]);
  });

  it("units never overlap in a row", () => {
    const m = lay({ n: 5, l: 4, w: 2 }, { count: "n", length: "l", width: "w" });
    const xs = m.pieces.map((p) => p.pos[0]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(4);
  });

  it("a huge count draws a bounded number and says so", () => {
    const m = lay({ n: 100000 }, { count: "n" });
    expect(count(m, "UN")).toBe(MAX_UNITS);
    expect(m.warnings.join(" ")).toContain(String(MAX_UNITS));
  });

  it("count with a run: markers spread along the run (manholes on a pipe)", () => {
    const m = lay({ r: 600, n: 6 }, { run: "r", count: "n" });
    expect(count(m, "UN")).toBe(6);
    expect(count(m, "RN")).toBeGreaterThan(0);
    const ux = m.pieces.filter((p) => p.code === "UN").map((p) => p.pos[0]);
    expect(Math.max(...ux) - Math.min(...ux)).toBeGreaterThan(400);
    expect(new Set(m.pieces.map((p) => p.pos[2])).size).toBe(1);
  });

  it("area only: a slab of that area", () => {
    const m = lay({ a: 150 }, { area: "a" });
    expect(codes(m)).toEqual(["SL"]);
    const p = m.pieces[0];
    expect(p.dims.w * p.dims.t).toBeCloseTo(150, 2);
  });

  it("area with one side: the other side follows", () => {
    const m = lay({ a: 60, l: 12 }, { area: "a", length: "l" });
    expect(codes(m)).toEqual(["SL"]);
    expect(m.pieces[0].dims.w).toBe(12);
    expect(m.pieces[0].dims.t).toBeCloseTo(5, 3);
  });

  it("a footprint that matches the area is not drawn twice", () => {
    expect(codes(lay({ l: 10, w: 6, a: 60 }, { length: "l", width: "w", area: "a" }))).toEqual(["FP"]);
    expect(codes(lay({ l: 10, w: 6, a: 300 }, { length: "l", width: "w", area: "a" })).sort()).toEqual(["FP", "SL"]);
  });

  it("a volume alone is a block of that volume", () => {
    const m = lay({ v: 500 }, {}, { volumeKey: "v" });
    expect(codes(m)).toEqual(["BL"]);
    expect(m.pieces[0].vol).toBeCloseTo(500, 1);
  });

  it("a volume is ignored when anything else gives a shape", () => {
    expect(codes(lay({ v: 500, l: 20 }, { length: "l" }, { volumeKey: "v" }))).toEqual(["RN"]);
  });

  it("all roles together: with a count the sizes belong to the units; lanes do not overlap, ids are unique valid marks", () => {
    const m = lay({ l: 10, w: 6, h: 3, r: 40, n: 5, a: 500 }, { length: "l", width: "w", height: "h", run: "r", count: "n", area: "a" });
    expect(codes(m).sort()).toEqual(["RN", "SL", "UN"]);
    const ids = m.pieces.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z0-9]+-\d+$/);
    expect(m.pieces.find((p) => p.code === "UN")!.dims).toEqual({ w: 10, h: 3, t: 6 });
  });

  it("without a count the sizes are a footprint, beside a run and a slab, in lanes that do not overlap", () => {
    const m = lay({ l: 10, w: 6, h: 3, r: 40, a: 500 }, { length: "l", width: "w", height: "h", run: "r", area: "a" });
    expect(codes(m).sort()).toEqual(["FP", "RN", "SL"]);
    const lanes = ["FP", "RN", "SL"].map((c) => {
      const ps = m.pieces.filter((p) => p.code === c);
      return { lo: Math.min(...ps.map((p) => p.pos[2] - p.dims.t / 2)), hi: Math.max(...ps.map((p) => p.pos[2] + p.dims.t / 2)) };
    }).sort((x, y) => x.lo - y.lo);
    for (let i = 1; i < lanes.length; i++) expect(lanes[i].lo).toBeGreaterThan(lanes[i - 1].hi);
  });

  it("is the same every time for the same inputs", () => {
    const a = lay({ l: 10, w: 6, n: 7 }, { length: "l", width: "w", count: "n" });
    expect(lay({ l: 10, w: 6, n: 7 }, { length: "l", width: "w", count: "n" })).toEqual(a);
  });

  it("names its families and slots, and is flagged as a sketch", () => {
    const m = lay({ l: 6, w: 4 }, { length: "l", width: "w" });
    expect(m.geometry).toBe("generic");
    expect(m.illustrative).toBe(true);
    expect(m.families?.map((f) => f.code)).toContain("FP");
    for (const p of m.pieces) expect(GENERIC_SLOT_KEYS.has(p.slot!)).toBe(true);
  });
});

describe("pieces and the cost lines they stand for", () => {
  const lines: GenericLine[] = [
    { code: "pipe", uom: "m", description: "Steel pipe DN300", cost_total: 900 },
    { code: "exc", uom: "m3", description: "Trench excavation in sand", cost_total: 200 },
    { code: "valves", uom: "nr", description: "Isolation valves", cost_total: 300 },
    { code: "lab", uom: "h", description: "Gang labour", cost_total: 400 },
    { code: "lump", uom: null, description: "Overhead", cost_total: 50 },
  ];

  it("a unit decides the family: metres to the run, a count to the units, a weight or hours to none", () => {
    const present = new Set(["RN", "UN", "FP"]);
    expect(familyForLine("m", present)).toBe("RN");
    expect(familyForLine("nr", present)).toBe("UN");
    expect(familyForLine("m3", present)).toBe("FP");
    expect(familyForLine("h", present)).toBeNull();
    expect(familyForLine(null, present)).toBeNull();
    expect(familyForLine("m", new Set(["UN"]))).toBeNull();
  });

  it("pieces carry the codes of their lines and the lines get mark ranges", () => {
    const m = lay({ r: 120, n: 3 }, { run: "r", count: "n" }, { lines });
    expect(m.pieces.find((p) => p.code === "RN")!.lines).toContain("pipe");
    expect(m.pieces.find((p) => p.code === "UN")!.lines).toEqual(["valves"]);
    const out = withGenericRefs(m, lines);
    expect(out.find((l) => l.code === "pipe")!.element_ref).toMatch(/^RN-01\.\.RN-\d+$/);
    expect(out.find((l) => l.code === "valves")!.element_ref).toBe("UN-01..UN-03");
    expect(out.find((l) => l.code === "lab")!.element_ref ?? null).toBeNull();
    expect(out.find((l) => l.code === "lump")!.element_ref ?? null).toBeNull();
  });

  it("a line that already has marks keeps them", () => {
    const m = lay({ r: 12 }, { run: "r" });
    const out = withGenericRefs(m, [{ code: "x", uom: "m", description: "x", cost_total: 1, element_ref: "AB-01" }]);
    expect(out[0].element_ref).toBe("AB-01");
  });

  it("the run is painted by what its lines say: steel pipe is steel, a trench is soil", () => {
    const steel = lay({ r: 60 }, { run: "r" }, { lines: [{ code: "p", uom: "m", description: "Steel pipe DN300", cost_total: 100 }] });
    expect(steel.pieces[0].slot).toBe("steel");
    const soil = lay({ r: 60 }, { run: "r" }, { lines: [{ code: "p", uom: "m", description: "Trench excavation", cost_total: 100 }] });
    expect(soil.pieces[0].slot).toBe("soil");
    const dearest = lay({ r: 60 }, { run: "r" }, { lines: [
      { code: "a", uom: "m", description: "Steel pipe", cost_total: 100 }, { code: "b", uom: "m", description: "Excavation", cost_total: 900 },
    ] });
    expect(dearest.pieces[0].slot).toBe("soil");
    expect(lay({ a: 100 }, { area: "a" }).pieces[0].slot).toBe("concrete");
  });
});
