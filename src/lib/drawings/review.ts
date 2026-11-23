// "A new release changes nothing by itself" (docs/design/pcbs-drawing-register.md sections 4 and 5). A BOQ line pinned to revision B keeps B's
// quantity when C is released; it is flagged for a person to apply or dismiss. Pure: the screens, the BOQ flag and the tests share it.

export type PinState = "current" | "review" | "dismissed";

/**
 * Where a pinned line stands against the drawing's released revision.
 *  - current: the line is pinned to the revision that is released now;
 *  - review: a later revision was released and nobody has applied or dismissed it yet;
 *  - dismissed: a person looked at the later revision and chose to keep the quantity, with a reason (the chip is quiet for that revision only;
 *    a still later release asks again).
 */
export function pinState(args: { pinnedRevId: string | null; currentRevId: string | null; dismissedRevId: string | null }): PinState | null {
  const { pinnedRevId, currentRevId, dismissedRevId } = args;
  if (!pinnedRevId) return null;
  if (!currentRevId || currentRevId === pinnedRevId) return "current";
  return dismissedRevId === currentRevId ? "dismissed" : "review";
}

/** The words on the chip. `pinned` and `current` are revision labels (A, B, C). */
export function pinChipLabel(state: PinState, drawingNo: string, pinned: string, current: string | null): string {
  if (state === "review") return `Rev ${current ?? "?"} released: review changes`;
  if (state === "dismissed") return `${drawingNo} ${pinned}, ${current ?? "later"} reviewed`;
  return `${drawingNo} ${pinned}`;
}

/** "differs by 12 %" between the client's quantity and the model's, or null when they agree (or the client's is zero). */
export function differsByPct(clientQty: number | null | undefined, modelQty: number | null | undefined): number | null {
  if (clientQty == null || modelQty == null || !Number.isFinite(clientQty) || !Number.isFinite(modelQty) || clientQty === 0) return null;
  const pct = ((modelQty - clientQty) / Math.abs(clientQty)) * 100;
  return Math.abs(pct) < 0.05 ? null : Math.round(pct * 10) / 10;
}
