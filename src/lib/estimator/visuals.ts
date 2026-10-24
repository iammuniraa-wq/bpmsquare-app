// Design attributes: an ordinary select input of a template may repaint one slot of the 3D model.
// The input says which slot it paints (`paints`), each option says what it paints it with (`visual`:
// a material key or "#rrggbb"). The same chosen option also feeds the bill of materials through its
// value / attrs, so one choice changes both the picture and the parts.

import { isVisualValue } from "./materialCatalog";
import type { DesignSlot } from "./geometry/types";
import type { TemplateInput } from "./types";

/** slot key -> material key or "#rrggbb". */
export type ResolvedVisuals = Readonly<Record<string, string>>;

/** The visuals a template + the chosen input values produce for a geometry module's slots. Pure; unknown or invalid choices fall back to the slot default. */
export function resolveVisuals(
  slots: readonly DesignSlot[] | undefined,
  inputs: readonly TemplateInput[],
  values: Readonly<Record<string, number | string | boolean>>
): ResolvedVisuals {
  const out: Record<string, string> = {};
  for (const s of slots ?? []) out[s.key] = s.default;
  for (const inp of inputs) {
    if (inp.type !== "select" || !inp.paints || !(inp.paints in out)) continue;
    const chosen = values[inp.key] ?? inp.default;
    const opt = inp.options?.find((o) => o.key === chosen);
    if (opt && isVisualValue(opt.visual)) out[inp.paints] = opt.visual;
  }
  return out;
}
