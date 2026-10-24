// Geometry module "tiles_floor": a tiled floor laid out tile by tile.
//
// The room is a rectangle (optionally an L: one corner cut away). Whole and
// cut tiles are laid in a grid, a running (brick) bond with a 50% offset, or
// on the diagonal at 45 degrees. The counts feed the BOM (adhesive, grout,
// spacers, skirting) through the formula scope; the same layout drives the 2D
// floor preview (components/estimator/viewer/FloorPreview.tsx), which is why
// layTiles() returns the tile polygons and the module only keeps the numbers.
//
// What a "cut tile" is: any tile position that is not a complete tile, i.e.
// trimmed by a wall, by the corner of an L, or by the border. Each cut position
// is counted as one tile to buy (no off-cut re-use is assumed), and the waste
// allowance on top covers breakage and mismatched off-cuts. Waste defaults by
// pattern are ILLUSTRATIVE placeholders: a real fitter replaces them.
//
// Axes: x runs along the room length, y along its width, origin at the corner
// where laying starts (grid and brick start there; the diagonal starts from a
// tile centred in the room). Metres everywhere except the mm inputs.

import { roundHalfAway } from "../formula";
import type { GeometryInputSpec, GeometryModel, GeometryModule, GeometryResult, Piece, PieceCodeInfo } from "./types";

export const TILES_FLOOR_KEY = "tiles_floor";

export const PATTERN_GRID = 1;
export const PATTERN_BRICK = 2;
export const PATTERN_DIAGONAL = 3;
export const PATTERNS = [
  { value: PATTERN_GRID, key: "grid", label: "Straight grid" },
  { value: PATTERN_BRICK, key: "brick", label: "Brick (50% offset)" },
  { value: PATTERN_DIAGONAL, key: "diagonal", label: "Diagonal (45°)" },
] as const;

/** Waste allowance (%) when the person gives none; ILLUSTRATIVE, diagonal is higher. */
export const DEFAULT_WASTE_PCT: Readonly<Record<number, number>> = { [PATTERN_GRID]: 5, [PATTERN_BRICK]: 8, [PATTERN_DIAGONAL]: 12 };

export const MAX_TILES = 15000;
const EPS = 1e-6;
/** A piece thinner than this (m) is grout, not a tile. */
const MIN_PIECE_SIDE_M = 0.002;
/** A diagonal corner chip smaller than this (m2) is ignored. */
const MIN_PIECE_AREA_M2 = 1e-4;
const TILE_THICKNESS_M = 0.01;

const LIMITS = {
  room: { min: 0.3, max: 200 },
  tileMm: { min: 50, max: 2400 },
  groutMm: { min: 0, max: 20 },
  borderMm: { min: 0, max: 500 },
  skirtingMm: { min: 30, max: 400 },
  doorM: { min: 0, max: 10 },
  wastePct: { min: 0, max: 50 },
} as const;

const PIECE_CODES: readonly PieceCodeInfo[] = [{ code: "FL", label: "Floor to be tiled" }];

const INPUTS: readonly GeometryInputSpec[] = [
  { key: "room_length_m", required: true },
  { key: "room_width_m", required: true },
  { key: "tile_length_mm", required: true },
  { key: "tile_width_mm", required: true },
  { key: "grout_mm", required: false, default: 3 },
  { key: "pattern", required: false, default: PATTERN_GRID, allow_select: true },
  { key: "direction", required: false, default: 1, allow_select: true },
  { key: "tile_color", required: false, default: 1, allow_select: true },
  { key: "cutout_length_m", required: false, default: 0 },
  { key: "cutout_width_m", required: false, default: 0 },
  { key: "border_mm", required: false, default: 0 },
  { key: "include_skirting", required: false, default: 1 },
  { key: "skirting_height_mm", required: false, default: 100 },
  { key: "door_width_m", required: false, default: 0.9 },
  { key: "waste_pct", required: false, default: 0 },
];

/** Names the module puts in the formula scope (section 10.2 of the estimator doc). */
export const TILES_EXTRA_IDENTIFIERS = [
  "n_tile", "n_cut", "n_laid", "n_order", "waste_pct_used",
  "n_border", "n_border_tiles",
  "area_floor", "area_tile", "area_cover",
  "len_joint", "len_perimeter", "len_skirting",
] as const;

// ── geometry helpers ─────────────────────────────────────────────────────────

export type Pt = [number, number];
export type Poly = Pt[];
export type Rect = { x0: number; y0: number; x1: number; y1: number };

const polyArea = (p: Poly): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(a) / 2;
};

/** Keep the part of a convex polygon where a*x + b*y + c >= 0. */
function clipHalf(poly: Poly, a: number, b: number, c: number): Poly {
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = a * p[0] + b * p[1] + c;
    const fq = a * q[0] + b * q[1] + c;
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-12;
  });
}

function clipRect(poly: Poly, r: Rect): Poly {
  let p = clipHalf(poly, 1, 0, -r.x0);
  if (p.length) p = clipHalf(p, -1, 0, r.x1);
  if (p.length) p = clipHalf(p, 0, 1, -r.y0);
  if (p.length) p = clipHalf(p, 0, -1, r.y1);
  return p;
}

function segLenInRect(a: Pt, b: Pt, r: Rect): number {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - r.x0, r.x1 - a[0], a[1] - r.y0, r.y1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return 0;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return 0; if (t > t0) t0 = t; }
      else { if (t < t0) return 0; if (t < t1) t1 = t; }
    }
  }
  return Math.max(0, t1 - t0) * Math.hypot(dx, dy);
}

const bbox = (p: Poly): { w: number; h: number } => {
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

// ── inputs ───────────────────────────────────────────────────────────────────

export type TileInputs = {
  length: number;
  width: number;
  /** Tile size as laid: tx along x, ty along y (swapped by direction 2). */
  tx: number;
  ty: number;
  tileLength: number;
  tileWidth: number;
  grout: number;
  pattern: number;
  direction: number;
  color: number;
  cutL: number;
  cutW: number;
  border: number;
  skirting: boolean;
  skirtingHeightMm: number;
  doorWidth: number;
  wasteGiven: number;
};

type Norm = { ok: true; v: TileInputs; echo: Record<string, number>; warnings: string[] } | { ok: false; error: string };

function normalise(raw: Readonly<Record<string, number>>): Norm {
  const warnings: string[] = [];
  const num = (k: string, def: number): number => {
    const v = raw[k];
    return v === undefined ? def : v;
  };
  const check = (k: string, label: string, lim: { min: number; max: number }, def: number, unit: string, minExclusive = false): string | number => {
    const v = num(k, def);
    if (!Number.isFinite(v)) return `${label} must be a number.`;
    if (minExclusive ? v <= 0 : v < 0) return minExclusive ? `${label} must be more than zero.` : `${label} cannot be negative.`;
    if (v < lim.min || v > lim.max) return `${label} must be between ${lim.min} and ${lim.max} ${unit}.`;
    return v;
  };
  const length = check("room_length_m", "Room length", LIMITS.room, NaN, "m", true);
  if (typeof length === "string") return { ok: false, error: length };
  const width = check("room_width_m", "Room width", LIMITS.room, NaN, "m", true);
  if (typeof width === "string") return { ok: false, error: width };
  const tl = check("tile_length_mm", "Tile length", LIMITS.tileMm, NaN, "mm", true);
  if (typeof tl === "string") return { ok: false, error: tl };
  const tw = check("tile_width_mm", "Tile width", LIMITS.tileMm, NaN, "mm", true);
  if (typeof tw === "string") return { ok: false, error: tw };
  const groutMm = check("grout_mm", "Grout joint", LIMITS.groutMm, 3, "mm");
  if (typeof groutMm === "string") return { ok: false, error: groutMm };
  if (groutMm >= Math.min(tl, tw) / 2) return { ok: false, error: "The grout joint must be much narrower than the tile." };

  const pattern = Math.round(num("pattern", PATTERN_GRID));
  if (![PATTERN_GRID, PATTERN_BRICK, PATTERN_DIAGONAL].includes(pattern)) return { ok: false, error: "Pattern must be grid, brick or diagonal." };
  const direction = Math.round(num("direction", 1));
  if (direction !== 1 && direction !== 2) return { ok: false, error: "Direction must be lengthways or across." };

  let cutL = num("cutout_length_m", 0);
  let cutW = num("cutout_width_m", 0);
  if (!Number.isFinite(cutL) || !Number.isFinite(cutW) || cutL < 0 || cutW < 0) return { ok: false, error: "The L-shape cut-out cannot be negative." };
  if ((cutL > 0) !== (cutW > 0)) return { ok: false, error: "Give both the length and the width of the L-shape cut-out, or neither." };
  if (cutL > 0 && (cutL > length - LIMITS.room.min || cutW > width - LIMITS.room.min)) return { ok: false, error: "The L-shape cut-out must leave at least 0.3 m of the room on both sides." };

  let border = check("border_mm", "Border width", LIMITS.borderMm, 0, "mm");
  if (typeof border === "string") return { ok: false, error: border };
  if (border > 0 && cutL > 0) { warnings.push("The border is only available for a rectangular room; it is left out of the L-shape."); border = 0; }
  if (border > 0 && (border * 2 >= length * 1000 - 100 || border * 2 >= width * 1000 - 100)) return { ok: false, error: "The border is too wide for this room." };

  const skirtingHeightMm = check("skirting_height_mm", "Skirting height", LIMITS.skirtingMm, 100, "mm");
  if (typeof skirtingHeightMm === "string") return { ok: false, error: skirtingHeightMm };
  const doorWidth = check("door_width_m", "Door width", LIMITS.doorM, 0.9, "m");
  if (typeof doorWidth === "string") return { ok: false, error: doorWidth };
  const wasteGiven = check("waste_pct", "Waste", LIMITS.wastePct, 0, "%");
  if (typeof wasteGiven === "string") return { ok: false, error: wasteGiven };
  const colorN = num("tile_color", 1);

  const swapped = direction === 2;
  const v: TileInputs = {
    length, width,
    tx: (swapped ? tw : tl) / 1000, ty: (swapped ? tl : tw) / 1000,
    tileLength: tl / 1000, tileWidth: tw / 1000,
    grout: groutMm / 1000, pattern, direction, color: Number.isFinite(colorN) ? Math.round(colorN) : 1,
    cutL, cutW, border: border / 1000,
    skirting: num("include_skirting", 1) !== 0, skirtingHeightMm, doorWidth, wasteGiven,
  };
  const echo: Record<string, number> = {
    room_length_m: length, room_width_m: width, tile_length_mm: tl, tile_width_mm: tw, grout_mm: groutMm,
    pattern, direction, tile_color: v.color, cutout_length_m: cutL, cutout_width_m: cutW, border_mm: border,
    include_skirting: v.skirting ? 1 : 0, skirting_height_mm: skirtingHeightMm, door_width_m: doorWidth, waste_pct: wasteGiven,
  };
  return { ok: true, v, echo, warnings };
}

// ── the layout ───────────────────────────────────────────────────────────────

export type LaidTile = {
  /** One polygon, or two where an L-shape corner splits the tile. */
  polys: Poly[];
  whole: boolean;
  /** Net tile area on the floor, m2. */
  area: number;
  /** 0, 1 or 2: a slight tone variation so the floor reads as separate tiles. */
  tone: number;
};

export type TileLayout = {
  inputs: TileInputs;
  echo: Record<string, number>;
  field: Rect;
  cutout: Rect | null;
  tiles: LaidTile[];
  strips: LaidTile[];
  stats: {
    n_tile: number; n_cut: number; n_laid: number; n_order: number; waste_pct_used: number;
    n_border: number; n_border_tiles: number;
    area_floor: number; area_tile: number; area_cover: number;
    len_joint: number; len_perimeter: number; len_skirting: number;
  };
  warnings: string[];
};

export type LayTilesResult = { ok: true; layout: TileLayout } | { ok: false; error: string };

type Cell = { poly: Poly; tone: number };

/** The tile positions of a pattern over a rectangle, before clipping. */
function cellsFor(v: TileInputs, f: Rect, px: number, py: number): { cells: Cell[]; joints: [Pt, Pt][] } {
  const cells: Cell[] = [];
  const joints: [Pt, Pt][] = [];
  const g = v.grout;
  const fw = f.x1 - f.x0;
  const fh = f.y1 - f.y0;
  const rect = (x: number, y: number): Poly => [[x, y], [x + v.tx, y], [x + v.tx, y + v.ty], [x, y + v.ty]];

  if (v.pattern === PATTERN_DIAGONAL) {
    const ang = ((v.direction === 2 ? -45 : 45) * Math.PI) / 180;
    const ex: Pt = [Math.cos(ang), Math.sin(ang)];
    const ey: Pt = [-Math.sin(ang), Math.cos(ang)];
    const cx = f.x0 + fw / 2;
    const cy = f.y0 + fh / 2;
    const R = Math.hypot(fw, fh) / 2 + Math.max(px, py);
    const ni = Math.ceil(R / px);
    const nj = Math.ceil(R / py);
    const reach = Math.hypot(v.tx, v.ty) / 2;
    for (let i = -ni; i <= ni; i++) {
      for (let j = -nj; j <= nj; j++) {
        const mx = cx + i * px * ex[0] + j * py * ey[0];
        const my = cy + i * px * ex[1] + j * py * ey[1];
        if (mx < f.x0 - reach || mx > f.x1 + reach || my < f.y0 - reach || my > f.y1 + reach) continue;
        const corner = (su: number, sv: number): Pt => [mx + su * (v.tx / 2) * ex[0] + sv * (v.ty / 2) * ey[0], my + su * (v.tx / 2) * ex[1] + sv * (v.ty / 2) * ey[1]];
        cells.push({ poly: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], tone: (((i * 7 + j * 13) % 3) + 3) % 3 });
      }
    }
    // Joint centre lines sit half a pitch from the tile centres.
    const L = R * 2;
    for (let i = -ni - 1; i <= ni; i++) {
      const u = (i + 0.5) * px;
      const o: Pt = [cx + u * ex[0], cy + u * ex[1]];
      joints.push([[o[0] - L * ey[0], o[1] - L * ey[1]], [o[0] + L * ey[0], o[1] + L * ey[1]]]);
    }
    for (let j = -nj - 1; j <= nj; j++) {
      const w = (j + 0.5) * py;
      const o: Pt = [cx + w * ey[0], cy + w * ey[1]];
      joints.push([[o[0] - L * ex[0], o[1] - L * ex[1]], [o[0] + L * ex[0], o[1] + L * ex[1]]]);
    }
    return { cells, joints };
  }

  const brick = v.pattern === PATTERN_BRICK;
  for (let r = 0; ; r++) {
    const y = f.y0 + r * py;
    if (y >= f.y1 - EPS) break;
    const shift = brick && r % 2 === 1 ? -px / 2 : 0;
    for (let c = 0; ; c++) {
      const x = f.x0 + shift + c * px;
      if (x >= f.x1 - EPS) break;
      cells.push({ poly: rect(x, y), tone: (r * 7 + c * 13) % 3 });
      // Vertical joint after this tile (brick: per row; grid: one line per column, added below).
      if (brick) {
        const jx = x + px - g / 2;
        if (jx < f.x1 - EPS) joints.push([[jx, y], [jx, y + v.ty]]);
      }
    }
    if (r > 0) joints.push([[f.x0 - 1, y - g / 2], [f.x1 + 1, y - g / 2]]);
  }
  if (!brick) {
    for (let c = 1; f.x0 + c * px - g / 2 < f.x1 - EPS; c++) {
      const jx = f.x0 + c * px - g / 2;
      joints.push([[jx, f.y0 - 1], [jx, f.y1 + 1]]);
    }
  }
  return { cells, joints };
}

/** Lay a floor. Pure: same inputs, same tiles. */
export function layTiles(raw: Readonly<Record<string, number>>): LayTilesResult {
  const n = normalise(raw);
  if (!n.ok) return n;
  const v = n.v;
  const warnings = [...n.warnings];
  const g = v.grout;
  const px = v.tx + g;
  const py = v.ty + g;

  const room: Rect = { x0: 0, y0: 0, x1: v.length, y1: v.width };
  const cutout: Rect | null = v.cutL > 0 ? { x0: v.length - v.cutL, y0: v.width - v.cutW, x1: v.length, y1: v.width } : null;
  const field: Rect = v.border > 0 ? { x0: v.border, y0: v.border, x1: v.length - v.border, y1: v.width - v.border } : room;
  const roomArea = v.length * v.width - v.cutL * v.cutW;

  const rough = ((field.x1 - field.x0) * (field.y1 - field.y0)) / (px * py);
  if (rough > MAX_TILES) {
    return { ok: false, error: `This floor needs more than ${MAX_TILES} tiles; use a larger tile or a smaller room.` };
  }

  const { cells, joints } = cellsFor(v, field, px, py);
  const axisAligned = v.pattern !== PATTERN_DIAGONAL;
  const tileArea = v.tx * v.ty;

  const tiles: LaidTile[] = [];
  for (const cell of cells) {
    const c = clipRect(cell.poly, field);
    if (c.length < 3) continue;
    let polys: Poly[];
    if (cutout) {
      const left = clipHalf(c, -1, 0, cutout.x0);
      const right = clipHalf(clipHalf(c, 1, 0, -cutout.x0), 0, -1, cutout.y0);
      polys = [left, right].filter((p) => p.length >= 3);
    } else {
      polys = [c];
    }
    polys = polys.filter((p) => {
      if (polyArea(p) < MIN_PIECE_AREA_M2 / 100) return false;
      if (axisAligned) { const b = bbox(p); return b.w >= MIN_PIECE_SIDE_M && b.h >= MIN_PIECE_SIDE_M; }
      return polyArea(p) >= MIN_PIECE_AREA_M2;
    });
    if (polys.length === 0) continue;
    const area = polys.reduce((a, p) => a + polyArea(p), 0);
    const whole = polys.length === 1 && area >= tileArea - 1e-6;
    tiles.push({ polys, whole, area, tone: cell.tone });
  }

  // Border strips: a ring one strip wide, cut from the same tile.
  const strips: LaidTile[] = [];
  if (v.border > 0) {
    const b = v.border;
    const sideStrips = (x0: number, y0: number, len: number, alongX: boolean): void => {
      const pitch = v.tileLength + g;
      for (let i = 0; i * pitch < len - EPS; i++) {
        const s = i * pitch;
        const l = Math.min(v.tileLength, len - s);
        const poly: Poly = alongX
          ? [[x0 + s, y0], [x0 + s + l, y0], [x0 + s + l, y0 + b], [x0 + s, y0 + b]]
          : [[x0, y0 + s], [x0 + b, y0 + s], [x0 + b, y0 + s + l], [x0, y0 + s + l]];
        strips.push({ polys: [poly], whole: l >= v.tileLength - 1e-6, area: l * b, tone: i % 3 });
      }
    };
    sideStrips(0, 0, v.length, true);
    sideStrips(0, v.width - b, v.length, true);
    sideStrips(0, b, v.width - 2 * b, false);
    sideStrips(v.length - b, b, v.width - 2 * b, false);
  }

  // Joint length: the centre lines of the grout joints that lie inside the floor.
  const inField = (a: Pt, bb: Pt): number => segLenInRect(a, bb, field) - (cutout ? segLenInRect(a, bb, cutout) : 0);
  let lenJoint = joints.reduce((acc, [a, bb]) => acc + inField(a, bb), 0);
  if (v.border > 0) {
    lenJoint += 2 * ((field.x1 - field.x0) + (field.y1 - field.y0));
    lenJoint += v.border * Math.max(0, strips.length - 4);
  }

  const nWhole = tiles.filter((t) => t.whole).length;
  const nCut = tiles.length - nWhole;
  const nLaid = nWhole + nCut;
  const waste = v.wasteGiven > 0 ? v.wasteGiven : DEFAULT_WASTE_PCT[v.pattern];
  const nOrder = Math.ceil(nLaid * (1 + waste / 100) - 1e-9);
  const stripsPerTile = Math.max(1, Math.floor(v.tileWidth / Math.max(v.border, 0.001)));
  const nBorderTiles = strips.length > 0 ? Math.ceil(strips.length / stripsPerTile) : 0;
  const perimeter = 2 * (v.length + v.width);
  const skirtLen = v.skirting ? Math.max(0, perimeter - v.doorWidth) : 0;

  const r3 = (x: number): number => roundHalfAway(x, 3);
  return {
    ok: true,
    layout: {
      inputs: v, echo: n.echo, field, cutout, tiles, strips,
      stats: {
        n_tile: nWhole, n_cut: nCut, n_laid: nLaid, n_order: nOrder, waste_pct_used: waste,
        n_border: strips.length, n_border_tiles: nBorderTiles,
        area_floor: r3(roomArea), area_tile: r3(v.tileLength * v.tileWidth), area_cover: r3(nOrder * v.tileLength * v.tileWidth),
        len_joint: r3(lenJoint), len_perimeter: r3(perimeter), len_skirting: r3(skirtLen),
      },
      warnings,
    },
  };
}

/** The same floor under another pattern (the preview's comparison and switcher). */
export function layWithPattern(raw: Readonly<Record<string, number>>, pattern: number, direction?: number): LayTilesResult {
  return layTiles({ ...raw, pattern, ...(direction !== undefined ? { direction } : {}) });
}

// ── the module ───────────────────────────────────────────────────────────────

export function layoutTilesFloor(raw: Readonly<Record<string, number>>): GeometryResult {
  const laid = layTiles(raw);
  if (!laid.ok) return laid;
  const { layout } = laid;
  const v = layout.inputs;
  const pieces: Piece[] = [];
  const slab = (id: string, x0: number, y0: number, x1: number, y1: number): void => {
    const area = (x1 - x0) * (y1 - y0);
    pieces.push({
      id, code: "FL", kind: "box", step: 1, floor: 0,
      pos: [roundHalfAway((x0 + x1) / 2 - v.length / 2, 4), TILE_THICKNESS_M / 2, roundHalfAway((y0 + y1) / 2 - v.width / 2, 4)],
      dims: { w: roundHalfAway(x1 - x0, 4), h: TILE_THICKNESS_M, t: roundHalfAway(y1 - y0, 4) },
      vol: roundHalfAway(area * TILE_THICKNESS_M, 6), area: roundHalfAway(area, 6),
    });
  };
  if (layout.cutout) {
    slab("FL-01", 0, 0, v.length, v.width - v.cutW);
    slab("FL-02", 0, v.width - v.cutW, v.length - v.cutL, v.width);
  } else {
    slab("FL-01", 0, 0, v.length, v.width);
  }
  const model: GeometryModel = {
    geometry: TILES_FLOOR_KEY, pieces, w: v.length, d: v.width,
    step_names: ["Floor prepared", "Tiles laid"], warnings: layout.warnings,
    extras: { ...layout.stats }, inputs: layout.echo,
  };
  return { ok: true, model };
}

export const TILES_FLOOR_MODULE: GeometryModule = {
  key: TILES_FLOOR_KEY,
  label: "Floor tiles (illustrative)",
  piece_codes: PIECE_CODES,
  inputs: INPUTS,
  extra_identifiers: TILES_EXTRA_IDENTIFIERS,
  view: "floor_plan",
  layout: layoutTilesFloor,
};
