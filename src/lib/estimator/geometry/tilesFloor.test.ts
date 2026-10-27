import { describe, it, expect } from "vitest";
import { layTiles, layWithPattern, layoutTilesFloor, TILES_FLOOR_MODULE, DEFAULT_WASTE_PCT, MAX_TILES, PATTERN_GRID, PATTERN_BRICK, PATTERN_DIAGONAL } from "./tilesFloor";
import type { LaidTile, Poly } from "./tilesFloor";
import { getGeometry, GEOMETRY_KEYS, geometryIdentifiers, pieceScope } from "./index";
import { TILE_SWATCHES, swatchFor } from "./tileSwatches";

const ROOM = { room_length_m: 3, room_width_m: 2.4, tile_length_mm: 600, tile_width_mm: 600, grout_mm: 0, pattern: PATTERN_GRID };

function stats(over: Record<string, number> = {}) {
  const r = layTiles({ ...ROOM, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.layout;
}

const area = (p: Poly): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return Math.abs(a) / 2;
};
const covered = (tiles: LaidTile[]): number => tiles.reduce((a, t) => a + t.polys.reduce((b, p) => b + area(p), 0), 0);

describe("tiles_floor, straight grid", () => {
  it("3.0 x 2.4 m with 600 mm tiles and no joint is 20 whole tiles and no cuts", () => {
    const l = stats();
    expect(l.stats.n_tile).toBe(20);
    expect(l.stats.n_cut).toBe(0);
    expect(l.stats.n_laid).toBe(20);
    expect(l.stats.area_floor).toBe(7.2);
  });

  it("the order adds the pattern's waste, rounded up", () => {
    const l = stats();
    expect(l.stats.waste_pct_used).toBe(DEFAULT_WASTE_PCT[PATTERN_GRID]);
    expect(l.stats.n_order).toBe(21); // 20 * 1.05
    expect(stats({ waste_pct: 10 }).stats.n_order).toBe(22);
  });

  it("4.0 x 3.0 m with 600 mm tiles: 6 x 5 whole tiles and a cut column and row", () => {
    const l = stats({ room_length_m: 4, room_width_m: 3 });
    expect(l.stats.n_tile).toBe(30);
    expect(l.stats.n_cut).toBe(5); // the 0.4 m column; the 3.0 m width is five whole rows
    expect(l.stats.n_laid).toBe(35);
  });

  it("450 mm tiles on 4.0 x 3.0 m: cuts appear on both axes", () => {
    const l = stats({ room_length_m: 4, room_width_m: 3, tile_length_mm: 450, tile_width_mm: 450 });
    expect(l.stats.n_tile).toBe(8 * 6);
    expect(l.stats.n_cut).toBe(9 * 7 - 8 * 6);
  });

  it("the tiles together cover exactly the floor when the joint is zero", () => {
    const l = stats({ room_length_m: 4, room_width_m: 3, tile_length_mm: 450, tile_width_mm: 450 });
    expect(covered(l.tiles)).toBeCloseTo(12, 6);
  });

  it("joint length: 6 vertical and 4 horizontal lines on 4.0 x 3.0 m with 600 tiles", () => {
    const l = stats({ room_length_m: 4, room_width_m: 3 });
    expect(l.stats.len_joint).toBeCloseTo(6 * 3 + 4 * 4, 6);
  });

  it("a tile turned across swaps the axes", () => {
    const a = stats({ room_length_m: 3, room_width_m: 2.4, tile_length_mm: 600, tile_width_mm: 300, grout_mm: 0 });
    const b = stats({ room_length_m: 3, room_width_m: 2.4, tile_length_mm: 600, tile_width_mm: 300, grout_mm: 0, direction: 2 });
    expect(a.stats.n_tile).toBe(5 * 8);
    expect(b.stats.n_tile).toBe(10 * 4);
  });
});

describe("tiles_floor, joint widths", () => {
  it("a 3 mm joint costs a column: 8 tiles + 7 joints no longer fit 4.8 m", () => {
    const tight = stats({ room_length_m: 4.8, room_width_m: 3, grout_mm: 0 });
    expect(tight.stats.n_cut).toBe(0);
    const grouted = stats({ room_length_m: 4.8, room_width_m: 3, grout_mm: 3 });
    expect(grouted.stats.n_tile).toBe(7 * 4);
    expect(grouted.stats.n_cut).toBeGreaterThan(0);
  });

  it("a wider joint never gives more whole tiles, and tiles keep their size", () => {
    const narrow = stats({ room_length_m: 5, room_width_m: 3.6, grout_mm: 2 });
    const wide = stats({ room_length_m: 5, room_width_m: 3.6, grout_mm: 10 });
    expect(wide.stats.n_tile).toBeLessThanOrEqual(narrow.stats.n_tile);
    const whole = wide.tiles.find((t) => t.whole)!;
    expect(area(whole.polys[0])).toBeCloseTo(0.36, 9);
  });

  it("neighbouring whole tiles are one joint width apart", () => {
    const l = stats({ room_length_m: 5, room_width_m: 3.6, grout_mm: 5 });
    const xs = l.tiles.filter((t) => t.whole).map((t) => Math.min(...t.polys[0].map((p) => p[0])));
    const first = [...new Set(xs.map((x) => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
    expect(first[1] - first[0]).toBeCloseTo(0.605, 6);
  });
});

describe("tiles_floor, brick bond", () => {
  it("offsets every other row by half a tile, so the rows start with a half tile", () => {
    const l = stats({ pattern: PATTERN_BRICK });
    // 2.4 m is four rows: the even rows have 5 whole tiles; the odd rows a half tile, 4 whole, a half tile.
    expect(l.stats.n_tile).toBe(2 * 5 + 2 * 4);
    expect(l.stats.n_cut).toBe(2 * 2);
    const half = l.tiles.filter((t) => !t.whole);
    expect(half).toHaveLength(4);
    for (const t of half) expect(area(t.polys[0])).toBeCloseTo(0.18, 6);
  });

  it("covers the floor and uses its higher default waste", () => {
    const l = stats({ pattern: PATTERN_BRICK });
    expect(covered(l.tiles)).toBeCloseTo(7.2, 6);
    expect(l.stats.waste_pct_used).toBe(DEFAULT_WASTE_PCT[PATTERN_BRICK]);
    expect(l.stats.n_order).toBe(Math.ceil(l.stats.n_laid * 1.08));
  });

  it("has the same joint density as the grid", () => {
    const g = stats({ room_length_m: 4.2, room_width_m: 3 }).stats.len_joint;
    const b = stats({ room_length_m: 4.2, room_width_m: 3, pattern: PATTERN_BRICK }).stats.len_joint;
    expect(Math.abs(g - b) / g).toBeLessThan(0.1);
  });
});

describe("tiles_floor, diagonal", () => {
  const room = { room_length_m: 4, room_width_m: 3, tile_length_mm: 450, tile_width_mm: 450, grout_mm: 3 };

  it("covers the floor", () => {
    const l = stats({ ...room, pattern: PATTERN_DIAGONAL });
    expect(covered(l.tiles)).toBeGreaterThan(12 * 0.985);
    expect(covered(l.tiles)).toBeLessThanOrEqual(12 + 1e-6);
  });

  it("needs more tiles and more waste than the grid", () => {
    const grid = stats({ ...room, pattern: PATTERN_GRID });
    const diag = stats({ ...room, pattern: PATTERN_DIAGONAL });
    expect(diag.stats.n_cut).toBeGreaterThan(grid.stats.n_cut);
    expect(diag.stats.waste_pct_used).toBeGreaterThan(grid.stats.waste_pct_used);
    expect(diag.stats.n_order).toBeGreaterThan(grid.stats.n_order);
  });

  it("the other direction mirrors the lay", () => {
    const a = stats({ ...room, pattern: PATTERN_DIAGONAL });
    const b = stats({ ...room, pattern: PATTERN_DIAGONAL, direction: 2 });
    expect(b.stats.n_tile + b.stats.n_cut).toBe(a.stats.n_tile + a.stats.n_cut);
  });

  it("layWithPattern re-lays the same room under another pattern", () => {
    const r = layWithPattern({ ...ROOM, room_length_m: 4, room_width_m: 3 }, PATTERN_DIAGONAL);
    expect(r.ok && r.layout.inputs.pattern).toBe(PATTERN_DIAGONAL);
  });
});

describe("tiles_floor, L-shape, border, skirting", () => {
  it("an L-shape removes the corner: area, cuts and one split tile", () => {
    const l = stats({ room_length_m: 4.2, room_width_m: 3, cutout_length_m: 1.8, cutout_width_m: 1.2 });
    expect(l.stats.area_floor).toBeCloseTo(4.2 * 3 - 1.8 * 1.2, 6);
    expect(covered(l.tiles)).toBeCloseTo(4.2 * 3 - 1.8 * 1.2, 6);
    // 7 x 5 positions, the 3 x 2 positions in the corner are gone.
    expect(l.stats.n_tile).toBe(7 * 5 - 3 * 2);
    expect(l.stats.len_perimeter).toBeCloseTo(2 * (4.2 + 3), 6);
  });

  it("a cut-out must be given as both sides and leave room", () => {
    expect(layTiles({ ...ROOM, cutout_length_m: 1 }).ok).toBe(false);
    expect(layTiles({ ...ROOM, cutout_length_m: 3, cutout_width_m: 1 }).ok).toBe(false);
  });

  it("a border ring takes strips and shrinks the field", () => {
    const plain = stats({ room_length_m: 4, room_width_m: 3 });
    const bordered = stats({ room_length_m: 4, room_width_m: 3, border_mm: 100 });
    expect(bordered.stats.n_border).toBeGreaterThan(0);
    expect(bordered.stats.n_border_tiles).toBeGreaterThan(0);
    expect(covered(bordered.tiles)).toBeCloseTo(3.8 * 2.8, 6);
    expect(covered(bordered.tiles) + covered(bordered.strips)).toBeCloseTo(12, 6);
    expect(plain.stats.len_joint).toBeLessThan(bordered.stats.len_joint + 100);
    expect(bordered.field.x0).toBeCloseTo(0.1, 9);
  });

  it("a border on an L-shape is dropped with a warning", () => {
    const l = stats({ room_length_m: 4.2, room_width_m: 3, cutout_length_m: 1.8, cutout_width_m: 1.2, border_mm: 100 });
    expect(l.stats.n_border).toBe(0);
    expect(l.warnings.join(" ")).toMatch(/border/i);
  });

  it("skirting is the perimeter less the door, or nothing when switched off", () => {
    const l = stats({ room_length_m: 4, room_width_m: 3 });
    expect(l.stats.len_perimeter).toBe(14);
    expect(l.stats.len_skirting).toBeCloseTo(14 - 0.9, 6);
    expect(stats({ include_skirting: 0 }).stats.len_skirting).toBe(0);
  });
});

describe("tiles_floor, rejected inputs", () => {
  it.each([
    ["zero length", { room_length_m: 0 }],
    ["negative width", { room_width_m: -2 }],
    ["zero tile", { tile_length_mm: 0 }],
    ["negative tile", { tile_width_mm: -300 }],
    ["negative joint", { grout_mm: -1 }],
    ["joint far wider than any real joint", { grout_mm: 25 }],
    ["not a number", { room_length_m: Number.NaN }],
    ["unknown pattern", { pattern: 9 }],
    ["negative waste", { waste_pct: -5 }],
  ])("%s is an error, not a guess", (_n, over) => {
    expect(layTiles({ ...ROOM, ...over }).ok).toBe(false);
    expect(layoutTilesFloor({ ...ROOM, ...over }).ok).toBe(false);
  });

  it("a missing required input is an error", () => {
    expect(layTiles({ room_width_m: 3, tile_length_mm: 600, tile_width_mm: 600 }).ok).toBe(false);
  });

  it("a floor that needs an absurd number of tiles is refused", () => {
    const r = layTiles({ ...ROOM, room_length_m: 100, room_width_m: 100, tile_length_mm: 100, tile_width_mm: 100 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(String(MAX_TILES));
  });
});

describe("tiles_floor, the module and the formula scope", () => {
  const mod = getGeometry("tiles_floor")!;

  it("is registered, drawn as a floor plan", () => {
    expect(GEOMETRY_KEYS).toContain("tiles_floor");
    expect(mod).toBe(TILES_FLOOR_MODULE);
    expect(mod.view).toBe("floor_plan");
  });

  it("lists the extras it puts in the scope", () => {
    const ids = geometryIdentifiers(mod);
    for (const k of ["n_tile", "n_cut", "n_order", "area_floor", "len_joint", "len_perimeter", "len_skirting"]) expect(ids).toContain(k);
  });

  it("puts the counts in the scope with the names a formula reads", () => {
    const r = layoutTilesFloor({ ...ROOM, room_length_m: 4, room_width_m: 3 });
    if (!r.ok) throw new Error(r.error);
    const scope = pieceScope(mod, r.model, 2.4);
    expect(scope.n_tile).toBe(30);
    expect(scope.n_cut).toBe(5);
    expect(scope.area_floor).toBe(12);
    expect(scope.len_perimeter).toBe(14);
    expect(scope.n_FL).toBe(1);
    expect(scope.area_FL).toBe(12);
  });

  it("an L-shaped room is two floor pieces; the model echoes its inputs for the preview", () => {
    const r = layoutTilesFloor({ ...ROOM, room_length_m: 4.2, room_width_m: 3, cutout_length_m: 1.8, cutout_width_m: 1.2 });
    if (!r.ok) throw new Error(r.error);
    expect(r.model.pieces).toHaveLength(2);
    expect(r.model.inputs?.room_length_m).toBe(4.2);
    expect(r.model.inputs?.pattern).toBe(PATTERN_GRID);
  });

  it("is deterministic", () => {
    const a = layoutTilesFloor({ ...ROOM, pattern: PATTERN_DIAGONAL });
    const b = layoutTilesFloor({ ...ROOM, pattern: PATTERN_DIAGONAL });
    expect(a).toEqual(b);
  });
});

describe("tile swatches", () => {
  it("have unique option numbers and fall back to the first", () => {
    expect(new Set(TILE_SWATCHES.map((s) => s.value)).size).toBe(TILE_SWATCHES.length);
    expect(swatchFor(99).value).toBe(1);
    expect(swatchFor(3).key).toBe("charcoal");
  });
});
