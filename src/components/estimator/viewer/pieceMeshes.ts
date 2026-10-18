// One piece -> one three.js group. The shapes follow the piece data exactly:
// a panel with an opening is drawn as the sill, the two jambs and the lintel
// around the opening plus a glass (window) or door leaf in it, a stair as
// nine steps, everything else as a box. Pieces carry their mark in
// userData so picking can map a hit back to the piece.

import * as THREE from "three";
import type { Piece } from "@/lib/estimator/geometry";

export type SharedMaterials = {
  glass: THREE.MeshLambertMaterial;
  door: THREE.MeshLambertMaterial;
  edge: THREE.LineBasicMaterial;
};

export const STAIR_STEPS = 9;
const MIN = 0.02;

function addBox(
  group: THREE.Group, piece: Piece, mat: THREE.Material, edge: THREE.Material,
  w: number, h: number, t: number, x: number, y: number, z: number
) {
  const geo = new THREE.BoxGeometry(Math.max(MIN, w), Math.max(MIN, h), Math.max(MIN, t));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { mark: piece.id };
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge);
  lines.raycast = () => {};
  mesh.add(lines);
  group.add(mesh);
}

/** The group sits at the piece's centre (a stair at its base), rotated about the vertical axis. */
export function buildPieceGroup(piece: Piece, body: THREE.Material, shared: SharedMaterials): THREE.Group {
  const g = new THREE.Group();
  g.position.set(piece.pos[0], piece.pos[1], piece.pos[2]);
  g.rotation.y = piece.rot ?? 0;
  const { w, h, t } = piece.dims;
  const e = shared.edge;

  if (piece.kind === "stair") {
    const rise = h / STAIR_STEPS;
    const run = t / STAIR_STEPS;
    for (let q = 0; q < STAIR_STEPS; q++) addBox(g, piece, body, e, w, rise * (q + 1), run, 0, (rise * (q + 1)) / 2, -t / 2 + run * (q + 0.5));
  } else if (piece.kind === "plank") {
    addBox(g, piece, body, e, w, h, t, 0, 0, 0);
  } else if (piece.op) {
    const op = piece.op;
    const side = (w - op.w) / 2;
    const lintel = h - op.sill - op.h;
    const openingY = -h / 2 + op.sill + op.h / 2;
    if (op.sill > 0) addBox(g, piece, body, e, w, op.sill, t, 0, -h / 2 + op.sill / 2, 0);
    if (side > 0.01) {
      addBox(g, piece, body, e, side, op.h, t, -(op.w / 2 + side / 2), openingY, 0);
      addBox(g, piece, body, e, side, op.h, t, op.w / 2 + side / 2, openingY, 0);
    }
    if (lintel > 0.01) addBox(g, piece, body, e, w, lintel, t, 0, h / 2 - lintel / 2, 0);
    addBox(g, piece, op.door ? shared.door : shared.glass, e, op.w, op.h, 0.04, 0, openingY, 0);
  } else {
    addBox(g, piece, body, e, w, h, t, 0, 0, 0);
  }
  g.userData = { mark: piece.id };
  return g;
}

/** Free every geometry under a node (materials are owned and disposed by the scene). */
export function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((n) => {
    const geo = (n as THREE.Mesh).geometry;
    if (geo) geo.dispose();
  });
}
