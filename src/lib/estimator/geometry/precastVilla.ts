// Geometry module "precast_villa": a rectangular villa of precast pieces with
// a parapet and a boundary wall, laid out as a list of real pieces.
//
// A pure, tested port of the reference layout() in
// docs/estimator-reference/layout-and-calc.reference.js: same pieces, same
// marks, same volumes. The reference's inline numbers are named constants
// below, and the degenerate cases the mock-up ignored are handled (see
// clampInputs and footprint). EVERY dimension here is an ILLUSTRATIVE
// placeholder -- panel widths, member sizes and hollow-core void share are
// plausible-looking numbers that make the model demonstrable, not any
// manufacturer's real product range. A real client gets its own module or
// its own client BIM model (section 10.1); the engine never changes.
//
// Footprint: the building is a w x d rectangle recovered from the wall
// perimeter and the floor area per storey (w + d = perimeter / 2, w * d =
// area). Axes: x runs along w, z along d, y is up; the origin is the centre of
// the footprint at ground level.

import type { DesignSlot, GeometryInputSpec, GeometryModel, GeometryModule, GeometryResult, Piece, PieceCodeInfo, PieceOpening } from "./types";

export const PRECAST_VILLA_KEY = "precast_villa";

// ── Limits (inputs are clamped into these, with a warning) ──────────────────
export const MAX_PIECES = 5000;
const LIMITS = {
  floors: { min: 1, max: 6 },
  area: { min: 10, max: 5000 },
  perimeter: { min: 10, max: 1000 },
  height: { min: 2.2, max: 6 },
  thickness: { min: 0.08, max: 0.6 },
  flights: { min: 0, max: 20 },
  boundaryLength: { min: 0, max: 2000 },
  boundaryHeight: { min: 1, max: 4 },
} as const;
/** Shortest side of the footprint; anything slimmer is re-proportioned. */
export const MIN_FOOTPRINT_SIDE_M = 3;

// ── Illustrative dimensions, metres unless noted ────────────────────────────
const STOREY_GAP_M = 0.25; // vertical air between storeys (explode spacing in the viewer)
const PANEL_TARGET_W_M = 2.4; // wall and parapet panels are cut to about this width
const JOINT_M = 0.06; // joint taken off every panel width
const COLUMN_SIZE_M = 0.4;
const COLUMN_EDGE_INSET_M = 0.7; // end columns sit this far in from the gable
const BEAM_DEPTH_M = 0.5;
const BEAM_WIDTH_M = 0.4;
const BEAM_END_INSET_M = 1.0; // beam is shorter than the footprint by this
const DOOR = { w: 1.2, h: 2.1, sill: 0, minLeaf: 0.5 }; // front door, ground floor
const WINDOW = { w: 1.3, h: 1.2, sill: 0.9, minPanelW: 1.4, minLeaf: 0.8 };
const WINDOW_SKIP_EVERY = 3; // every third panel on side walls stays solid (front keeps all)
const INTERNAL_WALL_T_M = 0.15;
const INTERNAL_WALL_LONG_SHARE = 0.8; // of w, along x
const INTERNAL_WALL_CROSS_SHARE = 0.5; // of d, along z
const PLANK_W_M = 1.2;
const PLANK_DEPTH_M = 0.2;
const PLANK_OVERHANG_M = 0.2; // slab runs this far past the walls in total
const PLANK_GAP_M = 0.04;
const HOLLOW_CORE_SOLID_SHARE = 0.62; // concrete share of a hollow-core plank's gross volume
const STAIR_FLIGHT = { w: 1.2, run: 3.2, vol: 1.6, spacing: 1.5, xInset: 1.5, zInset: 2.4 };
const PARAPET = { h: 0.9, t: 0.12, lift: 0.2 + 0.45 }; // sits on the roof slab plus a plank and a half-height offset
const BOUNDARY_OFFSET_M = 10; // boundary wall stands this much outside the building (total, both sides)
const BOUNDARY_PANEL = { pitch: 2.4, w: 2.34, t: 0.1 };
const COORD_DP = 4; // positions and sizes: 0.1 mm
const QTY_DP = 6; // volumes and areas keep more, so a sum of identical pieces does not drift

const PIECE_CODES: readonly PieceCodeInfo[] = [
  { code: "EW", label: "External wall panels" },
  { code: "PR", label: "Parapet panels" },
  { code: "IW", label: "Internal wall panels" },
  { code: "SL", label: "Hollow-core floor and roof planks" },
  { code: "FR", label: "Beams and columns" },
  { code: "ST", label: "Stair flights" },
  { code: "BW", label: "Boundary wall panels" },
];

/**
 * Parts a design attribute can repaint. "window", "door" and "plinth" are drawn details of the wall panels and the
 * foundation, not pieces of their own; the others are the piece families (see PRECAST_SLOT_BY_CODE).
 */
export const PRECAST_VILLA_SLOTS: readonly DesignSlot[] = [
  { key: "wall", label: "Walls and parapet", default: "concrete_precast" },
  { key: "slab", label: "Floor and roof slabs", default: "concrete_precast" },
  { key: "frame", label: "Beams and columns", default: "concrete_precast" },
  { key: "stair", label: "Stair flights", default: "concrete_smooth" },
  { key: "boundary", label: "Boundary wall", default: "concrete_precast" },
  { key: "window", label: "Window and door frames", default: "alu_dark" },
  { key: "door", label: "Front door", default: "wood_door" },
  { key: "plinth", label: "Foundation plinth", default: "concrete_smooth" },
  { key: "ground", label: "Ground", default: "ground_grass" },
];

/** The slot each piece family is painted by when the piece carries no `slot` of its own (also true of models stored before slots existed). */
export const PRECAST_SLOT_BY_CODE: Readonly<Record<string, string>> = {
  EW: "wall", IW: "wall", PR: "wall", SL: "slab", FR: "frame", ST: "stair", BW: "boundary",
};

const INPUTS: readonly GeometryInputSpec[] = [
  { key: "floors", required: true },
  { key: "built_up_area_m2", required: true },
  { key: "wall_perimeter_m", required: true },
  { key: "wall_height_m", required: true },
  { key: "ext_wall_thickness_m", required: true },
  { key: "stair_flights", required: true },
  { key: "boundary_wall_length_m", required: true },
  { key: "include_stairs", required: false, default: 1 },
  { key: "boundary_wall_height_m", required: false, default: 2.4 },
];

const rd = (x: number, dp: number): number => Math.round(x * 10 ** dp) / 10 ** dp + 0; // + 0 turns -0 into 0
const r4 = (x: number): number => rd(x, COORD_DP);

class LayoutError extends Error {}

function clamp(v: number, lim: { min: number; max: number }, label: string, warnings: string[], whole = false): number {
  let x = Number.isFinite(v) ? v : lim.min;
  if (whole) x = Math.round(x);
  if (x < lim.min) { warnings.push(`${label} ${v} is below the supported minimum; using ${lim.min}.`); return lim.min; }
  if (x > lim.max) { warnings.push(`${label} ${v} is above the supported maximum; using ${lim.max}.`); return lim.max; }
  return x;
}

/** Recover the w x d rectangle from the wall perimeter and the storey area. */
export function footprint(perimeter: number, area: number, warnings: string[] = []): { w: number; d: number } {
  const half = perimeter / 2;
  const disc = half * half - 4 * area;
  let w: number;
  let d: number;
  if (disc >= 0) {
    w = (half + Math.sqrt(disc)) / 2;
    d = (half - Math.sqrt(disc)) / 2;
  } else {
    // The perimeter is too short to enclose this area at all: a square is the
    // most compact shape, so use it (the reference behaviour) and say so.
    w = d = Math.sqrt(area);
    warnings.push(`A ${perimeter} m perimeter cannot enclose ${area} m2; the footprint is a ${r4(w)} m square instead.`);
  }
  if (d < MIN_FOOTPRINT_SIDE_M) {
    // A sliver is not a house: keep the area, fix the short side.
    d = MIN_FOOTPRINT_SIDE_M;
    w = area / d;
    warnings.push(`The perimeter and area give a ${r4(Math.min(w, d))} m wide sliver; the footprint is ${r4(w)} x ${MIN_FOOTPRINT_SIDE_M} m instead.`);
  }
  return { w, d };
}

type Seg = { n: number; w: number };
const segs = (len: number, target: number): Seg => {
  const n = Math.max(1, Math.round(len / target));
  return { n, w: len / n };
};

export function layoutPrecastVilla(raw: Readonly<Record<string, number>>): GeometryResult {
  try {
    return { ok: true, model: build(raw) };
  } catch (e) {
    if (e instanceof LayoutError) return { ok: false, error: e.message };
    throw e;
  }
}

function build(raw: Readonly<Record<string, number>>): GeometryModel {
  const warnings: string[] = [];
  const num = (k: string): number => raw[k];
  const floors = clamp(num("floors"), LIMITS.floors, "Floors", warnings, true);
  const area = clamp(num("built_up_area_m2"), LIMITS.area, "Floor area", warnings);
  const perim = clamp(num("wall_perimeter_m"), LIMITS.perimeter, "Wall perimeter", warnings);
  const fh = clamp(num("wall_height_m"), LIMITS.height, "Wall height", warnings);
  const th = clamp(num("ext_wall_thickness_m"), LIMITS.thickness, "Wall thickness", warnings);
  const stairsOn = raw.include_stairs === undefined ? true : raw.include_stairs !== 0;
  const flights = stairsOn ? clamp(num("stair_flights"), LIMITS.flights, "Stair flights", warnings, true) : 0;
  const bw = clamp(num("boundary_wall_length_m"), LIMITS.boundaryLength, "Boundary wall length", warnings);
  const bwh = clamp(raw.boundary_wall_height_m ?? 2.4, LIMITS.boundaryHeight, "Boundary wall height", warnings);

  const { w, d } = footprint(perim, area, warnings);
  const pcs: Piece[] = [];
  const counts: Record<string, number> = {};
  const stepNames = ["Foundation base"];
  let step = 0;

  const add = (o: Omit<Piece, "id">): void => {
    if (pcs.length >= MAX_PIECES) {
      throw new LayoutError(`This design needs more than ${MAX_PIECES} pieces; reduce the floors, the perimeter or the boundary wall length.`);
    }
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
  const fy = (f: number): number => f * (fh + STOREY_GAP_M);
  const wallSides = (s: Seg, t: Seg): { n: number; pw: number; z?: number; x?: number; rot: number; side: string }[] => [
    { n: s.n, pw: s.w, z: d / 2, rot: 0, side: "front" },
    { n: s.n, pw: s.w, z: -d / 2, rot: 0, side: "back" },
    { n: t.n, pw: t.w, x: w / 2, rot: Math.PI / 2, side: "right" },
    { n: t.n, pw: t.w, x: -w / 2, rot: Math.PI / 2, side: "left" },
  ];

  for (let f = 0; f < floors; f++) {
    step++;
    stepNames.push(`Floor ${f + 1}: columns and beam`);
    const colH = fh - BEAM_DEPTH_M;
    for (const x of [-w / 2 + COLUMN_EDGE_INSET_M, 0, w / 2 - COLUMN_EDGE_INSET_M]) {
      add({ code: "FR", kind: "col", step, floor: f, pos: [x, fy(f) + colH / 2, 0], dims: { w: COLUMN_SIZE_M, h: colH, t: COLUMN_SIZE_M }, vol: COLUMN_SIZE_M * COLUMN_SIZE_M * colH });
    }
    add({ code: "FR", kind: "box", step, floor: f, pos: [0, fy(f) + fh - BEAM_DEPTH_M / 2, 0], dims: { w: w - BEAM_END_INSET_M, h: BEAM_DEPTH_M, t: BEAM_WIDTH_M }, vol: (w - BEAM_END_INSET_M) * BEAM_DEPTH_M * BEAM_WIDTH_M });

    step++;
    stepNames.push(`Floor ${f + 1}: wall panels`);
    const sw = segs(w, PANEL_TARGET_W_M);
    const sd = segs(d, PANEL_TARGET_W_M);
    const y = fy(f) + fh / 2;
    for (const s of wallSides(sw, sd)) {
      for (let k = 0; k < s.n; k++) {
        const off = (k + 0.5) * s.pw - (s.rot === 0 ? w : d) / 2;
        let op: PieceOpening | null = null;
        if (s.side === "front" && f === 0 && k === Math.floor(s.n / 2)) {
          op = { w: Math.min(DOOR.w, s.pw - DOOR.minLeaf), h: DOOR.h, sill: DOOR.sill, door: true };
        } else if (s.pw > WINDOW.minPanelW && (k % WINDOW_SKIP_EVERY !== 2 || s.side === "front")) {
          op = { w: Math.min(WINDOW.w, s.pw - WINDOW.minLeaf), h: WINDOW.h, sill: WINDOW.sill, door: false };
        }
        const openingArea = op ? op.w * op.h : 0;
        const pw = s.pw - JOINT_M;
        add({
          code: "EW", kind: "panel", step, floor: f,
          pos: [s.rot === 0 ? off : s.x!, y, s.rot === 0 ? s.z! : off], rot: s.rot,
          dims: { w: pw, h: fh, t: th }, op,
          vol: pw * fh * th - openingArea * th,
          area: pw * fh - openingArea,
        });
      }
    }
    const l1 = w * INTERNAL_WALL_LONG_SHARE;
    const n1 = Math.ceil(l1 / PANEL_TARGET_W_M);
    const l2 = d * INTERNAL_WALL_CROSS_SHARE;
    const n2 = Math.ceil(l2 / PANEL_TARGET_W_M);
    for (let i = 0; i < n1; i++) {
      const pw = l1 / n1 - JOINT_M;
      add({ code: "IW", kind: "panel", step, floor: f, pos: [-l1 / 2 + (i + 0.5) * (l1 / n1), y, -d / 4], rot: 0, dims: { w: pw, h: fh, t: INTERNAL_WALL_T_M }, op: null, vol: pw * fh * INTERNAL_WALL_T_M });
    }
    for (let i = 0; i < n2; i++) {
      const pw = l2 / n2 - JOINT_M;
      add({ code: "IW", kind: "panel", step, floor: f, pos: [w / 6, y, -d / 2 + (i + 0.5) * (l2 / n2)], rot: Math.PI / 2, dims: { w: pw, h: fh, t: INTERNAL_WALL_T_M }, op: null, vol: pw * fh * INTERNAL_WALL_T_M });
    }

    step++;
    stepNames.push(f === floors - 1 ? "Roof: hollow-core planks" : `Floor ${f + 2}: hollow-core planks`);
    const np = Math.max(1, Math.ceil(w / PLANK_W_M));
    const plw = (w + PLANK_OVERHANG_M) / np;
    for (let i = 0; i < np; i++) {
      add({
        code: "SL", kind: "plank", step, floor: f,
        pos: [-(w + PLANK_OVERHANG_M) / 2 + (i + 0.5) * plw, fy(f) + fh + PLANK_DEPTH_M / 2, 0],
        dims: { w: plw - PLANK_GAP_M, h: PLANK_DEPTH_M, t: d + PLANK_OVERHANG_M },
        vol: (plw - PLANK_GAP_M) * (d + PLANK_OVERHANG_M) * PLANK_DEPTH_M * HOLLOW_CORE_SOLID_SHARE,
      });
    }

    if (f === 0 && flights > 0) {
      step++;
      stepNames.push("Stair flights");
      for (let i = 0; i < flights; i++) {
        add({
          code: "ST", kind: "stair", step, floor: 0,
          pos: [-w / 2 + STAIR_FLIGHT.xInset + i * STAIR_FLIGHT.spacing, 0, -d / 2 + STAIR_FLIGHT.zInset],
          dims: { w: STAIR_FLIGHT.w, h: fh, t: STAIR_FLIGHT.run }, vol: STAIR_FLIGHT.vol,
        });
      }
    }
  }

  step++;
  stepNames.push("Parapet panels");
  const top = fy(floors - 1) + fh + PARAPET.lift;
  const pw2 = segs(w, PANEL_TARGET_W_M);
  const pd2 = segs(d, PANEL_TARGET_W_M);
  for (const s of wallSides(pw2, pd2)) {
    for (let k = 0; k < s.n; k++) {
      const off = (k + 0.5) * s.pw - (s.rot === 0 ? w : d) / 2;
      const pw = s.pw - JOINT_M;
      add({
        code: "PR", kind: "panel", step, floor: floors - 1,
        pos: [s.rot === 0 ? off : s.x!, top, s.rot === 0 ? s.z! : off], rot: s.rot,
        dims: { w: pw, h: PARAPET.h, t: PARAPET.t }, op: null, vol: pw * PARAPET.h * PARAPET.t,
      });
    }
  }

  if (bw > 0) {
    step++;
    stepNames.push("Boundary wall");
    const ow = w + BOUNDARY_OFFSET_M;
    const od = d + BOUNDARY_OFFSET_M;
    const per = 2 * (ow + od);
    const nb = Math.ceil(bw / BOUNDARY_PANEL.pitch);
    for (let i = 0; i < nb; i++) {
      const u = (i * BOUNDARY_PANEL.pitch) % per;
      const half = BOUNDARY_PANEL.pitch / 2;
      let bx: number;
      let bz: number;
      let rot = 0;
      if (u < ow) { bx = -ow / 2 + u + half; bz = od / 2; }
      else if (u < ow + od) { bx = ow / 2; bz = od / 2 - (u - ow) - half; rot = Math.PI / 2; }
      else if (u < 2 * ow + od) { bx = ow / 2 - (u - ow - od) - half; bz = -od / 2; }
      else { bx = -ow / 2; bz = -od / 2 + (u - 2 * ow - od) + half; rot = Math.PI / 2; }
      add({
        code: "BW", kind: "panel", step, floor: 0, pos: [bx, bwh / 2, bz], rot,
        dims: { w: BOUNDARY_PANEL.w, h: bwh, t: BOUNDARY_PANEL.t }, op: null, vol: BOUNDARY_PANEL.w * bwh * BOUNDARY_PANEL.t,
      });
    }
  }

  return { geometry: PRECAST_VILLA_KEY, pieces: pcs, w: r4(w), d: r4(d), step_names: stepNames, warnings };
}

export const PRECAST_VILLA_MODULE: GeometryModule = {
  key: PRECAST_VILLA_KEY,
  label: "Precast villa (illustrative)",
  piece_codes: PIECE_CODES,
  inputs: INPUTS,
  slots: PRECAST_VILLA_SLOTS,
  layout: layoutPrecastVilla,
};
