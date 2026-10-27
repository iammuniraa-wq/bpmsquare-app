import { UOM_OPTIONS } from "@/lib/constants";

// Units on a deal line. The picker offers UOM_OPTIONS; a line can carry any text (a client's BOQ says "m3" or "no"). The editor must
// neither coerce such a value to "Nos" nor lose it: it maps an obvious synonym to the option that means the same, and shows any
// other value as an extra option of its own.

const SYNONYMS: Record<string, (typeof UOM_OPTIONS)[number]> = {
  no: "Nos", "no.": "Nos", "nos.": "Nos", nr: "Nos", each: "Nos", ea: "Nos", pc: "Nos", pcs: "Nos", piece: "Nos", pieces: "Nos",
  m: "Mtr", mtrs: "Mtr", meter: "Mtr", meters: "Mtr", metre: "Mtr", metres: "Mtr", lm: "Mtr",
  kgs: "Kg", kilogram: "Kg", kilograms: "Kg", l: "Ltr", ltrs: "Ltr", litre: "Ltr", litres: "Ltr", liter: "Ltr", liters: "Ltr",
  sets: "Set", lots: "Lot", boxes: "Box", pairs: "Pair", jobs: "Job", tons: "Ton", tonne: "Ton", tonnes: "Ton",
};

/** The value the editor holds for a stored unit: an option for an exact or obvious match, else the stored text unchanged; "Nos" only when there is none. */
export function editorUom(uom: string | null | undefined): string {
  const raw = (uom ?? "").trim();
  if (!raw) return "Nos";
  const exact = (UOM_OPTIONS as readonly string[]).find((o) => o.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  return SYNONYMS[raw.toLowerCase()] ?? raw;
}

/** The picker's options for a line: the standard ones, plus the line's own unit when it is not among them. */
export function uomChoices(current: string): string[] {
  const std = UOM_OPTIONS as readonly string[];
  return current && !std.includes(current) ? [...std, current] : [...std];
}
