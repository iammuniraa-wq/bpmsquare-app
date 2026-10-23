// Geometry module "porta_cabin": modular cabins on a grid.
//
// A cabin is a unit (floor frame, wall panels, roof) of a set size. Units sit
// side by side (a row), in an L, or stacked two high; where two units meet the
// wall between them is left out and the seam is counted as a joint. Exterior
// walls are cut into panels (about 2 m each) so a door or a window is a real
// opening in a real panel: the existing 3D viewer already draws an opening as
// the sill, jambs and lintel around a door leaf or glass, and the BOM counts
// the same openings, so what is on screen is what is priced.
//
// EVERY dimension below is an ILLUSTRATIVE placeholder (panel thickness, the
// door and window sizes, the panel width), not any manufacturer's product
// range. Axes: x runs along the unit length, z across, y is up; the origin is
// the centre of the footprint at ground level.

import { roundHalfAway } from "../formula";
import type { GeometryInputSpec, GeometryModel, GeometryModule, GeometryResult, Piece, PieceCodeInfo, PieceOpening } from "./types";

export const PORTA_CABIN_KEY = "porta_cabin";

export const LAYOUT_SINGLE = 1;
export const LAYOUT_ROW = 2;
export const LAYOUT_L = 3;
export const LAYOUT_STACKED = 4;
export const CABIN_LAYOUTS = [
  { value: LAYOUT_SINGLE, key: "single", label: "Single unit" },
  { value: LAYOUT_ROW, key: "row", label: "Row of units" },
  { value: LAYOUT_L, key: "l_shape", label: "L-shape" },
  { value: LAYOUT_STACKED, key: "stacked", label: "Stacked, 2 high" },
] as const;

export const MAX_PIECES = 3000;
const LIMITS = {
  length: { min: 2.4, max: 12.2 },
  width: { min: 2.2, max: 3.6 },
  height: { min: 2.1, max: 3.2 },
  along: { min: 1, max: 12 },
  across: { min: 1, max: 8 },
  doors: { min: 0, max: 20 },
  windows: { min: 0, max: 40 },
  partitions: { min: 0, max: 20 },
} as const;
/** Partitions per unit at most; the rest are refused rather than crammed in. */
const MAX_PARTITIONS_PER_UNIT = 3;

// ── Illustrative dimensions, metres ─────────────────────────────────────────
const FLOOR_T_M = 0.15;
const ROOF_T_M = 0.15;
const WALL_T_M = 0.075;
const PARTITION_T_M = 0.06;
const PANEL_TARGET_W_M = 2.0;
const DOOR = { w: 0.9, h: 2.0, sill: 0, minLeaf: 0.3 };
const WINDOW = { w: 1.0, h: 1.0, sill: 1.0, minPanelW: 1.4, minLeaf: 0.3 };
const COORD_DP = 4;
const QTY_DP = 6;

const PIECE_CODES: readonly PieceCodeInfo[] = [
  { code: "FL", label: "Floor frames" },
  { code: "WL", label: "Wall panels" },
  { code: "RF", label: "Roof panels" },
  { code: "PT", label: "Partition walls" },
];

const INPUTS: readonly GeometryInputSpec[] = [
  { key: "unit_length_m", required: true },
  { key: "unit_width_m", required: true },
  { key: "unit_height_m", required: true },
  { key: "units_along", required: true },
  { key: "units_across", required: false, default: 1 },
  { key: "layout", required: false, default: LAYOUT_ROW, allow_select: true },
  { key: "door_count", required: false, default: 1 },
  { key: "window_count", required: false, default: 2 },
  { key: "partition_count", required: false, default: 0 },
];

/** Names the module puts in the formula scope. */
export const CABIN_EXTRA_IDENTIFIERS = [
  "n_unit", "n_storey", "n_door", "n_window", "n_partition",
  "area_wall", "area_wall_gross", "area_roof", "area_floor", "area_partition",
  "len_joint", "len_perimeter",
] as const;

const rd = (x: number, dp: number): number => Math.round(x * 10 ** dp) / 10 ** dp + 0;
const r4 = (x: number): number => rd(x, COORD_DP);

type Cell = { i: number; j: number; k: number };
type Side = "front" | "back" | "left" | "right";
type WallPanel = {
  cell: Cell; side: Side; idx: number; n: number; pw: number; storey: number;
  /** Centre, metres, before the footprint is centred. */
  px: number; pz: number; rot: number; op: PieceOpening | null;
};

class LayoutError extends Error {}

function whole(raw: Readonly<Record<string, number>>, key: string, label: string, lim: { min: number; max: number }, def?: number): number {
  const v = raw[key] === undefined ? def : raw[key];
  if (v === undefined || !Number.isFinite(v)) throw new LayoutError(`${label} must be a number.`);
  const x = Math.round(v);
  if (x < lim.min || x > lim.max) throw new LayoutError(`${label} must be between ${lim.min} and ${lim.max}.`);
  return x;
}

function dim(raw: Readonly<Record<string, number>>, key: string, label: string, lim: { min: number; max: number }): number {
  const v = raw[key];
  if (v === undefined || !Number.isFinite(v)) throw new LayoutError(`${label} must be a number.`);
  if (v <= 0) throw new LayoutError(`${label} must be more than zero.`);
  if (v < lim.min || v > lim.max) throw new LayoutError(`${label} must be between ${lim.min} and ${lim.max} m.`);
  return v;
}

/** The unit positions of a layout, ground storey first. */
export function cabinCells(layout: number, along: number, across: number): Cell[] {
  const out: Cell[] = [];
  if (layout === LAYOUT_SINGLE) return [{ i: 0, j: 0, k: 0 }];
  for (let i = 0; i < along; i++) out.push({ i, j: 0, k: 0 });
  if (layout === LAYOUT_L) for (let j = 1; j < across; j++) out.push({ i: 0, j, k: 0 });
  if (layout === LAYOUT_STACKED) for (let i = 0; i < along; i++) out.push({ i, j: 0, k: 1 });
  return out;
}

export function layoutPortaCabin(raw: Readonly<Record<string, number>>): GeometryResult {
  try {
    return { ok: true, model: build(raw) };
  } catch (e) {
    if (e instanceof LayoutError) return { ok: false, error: e.message };
    throw e;
  }
}

function build(raw: Readonly<Record<string, number>>): GeometryModel {
  const warnings: string[] = [];
  const UL = dim(raw, "unit_length_m", "Unit length", LIMITS.length);
  const UW = dim(raw, "unit_width_m", "Unit width", LIMITS.width);
  const UH = dim(raw, "unit_height_m", "Unit height", LIMITS.height);
  const along = whole(raw, "units_along", "Units along", LIMITS.along);
  const across = whole(raw, "units_across", "Units across", LIMITS.across, 1);
  const layout = whole(raw, "layout", "Layout", { min: 1, max: 4 }, LAYOUT_ROW);
  const wantDoors = whole(raw, "door_count", "Doors", LIMITS.doors, 1);
  const wantWindows = whole(raw, "window_count", "Windows", LIMITS.windows, 2);
  const wantParts = whole(raw, "partition_count", "Partitions", LIMITS.partitions, 0);

  const cells = cabinCells(layout, along, across);
  if (layout === LAYOUT_L && across === 1) warnings.push("An L-shape with one unit across is a single row; raise \"units across\" to turn the corner.");
  const occ = new Set(cells.map((c) => `${c.i},${c.j},${c.k}`));
  const has = (i: number, j: number, k: number): boolean => occ.has(`${i},${j},${k}`);
  const nI = Math.max(...cells.map((c) => c.i)) + 1;
  const nJ = Math.max(...cells.map((c) => c.j)) + 1;
  const storeys = Math.max(...cells.map((c) => c.k)) + 1;
  const H = FLOOR_T_M + UH + ROOF_T_M;
  const w = nI * UL;
  const d = nJ * UW;
  const cx = (c: Cell): number => (c.i + 0.5) * UL - w / 2;
  const cz = (c: Cell): number => (c.j + 0.5) * UW - d / 2;

  // Exterior wall panels, with the sides shared with a neighbour left out.
  const panels: WallPanel[] = [];
  for (const c of cells) {
    const sides: { side: Side; len: number; rot: number; open: boolean }[] = [
      { side: "front", len: UL, rot: 0, open: has(c.i, c.j + 1, c.k) },
      { side: "back", len: UL, rot: 0, open: has(c.i, c.j - 1, c.k) },
      { side: "left", len: UW, rot: Math.PI / 2, open: has(c.i - 1, c.j, c.k) },
      { side: "right", len: UW, rot: Math.PI / 2, open: has(c.i + 1, c.j, c.k) },
    ];
    for (const s of sides) {
      if (s.open) continue;
      const n = Math.max(1, Math.round(s.len / PANEL_TARGET_W_M));
      const pw = s.len / n;
      for (let q = 0; q < n; q++) {
        const off = (q + 0.5) * pw - s.len / 2;
        const px = s.rot === 0 ? cx(c) + off : cx(c) + (s.side === "right" ? UL / 2 : -UL / 2);
        const pz = s.rot === 0 ? cz(c) + (s.side === "front" ? UW / 2 : -UW / 2) : cz(c) + off;
        panels.push({ cell: c, side: s.side, idx: q, n, pw, storey: c.k, px, pz, rot: s.rot, op: null });
      }
    }
  }

  // Doors: ground-storey panels, the middle panel of the long side first, then the other long side, then the ends.
  const ground = cells.filter((c) => c.k === 0);
  const mid = (p: WallPanel): boolean => p.idx === Math.floor(p.n / 2);
  const doorOk = (p: WallPanel): boolean => p.pw - DOOR.minLeaf >= DOOR.w * 0.6;
  const doorCandidates: WallPanel[] = [];
  for (const side of ["front", "back", "left", "right"] as Side[]) {
    for (const c of ground) {
      const p = panels.find((x) => x.cell === c && x.side === side && mid(x) && doorOk(x));
      if (p) doorCandidates.push(p);
    }
  }
  let doors = 0;
  for (const p of doorCandidates) {
    if (doors >= wantDoors) break;
    p.op = { w: r4(Math.min(DOOR.w, p.pw - DOOR.minLeaf)), h: DOOR.h, sill: DOOR.sill, door: true };
    doors++;
  }
  if (doors < wantDoors) warnings.push(`Only ${doors} of the ${wantDoors} doors fit on the outside walls of the ground floor; the count is reduced to ${doors}.`);

  // Windows: spread over the four sides in turn, on panels wide enough and not already holding a door.
  const buckets: Record<Side, WallPanel[]> = { front: [], back: [], left: [], right: [] };
  for (const p of panels) if (!p.op && p.pw >= WINDOW.minPanelW) buckets[p.side].push(p);
  let windows = 0;
  const order: Side[] = ["front", "back", "left", "right"];
  const used: Record<Side, number> = { front: 0, back: 0, left: 0, right: 0 };
  while (windows < wantWindows) {
    let placed = false;
    for (const side of order) {
      if (windows >= wantWindows) break;
      const p = buckets[side][used[side]++];
      if (!p) continue;
      p.op = { w: r4(Math.min(WINDOW.w, p.pw - WINDOW.minLeaf)), h: WINDOW.h, sill: WINDOW.sill, door: false };
      windows++;
      placed = true;
    }
    if (!placed) break;
  }
  if (windows < wantWindows) warnings.push(`Only ${windows} of the ${wantWindows} windows fit on the outside walls; the count is reduced to ${windows}.`);

  // Partitions: shared out over the units, ground first, at most three in one unit.
  const perUnit = cells.map(() => 0);
  let parts = 0;
  for (let p = 0; p < wantParts; p++) {
    const u = p % cells.length;
    if (perUnit[u] >= MAX_PARTITIONS_PER_UNIT) continue;
    perUnit[u]++;
    parts++;
  }
  if (parts < wantParts) warnings.push(`Only ${parts} of the ${wantParts} partitions fit (at most ${MAX_PARTITIONS_PER_UNIT} in one unit); the count is reduced to ${parts}.`);

  // ── pieces ──
  const pcs: Piece[] = [];
  const counts: Record<string, number> = {};
  const stepNames = ["Foundation and skids"];
  const stepOf: Record<string, number> = {};
  const nameStep = (key: string, label: string): void => { stepOf[key] = stepNames.length; stepNames.push(label); };
  for (let k = 0; k < storeys; k++) {
    const pre = storeys > 1 ? `Storey ${k + 1}: ` : "";
    nameStep(`f${k}`, `${pre}floor frames`);
    nameStep(`w${k}`, `${pre}wall panels, doors and windows`);
    nameStep(`r${k}`, `${pre}roof panels`);
  }
  if (parts > 0) nameStep("p", "Partition walls");

  const add = (o: Omit<Piece, "id">): void => {
    if (pcs.length >= MAX_PIECES) throw new LayoutError(`This design needs more than ${MAX_PIECES} pieces; use fewer units.`);
    counts[o.code] = (counts[o.code] ?? 0) + 1;
    const n = counts[o.code];
    pcs.push({
      id: `${o.code}-${n < 10 ? "0" : ""}${n}`,
      ...o,
      pos: [r4(o.pos[0]), r4(o.pos[1]), r4(o.pos[2])],
      dims: { w: r4(o.dims.w), h: r4(o.dims.h), t: r4(o.dims.t) },
      vol: rd(o.vol, QTY_DP),
      ...(o.area !== undefined ? { area: rd(o.area, QTY_DP) } : {}),
    });
  };

  for (const c of cells) {
    add({ code: "FL", kind: "box", step: stepOf[`f${c.k}`], floor: c.k, pos: [cx(c), c.k * H + FLOOR_T_M / 2, cz(c)], dims: { w: UL, h: FLOOR_T_M, t: UW }, vol: UL * UW * FLOOR_T_M, area: UL * UW });
  }
  for (const p of panels) {
    const op = p.op;
    const opArea = op ? op.w * op.h : 0;
    add({
      code: "WL", kind: "panel", step: stepOf[`w${p.storey}`], floor: p.storey,
      pos: [p.px, p.storey * H + FLOOR_T_M + UH / 2, p.pz], rot: p.rot,
      dims: { w: p.pw, h: UH, t: WALL_T_M }, op,
      vol: (p.pw * UH - opArea) * WALL_T_M, area: p.pw * UH - opArea,
    });
  }
  for (const c of cells) {
    add({ code: "RF", kind: "box", step: stepOf[`r${c.k}`], floor: c.k, pos: [cx(c), c.k * H + FLOOR_T_M + UH + ROOF_T_M / 2, cz(c)], dims: { w: UL, h: ROOF_T_M, t: UW }, vol: UL * UW * ROOF_T_M, area: UL * UW });
  }
  cells.forEach((c, u) => {
    const m = perUnit[u];
    for (let q = 0; q < m; q++) {
      const x = cx(c) - UL / 2 + (UL * (q + 1)) / (m + 1);
      const len = UW - 2 * WALL_T_M;
      add({
        code: "PT", kind: "panel", step: stepOf.p, floor: c.k,
        pos: [x, c.k * H + FLOOR_T_M + UH / 2, cz(c)], rot: Math.PI / 2,
        dims: { w: len, h: UH, t: PARTITION_T_M }, op: null, vol: len * UH * PARTITION_T_M, area: len * UH,
      });
    }
  });

  // Seams where units meet: roof and floor lines plus the two end verticals; a stack seam runs round the unit.
  let joint = 0;
  for (const c of cells) {
    if (has(c.i + 1, c.j, c.k)) joint += 2 * UW + 2 * UH;
    if (has(c.i, c.j + 1, c.k)) joint += 2 * UL + 2 * UH;
    if (has(c.i, c.j, c.k + 1)) joint += 2 * (UL + UW);
  }
  const groundPerimeter = panels.filter((p) => p.storey === 0).reduce((a, p) => a + p.pw, 0);
  const wall = pcs.filter((p) => p.code === "WL");
  const net = wall.reduce((a, p) => a + (p.area ?? 0), 0);
  const gross = wall.reduce((a, p) => a + p.dims.w * p.dims.h, 0);
  const sum = (code: string): number => pcs.filter((p) => p.code === code).reduce((a, p) => a + (p.area ?? 0), 0);
  const r3 = (x: number): number => roundHalfAway(x, 3);

  return {
    geometry: PORTA_CABIN_KEY, pieces: pcs, w: r4(w), d: r4(d), step_names: stepNames, warnings,
    view_min_dist: 16,
    extras: {
      n_unit: cells.length, n_storey: storeys, n_door: doors, n_window: windows, n_partition: parts,
      area_wall: r3(net), area_wall_gross: r3(gross), area_roof: r3(sum("RF")), area_floor: r3(sum("FL")), area_partition: r3(sum("PT")),
      len_joint: r3(joint), len_perimeter: r3(groundPerimeter),
    },
    inputs: { unit_length_m: UL, unit_width_m: UW, unit_height_m: UH, units_along: along, units_across: across, layout, door_count: wantDoors, window_count: wantWindows, partition_count: wantParts },
  };
}

export const PORTA_CABIN_MODULE: GeometryModule = {
  key: PORTA_CABIN_KEY,
  label: "Porta cabin (illustrative)",
  piece_codes: PIECE_CODES,
  inputs: INPUTS,
  extra_identifiers: CABIN_EXTRA_IDENTIFIERS,
  layout: layoutPortaCabin,
};
