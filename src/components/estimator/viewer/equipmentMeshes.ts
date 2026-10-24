// Equipment pieces (kind "equip"): the furniture and fittings inside a cabin room, drawn from simple
// parametric parts so they stay light and always match the piece's size. pieceMeshes.ts calls
// buildEquipment() for every piece of kind "equip".

import * as THREE from "three";
import type { Piece } from "@/lib/estimator/geometry";
import type { MaterialLibrary } from "./materialLibrary";

/** The group sits at the piece's centre, like every other piece; `piece.item` says what to draw. */
export function buildEquipment(piece: Piece, lib: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const { w, h, t } = piece.dims;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), lib.get("#c9ccd0"));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { mark: piece.id };
  g.add(mesh);
  g.userData = { mark: piece.id };
  return g;
}
