// Design attributes: an ordinary select input of a template may repaint one slot of the 3D model.
// The input says which slot it paints (`paints`), each option says what it paints it with (`visual`:
// a material key or "#rrggbb"). The same chosen option also feeds the bill of materials through its
// value / attrs, so one choice changes both the picture and the parts.

import { getMaterialDef, HEX_COLOUR, isVisualValue } from "./materialCatalog";
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

export type VisualSwatch = { colour: string; label: string; textured: boolean };

/** What to draw for a chip or picker button: the colour, a name and whether the material is a texture set. Null for anything that is not a visual value. */
export function visualSwatch(v: string | null | undefined): VisualSwatch | null {
  if (typeof v !== "string") return null;
  if (HEX_COLOUR.test(v)) return { colour: v, label: v.toLowerCase(), textured: false };
  const m = getMaterialDef(v);
  return m ? { colour: m.color, label: m.label, textured: m.textured === true } : null;
}

/** Same slot to material map (so the page can keep the previous object and the 3D view does not repaint for nothing). */
export function sameVisuals(a: ResolvedVisuals | undefined, b: ResolvedVisuals | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
