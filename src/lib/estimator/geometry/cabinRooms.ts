// Porta cabin rooms: where the furniture and fittings of one room stand.
//
// Pure and deterministic. A room is a rectangle of floor (the inner faces of its
// walls and partitions) plus what is in its walls: windows, exterior doors and the
// doors in its partitions. Each item of the room's furniture list is tried against
// the walls in a fixed order and takes the first spot that is inside the room, clear
// of every item already placed and clear of the swing of every door; an item that
// cannot be placed is dropped and counted, never forced through a wall. The caller
// turns the placements into pieces, so the counts on screen are the counts priced.
//
// Axes as in portaCabin.ts: x along the unit, z across, y up. y values here are
// absolute heights; `yBase` is the top of the room's floor.

import { CHAIR_GAP_M, getCabinEquipment, getRoomType } from "./cabinEquipment";
import type { EquipItem, RecipeLine, RoomTypeKey } from "./cabinEquipment";

export type Wall = "back" | "front" | "left" | "right";
export const WALLS: readonly Wall[] = ["back", "front", "left", "right"];

export type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Box = Rect & { y0: number; y1: number };

/** An opening in a wall of the room. `a`..`b` runs along the wall (x for back and front, z for left and right). */
export type WallOpening = { wall: Wall; a: number; b: number; sill: number; top: number; door: boolean };

export type RoomSpec = {
  label: string;
  type: RoomTypeKey;
  /** The free floor: inner faces of the walls and partitions. */
  rect: Rect;
  /** Top of the room's floor, and the inside height. */
  yBase: number;
  height: number;
  /** A wall (or partition) stands on this side; false where the unit is open to its neighbour. */
  solid: Record<Wall, boolean>;
  /** The side is an outside wall: the one place an air-conditioner can go. */
  exterior: Record<Wall, boolean>;
  /** Coordinate of the OUTER face of the wall on each side (z for back and front, x for left and right). */
  outer: Record<Wall, number>;
  openings: readonly WallOpening[];
  /** Extra no-go boxes, such as the swing of a door in a partition. */
  keepouts: readonly Box[];
  /** False when the quote leaves the air-conditioning out. */
  ac: boolean;
  /** Items added to the room's default list (fire extinguisher, water cooler). */
  extras: readonly string[];
};

export type PlacedItem = { item: string; room: string; x: number; y: number; z: number; rot: number };
export type Furnished = { placed: PlacedItem[]; dropped: Record<string, number> };

const G = 0.01;
const STEP = 0.05;
const FALLBACK_STEP = 0.1;
const EPS = 1e-6;
const DOOR_SWING_M = 0.95;
const DOOR_SIDE_M = 0.1;
const WINDOW_DEPTH_M = 0.25;
const WINDOW_SIDE_M = 0.05;
const CEILING_CLEAR_M = 0.12;
const HALF_PI = Math.PI / 2;

/** The order a room is furnished in: the big things first, so they get the walls. */
const RANK: readonly string[] = [
  "meeting_table", "desk", "bed_bunk", "bed_single", "wardrobe", "shelf", "pantry_counter", "fridge",
  "wc", "shower", "basin", "water_cooler", "water_heater", "ac_split", "extinguisher", "light", "socket",
];

/** Walls an item prefers, first to last (default: back, front, left, right). */
const PREFER: Readonly<Record<string, readonly Wall[]>> = {
  wc: ["front", "back", "left", "right"],
  basin: ["front", "back", "left", "right"],
  shower: ["front", "back", "left", "right"],
  fridge: ["right", "left", "back", "front"],
  water_cooler: ["right", "left", "back", "front"],
  socket: ["left", "right", "back", "front"],
  extinguisher: ["left", "right", "back", "front"],
};
/** Bunk beds stand under a window rather than be left out when the walls are crowded. */
const UNDER_WINDOW: ReadonlySet<string> = new Set(["bed_bunk"]);
const DEFAULT_PREFER: readonly Wall[] = ["back", "front", "left", "right"];

const overlaps = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS;
const clear = (box: Box, ...lists: readonly (readonly Box[])[]): boolean => !lists.some((l) => l.some((o) => overlaps(box, o)));

/** The direction a piece with rotation `rot` faces, and its local x axis, in the (x, z) plane. */
const facing = (rot: number): [number, number] => [Math.sin(rot), Math.cos(rot)];
const lateral = (rot: number): [number, number] => [Math.cos(rot), -Math.sin(rot)];
const turnAround = (rot: number): number => (rot > EPS ? rot - Math.PI : rot + Math.PI);
const rectOf = (cx: number, cz: number, w: number, t: number, rot: number): Rect => {
  const swap = Math.abs(Math.abs(rot) - HALF_PI) < 1e-3;
  const hx = (swap ? t : w) / 2;
  const hz = (swap ? w : t) / 2;
  return { x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz };
};

type Token = { item: string; withItem?: string; withN: number; nth: number };

function tokensOf(room: RoomSpec): Token[] {
  const rt = getRoomType(room.type);
  if (!rt) return [];
  const lines: RecipeLine[] = [...rt.items, ...room.extras.map((item) => ({ item, n: 1 }))];
  const seen: Record<string, number> = {};
  const out: Token[] = [];
  for (const l of lines) {
    if (l.item === "ac_split" && !room.ac) continue;
    for (let i = 0; i < l.n; i++) {
      out.push({ item: l.item, ...(l.withItem ? { withItem: l.withItem } : {}), withN: l.withN ?? 0, nth: (seen[l.item] = (seen[l.item] ?? -1) + 1) });
    }
  }
  const rank = (k: string): number => { const i = RANK.indexOf(k); return i < 0 ? RANK.length : i; };
  return out.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t.item) - rank(b.t.item) || a.i - b.i).map((x) => x.t);
}

type Cand = Rect & { cx: number; cz: number; rot: number };

/** Positions along one wall, the item's back against the wall; `mid` orders them from the middle of the wall outwards. */
function wallRun(rect: Rect, wall: Wall, w: number, t: number, mid: boolean): Cand[] {
  const out: Cand[] = [];
  const alongWall = wall === "back" || wall === "front";
  const lo = (alongWall ? rect.x0 : rect.z0) + G;
  const hi = (alongWall ? rect.x1 : rect.z1) - G - w;
  for (let a = lo; a <= hi + EPS; a += STEP) {
    if (alongWall) {
      const cz = wall === "back" ? rect.z0 + G + t / 2 : rect.z1 - G - t / 2;
      out.push({ cx: a + w / 2, cz, rot: wall === "back" ? 0 : Math.PI, x0: a, x1: a + w, z0: cz - t / 2, z1: cz + t / 2 });
    } else {
      const cx = wall === "left" ? rect.x0 + G + t / 2 : rect.x1 - G - t / 2;
      out.push({ cx, cz: a + w / 2, rot: wall === "left" ? HALF_PI : -HALF_PI, x0: cx - t / 2, x1: cx + t / 2, z0: a, z1: a + w });
    }
  }
  if (mid && out.length > 1) {
    const m = ((alongWall ? rect.x0 + rect.x1 : rect.z0 + rect.z1)) / 2;
    const along = (c: Cand): number => (alongWall ? c.cx : c.cz);
    return out.map((c, i) => ({ c, i })).sort((p, q) => Math.abs(along(p.c) - m) - Math.abs(along(q.c) - m) || p.i - q.i).map((x) => x.c);
  }
  return out;
}

/** Any spot in the room, nearest the middle first (turned a quarter turn as a second choice). */
function anywhere(rect: Rect, w: number, t: number): Cand[] {
  const out: Cand[] = [];
  const mx = (rect.x0 + rect.x1) / 2;
  const mz = (rect.z0 + rect.z1) / 2;
  for (const rot of [0, HALF_PI]) {
    const r0 = rectOf(0, 0, w, t, rot);
    const hw = (r0.x1 - r0.x0) / 2;
    const hd = (r0.z1 - r0.z0) / 2;
    for (let x = rect.x0 + G + hw; x <= rect.x1 - G - hw + EPS; x += FALLBACK_STEP) {
      for (let z = rect.z0 + G + hd; z <= rect.z1 - G - hd + EPS; z += FALLBACK_STEP) {
        out.push({ cx: x, cz: z, rot, ...rectOf(x, z, w, t, rot) });
      }
    }
  }
  return out.map((c, i) => ({ c, i, d: Math.hypot(c.cx - mx, c.cz - mz) + (c.rot === 0 ? 0 : 0.5) }))
    .sort((p, q) => p.d - q.d || p.i - q.i).map((x) => x.c);
}

/** One furniture group: an item with its chairs, standing against a wall or in the open. */
type Group = {
  w: number; t: number; h: number; free: boolean;
  /** Parts relative to the group's centre: along the group's facing direction (`dn`), sideways (`dl`), and a turn. */
  parts: { item: string; dn: number; dl: number; turn: boolean }[];
};

function groupOf(it: EquipItem, ch: EquipItem | null, withN: number): Group {
  if (!ch || withN < 1) return { w: it.w, t: it.t, h: it.h, free: false, parts: [{ item: it.key, dn: 0, dl: 0, turn: false }] };
  if (it.key === "meeting_table") {
    const sideA = Math.ceil(withN / 2);
    const sideB = withN - sideA;
    const t = it.t + (sideB > 0 ? 2 : 1) * (CHAIR_GAP_M + ch.t);
    const tableDn = sideB > 0 ? 0 : -(CHAIR_GAP_M + ch.t) / 2;
    const parts: Group["parts"] = [{ item: it.key, dn: tableDn, dl: 0, turn: false }];
    const place = (n: number, sign: number): void => {
      for (let i = 0; i < n; i++) {
        parts.push({ item: ch.key, dn: tableDn + sign * (it.t / 2 + CHAIR_GAP_M + ch.t / 2), dl: (i + 0.5 - n / 2) * (it.w / Math.max(n, 1)), turn: sign > 0 });
      }
    };
    place(sideA, 1);
    place(sideB, -1);
    return { w: it.w, t, h: Math.max(it.h, ch.h), free: true, parts };
  }
  // A desk, with its chair on the room side.
  const t = it.t + CHAIR_GAP_M + ch.t;
  const parts: Group["parts"] = [{ item: it.key, dn: -(t / 2 - it.t / 2), dl: 0, turn: false }];
  for (let i = 0; i < withN; i++) parts.push({ item: ch.key, dn: t / 2 - ch.t / 2, dl: (i + 0.5 - withN / 2) * (it.w / withN), turn: true });
  return { w: Math.max(it.w, ch.w), t, h: Math.max(it.h, ch.h), free: false, parts };
}

/**
 * Furnish one room. `outside` is shared by every room of the model so two outdoor air-conditioning units
 * never share a spot.
 */
export function furnishRoom(room: RoomSpec, outside: Box[]): Furnished {
  const placed: PlacedItem[] = [];
  const dropped: Record<string, number> = {};
  const boxes: Box[] = [];
  const { rect, yBase, height } = room;
  const top = yBase + height;

  const keepouts: Box[] = [...room.keepouts];
  const windowBoxes: Box[] = [];
  // An opening belongs to a wall of the unit; it matters to this room only where that wall is the room's own.
  const mine = room.openings.filter((o) => room.exterior[o.wall]);
  for (const o of mine) {
    const d = o.door ? DOOR_SWING_M : WINDOW_DEPTH_M;
    const m = o.door ? DOOR_SIDE_M : WINDOW_SIDE_M;
    const y0 = o.door ? yBase : yBase + o.sill - 0.05;
    const y1 = yBase + o.top + 0.05;
    const into = o.door ? keepouts : windowBoxes;
    if (o.wall === "back") into.push({ x0: o.a - m, x1: o.b + m, z0: rect.z0, z1: rect.z0 + d, y0, y1 });
    else if (o.wall === "front") into.push({ x0: o.a - m, x1: o.b + m, z0: rect.z1 - d, z1: rect.z1, y0, y1 });
    else if (o.wall === "left") into.push({ x0: rect.x0, x1: rect.x0 + d, z0: o.a - m, z1: o.b + m, y0, y1 });
    else into.push({ x0: rect.x1 - d, x1: rect.x1, z0: o.a - m, z1: o.b + m, y0, y1 });
  }

  const drop = (item: string, n = 1): void => { dropped[item] = (dropped[item] ?? 0) + n; };
  const fits = (b: Box, underWindow = false): boolean => b.y1 <= top - 0.02 + EPS && clear(b, boxes, keepouts, underWindow ? [] : windowBoxes);
  const wallsFor = (item: string, nth: number): Wall[] => {
    const pref = PREFER[item] ?? DEFAULT_PREFER;
    const k = nth % pref.length;
    return [...pref.slice(k), ...pref.slice(0, k)].filter((w) => room.solid[w]);
  };

  const tokens = tokensOf(room);
  const lights = tokens.filter((t) => t.item === "light").length;

  for (const tok of tokens) {
    const it = getCabinEquipment(tok.item);
    if (!it) continue;

    if (it.mount === "ceiling") {
      const cx = rect.x0 + ((rect.x1 - rect.x0) * (tok.nth + 0.5)) / lights;
      const cz = (rect.z0 + rect.z1) / 2;
      const b: Box = { x0: cx - it.w / 2, x1: cx + it.w / 2, z0: cz - it.t / 2, z1: cz + it.t / 2, y0: top - it.h, y1: top };
      if (b.x0 < rect.x0 + G - EPS || b.x1 > rect.x1 - G + EPS || b.z0 < rect.z0 + G - EPS || b.z1 > rect.z1 - G + EPS) { drop(tok.item); continue; }
      boxes.push(b);
      placed.push({ item: it.key, room: room.label, x: cx, y: top - it.h / 2, z: cz, rot: 0 });
      continue;
    }

    if (it.mount === "wall_high") {
      const y1 = top - CEILING_CLEAR_M;
      const y0 = y1 - it.h;
      const out = getCabinEquipment("ac_outdoor");
      let done = false;
      for (const wall of wallsFor(it.key, tok.nth).filter((w) => room.exterior[w])) {
        for (const c of wallRun(rect, wall, it.w, it.t, true)) {
          const b: Box = { x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, y0, y1 };
          if (!fits(b)) continue;
          // The outdoor unit hangs on the outside of the same wall, clear of any door and of other outdoor units.
          const along = wall === "back" || wall === "front" ? c.cx : c.cz;
          let ob: Box | null = null;
          let ocx = 0, ocz = 0, orot = 0;
          if (out) {
            const o = room.outer[wall];
            const gap = 0.02;
            const oy0 = yBase + out.lift;
            if (wall === "back") { ocx = along; ocz = o - gap - out.t / 2; orot = Math.PI; }
            else if (wall === "front") { ocx = along; ocz = o + gap + out.t / 2; orot = 0; }
            else if (wall === "left") { ocx = o - gap - out.t / 2; ocz = along; orot = -HALF_PI; }
            else { ocx = o + gap + out.t / 2; ocz = along; orot = HALF_PI; }
            const r = rectOf(ocx, ocz, out.w, out.t, orot);
            ob = { ...r, y0: oy0, y1: oy0 + out.h };
            const lo = along - out.w / 2;
            const hi = along + out.w / 2;
            const blocked = mine.some((op) => op.wall === wall && op.door && lo < op.b + DOOR_SIDE_M && op.a - DOOR_SIDE_M < hi);
            const insideRoom = lo >= (wall === "back" || wall === "front" ? rect.x0 : rect.z0) - EPS && hi <= (wall === "back" || wall === "front" ? rect.x1 : rect.z1) + EPS;
            if (blocked || !insideRoom || !clear(ob, outside)) continue;
          }
          boxes.push(b);
          placed.push({ item: it.key, room: room.label, x: c.cx, y: (y0 + y1) / 2, z: c.cz, rot: c.rot });
          if (out && ob) {
            outside.push(ob);
            placed.push({ item: out.key, room: room.label, x: ocx, y: (ob.y0 + ob.y1) / 2, z: ocz, rot: orot });
          }
          done = true;
          break;
        }
        if (done) break;
      }
      if (!done) drop(tok.item);
      continue;
    }

    if (it.mount === "wall") {
      const y0 = yBase + it.lift;
      let done = false;
      for (const wall of wallsFor(it.key, tok.nth)) {
        for (const c of wallRun(rect, wall, it.w, it.t, true)) {
          const b: Box = { x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, y0, y1: y0 + it.h };
          if (!fits(b)) continue;
          boxes.push(b);
          placed.push({ item: it.key, room: room.label, x: c.cx, y: y0 + it.h / 2, z: c.cz, rot: c.rot });
          done = true;
          break;
        }
        if (done) break;
      }
      if (!done) drop(tok.item);
      continue;
    }

    // Floor items, alone or with their chairs.
    const ch = tok.withItem ? getCabinEquipment(tok.withItem) : null;
    const grp = groupOf(it, ch, tok.withN);
    const cands: Cand[] = [];
    if (!grp.free) for (const wall of wallsFor(it.key, tok.nth)) cands.push(...wallRun(rect, wall, grp.w, grp.t, false));
    cands.push(...anywhere(rect, grp.w, grp.t));
    let done = false;
    for (const c of cands) {
      const b: Box = { x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, y0: yBase, y1: yBase + grp.h };
      if (c.x0 < rect.x0 + G - EPS || c.x1 > rect.x1 - G + EPS || c.z0 < rect.z0 + G - EPS || c.z1 > rect.z1 - G + EPS) continue;
      if (!fits(b, UNDER_WINDOW.has(it.key))) continue;
      boxes.push(b);
      const [nx, nz] = facing(c.rot);
      const [lx, lz] = lateral(c.rot);
      for (const p of grp.parts) {
        const pi = getCabinEquipment(p.item)!;
        placed.push({
          item: p.item, room: room.label,
          x: c.cx + nx * p.dn + lx * p.dl, y: yBase + pi.h / 2, z: c.cz + nz * p.dn + lz * p.dl,
          rot: p.turn ? turnAround(c.rot) : c.rot,
        });
      }
      done = true;
      break;
    }
    if (!done) {
      drop(it.key);
      if (ch) drop(ch.key, grp.parts.filter((p) => p.item === ch.key).length);
    }
  }
  return { placed, dropped };
}

/** The footprint of a placed item, for tests and the caller's bounds checks. */
export function placedRect(p: PlacedItem): Rect {
  const it = getCabinEquipment(p.item);
  return it ? rectOf(p.x, p.z, it.w, it.t, p.rot) : { x0: p.x, x1: p.x, z0: p.z, z1: p.z };
}
