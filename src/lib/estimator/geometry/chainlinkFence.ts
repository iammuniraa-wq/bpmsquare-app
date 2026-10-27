// The chain-link fence layout module (docs/estimator-architecture.md section 18).
//
// It wraps src/lib/fence/geometry.ts (pure, tested, the engineering the Fence
// configurator has used since 0122) and turns its COUNTS into pieces, so a fence
// estimate reads them the way a villa reads its panels: n_LP (line posts), n_SP
// (straining), n_CP (corner), n_TP (terminal), n_GP (gate posts), area_FB (fabric,
// m2), n_GT and area_GT (gates). The hardware (bands, rail ends, bolts, wire) is
// NOT here: it is rule lines in the template, priced from those counts.
//
// The post-count split (line vs straining vs corner) is the open engineering-review
// item recorded in docs/fence-configurator-architecture.md section 5; this module
// does not change it, so a fence estimate and an old fence project agree to the post.
//
// Positions are for drawing and are approximate (a closed fence is drawn as a 2:1
// rectangle); the counts and the fabric area are exact and are what is priced.

import { computeGeometry, type FenceGateInput } from "../../fence/geometry";
import type { DesignSlot, GeometryModel, GeometryModule, GeometryResult, Piece, PieceKind } from "./types";

export const CHAINLINK_FENCE_KEY = "chainlink_fence";

/** Parts a design attribute can repaint; "footing" is the concrete base drawn at the foot of every post. */
export const CHAINLINK_FENCE_SLOTS: readonly DesignSlot[] = [
  { key: "posts", label: "Posts and rails", default: "galvanised" },
  { key: "mesh", label: "Chain-link mesh", default: "galvanised" },
  { key: "footing", label: "Post footings", default: "concrete_smooth" },
  { key: "gate", label: "Gate frames", default: "galvanised" },
  { key: "ground", label: "Ground", default: "ground_sand" },
];

/** The slot each piece family is painted by when the piece carries no `slot` of its own. */
export const CHAINLINK_FENCE_SLOT_BY_CODE: Readonly<Record<string, string>> = {
  LP: "posts", SP: "posts", CP: "posts", TP: "posts", GP: "posts", FB: "mesh", GT: "gate",
};

/** What a gate piece is, so the viewer can draw hinges (swing), a centre bolt (double) or a track (sliding). Stored on `Piece.item`. */
export type FenceGateKind = "single_swing" | "double_swing" | "sliding";

/**
 * Where a gate and its two posts stand: the posts are moved along the fence to straddle the gate's width (never past
 * 0.8 of a post bay, so a neighbour is not run over); the gate sits midway, turned along the fence. Pure drawing
 * geometry: counts, marks and areas are not touched.
 */
export function placeGate(a: Point, b: Point, width: number, bay: number): { a: Point; b: Point; mid: Point; rot: number } {
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const ux = dist > 1e-6 ? dx / dist : 1;
  const uz = dist > 1e-6 ? dz / dist : 0;
  const slack = 0.8 * bay;
  const half = Math.min(dist / 2 + slack, Math.max(Math.max(0.25, dist / 2 - slack), width / 2));
  return {
    a: { x: mid.x - ux * half, z: mid.z - uz * half },
    b: { x: mid.x + ux * half, z: mid.z + uz * half },
    mid,
    rot: -Math.atan2(uz, ux),
  };
}

/** More posts than this and the model is refused rather than stored: a fence this long is several estimates. */
export const MAX_FENCE_POSTS = 4000;

const EMBEDMENT_M = 0.9;
const POST_SIZE_M = 0.06;

const POST_CODES = ["LP", "SP", "CP", "TP", "GP"] as const;
type PostCode = (typeof POST_CODES)[number];

const STEP_NAMES = ["Foundations", "Posts", "Fabric", "Gates"];

const n = (v: number | undefined, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const pad = (i: number) => String(i).padStart(3, "0");
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export type Point = { x: number; z: number };

/** A point `s` metres along the fence: a straight line, or the edge of a 2:1 rectangle. */
function pointAlong(s: number, total: number, closed: boolean): Point {
  if (!closed) return { x: s - total / 2, z: 0 };
  const depth = total / 6;
  const width = total / 3;
  const per = 2 * (width + depth);
  let t = ((s % per) + per) % per;
  if (t < width) return { x: t - width / 2, z: -depth / 2 };
  t -= width;
  if (t < depth) return { x: width / 2, z: t - depth / 2 };
  t -= depth;
  if (t < width) return { x: width / 2 - t, z: depth / 2 };
  t -= width;
  return { x: -width / 2, z: depth / 2 - t };
}

/** Give each post a family so the totals are exactly the geometry's, whatever the order. */
function assignKinds(total: number, counts: Record<PostCode, number>, closed: boolean): PostCode[] {
  const kinds: (PostCode | null)[] = Array(total).fill(null);
  const claim = (code: PostCode, want: number, at: (k: number) => number) => {
    for (let k = 0; k < want; k++) {
      let i = Math.min(total - 1, Math.max(0, Math.round(at(k))));
      for (let step = 0; step < total && kinds[i] !== null; step++) i = (i + 1) % total;
      if (kinds[i] === null) kinds[i] = code;
    }
  };
  if (closed) claim("CP", counts.CP, (k) => (k * total) / Math.max(1, counts.CP));
  else claim("TP", counts.TP, (k) => (k === 0 ? 0 : total - 1));
  claim("GP", counts.GP, (k) => ((Math.floor(k / 2) + 0.5) * total) / Math.max(1, counts.GP / 2) + (k % 2));
  claim("SP", counts.SP, (k) => ((k + 1) * total) / (counts.SP + 1));
  return kinds.map((k) => k ?? "LP");
}

export const CHAINLINK_FENCE_MODULE: GeometryModule = {
  key: CHAINLINK_FENCE_KEY,
  label: "Chain-link fence",
  piece_codes: [
    { code: "LP", label: "Line posts" },
    { code: "SP", label: "Straining posts" },
    { code: "CP", label: "Corner posts" },
    { code: "TP", label: "Terminal posts" },
    { code: "GP", label: "Gate posts" },
    { code: "FB", label: "Chain-link fabric" },
    { code: "GT", label: "Gates" },
  ],
  inputs: [
    { key: "total_length_m", required: true },
    { key: "closed_perimeter", required: false, default: 1 },
    { key: "post_spacing_m", required: false, default: 3, allow_select: true },
    { key: "straining_spacing_m", required: false, default: 100 },
    { key: "fabric_height_m", required: false, default: 2 },
    { key: "gates_single_n", required: false, default: 0 },
    { key: "gates_single_w", required: false, default: 1 },
    { key: "gates_double_n", required: false, default: 0 },
    { key: "gates_double_w", required: false, default: 4 },
    { key: "gates_sliding_n", required: false, default: 0 },
    { key: "gates_sliding_w", required: false, default: 6 },
  ],

  slots: CHAINLINK_FENCE_SLOTS,

  layout(inputs): GeometryResult {
    const length = n(inputs.total_length_m, 0);
    const closed = n(inputs.closed_perimeter, 1) >= 0.5;
    const height = n(inputs.fabric_height_m, 2);
    const gates: (FenceGateInput & { sort: number })[] = [];
    const addGates = (type: FenceGateInput["type"], count: number, width: number) => {
      for (let i = 0; i < Math.max(0, Math.round(count)); i++) gates.push({ type, width_m: width, sort: gates.length });
    };
    addGates("single_swing", n(inputs.gates_single_n, 0), n(inputs.gates_single_w, 1));
    addGates("double_swing", n(inputs.gates_double_n, 0), n(inputs.gates_double_w, 4));
    addGates("sliding", n(inputs.gates_sliding_n, 0), n(inputs.gates_sliding_w, 6));
    if (gates.length > 40) return { ok: false, error: "A fence estimate takes at most 40 gates." };
    if (gates.some((g) => !(g.width_m > 0))) return { ok: false, error: "Each gate needs a width above zero." };

    let geo;
    try {
      geo = computeGeometry({
        layout: closed ? "closed_perimeter" : "open_run",
        total_length_m: length,
        post_spacing_m: n(inputs.post_spacing_m, 3),
        embedment_m: EMBEDMENT_M,
        straining_spacing_m: n(inputs.straining_spacing_m, 100),
        gates: gates.map(({ type, width_m }) => ({ type, width_m })),
        fabric_height_m: height,
      });
    } catch (e) {
      return { ok: false, error: e instanceof RangeError ? e.message.replace(/^FenceGeometryInput\./, "") : "The fence could not be laid out." };
    }
    if (geo.total_posts > MAX_FENCE_POSTS) {
      return { ok: false, error: `That is ${geo.total_posts} posts; a fence estimate takes at most ${MAX_FENCE_POSTS}. Split a very long fence into sections.` };
    }

    const warnings: string[] = [];
    if (geo.gate_width_sum_m >= length) warnings.push("The gates are as wide as the whole fence, so there is no fabric to price.");
    if (geo.line_posts === 0 && geo.total_posts > 0) warnings.push("The posts are so far apart that the corner, straining and gate posts take up all of them.");

    const counts: Record<PostCode, number> = {
      LP: geo.line_posts, SP: geo.straining_posts, CP: geo.corner_posts, TP: geo.terminal_posts, GP: geo.gate_posts,
    };
    const kinds = assignKinds(geo.total_posts, counts, closed);
    const seq: Record<string, number> = {};
    const next = (code: string) => { seq[code] = (seq[code] ?? 0) + 1; return `${code}-${pad(seq[code])}`; };

    const pieces: Piece[] = [];
    const postHeight = height + 0.6;
    const spots: Point[] = kinds.map((_, i) => {
      const s = geo.total_posts <= 1 ? 0 : closed ? (i * length) / geo.total_posts : (i * length) / (geo.total_posts - 1);
      return pointAlong(s, length, closed);
    });
    // Each gate stands between a pair of gate posts (in index order, the gate's own two): stand the pair apart by the
    // gate's width and put the gate between them, so the drawing shows a gate in its opening.
    const gatePostIdx = kinds.flatMap((c, i) => (c === "GP" ? [i] : []));
    const bay = geo.total_posts > 0 ? length / geo.total_posts : length;
    const gateSpots = gates.map((g, j) => {
      const ia = gatePostIdx[2 * j];
      const ib = gatePostIdx[2 * j + 1];
      if (ia === undefined || ib === undefined) {
        const p = pointAlong(((j + 0.5) * length) / gates.length, length, closed);
        return { mid: p, rot: 0 };
      }
      const placed = placeGate(spots[ia], spots[ib], g.width_m, bay);
      spots[ia] = placed.a;
      spots[ib] = placed.b;
      return { mid: placed.mid, rot: placed.rot };
    });
    kinds.forEach((code, i) => {
      const p = spots[i];
      pieces.push({
        id: next(code), code, kind: "col" as PieceKind, step: 1, floor: 0,
        pos: [r3(p.x), r3(postHeight / 2 - 0.3), r3(p.z)],
        dims: { w: POST_SIZE_M, h: postHeight, t: POST_SIZE_M }, vol: 0,
      });
    });
    if (geo.fabric_area_m2 > 0) {
      pieces.push({
        id: next("FB"), code: "FB", kind: "panel", step: 2, floor: 0, pos: [0, height / 2, 0],
        dims: { w: Math.max(0, length - geo.gate_width_sum_m), h: height, t: 0.005 }, vol: 0, area: geo.fabric_area_m2,
      });
    }
    gates.forEach((g, i) => {
      const at = gateSpots[i];
      pieces.push({
        id: next("GT"), code: "GT", kind: "panel", step: 3, floor: 0, pos: [r3(at.mid.x), r3(height / 2), r3(at.mid.z)],
        rot: Math.round(at.rot * 10000) / 10000, item: g.type as FenceGateKind,
        dims: { w: g.width_m, h: height, t: 0.05 }, vol: 0, area: g.width_m * height,
      });
    });

    const w = r3(closed ? length / 3 : length);
    const d = r3(closed ? length / 6 : 1);
    const model: GeometryModel = { geometry: CHAINLINK_FENCE_KEY, pieces, w, d, step_names: STEP_NAMES, warnings };
    return { ok: true, model };
  },
};

/** Gate widths as the three-way (count, width) inputs describe them, for callers that draw the fence. */
export function fenceGatesFromInputs(v: Readonly<Record<string, number | string | boolean>>): FenceGateInput[] {
  const num = (k: string, fallback: number) => (typeof v[k] === "number" && Number.isFinite(v[k] as number) ? (v[k] as number) : fallback);
  const out: FenceGateInput[] = [];
  const add = (type: FenceGateInput["type"], count: number, width: number) => {
    for (let i = 0; i < Math.max(0, Math.round(count)); i++) out.push({ type, width_m: width });
  };
  add("single_swing", num("gates_single_n", 0), num("gates_single_w", 1));
  add("double_swing", num("gates_double_n", 0), num("gates_double_w", 4));
  add("sliding", num("gates_sliding_n", 0), num("gates_sliding_w", 6));
  return out;
}
