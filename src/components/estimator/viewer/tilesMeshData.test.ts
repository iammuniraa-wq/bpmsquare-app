import { describe, it, expect } from "vitest";
import { layTiles, MAX_TILES, PATTERN_BRICK, PATTERN_DIAGONAL, PATTERN_GRID, TILES_FLOOR_MODULE, TILES_SLOTS } from "@/lib/estimator/geometry/tilesFloor";
import type { TileLayout } from "@/lib/estimator/geometry/tilesFloor";
import { swatchFromVisuals, swatchFor } from "@/lib/estimator/geometry/tileSwatches";
import { TILES_FLOOR_STARTER } from "@/lib/estimator/starterTemplatesTiles";
import { resolveVisuals } from "@/lib/estimator/visuals";
import {
  allTiles, buildTileMesh, hash01, revealCount, roomOutline, skirtingBoards, slotValues, tileUv, tileVariant, toWorld, uvModeFor,
  viewDistances, wallPlacements, TILE_TOP_M,
} from "./tilesMeshData";

const ROOM = { room_length_m: 3, room_width_m: 2.4, tile_length_mm: 600, tile_width_mm: 600, grout_mm: 3, pattern: PATTERN_GRID };

function lay(over: Record<string, number> = {}): TileLayout {
  const r = layTiles({ ...ROOM, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.layout;
}

const NOFLIP = { flipU: false, flipV: false, offU: 0, offV: 0 };

describe("design slots of the tiles module", () => {
  it("declares tile, grout and skirting with defaults", () => {
    expect(TILES_FLOOR_MODULE.slots).toBe(TILES_SLOTS);
    expect(TILES_SLOTS.map((s) => [s.key, s.default])).toEqual([
      ["tile", "porcelain_white"], ["grout", "#9a9a96"], ["skirting", "#f2f2ee"],
    ]);
  });

  it("fills any missing slot from the module defaults", () => {
    expect(slotValues(undefined)).toEqual({ tile: "porcelain_white", grout: "#9a9a96", skirting: "#f2f2ee" });
    expect(slotValues({ tile: "wood_oak" })).toEqual({ tile: "wood_oak", grout: "#9a9a96", skirting: "#f2f2ee" });
    expect(slotValues({ grout: "#112233" }).grout).toBe("#112233");
  });

  it("the starter's finish select paints the tile slot with each option's material", () => {
    const finish = TILES_FLOOR_STARTER.inputs.find((i) => i.key === "finish");
    expect(finish?.paints).toBe("tile");
    expect(finish?.options?.map((o) => o.visual)).toEqual(["porcelain_white", "porcelain_grey", "marble_white", "terrazzo", "ceramic_beige", "wood_oak"]);
    expect(finish?.options?.every((o) => o.key === o.visual)).toBe(true);
    const v = resolveVisuals(TILES_SLOTS, TILES_FLOOR_STARTER.inputs, { finish: "marble_white" });
    expect(v.tile).toBe("marble_white");
    expect(resolveVisuals(TILES_SLOTS, TILES_FLOOR_STARTER.inputs, {}).tile).toBe("porcelain_white");
  });
});

describe("texture mapping", () => {
  it("maps one texture image per tile for tile finishes and a plank window for wood", () => {
    for (const k of ["porcelain_white", "porcelain_grey", "marble_white", "terrazzo", "ceramic_beige", "#aabbcc", "unknown"]) expect(uvModeFor(k)).toBe("tile");
    expect(uvModeFor("wood_oak")).toBe("plank");
  });

  it("a whole tile covers the texture exactly once, corner to corner", () => {
    const l = lay();
    const t = l.tiles.find((x) => x.whole)!;
    const c = t.polys[0];
    const uvs = c.map((p) => tileUv(t.frame, p, "tile", NOFLIP));
    const us = uvs.map((u) => Math.round(u[0] * 1e6) / 1e6);
    const vs = uvs.map((u) => Math.round(u[1] * 1e6) / 1e6);
    expect(Math.min(...us)).toBe(0);
    expect(Math.max(...us)).toBe(1);
    expect(Math.min(...vs)).toBe(0);
    expect(Math.max(...vs)).toBe(1);
  });

  it("a cut tile keeps the texture of the whole tile it was cut from", () => {
    const l = lay({ room_length_m: 3.3 });
    const cut = l.tiles.find((x) => !x.whole)!;
    const uvs = cut.polys[0].map((p) => tileUv(cut.frame, p, "tile", NOFLIP));
    expect(Math.min(...uvs.map((u) => u[0]))).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...uvs.map((u) => u[0]))).toBeLessThan(1);
    expect(Math.max(...uvs.map((u) => u[1]))).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("follows a diagonal tile's own axes", () => {
    const l = lay({ pattern: PATTERN_DIAGONAL });
    const t = l.tiles.find((x) => x.whole)!;
    const uvs = t.polys[0].map((p) => tileUv(t.frame, p, "tile", NOFLIP));
    const us = uvs.map((u) => u[0]);
    const vs = uvs.map((u) => u[1]);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(1, 6);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(1, 6);
  });

  it("flips mirror the tile image and plank mode works in metres with the grain along the long side", () => {
    const l = lay();
    const t = l.tiles[0];
    const p = t.polys[0][2];
    expect(tileUv(t.frame, p, "tile", { ...NOFLIP, flipU: true })[0]).toBeCloseTo(0, 6);
    const plank = lay({ tile_length_mm: 1200, tile_width_mm: 200, room_length_m: 4.8, room_width_m: 2 });
    const pt = plank.tiles[0];
    const far = pt.polys[0][2];
    const [u, v] = tileUv(pt.frame, far, "plank", NOFLIP);
    expect(u).toBeCloseTo(1.2, 6);
    expect(v).toBeCloseTo(0.2, 6);
    const turned = lay({ tile_length_mm: 1200, tile_width_mm: 200, room_length_m: 4.8, room_width_m: 2, direction: 2 });
    const tt = turned.tiles[0];
    const [u2, v2] = tileUv(tt.frame, tt.polys[0][2], "plank", NOFLIP);
    expect(u2).toBeCloseTo(1.2, 6);
    expect(v2).toBeCloseTo(0.2, 6);
  });

  it("variation is stable and spread out", () => {
    expect(tileVariant(5)).toEqual(tileVariant(5));
    const flips = new Set(Array.from({ length: 64 }, (_, i) => `${tileVariant(i).flipU}${tileVariant(i).flipV}`));
    expect(flips.size).toBe(4);
    expect(hash01(1)).toBeGreaterThanOrEqual(0);
    expect(hash01(1)).toBeLessThan(1);
  });
});

describe("the merged tile mesh", () => {
  it("has one vertex per polygon corner and a fan of triangles per polygon", () => {
    for (const over of [{} as Record<string, number>, { pattern: PATTERN_BRICK }, { pattern: PATTERN_DIAGONAL }, { cutout_length_m: 1, cutout_width_m: 1 }, { border_mm: 100 }]) {
      const l = lay(over);
      const d = buildTileMesh(l, "tile");
      const polys = allTiles(l).flatMap((t) => t.polys);
      const verts = polys.reduce((a, p) => a + p.length, 0);
      const tris = polys.reduce((a, p) => a + p.length - 2, 0);
      expect(d.positions.length).toBe(verts * 3);
      expect(d.uvs.length).toBe(verts * 2);
      expect(d.colors.length).toBe(verts * 3);
      expect(d.indices.length).toBe(tris * 3);
      expect(d.triangles).toBe(tris);
      expect(d.tiles).toBe(allTiles(l).length);
      expect(Math.max(...d.indices)).toBeLessThan(verts);
    }
  });

  it("every triangle faces up and lies at the tile top", () => {
    const l = lay({ pattern: PATTERN_DIAGONAL, cutout_length_m: 1, cutout_width_m: 0.8 });
    const d = buildTileMesh(l, "tile");
    for (let i = 0; i < d.indices.length; i += 3) {
      const [a, b, c] = [d.indices[i], d.indices[i + 1], d.indices[i + 2]].map((k) => [d.positions[k * 3], d.positions[k * 3 + 1], d.positions[k * 3 + 2]]);
      expect(a[1]).toBeCloseTo(TILE_TOP_M, 9);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(ny).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("covers exactly the floor area the layout counted, so an L-shaped room shows its notch", () => {
    const l = lay({ cutout_length_m: 1, cutout_width_m: 0.8, grout_mm: 0 });
    const d = buildTileMesh(l, "tile");
    let area = 0;
    for (let i = 0; i < d.indices.length; i += 3) {
      const [a, b, c] = [d.indices[i], d.indices[i + 1], d.indices[i + 2]].map((k) => [d.positions[k * 3], d.positions[k * 3 + 2]]);
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    }
    expect(area).toBeCloseTo(3 * 2.4 - 1 * 0.8, 3);
    expect(roomOutline(l)).toHaveLength(6);
  });

  it("builds the largest allowed floor quickly and as one draw", () => {
    const l = lay({ room_length_m: 28, room_width_m: 28, tile_length_mm: 240, tile_width_mm: 240, grout_mm: 2, pattern: PATTERN_DIAGONAL });
    expect(l.tiles.length).toBeGreaterThan(5000);
    expect(l.tiles.length).toBeLessThanOrEqual(MAX_TILES * 1.2);
    const t0 = Date.now();
    const d = buildTileMesh(l, "tile");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(d.positions.length / 3).toBeLessThan(MAX_TILES * 1.3 * 8);
  });

  it("reveals tiles in laying order", () => {
    const d = buildTileMesh(lay(), "tile");
    expect(revealCount(d, 0)).toBe(0);
    expect(revealCount(d, 1)).toBe(d.indices.length);
    expect(revealCount(d, 0.5)).toBe(d.tileEnds[Math.floor(d.tiles / 2) - 1]);
    for (let i = 1; i < d.tileEnds.length; i++) expect(d.tileEnds[i]).toBeGreaterThan(d.tileEnds[i - 1]);
  });
});

describe("room dressing", () => {
  it("centres the room and turns plan y into -Z", () => {
    expect(toWorld({ length: 4, width: 2 }, 0, 0)).toEqual([-2, 1]);
    expect(toWorld({ length: 4, width: 2 }, 4, 2)).toEqual([2, -1]);
  });

  it("keeps two walls for a rectangle and three for an L, the window in the back one", () => {
    const rect = wallPlacements(lay());
    expect(rect.map((w) => w.name)).toEqual(["left", "back"]);
    expect(rect.filter((w) => w.window)).toHaveLength(1);
    expect(rect[1].window).not.toBeNull();
    const ell = wallPlacements(lay({ cutout_length_m: 1, cutout_width_m: 0.8 }));
    expect(ell.map((w) => w.name)).toEqual(["left", "back", "notch"]);
    expect(ell[1].length).toBeCloseTo(2, 6);
  });

  it("walls stand outside the floor, on the side the room is not", () => {
    for (const w of wallPlacements(lay())) {
      expect(Math.abs(Math.hypot(w.outward[0], w.outward[1]) - 1)).toBeLessThan(1e-9);
      // local x = up x outward
      expect(w.dir[0]).toBeCloseTo(w.outward[1], 9);
      expect(w.dir[1]).toBeCloseTo(-w.outward[0], 9);
    }
  });

  it("draws skirting boards that add up to len_skirting, with a gap for the door", () => {
    const l = lay();
    const boards = skirtingBoards(l);
    expect(boards.length).toBe(5);
    const total = boards.reduce((a, b) => a + b.length, 0);
    expect(total).toBeCloseTo(l.stats.len_skirting, 3);
    expect(skirtingBoards(lay({ include_skirting: 0 }))).toEqual([]);
    const ell = lay({ cutout_length_m: 1, cutout_width_m: 0.8 });
    expect(skirtingBoards(ell).reduce((a, b) => a + b.length, 0)).toBeCloseTo(ell.stats.len_skirting, 3);
  });

  it("frames a small bathroom close and a big hall far", () => {
    const a = viewDistances(lay({ room_length_m: 2, room_width_m: 1.8 }));
    const b = viewDistances(lay({ room_length_m: 40, room_width_m: 30, tile_length_mm: 1200, tile_width_mm: 1200 }));
    expect(a.start).toBeLessThan(b.start);
    expect(a.min).toBeLessThan(b.min);
    expect(b.max).toBeGreaterThan(b.start);
  });
});

describe("the 2D plan follows the same slots", () => {
  it("paints the plan from the tile and grout slots", () => {
    const s = swatchFromVisuals({ tile: "marble_white", grout: "#445566" });
    expect(s.texture).toBe("veined");
    expect(s.grout).toBe("#445566");
    expect(s.tones[0]).toBe("#efeeee");
    expect(swatchFromVisuals({ tile: "wood_oak" }).texture).toBe("wood");
    expect(swatchFromVisuals({ tile: "#123456" }).tones[0]).toBe("#123456");
    expect(swatchFromVisuals({}, swatchFor(3)).key).toBe("charcoal");
  });
});
