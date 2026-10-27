// One piece -> one three.js group. The shapes follow the piece data exactly: a panel with an opening is drawn
// as the sill, the two jambs and the lintel around the opening plus a framed window (glazing, mullions, outer
// ledge) or a door (leaf, frame, handle) in it, a stair as nine steps with a rail, a plank as a slab (the roof
// slab gets a membrane), a fence piece through fenceMeshes.ts, equipment through equipmentMeshes.ts, everything
// else as a box. Every part carries its mark (picking) and its design slot (repainting) in userData; the
// scene decides the material, so a part is repainted without being rebuilt.

import * as THREE from "three";
import type { Piece } from "@/lib/estimator/geometry";
import { CHAINLINK_FENCE_KEY } from "@/lib/estimator/geometry/chainlinkFence";
import { PRECAST_VILLA_KEY } from "@/lib/estimator/geometry/precastVilla";
import { slotForPiece } from "@/lib/estimator/geometry/pieceSlots";
import { buildEquipment } from "./equipmentMeshes";
import { buildFencePiece } from "./fenceMeshes";
import { addPart, mergeGroupParts, sharedGeo } from "./meshKit";
import type { BuildCtx } from "./meshKit";
import { hashSeed, metricBoxGeometry } from "./metricGeometry";

export { createBuildCtx, disposeBuildCtx } from "./meshKit";
export type { BuildCtx } from "./meshKit";

export const STAIR_STEPS = 9;
const MIN = 0.02;
const FRAME_M = 0.05;
const BODY_DEF = "concrete_smooth";

type Vec = readonly [number, number, number];

function body(
  g: THREE.Group, piece: Piece, ctx: BuildCtx, slot: string, part: string,
  w: number, h: number, t: number, pos: Vec, edges = false, shared = false
): THREE.Mesh {
  const W = Math.max(MIN, w);
  const H = Math.max(MIN, h);
  const T = Math.max(MIN, t);
  const geo = shared
    ? sharedGeo(ctx, `mb:${W.toFixed(3)}:${H.toFixed(3)}:${T.toFixed(3)}`, () => metricBoxGeometry(W, H, T))
    : metricBoxGeometry(W, H, T, hashSeed(piece.id + part));
  return addPart(g, ctx, geo, { mark: piece.id, slot, def: BODY_DEF, pos, own: !shared, edges });
}

/** The group sits at the piece's centre (a stair at its base), rotated about the vertical axis. */
export function buildPieceGroup(piece: Piece, ctx: BuildCtx): THREE.Group {
  const g = new THREE.Group();
  g.position.set(piece.pos[0], piece.pos[1], piece.pos[2]);
  g.rotation.y = piece.rot ?? 0;
  g.userData = { mark: piece.id };

  if (piece.kind === "equip") {
    // buildEquipment positions its own group (it can stand alone in a scene); here the piece group already is at the piece.
    const eq = buildEquipment(piece, ctx.lib);
    eq.position.set(0, 0, 0);
    eq.rotation.set(0, 0, 0);
    g.add(eq);
    return g;
  }
  if (ctx.model.geometry === CHAINLINK_FENCE_KEY) { buildFencePiece(piece, ctx, g); mergeGroupParts(g, ctx); return g; }
  buildBody(g, piece, ctx);
  mergeGroupParts(g, ctx);
  return g;
}

function buildBody(g: THREE.Group, piece: Piece, ctx: BuildCtx): void {
  const slot = slotForPiece(ctx.model.geometry, piece) ?? "body";
  const { w, h, t } = piece.dims;
  const villa = ctx.model.geometry === PRECAST_VILLA_KEY;

  if (piece.kind === "stair") stair(g, piece, ctx, slot);
  else if (piece.kind === "plank") {
    body(g, piece, ctx, slot, "plank", w, h, t, [0, 0, 0]);
    if (villa && piece.floor === ctx.roofFloor) {
      addPart(g, ctx, sharedGeo(ctx, `roof:${w.toFixed(3)}:${t.toFixed(3)}`, () => new THREE.BoxGeometry(Math.max(MIN, w - 0.02), 0.016, Math.max(MIN, t - 0.02))), {
        mark: piece.id, slot: "roof", def: "roof_membrane", pos: [0, h / 2 + 0.008, 0], cast: false,
      });
    }
  } else if (piece.op) panelWithOpening(g, piece, ctx, slot);
  else {
    body(g, piece, ctx, slot, "body", w, h, t, [0, 0, 0], piece.kind === "panel");
    if (villa && piece.code === "PR" && ctx.detail) body(g, piece, ctx, "slab", "coping", w + 0.02, 0.04, t + 0.06, [0, h / 2 + 0.02, 0]);
  }
}

function stair(g: THREE.Group, piece: Piece, ctx: BuildCtx, slot: string): void {
  const { w, h, t } = piece.dims;
  const rise = h / STAIR_STEPS;
  const run = t / STAIR_STEPS;
  for (let q = 0; q < STAIR_STEPS; q++) body(g, piece, ctx, slot, `s${q}`, w, rise * (q + 1), run, [0, (rise * (q + 1)) / 2, -t / 2 + run * (q + 0.5)], false, true);
  if (!ctx.detail) return;
  // A handrail on each side: two posts and an inclined bar.
  const dh = h - rise;
  const dz = t - run;
  const len = Math.hypot(dh, dz);
  const barGeo = sharedGeo(ctx, `rail:${len.toFixed(3)}`, () => new THREE.CylinderGeometry(0.022, 0.022, len, 8));
  const postGeo = sharedGeo(ctx, "railpost", () => new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6));
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - 0.03);
    // The cylinder's axis is y; turning it about x by atan2(dz, dh) lays it along the nosing line.
    addPart(g, ctx, barGeo, { mark: piece.id, slot: "railing", def: "alu_dark", pos: [x, rise + dh / 2 + 0.9, 0], rot: [Math.atan2(dz, dh), 0, 0] });
    for (const f of [0.1, 0.9]) {
      const q = Math.min(STAIR_STEPS - 1, Math.floor(f * STAIR_STEPS));
      addPart(g, ctx, postGeo, { mark: piece.id, slot: "railing", def: "alu_dark", pos: [x, rise * (q + 1) + 0.45, -t / 2 + t * f] });
    }
  }
}

function panelWithOpening(g: THREE.Group, piece: Piece, ctx: BuildCtx, slot: string): void {
  const op = piece.op!;
  const { w, h, t } = piece.dims;
  const side = (w - op.w) / 2;
  const lintel = h - op.sill - op.h;
  const openingY = -h / 2 + op.sill + op.h / 2;
  // +1 when the panel's local +z faces away from the building's centre (the outside), -1 otherwise.
  const rot = piece.rot ?? 0;
  const out = piece.pos[0] * Math.sin(rot) + piece.pos[2] * Math.cos(rot) >= 0 ? 1 : -1;

  if (op.sill > 0) body(g, piece, ctx, slot, "sill", w, op.sill, t, [0, -h / 2 + op.sill / 2, 0], true);
  if (side > 0.01) {
    body(g, piece, ctx, slot, "jl", side, op.h, t, [-(op.w / 2 + side / 2), openingY, 0], true);
    body(g, piece, ctx, slot, "jr", side, op.h, t, [op.w / 2 + side / 2, openingY, 0], true);
  }
  if (lintel > 0.01) body(g, piece, ctx, slot, "lintel", w, lintel, t, [0, h / 2 - lintel / 2, 0], true);

  const depth = Math.min(0.1, t * 0.6);
  const bar = (bw: number, bh: number, bd: number, pos: Vec, sl = "window", def = "alu_dark") =>
    addPart(g, ctx, sharedGeo(ctx, `fb:${bw.toFixed(3)}:${bh.toFixed(3)}:${bd.toFixed(3)}`, () => new THREE.BoxGeometry(Math.max(0.01, bw), Math.max(0.01, bh), Math.max(0.01, bd))), {
      mark: piece.id, slot: sl, def, pos,
    });

  // The frame (top, bottom or head, two jambs) is the same for a window and a door.
  const inner = op.h - 2 * FRAME_M;
  bar(op.w, FRAME_M, depth, [0, openingY + op.h / 2 - FRAME_M / 2, 0]);
  bar(FRAME_M, op.door ? op.h - FRAME_M : inner, depth, [-(op.w / 2 - FRAME_M / 2), op.door ? openingY - FRAME_M / 2 : openingY, 0]);
  bar(FRAME_M, op.door ? op.h - FRAME_M : inner, depth, [op.w / 2 - FRAME_M / 2, op.door ? openingY - FRAME_M / 2 : openingY, 0]);

  if (op.door) {
    const leafW = op.w - 2 * FRAME_M;
    const leafH = op.h - FRAME_M;
    const leafY = openingY - FRAME_M / 2;
    bar(leafW, leafH, 0.045, [0, leafY, 0], "door", "wood_door");
    if (ctx.detail) {
      // A handle and a kick plate on the outside.
      bar(0.14, 0.025, 0.03, [leafW / 2 - 0.13, leafY, out * 0.04], "window", "alu_dark");
      bar(leafW * 0.9, 0.2, 0.012, [0, leafY - leafH / 2 + 0.12, out * 0.03], "window", "alu_dark");
    }
    return;
  }

  bar(op.w, FRAME_M, depth, [0, openingY - op.h / 2 + FRAME_M / 2, 0]);
  const gw = op.w - 2 * FRAME_M;
  addPart(g, ctx, sharedGeo(ctx, `gl:${gw.toFixed(3)}:${inner.toFixed(3)}`, () => new THREE.BoxGeometry(Math.max(0.01, gw), Math.max(0.01, inner), 0.012)), {
    mark: piece.id, slot: "glazing", def: "glass", pos: [0, openingY, 0], noTint: true, cast: false, receive: false, order: 3,
  });
  if (!ctx.detail) return;
  if (op.w > 1.0) bar(0.035, inner, depth * 0.8, [0, openingY, 0]);
  if (op.h > 1.05) bar(gw, 0.035, depth * 0.8, [0, openingY + inner * 0.18, 0]);
  // The outer ledge under the window.
  addPart(g, ctx, sharedGeo(ctx, `ledge:${op.w.toFixed(3)}:${t.toFixed(3)}`, () => new THREE.BoxGeometry(op.w + 0.12, 0.04, 0.1)), {
    mark: piece.id, slot, def: BODY_DEF, pos: [0, openingY - op.h / 2 - 0.02, out * (t / 2 + 0.03)],
  });
}

/** Free every geometry under a node (materials are owned and disposed by the scene). */
export function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((n) => {
    const geo = (n as THREE.Mesh).geometry;
    if (geo) geo.dispose();
  });
}
