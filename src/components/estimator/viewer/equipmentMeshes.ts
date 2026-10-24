// Equipment pieces (kind "equip"): the furniture and fittings inside a cabin room, drawn from simple
// parametric parts so they stay light and always match the piece's size. pieceMeshes.ts calls
// buildEquipment() for every piece of kind "equip". Which item and how it is drawn is in equipmentShapes.ts;
// the catalogue of items (sizes, colours, which rooms use them) is lib/estimator/geometry/cabinEquipment.ts.

import * as THREE from "three";
import type { Piece } from "@/lib/estimator/geometry";
import { getCabinEquipment } from "@/lib/estimator/geometry/cabinEquipment";
import type { MaterialLibrary } from "./materialLibrary";
import { Parts } from "./equipmentParts";
import { SHAPES } from "./equipmentShapes";

const FALLBACK_COLOUR = "#c9ccd0";

/**
 * The group sits at the piece's centre, turned to the piece's rotation, so it may be added to the scene as it is.
 * `piece.item` says what to draw; every mesh carries `userData.mark = piece.id` so a click picks the piece.
 * `paint` (a material key or "#rrggbb", from the design slot "equipment") replaces the item's own body colour;
 * leave it out to keep each item's own colour. An item the catalogue does not know is drawn as a plain box.
 */
export function buildEquipment(piece: Piece, lib: MaterialLibrary, paint?: string): THREE.Group {
  const { w, h, t } = piece.dims;
  const item = piece.item ? getCabinEquipment(piece.item) : null;
  const shape = piece.item ? SHAPES[piece.item] : undefined;
  const parts = new Parts();
  if (shape) {
    shape(parts, { w, h, t }, {
      body: lib.get(paint ?? item?.colour ?? FALLBACK_COLOUR),
      c: (hex) => lib.get(hex),
      glass: lib.get("glass"),
      metal: lib.get("galvanised"),
    });
  } else {
    parts.box(lib.get(paint ?? FALLBACK_COLOUR), w, h, t, 0, 0, 0);
  }
  const g = parts.build(piece.id, h > 0.06);
  g.position.set(piece.pos[0], piece.pos[1], piece.pos[2]);
  g.rotation.y = piece.rot ?? 0;
  return g;
}
