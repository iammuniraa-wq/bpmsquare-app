// The numbers behind the 3D floor-tiles room: typed arrays for one merged tile mesh, the wall and skirting
// placements, and the texture mapping. No three.js here, so it is unit-tested; tilesRoomScene.ts only turns
// these into meshes. Plan coordinates are the layout's (x along the length, y along the width, metres); the
// room is centred on the origin and plan y runs to -Z, so the 3D room is the 2D plan seen from the front.

import { TILES_SLOTS } from "@/lib/estimator/geometry/tilesFloor";
import type { LaidTile, Poly, Pt, TileFrame, TileLayout } from "@/lib/estimator/geometry/tilesFloor";
import { getMaterialDef } from "@/lib/estimator/materialCatalog";

export const TILE_TOP_M = 0.01;
/** Grout sits a little under the tile tops, so every joint reads as a groove. */
export const GROUT_TOP_M = 0.0085;
export const SLAB_DEPTH_M = 0.12;
export const WALL_HEIGHT_M = 2.6;
export const WALL_THICK_M = 0.1;
export const SKIRTING_THICK_M = 0.012;

export type Vec2 = [number, number];

/** Plan (x, y) to the scene's (X, Z). */
export function toWorld(size: { length: number; width: number }, x: number, y: number): Vec2 {
  return [x - size.length / 2, -(y - size.width / 2)];
}

/** A stable pseudo-random number in [0, 1) from a counter and a salt. */
export function hash01(n: number, salt = 0): number {
  let h = (Math.imul(n + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// ── texture mapping ──────────────────────────────────────────────────────────

/**
 * "tile": one texture image covers one tile (porcelain, ceramic, marble, terrazzo, or a plain colour).
 * "plank": the texture keeps its real size in metres (the catalogue's repeat_m) and each plank takes
 * its own window of it, grain along the plank (wood).
 */
export type UvMode = "tile" | "plank";

export function uvModeFor(value: string): UvMode {
  return getMaterialDef(value)?.group === "wood" ? "plank" : "tile";
}

/** What differs from tile to tile so a floor of one texture does not look stamped. */
export type TileVariant = { flipU: boolean; flipV: boolean; offU: number; offV: number };

export function tileVariant(index: number): TileVariant {
  return {
    flipU: hash01(index, 1) < 0.5, flipV: hash01(index, 2) < 0.5,
    offU: hash01(index, 3) * 4.7, offV: hash01(index, 4) * 4.7,
  };
}

/** The texture coordinates of a plan point on a tile whose own axes are `frame`. */
export function tileUv(frame: TileFrame, p: Pt, mode: UvMode, variant: TileVariant): Vec2 {
  const dx = p[0] - frame.ox;
  const dy = p[1] - frame.oy;
  const c = Math.cos(frame.ang);
  const s = Math.sin(frame.ang);
  const along = dx * c + dy * s;
  const across = -dx * s + dy * c;
  if (mode === "tile") {
    const u = along / frame.du;
    const v = across / frame.dv;
    return [variant.flipU ? 1 - u : u, variant.flipV ? 1 - v : v];
  }
  // plank: metres, grain (u) along the long side
  const longAlong = frame.du >= frame.dv;
  const a = longAlong ? along : across;
  const b = longAlong ? across : along;
  return [a + variant.offU, b + variant.offV];
}

// ── the merged tile mesh ─────────────────────────────────────────────────────

export type TileMeshData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Per-vertex tone (multiplies the texture): near 1, a few percent either way. */
  colors: Float32Array;
  indices: Uint32Array;
  /** Whole tiles and cut tiles drawn, counting a tile that an L-shape splits as one. */
  tiles: number;
  triangles: number;
  /** Index count to draw to show the first i + 1 tiles (the laying animation); length = tiles. */
  tileEnds: Uint32Array;
};

function signedArea(p: Poly): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

/** Every laid tile, the border strips after the field, in laying order. */
export function allTiles(layout: TileLayout): LaidTile[] {
  return [...layout.tiles, ...layout.strips];
}

/**
 * One merged geometry for the whole floor: each tile polygon (already clipped by the walls, the L corner
 * and the border, so a cut tile is a real cut shape) as a triangle fan facing up at TILE_TOP_M. 15,000
 * tiles are about 70,000 vertices, one draw call.
 */
export function buildTileMesh(layout: TileLayout, mode: UvMode): TileMeshData {
  const size = layout.inputs;
  const tiles = allTiles(layout);
  let nv = 0;
  let nt = 0;
  for (const t of tiles) for (const p of t.polys) { nv += p.length; nt += p.length - 2; }

  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const uvs = new Float32Array(nv * 2);
  const colors = new Float32Array(nv * 3);
  const indices = new Uint32Array(nt * 3);
  const tileEnds = new Uint32Array(tiles.length);

  let v = 0;
  let ix = 0;
  tiles.forEach((tile, ti) => {
    const variant = tileVariant(ti);
    const tone = 0.93 + tile.tone * 0.035 + (hash01(ti, 9) - 0.5) * 0.03;
    for (const poly0 of tile.polys) {
      // Plan-counter-clockwise faces up in the scene (x stays, y becomes -Z).
      const poly = signedArea(poly0) < 0 ? [...poly0].reverse() : poly0;
      const first = v;
      for (const pt of poly) {
        const [X, Z] = toWorld(size, pt[0], pt[1]);
        const [u, w] = tileUv(tile.frame, pt, mode, variant);
        positions[v * 3] = X;
        positions[v * 3 + 1] = TILE_TOP_M;
        positions[v * 3 + 2] = Z;
        normals[v * 3 + 1] = 1;
        uvs[v * 2] = u;
        uvs[v * 2 + 1] = w;
        colors[v * 3] = colors[v * 3 + 1] = colors[v * 3 + 2] = tone;
        v++;
      }
      for (let k = 1; k < poly.length - 1; k++) {
        indices[ix++] = first;
        indices[ix++] = first + k;
        indices[ix++] = first + k + 1;
      }
    }
    tileEnds[ti] = ix;
  });
  return { positions, normals, uvs, colors, indices, tiles: tiles.length, triangles: nt, tileEnds };
}

/** The index count to draw so that `fraction` (0..1) of the tiles are laid. */
export function revealCount(data: Pick<TileMeshData, "tileEnds" | "indices">, fraction: number): number {
  const n = data.tileEnds.length;
  if (n === 0) return 0;
  const k = Math.max(0, Math.min(1, fraction));
  if (k >= 1) return data.indices.length;
  const upTo = Math.floor(k * n);
  return upTo <= 0 ? 0 : data.tileEnds[upTo - 1];
}

// ── room outline, walls, skirting ────────────────────────────────────────────

/** The room outline, counter-clockwise in plan: the rectangle, or the L with its corner cut away. */
export function roomOutline(layout: Pick<TileLayout, "inputs">): Pt[] {
  const { length: L, width: W, cutL, cutW } = layout.inputs;
  return cutL > 0
    ? [[0, 0], [L, 0], [L, W - cutW], [L - cutL, W - cutW], [L - cutL, W], [0, W]]
    : [[0, 0], [L, 0], [L, W], [0, W]];
}

export type WallPlacement = {
  name: "left" | "back" | "notch";
  /** Scene X, Z of the wall's start (its local x = 0 end, on the room's edge). */
  origin: Vec2;
  /** Scene direction of the wall's length (local +x) and of its thickness (local +z, away from the room). */
  dir: Vec2;
  outward: Vec2;
  length: number;
  /** A window in the wall: width, height, sill (m); the hole is centred on the wall. */
  window: { w: number; h: number; sill: number } | null;
};

/**
 * The cut-away room keeps two or three walls: the left and the back one, and in an L the short face of
 * the corner that is cut out. The back wall carries the window the light comes through; the walls stand
 * outside the floor so they never overlap a tile.
 */
export function wallPlacements(layout: Pick<TileLayout, "inputs">): WallPlacement[] {
  const size = layout.inputs;
  const { length: L, width: W, cutL, cutW } = size;
  const backLen = cutL > 0 ? L - cutL : L;
  const out: WallPlacement[] = [];
  const edge = (name: WallPlacement["name"], a: Pt, b: Pt, outwardPlan: Pt, window: WallPlacement["window"]) => {
    const [ax, az] = toWorld(size, a[0], a[1]);
    const [bx, bz] = toWorld(size, b[0], b[1]);
    const length = Math.hypot(bx - ax, bz - az);
    const outward: Vec2 = [outwardPlan[0], -outwardPlan[1]];
    // local x = up x outward, so (x, y, z) is right-handed with y up.
    const dir: Vec2 = [outward[1], -outward[0]];
    // Start at whichever end the direction runs away from.
    const along = (bx - ax) * dir[0] + (bz - az) * dir[1];
    out.push({ name, origin: along >= 0 ? [ax, az] : [bx, bz], dir, outward, length, window });
  };
  edge("left", [0, 0], [0, W], [-1, 0], null);
  const winW = Math.min(1.4, Math.max(0.5, backLen * 0.4));
  const winH = 1.1;
  edge("back", [0, W], [backLen, W], [0, 1], backLen >= 1 ? { w: winW, h: winH, sill: 0.9 } : null);
  if (cutL > 0) edge("notch", [L - cutL, W - cutW], [L - cutL, W], [1, 0], null);
  return out;
}

export type SkirtingBoard = {
  /** Scene X, Z of the board's centre, already moved to the room side of the wall. */
  centre: Vec2;
  length: number;
  /** The board runs along the scene X axis (true) or the Z axis. */
  alongX: boolean;
};

/** The skirting boards round the room, with a gap for the door on the front edge. Their total is len_skirting. */
export function skirtingBoards(layout: TileLayout): SkirtingBoard[] {
  const v = layout.inputs;
  if (!v.skirting) return [];
  const size = v;
  const pts = roomOutline(layout);
  const boards: SkirtingBoard[] = [];
  const doorFits = (len: number) => v.doorWidth > 0 && len > v.doorWidth + 0.4;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const dx = (b[0] - a[0]) / len;
    const dy = (b[1] - a[1]) / len;
    const inward: Pt = [-dy, dx];
    // The door is in the front edge (plan y = 0), the one the cut-away leaves open.
    const isFront = i === 0;
    const pieces: [number, number][] = isFront && doorFits(len)
      ? [[0, (len - v.doorWidth) / 2], [(len + v.doorWidth) / 2, len]]
      : [[0, len]];
    for (const [s0, s1] of pieces) {
      const m = (s0 + s1) / 2;
      const off = SKIRTING_THICK_M / 2;
      const cx = a[0] + dx * m + inward[0] * off;
      const cy = a[1] + dy * m + inward[1] * off;
      boards.push({ centre: toWorld(size, cx, cy), length: s1 - s0, alongX: Math.abs(dx) > 0.5 });
    }
  }
  return boards;
}

// ── framing ──────────────────────────────────────────────────────────────────

/** The camera's first distance and its limits for a room, so a 2 m bathroom and a 40 m hall both fit. */
export function viewDistances(layout: Pick<TileLayout, "inputs">): { start: number; min: number; max: number; size: number } {
  const size = Math.hypot(layout.inputs.length, layout.inputs.width);
  return { start: Math.max(2.8, size * 1.45 + 1.6), min: Math.max(0.6, size * 0.12), max: Math.max(8, size * 4), size };
}

export type TileSlotValues = { tile: string; grout: string; skirting: string };

const slotDefault = (key: keyof TileSlotValues): string => TILES_SLOTS.find((x) => x.key === key)?.default ?? "#cccccc";

/** The three design slots of the room, each with the module's default behind it. */
export function slotValues(visuals: Readonly<Record<string, string>> | undefined): TileSlotValues {
  return {
    tile: visuals?.tile || slotDefault("tile"),
    grout: visuals?.grout || slotDefault("grout"),
    skirting: visuals?.skirting || slotDefault("skirting"),
  };
}
