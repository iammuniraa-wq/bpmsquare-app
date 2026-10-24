// How the chain-link fence pieces are drawn (drawing only: the counts, marks and areas come from the layout and
// are untouched). A post is a round tube standing in a partly buried concrete footing; the fabric is an alpha-cut
// diamond lattice stretched between the posts with a top rail and a bottom tension wire; a gate is a tube frame
// with its own mesh, hinges and, by type, a centre bolt or a track.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Piece } from "@/lib/estimator/geometry";
import {
  DIAMOND_PITCH_M, FOOTING_ABOVE_M, FOOTING_DEPTH_M, POST_CODES, fenceRuns, footingRadius, gateAngle, gateKind, postRadius,
} from "@/lib/estimator/geometry/chainlinkFenceDraw";
import type { FenceRun } from "@/lib/estimator/geometry/chainlinkFenceDraw";
import { addPart, boxGeo, diamondTexture, sharedGeo } from "./meshKit";
import type { BuildCtx, PartDecor } from "./meshKit";
import { metricPlaneGeometry } from "./metricGeometry";

const POST_ABOVE_FABRIC_M = 0.06;
const FABRIC_BOTTOM_M = 0.05;
const FABRIC_TOP_GAP_M = 0.03;
const RAIL_R = 0.018;
const WIRE_R = 0.005;
const TUBE_M = 0.04;

function decor(ctx: BuildCtx): PartDecor {
  return { id: "fabric", alphaMap: diamondTexture(ctx), alphaTest: 0.04 };
}

/** Draws any piece of the fence into `g` (already placed at the piece's position). */
export function buildFencePiece(piece: Piece, ctx: BuildCtx, g: THREE.Group): void {
  if (piece.kind === "col" && POST_CODES.includes(piece.code)) post(piece, ctx, g);
  else if (piece.code === "FB") fabric(piece, ctx, g);
  else if (piece.code === "GT") gate(piece, ctx, g);
}

function post(piece: Piece, ctx: BuildCtx, g: THREE.Group): void {
  const fabricH = piece.dims.h - 0.6;
  const r = postRadius(piece.code);
  const segs = ctx.detail ? 12 : 7;
  // The tube runs from 0.3 m under the ground to just over the fabric; the group sits at height / 2.
  const len = fabricH + 0.3 + POST_ABOVE_FABRIC_M;
  const centre = (POST_ABOVE_FABRIC_M - 0.3) / 2;
  const tube = sharedGeo(ctx, `post:${piece.code}:${len.toFixed(3)}:${segs}`, () => new THREE.CylinderGeometry(r, r, len, segs));
  addPart(g, ctx, tube, { mark: piece.id, slot: "posts", def: "galvanised", pos: [0, centre, 0] });
  if (!ctx.detail) return;
  const cap = sharedGeo(ctx, `cap:${piece.code}`, () => new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.03, segs));
  addPart(g, ctx, cap, { mark: piece.id, slot: "posts", def: "galvanised", pos: [0, centre + len / 2 + 0.012, 0] });
  const fr = footingRadius(piece.code);
  const foot = sharedGeo(ctx, `foot:${piece.code}`, () => new THREE.CylinderGeometry(fr * 0.92, fr, FOOTING_DEPTH_M, 12));
  // world y of the footing centre = FOOTING_ABOVE - depth / 2; the group's own world y is height / 2 - 0.3 + 0.3.
  addPart(g, ctx, foot, { mark: piece.id, slot: "footing", def: "concrete_smooth", pos: [0, FOOTING_ABOVE_M - FOOTING_DEPTH_M / 2 - fabricH / 2, 0] });
}

/** Fabric, rail and wire for every run, each merged into one mesh so a long fence is three draw calls. */
function fabric(piece: Piece, ctx: BuildCtx, g: THREE.Group): void {
  const runs = ctx.memo.get("runs") as FenceRun[] | undefined ?? (() => { const r = fenceRuns(ctx.model); ctx.memo.set("runs", r); return r; })();
  if (runs.length === 0) return;
  const h = piece.dims.h;
  const fabH = Math.max(0.1, h - FABRIC_BOTTOM_M - FABRIC_TOP_GAP_M);
  const yMesh = FABRIC_BOTTOM_M + fabH / 2 - h / 2;
  const sheets: THREE.BufferGeometry[] = [];
  const rails: THREE.BufferGeometry[] = [];
  for (const run of runs) {
    const sheet = metricPlaneGeometry(run.len, fabH, DIAMOND_PITCH_M, DIAMOND_PITCH_M);
    sheet.rotateY(run.rot);
    sheet.translate(run.mx, yMesh, run.mz);
    sheets.push(sheet);
    const rail = new THREE.CylinderGeometry(RAIL_R, RAIL_R, run.len, 6);
    rail.rotateZ(Math.PI / 2);
    rail.rotateY(run.rot);
    rail.translate(run.mx, h - 0.02 - h / 2, run.mz);
    rails.push(rail);
    const wire = new THREE.CylinderGeometry(WIRE_R, WIRE_R, run.len, 4);
    wire.rotateZ(Math.PI / 2);
    wire.rotateY(run.rot);
    wire.translate(run.mx, 0.07 - h / 2, run.mz);
    rails.push(wire);
  }
  const sheetGeo = mergeGeometries(sheets);
  const railGeo = mergeGeometries(rails);
  sheets.forEach((s) => s.dispose());
  rails.forEach((s) => s.dispose());
  if (sheetGeo) addPart(g, ctx, sheetGeo, { mark: piece.id, slot: "mesh", def: "galvanised", cast: false, receive: false, decor: decor(ctx) });
  if (railGeo) addPart(g, ctx, railGeo, { mark: piece.id, slot: "posts", def: "galvanised", cast: ctx.detail });
}

function gate(piece: Piece, ctx: BuildCtx, g: THREE.Group): void {
  g.rotation.y = gateAngle(ctx.model, piece);
  const kind = gateKind(piece);
  const w = piece.dims.w;
  const h = piece.dims.h;
  const mark = piece.id;
  const bottom = FABRIC_BOTTOM_M - h / 2;
  const leafH = h - FABRIC_BOTTOM_M - 0.04;
  const yc = bottom + leafH / 2;
  const leaves: { x: number; w: number }[] =
    kind === "double_swing" ? [{ x: -w / 4, w: w / 2 - 0.02 }, { x: w / 4, w: w / 2 - 0.02 }] : [{ x: 0, w: w - 0.04 }];
  const frame = (lw: number, x: number) => {
    const bar = (bw: number, bh: number, px: number, py: number, rz = 0) =>
      addPart(g, ctx, boxGeo(ctx, bw, bh, TUBE_M), { mark, slot: "gate", def: "galvanised", pos: [x + px, yc + py, 0], rot: [0, 0, rz] });
    bar(lw, TUBE_M, 0, leafH / 2 - TUBE_M / 2);
    bar(lw, TUBE_M, 0, -leafH / 2 + TUBE_M / 2);
    bar(TUBE_M, leafH - 2 * TUBE_M, -lw / 2 + TUBE_M / 2, 0);
    bar(TUBE_M, leafH - 2 * TUBE_M, lw / 2 - TUBE_M / 2, 0);
    const dx = lw - 2 * TUBE_M;
    const dy = leafH - 2 * TUBE_M;
    bar(Math.hypot(dx, dy), TUBE_M * 0.6, 0, 0, Math.atan2(dy, dx));
    const sheet = sharedGeo(ctx, `gmesh:${lw.toFixed(3)}:${dy.toFixed(3)}`, () => metricPlaneGeometry(dx, dy, DIAMOND_PITCH_M, DIAMOND_PITCH_M));
    addPart(g, ctx, sheet, { mark, slot: "mesh", def: "galvanised", pos: [x, yc, 0], cast: false, receive: false, decor: decor(ctx) });
  };
  for (const l of leaves) frame(l.w, l.x);
  if (!ctx.detail) return;

  const hinge = (x: number) => {
    const geo = sharedGeo(ctx, "hinge", () => new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8));
    for (const dy of [-leafH / 2 + 0.25, leafH / 2 - 0.25]) addPart(g, ctx, geo, { mark, slot: "gate", def: "galvanised", pos: [x, yc + dy, 0] });
  };
  if (kind === "single_swing") {
    hinge(-w / 2 + 0.01);
    addPart(g, ctx, boxGeo(ctx, 0.08, 0.05, 0.06), { mark, slot: "gate", def: "galvanised", pos: [w / 2 - 0.05, yc, 0.03] });
  } else if (kind === "double_swing") {
    hinge(-w / 2 + 0.01);
    hinge(w / 2 - 0.01);
    const bolt = sharedGeo(ctx, "bolt", () => new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6));
    addPart(g, ctx, bolt, { mark, slot: "gate", def: "galvanised", pos: [0, bottom + 0.2, 0.035] });
  } else {
    // Sliding: a ground track long enough for the leaf to run clear, and two wheels under the leaf.
    addPart(g, ctx, boxGeo(ctx, w * 1.9, 0.03, 0.08), { mark, slot: "footing", def: "concrete_smooth", pos: [w * 0.45, bottom - 0.005, 0] });
    const wheel = sharedGeo(ctx, "wheel", () => new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10).rotateX(Math.PI / 2));
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) addPart(g, ctx, wheel, { mark, slot: "gate", def: "galvanised", pos: [x, bottom + 0.01, 0] });
  }
}
