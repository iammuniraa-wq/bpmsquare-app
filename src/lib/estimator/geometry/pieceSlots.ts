// Which design slot paints a piece, and what a slot is painted with. A piece's own `slot` wins; otherwise the
// module's family map decides (so a model stored before slots existed repaints the same way). Pure.

import type { DesignSlot, Piece } from "./types";
import { PRECAST_SLOT_BY_CODE, PRECAST_VILLA_KEY } from "./precastVilla";
import { CHAINLINK_FENCE_KEY, CHAINLINK_FENCE_SLOT_BY_CODE } from "./chainlinkFence";

const BY_MODULE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [PRECAST_VILLA_KEY]: PRECAST_SLOT_BY_CODE,
  [CHAINLINK_FENCE_KEY]: CHAINLINK_FENCE_SLOT_BY_CODE,
};

/** The module's default slot for a piece family, or null when the module does not say. */
export function defaultSlotForCode(geometryKey: string, code: string): string | null {
  const map = Object.prototype.hasOwnProperty.call(BY_MODULE, geometryKey) ? BY_MODULE[geometryKey] : null;
  return map && Object.prototype.hasOwnProperty.call(map, code) ? map[code] : null;
}

export function slotForPiece(geometryKey: string, piece: Pick<Piece, "code" | "slot">): string | null {
  return piece.slot ?? defaultSlotForCode(geometryKey, piece.code);
}

/** The material for a slot: the chosen visual, else the module's default for it, else null. */
export function slotValue(
  slots: readonly DesignSlot[] | undefined,
  visuals: Readonly<Record<string, string>> | undefined,
  slot: string
): string | null {
  const chosen = visuals && Object.prototype.hasOwnProperty.call(visuals, slot) ? visuals[slot] : undefined;
  if (chosen) return chosen;
  return slots?.find((s) => s.key === slot)?.default ?? null;
}
