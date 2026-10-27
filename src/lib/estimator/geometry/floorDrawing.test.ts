import { describe, it, expect } from "vitest";
import { buildFloorDrawing, speckleDots } from "./floorDrawing";
import { layTiles } from "./tilesFloor";
import type { TileLayout } from "./tilesFloor";

const BASE = { room_length_m: 5, room_width_m: 3.5, tile_length_mm: 600, tile_width_mm: 600, grout_mm: 3, pattern: 1 };

function lay(over: Record<string, number> = {}): TileLayout {
  const r = layTiles({ ...BASE, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.layout;
}
const subpaths = (d: string): number => (d.match(/M/g) ?? []).length;

describe("floor drawing", () => {
  it("draws one closed shape per tile: whole tiles by tone, cut tiles, nothing lost", () => {
    const l = lay();
    const d = buildFloorDrawing(l);
    expect(d.whole.reduce((a, p) => a + subpaths(p), 0)).toBe(l.stats.n_tile);
    expect(subpaths(d.cut)).toBe(l.stats.n_cut);
    expect(d.strips).toBe("");
  });

  it("spreads whole tiles over three tones so the floor reads as separate tiles", () => {
    const d = buildFloorDrawing(lay());
    expect(d.whole.every((p) => p.length > 0)).toBe(true);
  });

  it("the room is a rectangle, or six points for an L-shape", () => {
    expect(buildFloorDrawing(lay()).room.match(/L/g)).toHaveLength(3);
    expect(buildFloorDrawing(lay({ cutout_length_m: 2, cutout_width_m: 1.5 })).room.match(/L/g)).toHaveLength(5);
  });

  it("a cut tile split by the L-corner is two shapes of one tile", () => {
    const l = lay({ room_length_m: 4.2, room_width_m: 3, cutout_length_m: 1.7, cutout_width_m: 1.1 });
    const d = buildFloorDrawing(l);
    const shapes = l.tiles.filter((t) => !t.whole).reduce((a, t) => a + t.polys.length, 0);
    expect(subpaths(d.cut)).toBe(shapes);
    expect(shapes).toBeGreaterThan(l.stats.n_cut - 1);
  });

  it("border strips are drawn", () => {
    const l = lay({ border_mm: 100 });
    expect(subpaths(buildFloorDrawing(l).strips)).toBe(l.strips.length);
  });

  it("flips y so the laying corner is bottom left", () => {
    const d = buildFloorDrawing(lay());
    expect(d.room.startsWith("M0 3.5L5 3.5")).toBe(true);
  });

  it("the view box has room for the dimension labels, which scale with the room", () => {
    const small = buildFloorDrawing(lay({ room_length_m: 2, room_width_m: 2 }));
    const big = buildFloorDrawing(lay({ room_length_m: 20, room_width_m: 15 }));
    expect(small.viewBox.x).toBeLessThan(0);
    expect(small.viewBox.y).toBeLessThan(0);
    expect(small.viewBox.w).toBeGreaterThan(2);
    expect(big.fontSize).toBeGreaterThan(small.fontSize * 5);
    expect(big.dims.top.label).toBe("20 m");
    expect(big.dims.left.label).toBe("15 m");
  });

  it("speckle dots are the same every time", () => {
    expect(speckleDots(10, 0.9)).toEqual(speckleDots(10, 0.9));
    expect(speckleDots(10, 0.9)).toHaveLength(10);
    for (const d of speckleDots(30, 0.9)) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThan(0.9);
    }
  });
});
