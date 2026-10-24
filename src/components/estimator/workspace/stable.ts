// Keeps an object's identity while its content has not changed, so the 3D view is not rebuilt (or repainted)
// by a recompute that produced the same thing. Pure helpers plus one tiny hook.

import { useState } from "react";
import type { GeometryModel } from "@/lib/estimator/geometry";

/** Same model content (the page recomputes the model on every edit, including a colour-only one). */
export function sameModel(a: GeometryModel | null | undefined, b: GeometryModel | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.pieces.length !== b.pieces.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The previous value while `same` says the new one is equal, else the new one. */
export function useStable<T>(value: T, same: (a: T, b: T) => boolean): T {
  const [kept, setKept] = useState(value);
  if (kept === value) return kept;
  if (same(kept, value)) return kept;
  setKept(value);
  return value;
}
