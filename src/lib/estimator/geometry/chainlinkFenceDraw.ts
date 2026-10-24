// Pure drawing maths for the chain-link fence (no three.js): which post pairs the fabric runs between, where a
// gate stands and how it is oriented, how big a post and its footing are, and how the diamond mesh texture
// repeats. The viewer (components/estimator/viewer/fenceMeshes.ts) turns these into meshes; counts, marks and the
// bill of materials never depend on anything here.

import type { FenceGateKind } from "./chainlinkFence";
import type { GeometryModel, Piece } from "./types";

/** One diamond of the mesh, metres (the usual 50 mm chain-link). */
export const DIAMOND_PITCH_M = 0.05;
/** The mesh texture tile is one diamond, drawn at this many pixels. */
export const DIAMOND_TILE_PX = 64;

export const POST_CODES: readonly string[] = ["LP", "SP", "CP", "TP", "GP"];

/** How many times the one-diamond texture repeats across a run of fabric. */
export function diamondRepeat(lengthM: number, heightM: number, pitch = DIAMOND_PITCH_M): [number, number] {
  return [Math.max(1, lengthM / pitch), Math.max(1, heightM / pitch)];
}

/** Post radius by family, metres: line posts are lighter tube than the ones that carry the strain. */
export function postRadius(code: string): number {
  return code === "LP" ? 0.0305 : code === "GP" ? 0.05 : 0.04;
}

/** Concrete footing radius by family, metres. */
export function footingRadius(code: string): number {
  return code === "LP" ? 0.12 : code === "GP" ? 0.2 : 0.16;
}

/** How far the footing shows above the ground and how deep the drawn stub goes, metres. */
export const FOOTING_ABOVE_M = 0.07;
export const FOOTING_DEPTH_M = 0.45;

export type FenceRun = { x1: number; z1: number; x2: number; z2: number; len: number; mx: number; mz: number; rot: number };

const isPost = (p: Piece) => p.kind === "col" && POST_CODES.includes(p.code);

/** The fence's posts in the order the layout walked them. */
export function fencePosts(model: GeometryModel): Piece[] {
  return model.pieces.filter(isPost);
}

function nearest(posts: readonly Piece[], x: number, z: number, take: (p: Piece) => boolean, n: number): number[] {
  return posts
    .map((p, i) => ({ i, d: take(p) ? Math.hypot(p.pos[0] - x, p.pos[2] - z) : Infinity }))
    .filter((e) => e.d !== Infinity)
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((e) => e.i);
}

/** Indices (into fencePosts) of the two gate posts that frame a gate. */
export function gatePostPair(posts: readonly Piece[], gate: Piece): [number, number] | null {
  const two = nearest(posts, gate.pos[0], gate.pos[2], (p) => p.code === "GP", 2);
  return two.length === 2 ? [two[0], two[1]] : null;
}

/**
 * The runs of fabric: one between each pair of neighbouring posts (the last joins the first on a closed
 * fence), none across a gate opening.
 */
export function fenceRuns(model: GeometryModel): FenceRun[] {
  const posts = fencePosts(model);
  const n = posts.length;
  if (n < 2) return [];
  const closed = posts.some((p) => p.code === "CP");
  const gaps = new Set<string>();
  for (const g of model.pieces.filter((p) => p.code === "GT")) {
    const pair = gatePostPair(posts, g);
    if (pair) gaps.add(`${Math.min(...pair)}-${Math.max(...pair)}`);
  }
  const runs: FenceRun[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    if (gaps.has(`${Math.min(i, j)}-${Math.max(i, j)}`)) continue;
    const a = posts[i].pos;
    const b = posts[j].pos;
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    runs.push({ x1: a[0], z1: a[2], x2: b[0], z2: b[2], len, mx: (a[0] + b[0]) / 2, mz: (a[2] + b[2]) / 2, rot: -Math.atan2(dz, dx) });
  }
  return runs;
}

/** What a gate is: the layout says so; a model stored before it did is read from the width. */
export function gateKind(gate: Piece): FenceGateKind {
  const k = gate.item;
  if (k === "single_swing" || k === "double_swing" || k === "sliding") return k;
  return gate.dims.w >= 5 ? "sliding" : gate.dims.w >= 2.5 ? "double_swing" : "single_swing";
}

/** The angle a gate is turned about the vertical axis: as laid, or (older models) along the line of its two nearest posts. */
export function gateAngle(model: GeometryModel, gate: Piece): number {
  if (gate.rot !== undefined && gate.item !== undefined) return gate.rot;
  const posts = fencePosts(model);
  const two = nearest(posts, gate.pos[0], gate.pos[2], () => true, 2);
  if (two.length < 2) return gate.rot ?? 0;
  const a = posts[two[0]].pos;
  const b = posts[two[1]].pos;
  return -Math.atan2(b[2] - a[2], b[0] - a[0]);
}
