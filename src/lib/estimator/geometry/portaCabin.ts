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
// ROOMS AND EQUIPMENT. With a room plan chosen (rooms_mode, default none) each unit is divided into rooms
// by partitions, every partition has a door, and each room is furnished from the catalogue in
// cabinEquipment.ts (placement in cabinRooms.ts). The furniture and fittings are pieces of the family "EQ",
// counted as n_eq_<item> for the bill of materials. With no room plan the model, its counts and its bill
// are exactly what they were before rooms existed.
//
// EVERY dimension below is an ILLUSTRATIVE placeholder (panel thickness, the
// door and window sizes, the panel width), not any manufacturer's product
// range. Axes: x runs along the unit length, z across, y is up; the origin is
// the centre of the footprint at ground level.

import { roundHalfAway } from "../formula";
import { CABIN_EQUIPMENT, MAX_ROOMS_PER_UNIT, ROOMS_CUSTOM, ROOM_TYPES, getCabinEquipment, getRoomType, planRooms } from "./cabinEquipment";
import type { RoomTypeKey } from "./cabinEquipment";
import { furnishRoom } from "./cabinRooms";
import type { Box, RoomSpec, WallOpening } from "./cabinRooms";
import type { DesignSlot, GeometryInputSpec, GeometryModel, GeometryModule, GeometryResult, Piece, PieceCodeInfo, PieceOpening } from "./types";

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
  rooms_mode: { min: 0, max: 5 },
  rooms_of_a_type: { min: 0, max: 20 },
  extinguishers: { min: 0, max: 10 },
  coolers: { min: 0, max: 4 },
} as const;
/** Partitions per unit at most; the rest are refused rather than crammed in. */
const MAX_PARTITIONS_PER_UNIT = 3;

// ── Illustrative dimensions, metres ─────────────────────────────────────────
const FLOOR_T_M = 0.15;
const ROOF_T_M = 0.15;
const WALL_T_M = 0.075;
const PARTITION_T_M = 0.06;
/** The door in a room partition: a short door panel at the back end of the partition, then a solid panel. */
const PART_DOOR = { panelW: 1.0, w: 0.8, h: 2.0 };
const PART_DOOR_SWING_M = 0.6;
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
  { code: "EQ", label: "Furniture and equipment" },
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
  { key: "include_ac", required: false, default: 1 },
  { key: "rooms_mode", required: false, default: 0, allow_select: true },
  { key: "room_offices", required: false, default: 0 },
  { key: "room_bedrooms", required: false, default: 0 },
  { key: "room_toilets", required: false, default: 0 },
  { key: "room_pantries", required: false, default: 0 },
  { key: "extinguisher_count", required: false, default: 1 },
  { key: "water_cooler_count", required: false, default: 0 },
];

/** Parts of the model a template's look-and-finish inputs may repaint. */
export const CABIN_SLOTS: readonly DesignSlot[] = [
  { key: "cladding", label: "Cladding", default: "cladding_white" },
  { key: "roof", label: "Roof", default: "roof_sheet" },
  { key: "floor", label: "Floor finish", default: "porcelain_grey" },
  { key: "frame", label: "Frames and trims", default: "galvanised" },
  { key: "door", label: "Doors", default: "wood_door" },
  { key: "equipment", label: "Equipment", default: "#c9ccd0" },
];

/** Names the module puts in the formula scope. */
export const CABIN_EXTRA_IDENTIFIERS = [
  "n_unit", "n_storey", "n_door", "n_window", "n_partition",
  "area_wall", "area_wall_gross", "area_roof", "area_floor", "area_partition",
  "len_joint", "len_perimeter",
  "n_door_int", "n_room",
  ...ROOM_TYPES.map((r) => `n_room_${r.key}` as const),
  ...CABIN_EQUIPMENT.map((i) => `n_eq_${i.key}`),
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

/** With a room plan, the outside door opens into the first of these rooms the side offers. */
const DOOR_ROOM_RANK: readonly RoomTypeKey[] = ["reception", "office", "pantry", "store", "bedroom", "meeting", "toilet", "shower"];

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

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
  const roomsMode = whole(raw, "rooms_mode", "Room plan", LIMITS.rooms_mode, 0);
  const custom = {
    office: whole(raw, "room_offices", "Offices", LIMITS.rooms_of_a_type, 0),
    bedroom: whole(raw, "room_bedrooms", "Bedrooms", LIMITS.rooms_of_a_type, 0),
    toilet: whole(raw, "room_toilets", "Toilets", LIMITS.rooms_of_a_type, 0),
    pantry: whole(raw, "room_pantries", "Pantries", LIMITS.rooms_of_a_type, 0),
  };
  const wantExtinguishers = whole(raw, "extinguisher_count", "Fire extinguishers", LIMITS.extinguishers, 1);
  const wantCoolers = whole(raw, "water_cooler_count", "Water coolers", LIMITS.coolers, 0);
  const acOn = !(raw.include_ac !== undefined && Number.isFinite(raw.include_ac) && Math.round(raw.include_ac) === 0);

  const cells = cabinCells(layout, along, across);
  /** The room types of every unit when a room plan is chosen; empty (no plan) leaves the cabin exactly as before rooms existed. */
  const plan: RoomTypeKey[][] = planRooms(roomsMode, cells.length, UL, custom);
  const rooms = plan.length > 0;
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

  // With a room plan the partitions are known up front: the x of each, per unit, and which room a panel opens into.
  const cellIndex = new Map<Cell, number>(cells.map((c, u) => [c, u]));
  const partXs = (c: Cell): number[] => {
    const m = rooms ? plan[cellIndex.get(c)!].length - 1 : 0;
    return Array.from({ length: m }, (_, q) => cx(c) - UL / 2 + (UL * (q + 1)) / (m + 1));
  };
  /** A panel on a long side whose opening would run into a partition is passed over (end walls never meet one). */
  const clearOfPartitions = (p: WallPanel, half: number, margin: number): boolean =>
    !rooms || p.side === "left" || p.side === "right" || partXs(p.cell).every((x) => Math.abs(p.px - x) >= half + margin);
  const roomIndexOf = (p: WallPanel): number => {
    const xs = partXs(p.cell);
    if (p.side === "left") return 0;
    if (p.side === "right") return xs.length;
    return xs.filter((x) => x < p.px).length;
  };

  // Doors: ground-storey panels, the middle panel of the long side first, then the other long side, then the ends.
  const ground = cells.filter((c) => c.k === 0);
  const mid = (p: WallPanel): boolean => p.idx === Math.floor(p.n / 2);
  const doorOk = (p: WallPanel): boolean => p.pw - DOOR.minLeaf >= DOOR.w * 0.6;
  const doorCandidates: WallPanel[] = [];
  for (const side of ["front", "back", "left", "right"] as Side[]) {
    for (const c of ground) {
      let p: WallPanel | undefined;
      if (!rooms) {
        p = panels.find((x) => x.cell === c && x.side === side && mid(x) && doorOk(x));
      } else {
        // Of the panels that clear the partitions, the one into the room people should enter by (not a meeting room or a
        // bedroom), then the one nearest the middle of the side.
        const mine = panels.filter((x) => x.cell === c && x.side === side && doorOk(x) && clearOfPartitions(x, Math.min(DOOR.w, x.pw - DOOR.minLeaf) / 2, 0.35));
        const keyOf = (x: WallPanel): number[] => [DOOR_ROOM_RANK.indexOf(plan[cellIndex.get(c)!][roomIndexOf(x)]), Math.abs(x.idx - (x.n - 1) / 2), x.idx];
        p = mine.reduce<WallPanel | undefined>((best, x) => (!best || lexLess(keyOf(x), keyOf(best)) ? x : best), undefined);
      }
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
  let windows = 0;
  const windowOf = (p: WallPanel): PieceOpening => ({ w: r4(Math.min(WINDOW.w, p.pw - WINDOW.minLeaf)), h: WINDOW.h, sill: WINDOW.sill, door: false });
  if (!rooms) {
    const buckets: Record<Side, WallPanel[]> = { front: [], back: [], left: [], right: [] };
    for (const p of panels) if (!p.op && p.pw >= WINDOW.minPanelW) buckets[p.side].push(p);
    const order: Side[] = ["front", "back", "left", "right"];
    const used: Record<Side, number> = { front: 0, back: 0, left: 0, right: 0 };
    while (windows < wantWindows) {
      let placed = false;
      for (const side of order) {
        if (windows >= wantWindows) break;
        const p = buckets[side][used[side]++];
        if (!p) continue;
        p.op = windowOf(p);
        windows++;
        placed = true;
      }
      if (!placed) break;
    }
  } else {
    // With rooms, a window goes to a room that has none and wants one first, then spreads over the sides.
    const free = panels.filter((p) => !p.op && p.pw >= WINDOW.minPanelW && clearOfPartitions(p, windowOf(p).w / 2, 0.2));
    const inRoom = new Map<number, number>();
    const sideUsed: Record<Side, number> = { front: 0, back: 0, left: 0, right: 0 };
    const roomKey = (p: WallPanel): number => cellIndex.get(p.cell)! * 8 + roomIndexOf(p);
    const wants = (p: WallPanel): boolean => getRoomType(plan[cellIndex.get(p.cell)!][roomIndexOf(p)])?.window === true;
    const left = new Set(free);
    while (windows < wantWindows && left.size > 0) {
      let best: WallPanel | null = null;
      let bestKey: number[] = [];
      for (const p of left) {
        const key = [inRoom.get(roomKey(p)) ?? 0, wants(p) ? 0 : 1, sideUsed[p.side], panels.indexOf(p)];
        if (!best || lexLess(key, bestKey)) { best = p; bestKey = key; }
      }
      if (!best) break;
      left.delete(best);
      best.op = windowOf(best);
      inRoom.set(roomKey(best), (inRoom.get(roomKey(best)) ?? 0) + 1);
      sideUsed[best.side]++;
      windows++;
    }
  }
  if (windows < wantWindows) warnings.push(`Only ${windows} of the ${wantWindows} windows fit on the outside walls; the count is reduced to ${windows}.`);

  // Partitions: shared out over the units, ground first, at most three in one unit.
  // With a room plan the plan decides them: one partition between neighbouring rooms of a unit.
  const perUnit = cells.map(() => 0);
  let parts = 0;
  if (rooms) {
    plan.forEach((types, u) => { perUnit[u] = types.length - 1; parts += perUnit[u]; });
    if (wantParts > 0) warnings.push("A room plan sets the partitions; the partition count is not used while a room plan is chosen.");
    if (roomsMode === ROOMS_CUSTOM) {
      const asked = custom.office + custom.bedroom + custom.toilet + custom.pantry;
      const got = plan.flat().filter((t) => t === "office" || t === "bedroom" || t === "toilet" || t === "pantry").length;
      if (got < asked) warnings.push(`Only ${got} of the ${asked} rooms fit (at most ${MAX_ROOMS_PER_UNIT} in one unit, each wide enough for its furniture); the count is reduced to ${got}.`);
    }
  } else {
    for (let p = 0; p < wantParts; p++) {
      const u = p % cells.length;
      if (perUnit[u] >= MAX_PARTITIONS_PER_UNIT) continue;
      perUnit[u]++;
      parts++;
    }
    if (parts < wantParts) warnings.push(`Only ${parts} of the ${wantParts} partitions fit (at most ${MAX_PARTITIONS_PER_UNIT} in one unit); the count is reduced to ${parts}.`);
  }
  const partsOn = (k: number): number => cells.reduce((a, c, u) => a + (c.k === k ? perUnit[u] : 0), 0);

  // ── rooms and equipment ──
  type Furnishing = { item: string; room: string; k: number; x: number; y: number; z: number; rot: number };
  const furnishings: Furnishing[] = [];
  const roomTotals: Record<string, number> = {};
  if (rooms) {
    const specs: { spec: RoomSpec; k: number }[] = [];
    const labelCount: Record<string, number> = {};
    cells.forEach((c, u) => {
      const types = plan[u];
      const R = types.length;
      const xs = partXs(c);
      const yBase = c.k * H + FLOOR_T_M;
      const zBack = cz(c) - UW / 2;
      const zFront = cz(c) + UW / 2;
      const partStart = zBack + WALL_T_M;
      const swing: Box[] = xs.map((x) => ({
        x0: x - PARTITION_T_M / 2 - PART_DOOR_SWING_M, x1: x + PARTITION_T_M / 2 + PART_DOOR_SWING_M,
        z0: zBack + WALL_T_M / 2, z1: partStart + PART_DOOR.panelW + 0.1, y0: yBase, y1: yBase + PART_DOOR.h + 0.05,
      }));
      const openings: WallOpening[] = panels.filter((p) => p.cell === c && p.op).map((p) => {
        const along = p.side === "front" || p.side === "back" ? p.px : p.pz;
        return { wall: p.side, a: along - p.op!.w / 2, b: along + p.op!.w / 2, sill: p.op!.sill, top: p.op!.sill + p.op!.h, door: p.op!.door };
      });
      const extBack = !has(c.i, c.j - 1, c.k);
      const extFront = !has(c.i, c.j + 1, c.k);
      const extLeft = !has(c.i - 1, c.j, c.k);
      const extRight = !has(c.i + 1, c.j, c.k);
      types.forEach((type, r) => {
        const n = (labelCount[type] = (labelCount[type] ?? 0) + 1);
        roomTotals[type] = n;
        const exterior = { back: extBack, front: extFront, left: r === 0 && extLeft, right: r === R - 1 && extRight };
        specs.push({
          k: c.k,
          spec: {
            label: `${type}-${n}`, type,
            rect: {
              x0: r === 0 ? cx(c) - UL / 2 + WALL_T_M / 2 : xs[r - 1] + PARTITION_T_M / 2,
              x1: r === R - 1 ? cx(c) + UL / 2 - WALL_T_M / 2 : xs[r] - PARTITION_T_M / 2,
              z0: zBack + WALL_T_M / 2, z1: zFront - WALL_T_M / 2,
            },
            yBase, height: UH,
            solid: { back: extBack, front: extFront, left: r > 0 || extLeft, right: r < R - 1 || extRight },
            exterior,
            outer: { back: zBack - WALL_T_M / 2, front: zFront + WALL_T_M / 2, left: cx(c) - UL / 2 - WALL_T_M / 2, right: cx(c) + UL / 2 + WALL_T_M / 2 },
            openings, keepouts: swing, ac: acOn, extras: [],
          },
        });
      });
    });
    // Fire extinguishers and water coolers go to the rooms people meet first, round and round.
    const extraFor: string[][] = specs.map(() => []);
    const spread = (item: string, count: number, prefer: readonly RoomTypeKey[]): void => {
      const rank = (t: RoomTypeKey): number => { const i = prefer.indexOf(t); return i < 0 ? prefer.length : i; };
      const order = specs.map((s, i) => ({ i, r: rank(s.spec.type) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.i);
      for (let n = 0; n < count; n++) extraFor[order[n % order.length]].push(item);
    };
    spread("extinguisher", wantExtinguishers, ["reception", "office", "pantry", "meeting", "bedroom", "store", "toilet", "shower"]);
    spread("water_cooler", wantCoolers, ["pantry", "reception", "meeting", "office", "bedroom", "store", "toilet", "shower"]);
    const outside: Box[] = [];
    const droppedAll: Record<string, number> = {};
    specs.forEach((s, i) => {
      const f = furnishRoom({ ...s.spec, extras: extraFor[i] }, outside);
      for (const p of f.placed) furnishings.push({ ...p, k: s.k });
      for (const [item, n] of Object.entries(f.dropped)) droppedAll[item] = (droppedAll[item] ?? 0) + n;
    });
    for (const [item, n] of Object.entries(droppedAll)) {
      warnings.push(`No room for ${n} x ${(getCabinEquipment(item)?.label ?? item).toLowerCase()}; ${n === 1 ? "it is" : "they are"} left out.`);
    }
  }
  const furnishedOn = (k: number): number => furnishings.filter((f) => f.k === k).length;

  // ── pieces ──
  const pcs: Piece[] = [];
  const counts: Record<string, number> = {};
  const stepNames = ["Foundation and skids"];
  const stepOf: Record<string, number> = {};
  const nameStep = (key: string, label: string): void => { stepOf[key] = stepNames.length; stepNames.push(label); };
  // Floor, walls, partitions, furniture, then the roof last, so stepping back through the build shows the inside.
  for (let k = 0; k < storeys; k++) {
    const pre = storeys > 1 ? `Storey ${k + 1}: ` : "";
    nameStep(`f${k}`, `${pre}floor frames`);
    nameStep(`w${k}`, `${pre}wall panels, doors and windows`);
    if (partsOn(k) > 0) nameStep(`p${k}`, `${pre}partition walls`);
    if (furnishedOn(k) > 0) nameStep(`e${k}`, `${pre}furniture and equipment`);
    nameStep(`r${k}`, `${pre}roof panels`);
  }

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
    add({ code: "FL", kind: "box", slot: "floor", step: stepOf[`f${c.k}`], floor: c.k, pos: [cx(c), c.k * H + FLOOR_T_M / 2, cz(c)], dims: { w: UL, h: FLOOR_T_M, t: UW }, vol: UL * UW * FLOOR_T_M, area: UL * UW });
  }
  for (const p of panels) {
    const op = p.op;
    const opArea = op ? op.w * op.h : 0;
    add({
      code: "WL", kind: "panel", slot: "cladding", step: stepOf[`w${p.storey}`], floor: p.storey,
      pos: [p.px, p.storey * H + FLOOR_T_M + UH / 2, p.pz], rot: p.rot,
      dims: { w: p.pw, h: UH, t: WALL_T_M }, op,
      vol: (p.pw * UH - opArea) * WALL_T_M, area: p.pw * UH - opArea,
    });
  }
  for (const c of cells) {
    add({ code: "RF", kind: "box", slot: "roof", step: stepOf[`r${c.k}`], floor: c.k, pos: [cx(c), c.k * H + FLOOR_T_M + UH + ROOF_T_M / 2, cz(c)], dims: { w: UL, h: ROOF_T_M, t: UW }, vol: UL * UW * ROOF_T_M, area: UL * UW });
  }
  cells.forEach((c, u) => {
    const m = perUnit[u];
    for (let q = 0; q < m; q++) {
      const x = cx(c) - UL / 2 + (UL * (q + 1)) / (m + 1);
      const len = UW - 2 * WALL_T_M;
      const y = c.k * H + FLOOR_T_M + UH / 2;
      if (!rooms) {
        add({
          code: "PT", kind: "panel", slot: "cladding", step: stepOf[`p${c.k}`], floor: c.k,
          pos: [x, y, cz(c)], rot: Math.PI / 2,
          dims: { w: len, h: UH, t: PARTITION_T_M }, op: null, vol: len * UH * PARTITION_T_M, area: len * UH,
        });
        continue;
      }
      // A partition between rooms carries a door, in a short panel at its back end.
      const start = cz(c) - len / 2;
      const doorArea = PART_DOOR.w * PART_DOOR.h;
      const dw = PART_DOOR.panelW;
      add({
        code: "PT", kind: "panel", slot: "cladding", step: stepOf[`p${c.k}`], floor: c.k,
        pos: [x, y, start + dw / 2], rot: Math.PI / 2,
        dims: { w: dw, h: UH, t: PARTITION_T_M }, op: { w: PART_DOOR.w, h: PART_DOOR.h, sill: 0, door: true },
        vol: (dw * UH - doorArea) * PARTITION_T_M, area: dw * UH - doorArea,
      });
      add({
        code: "PT", kind: "panel", slot: "cladding", step: stepOf[`p${c.k}`], floor: c.k,
        pos: [x, y, start + dw + (len - dw) / 2], rot: Math.PI / 2,
        dims: { w: len - dw, h: UH, t: PARTITION_T_M }, op: null, vol: (len - dw) * UH * PARTITION_T_M, area: (len - dw) * UH,
      });
    }
  });
  for (const f of furnishings) {
    const it = getCabinEquipment(f.item)!;
    add({
      code: "EQ", kind: "equip", slot: "equipment", item: it.key, room: f.room, step: stepOf[`e${f.k}`], floor: f.k,
      pos: [f.x, f.y, f.z], rot: f.rot, dims: { w: it.w, h: it.h, t: it.t }, vol: 0,
    });
  }

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
      n_door_int: rooms ? parts : 0,
      n_room: Object.values(roomTotals).reduce((a, n) => a + n, 0),
      ...Object.fromEntries(ROOM_TYPES.map((r) => [`n_room_${r.key}`, roomTotals[r.key] ?? 0])),
      ...Object.fromEntries(CABIN_EQUIPMENT.map((i) => [`n_eq_${i.key}`, furnishings.filter((f) => f.item === i.key).length])),
    },
    inputs: {
      unit_length_m: UL, unit_width_m: UW, unit_height_m: UH, units_along: along, units_across: across, layout, door_count: wantDoors, window_count: wantWindows, partition_count: wantParts,
      rooms_mode: roomsMode, extinguisher_count: wantExtinguishers, water_cooler_count: wantCoolers,
    },
  };
}

export const PORTA_CABIN_MODULE: GeometryModule = {
  key: PORTA_CABIN_KEY,
  label: "Porta cabin (illustrative)",
  piece_codes: PIECE_CODES,
  inputs: INPUTS,
  extra_identifiers: CABIN_EXTRA_IDENTIFIERS,
  slots: CABIN_SLOTS,
  layout: layoutPortaCabin,
};
