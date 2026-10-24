import { describe, it, expect } from "vitest";
import { layoutPortaCabin, cabinCells, PORTA_CABIN_MODULE, LAYOUT_SINGLE, LAYOUT_ROW, LAYOUT_L, LAYOUT_STACKED } from "./portaCabin";
import { getGeometry, GEOMETRY_KEYS, geometryIdentifiers, pieceScope, familyTotals } from "./index";
import type { GeometryModel } from "./types";

// A 6.0 x 2.4 m unit, 2.6 m inside.
const UNIT = { unit_length_m: 6, unit_width_m: 2.4, unit_height_m: 2.6, units_along: 1, units_across: 1, layout: LAYOUT_SINGLE, door_count: 1, window_count: 2, partition_count: 0 };

function build(over: Record<string, number> = {}): GeometryModel {
  const r = layoutPortaCabin({ ...UNIT, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.model;
}
const x = (m: GeometryModel, k: string): number => m.extras![k];

describe("porta_cabin, a single unit", () => {
  const m = build();

  it("is one unit with the floor, roof and wall areas of its size", () => {
    expect(x(m, "n_unit")).toBe(1);
    expect(x(m, "n_storey")).toBe(1);
    expect(x(m, "area_floor")).toBeCloseTo(14.4, 6);
    expect(x(m, "area_roof")).toBeCloseTo(14.4, 6);
    expect(x(m, "area_wall_gross")).toBeCloseTo(2 * 6 * 2.6 + 2 * 2.4 * 2.6, 6);
  });

  it("cuts the walls into panels: 3 + 3 long, 1 + 1 short", () => {
    expect(familyTotals(m, "WL").n).toBe(8);
    expect(familyTotals(m, "FL").n).toBe(1);
    expect(familyTotals(m, "RF").n).toBe(1);
  });

  it("places the door and windows as openings in real panels, and the net wall area is the gross less the openings", () => {
    expect(x(m, "n_door")).toBe(1);
    expect(x(m, "n_window")).toBe(2);
    const open = m.pieces.filter((p) => p.op);
    expect(open.filter((p) => p.op!.door)).toHaveLength(1);
    expect(open.filter((p) => !p.op!.door)).toHaveLength(2);
    expect(x(m, "area_wall")).toBeCloseTo(43.68 - 0.9 * 2 - 2 * 1.0, 6);
  });

  it("has no joints and a ground perimeter of 2 x (6 + 2.4)", () => {
    expect(x(m, "len_joint")).toBe(0);
    expect(x(m, "len_perimeter")).toBeCloseTo(16.8, 6);
  });

  it("every mark is unique and every piece sits inside the footprint", () => {
    expect(new Set(m.pieces.map((p) => p.id)).size).toBe(m.pieces.length);
    for (const p of m.pieces) {
      expect(Math.abs(p.pos[0])).toBeLessThanOrEqual(m.w / 2 + 1e-6);
      expect(Math.abs(p.pos[2])).toBeLessThanOrEqual(m.d / 2 + 1e-6);
    }
    expect(m.w).toBe(6);
    expect(m.d).toBe(2.4);
  });

  it("ignores the unit counts when the layout is a single unit", () => {
    expect(x(build({ units_along: 4, units_across: 3 }), "n_unit")).toBe(1);
  });
});

describe("porta_cabin, layouts", () => {
  it("a row of three leaves out the two party walls and counts their seams", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 3 });
    expect(x(m, "n_unit")).toBe(3);
    expect(m.w).toBe(18);
    // Front and back run the whole length (9 panels each); only the two ends have a short wall.
    expect(familyTotals(m, "WL").n).toBe(9 + 9 + 2);
    expect(x(m, "len_joint")).toBeCloseTo(2 * (2 * 2.4 + 2 * 2.6), 6);
    expect(x(m, "area_floor")).toBeCloseTo(3 * 14.4, 6);
  });

  it("an L turns the corner: along + across - 1 units", () => {
    const m = build({ layout: LAYOUT_L, units_along: 2, units_across: 3 });
    expect(x(m, "n_unit")).toBe(4);
    expect(m.w).toBe(12);
    expect(m.d).toBeCloseTo(7.2, 6);
    expect(x(m, "len_joint")).toBeCloseTo((2 * 2.4 + 2 * 2.6) + 2 * (2 * 6 + 2 * 2.6), 6);
  });

  it("an L with one unit across is a plain row, with a warning", () => {
    const m = build({ layout: LAYOUT_L, units_along: 2, units_across: 1 });
    expect(x(m, "n_unit")).toBe(2);
    expect(m.warnings.join(" ")).toMatch(/units across/i);
  });

  it("stacked two high doubles the units, keeps the doors on the ground and adds a stack seam", () => {
    const m = build({ layout: LAYOUT_STACKED, units_along: 2, door_count: 2, window_count: 6 });
    expect(x(m, "n_unit")).toBe(4);
    expect(x(m, "n_storey")).toBe(2);
    expect(m.pieces.filter((p) => p.op?.door).every((p) => p.floor === 0)).toBe(true);
    expect(m.pieces.some((p) => p.floor === 1 && p.code === "WL")).toBe(true);
    const upper = m.pieces.find((p) => p.code === "RF" && p.floor === 1)!;
    const lower = m.pieces.find((p) => p.code === "RF" && p.floor === 0)!;
    expect(upper.pos[1] - lower.pos[1]).toBeCloseTo(0.15 + 2.6 + 0.15, 6);
    // one party-wall seam per storey plus a stack seam round each of the two lower units
    expect(x(m, "len_joint")).toBeCloseTo(2 * (2 * 2.4 + 2 * 2.6) + 2 * (2 * (6 + 2.4)), 6);
  });

  it("cabinCells lays each layout out", () => {
    expect(cabinCells(LAYOUT_SINGLE, 5, 5)).toHaveLength(1);
    expect(cabinCells(LAYOUT_ROW, 5, 5)).toHaveLength(5);
    expect(cabinCells(LAYOUT_L, 3, 4)).toHaveLength(6);
    expect(cabinCells(LAYOUT_STACKED, 3, 4)).toHaveLength(6);
  });
});

describe("porta_cabin, doors, windows, partitions", () => {
  it("puts each door in its own unit before a second door in the same unit", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 3, door_count: 3 });
    expect(x(m, "n_door")).toBe(3);
    const cells = new Set(m.pieces.filter((p) => p.op?.door).map((p) => Math.round(p.pos[0])));
    expect(cells.size).toBe(3);
  });

  it("reduces a door count that cannot fit, and says so", () => {
    const m = build({ door_count: 9 });
    expect(x(m, "n_door")).toBe(4);
    expect(m.warnings.join(" ")).toMatch(/doors/i);
  });

  it("reduces a window count that cannot fit, and says so", () => {
    const m = build({ window_count: 40 });
    expect(x(m, "n_window")).toBeLessThan(40);
    expect(x(m, "n_window")).toBe(m.pieces.filter((p) => p.op && !p.op.door).length);
    expect(m.warnings.join(" ")).toMatch(/windows/i);
  });

  it("spreads windows over the sides rather than filling one wall", () => {
    const m = build({ window_count: 4 });
    const sides = new Set(m.pieces.filter((p) => p.op && !p.op.door).map((p) => `${p.rot ?? 0}:${Math.sign(p.pos[2]) || Math.sign(p.pos[0])}`));
    expect(sides.size).toBeGreaterThan(1);
  });

  it("shares partitions out over the units and counts their area", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, partition_count: 4 });
    expect(x(m, "n_partition")).toBe(4);
    expect(familyTotals(m, "PT").n).toBe(4);
    expect(x(m, "area_partition")).toBeCloseTo(4 * (2.4 - 0.15) * 2.6, 5);
  });

  it("caps partitions at three to a unit", () => {
    const m = build({ partition_count: 5 });
    expect(x(m, "n_partition")).toBe(3);
    expect(m.warnings.join(" ")).toMatch(/partitions/i);
  });
});

describe("porta_cabin, rejected inputs", () => {
  it.each([
    ["zero length", { unit_length_m: 0 }],
    ["negative width", { unit_width_m: -2.4 }],
    ["zero height", { unit_height_m: 0 }],
    ["a 40 m unit", { unit_length_m: 40 }],
    ["no units", { layout: LAYOUT_ROW, units_along: 0 }],
    ["too many units", { layout: LAYOUT_ROW, units_along: 30 }],
    ["negative doors", { door_count: -1 }],
    ["unknown layout", { layout: 9 }],
    ["not a number", { unit_length_m: Number.NaN }],
  ])("%s is an error", (_n, over) => {
    expect(layoutPortaCabin({ ...UNIT, ...over }).ok).toBe(false);
  });
});

describe("porta_cabin, the module and the formula scope", () => {
  const mod = getGeometry("porta_cabin")!;

  it("is registered and exposes its extras", () => {
    expect(GEOMETRY_KEYS).toContain("porta_cabin");
    expect(mod).toBe(PORTA_CABIN_MODULE);
    const ids = geometryIdentifiers(mod);
    for (const k of ["n_unit", "area_wall", "area_roof", "area_floor", "n_door", "n_window", "n_partition", "len_joint", "vol_total", "n_WL", "area_WL"]) expect(ids).toContain(k);
  });

  it("reads the names a formula uses, and the piece families too", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, partition_count: 2 });
    const s = pieceScope(mod, m, 0.3);
    expect(s.n_unit).toBe(2);
    expect(s.n_door).toBe(1);
    expect(s.n_partition).toBe(2);
    expect(s.n_FL).toBe(2);
    expect(s.n_RF).toBe(2);
    expect(s.area_WL).toBeCloseTo(s.area_wall, 3);
  });

  it("names an erection step for every piece", () => {
    const m = build({ layout: LAYOUT_STACKED, units_along: 2, partition_count: 2 });
    for (const p of m.pieces) expect(m.step_names[p.step]).toBeTruthy();
    expect(m.step_names[0]).toMatch(/foundation/i);
  });

  it("is deterministic", () => {
    expect(layoutPortaCabin({ ...UNIT, layout: LAYOUT_L, units_along: 3, units_across: 2 })).toEqual(layoutPortaCabin({ ...UNIT, layout: LAYOUT_L, units_along: 3, units_across: 2 }));
  });
});
