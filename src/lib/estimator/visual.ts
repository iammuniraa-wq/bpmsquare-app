// The picture of an estimate that has no bespoke 3D module (docs/design/estimator-visual-for-every-estimate.md): which number input is
// the length, width, height, run, count or area of what is being built. Pure: no I/O, safe in client components.
//
// A template may say so in `visual`; when it says nothing the roles are inferred from each input's key and unit, so a template written
// before this existed still gets a picture. Inference is deliberately plain (words in the key, the unit) and fully predictable: the
// editor shows its answer in the six selects, so what the page draws is never a surprise.

import { VISUAL_ROLES } from "./types";
import type { TemplateInput, TemplateVisual, VisualRole } from "./types";

export type VisualMapping = Partial<Record<VisualRole, string>>;

/** Words in an input key (snake_case, camelCase and digits all split) that name a role. */
const KEY_WORDS: Record<VisualRole, readonly string[]> = {
  run: ["run", "pipeline", "pipe", "fence", "trench", "cable", "duct", "route", "perimeter"],
  area: ["area", "sqm"],
  count: ["count", "number", "qty", "quantity", "n", "nos", "nr", "units", "pcs"],
  length: ["length", "len", "long", "l"],
  width: ["width", "wide", "breadth", "w"],
  height: ["height", "high", "ht", "h"],
};

/** Words that make an input a setting of the job, not a size of what is built (a gap, a haul distance, a border). */
const NOT_A_SIZE = new Set([
  "spacing", "gap", "clearance", "cutout", "border", "offset", "haul", "dump", "distance", "km", "thickness", "thk", "depth",
  "door", "doors", "opening", "openings", "margin", "waste", "rate", "pct", "percent", "tile", "grout", "skirting", "adhesive",
]);

const AREA_UNITS = new Set(["m2", "m²", "sqm", "sq m", "sq.m"]);
const VOLUME_UNITS = new Set(["m3", "m³", "cum", "cu m"]);
const LENGTH_UNITS = new Set(["m", "metre", "metres", "meter", "meters", "lm", "rm"]);
const COUNT_UNITS = new Set(["nr", "nrs", "nos", "no", "qty", "unit", "units", "pcs", "pc", "each", "ea"]);

const norm = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

export function keyWords(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

type Candidate = { key: string; index: number; words: string[]; unit: string };

function candidates(inputs: readonly TemplateInput[]): Candidate[] {
  return inputs
    .map((x, index) => ({ key: x.key, index, words: keyWords(x.key), unit: norm(x.unit), type: x.type }))
    .filter((x) => x.type === "number")
    .map(({ key, index, words, unit }) => ({ key, index, words, unit }));
}

function scoreFor(role: VisualRole, c: Candidate): number {
  const named = c.words.some((w) => KEY_WORDS[role].includes(w));
  const sizeLike = !c.words.some((w) => NOT_A_SIZE.has(w));
  const metres = c.unit === "" || LENGTH_UNITS.has(c.unit);
  switch (role) {
    case "area":
      return (named && (AREA_UNITS.has(c.unit) || c.unit === "") ? 3 : 0) + (AREA_UNITS.has(c.unit) && sizeLike ? 2 : 0);
    case "count":
      return (named && sizeLike && !LENGTH_UNITS.has(c.unit) && !AREA_UNITS.has(c.unit) ? 3 : 0) + (COUNT_UNITS.has(c.unit) && sizeLike ? 2 : 0);
    case "run":
      return named && sizeLike && metres ? 4 : 0;
    default:
      // A plain metre input with no role word is not enough to say which side it is.
      return named && sizeLike && metres ? 3 + (LENGTH_UNITS.has(c.unit) ? 1 : 0) : 0;
  }
}

/** The volume input, if the template has one and nothing else gives it a shape (drawn as a block). */
export function inferVolumeKey(inputs: readonly TemplateInput[]): string | undefined {
  return candidates(inputs).find((c) => VOLUME_UNITS.has(c.unit) && !c.words.some((w) => NOT_A_SIZE.has(w)))?.key;
}

const INFERENCE_ORDER: readonly VisualRole[] = ["run", "area", "count", "length", "width", "height"];

/** Roles from key words and units; an input serves at most one role, the first by position wins a tie. */
export function inferVisualMapping(inputs: readonly TemplateInput[]): VisualMapping {
  const taken = new Set<string>();
  const out: VisualMapping = {};
  const all = candidates(inputs);
  for (const role of INFERENCE_ORDER) {
    let best: { c: Candidate; score: number } | null = null;
    for (const c of all) {
      if (taken.has(c.key)) continue;
      const score = scoreFor(role, c);
      if (score > 0 && (!best || score > best.score)) best = { c, score };
    }
    if (best) { out[role] = best.c.key; taken.add(best.c.key); }
  }
  return out;
}

export const hasVisualMapping = (v: TemplateVisual | null | undefined): boolean => !!v && VISUAL_ROLES.some((r) => !!v[r]);

/**
 * What the picture will use: the template's own mapping when it names any role (restricted to number inputs that exist), else the
 * inference. A role the mapping leaves out is not used.
 */
export function resolveVisualMapping(visual: TemplateVisual | null | undefined, inputs: readonly TemplateInput[]): VisualMapping {
  const numeric = new Set(inputs.filter((i) => i.type === "number").map((i) => i.key));
  if (hasVisualMapping(visual)) {
    const out: VisualMapping = {};
    for (const r of VISUAL_ROLES) { const k = visual?.[r]; if (k && numeric.has(k)) out[r] = k; }
    return out;
  }
  return inferVisualMapping(inputs);
}

export type VisualIssue = { path: string; message: string };

/** Validates the `visual` of a template: every named input must be a number input of the template. Absent or empty = undefined. */
export function validateVisual(raw: unknown, inputs: readonly TemplateInput[], issues: VisualIssue[]): TemplateVisual | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) { issues.push({ path: "visual", message: "The picture settings must be an object." }); return undefined; }
  const obj = raw as Record<string, unknown>;
  const out: TemplateVisual = {};
  for (const k of Object.keys(obj)) {
    if (k !== "picture" && !(VISUAL_ROLES as readonly string[]).includes(k)) issues.push({ path: `visual.${k}`, message: `"${k.slice(0, 40)}" is not a picture setting. Use ${VISUAL_ROLES.join(", ")} or picture.` });
  }
  if (obj.picture !== undefined && obj.picture !== null && obj.picture !== "") {
    if (obj.picture === "none") out.picture = "none";
    else issues.push({ path: "visual.picture", message: 'picture can only be "none".' });
  }
  const numeric = new Set(inputs.filter((i) => i.type === "number").map((i) => i.key));
  for (const r of VISUAL_ROLES) {
    const v = obj[r];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") { issues.push({ path: `visual.${r}`, message: `${r} must be the key of a number input.` }); continue; }
    if (!numeric.has(v)) { issues.push({ path: `visual.${r}`, message: `${r}: "${v.slice(0, 60)}" is not a number input of this template.` }); continue; }
    out[r] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const ROLE_LABEL: Record<VisualRole, string> = {
  length: "Length", width: "Width", height: "Height", run: "Run (a pipe, cable or fence)", count: "How many", area: "Area",
};
