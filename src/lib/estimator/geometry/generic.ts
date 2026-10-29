// The "built from the inputs" picture (docs/design/estimator-visual-for-every-estimate.md): a to-scale massing of any template whose
// inputs carry dimensions. It is NOT a geometry module a template names: it feeds nothing into the formulas and prices nothing, it only
// draws. The roles (length, width, height, run, count, area) come from the template's visual mapping or are inferred (visual.ts), and
// the pieces come out in the same GeometryModel shape the 3D viewer already draws, so clicking a piece, the inspector and the cost
// split work unchanged. Axes as everywhere: x along the length, z across, y up; the origin is the centre of the scene at ground level.
//
//   footprint (length x width, with a height)    one box
//   run (pipe, cable, fence)                     a long element along x, cut every 6 m so a long run stays readable
//   count with a size                            that many boxes, in a row or a grid
//   count with a run                             markers spread along the run (manholes on a pipe)
//   area                                         a slab
//   only a volume                                a block of that volume
//
// A pure function that never throws: no usable number gives a model with no pieces, which the page reads as "no picture".

import type { DesignSlot, GeometryModel, Piece, PieceCodeInfo } from "./types";
import type { VisualMapping } from "../visual";

export const GENERIC_KEY = "generic";

export const GENERIC_SLOTS: readonly DesignSlot[] = [
  { key: "concrete", label: "Concrete", default: "concrete_smooth" },
  { key: "steel", label: "Steel and pipework", default: "galvanised" },
  { key: "soil", label: "Soil and fill", default: "ground_sand" },
  { key: "timber", label: "Timber", default: "wood_oak" },
];
export const GENERIC_SLOT_KEYS: ReadonlySet<string> = new Set(GENERIC_SLOTS.map((s) => s.key));

export const GENERIC_FAMILIES: readonly PieceCodeInfo[] = [
  { code: "FP", label: "Footprint" },
  { code: "RN", label: "Run" },
  { code: "UN", label: "Repeated units" },
  { code: "SL", label: "Slab" },
  { code: "BL", label: "Block" },
];

export const RUN_SEGMENT_M = 6;
export const MAX_RUN_SEGMENTS = 160;
export const MAX_UNITS = 300;
const MAX_SIDE_M = 5000;
const MIN_M = 0.05;
const GROUP_GAP_M = 2;
const SLAB_THICKNESS_M = 0.2;
const FLOOR_THICKNESS_M = 0.15;
const DP = 4;
const r4 = (x: number): number => Math.round(x * 10 ** DP) / 10 ** DP;

export type GenericLine = { code: string | null; uom: string | null; description: string; cost_total: number | null; element_ref?: string | null };

export type GenericArgs = {
  /** Input key -> number (strings and yes/no are ignored). */
  values: Readonly<Record<string, unknown>>;
  mapping: VisualMapping;
  /** An input that only gives a volume (m3): drawn as a block when nothing else gives the job a shape. */
  volumeKey?: string;
  /** The estimate's cost lines: they colour the pieces and say which lines each piece stands for. */
  lines?: readonly GenericLine[];
};

type Roles = { L?: number; W?: number; H?: number; R?: number; N?: number; A?: number; V?: number };

function num(values: GenericArgs["values"], key: string | undefined): number | undefined {
  if (!key) return undefined;
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, MAX_SIDE_M * 1000) : undefined;
}
const side = (v: number): number => Math.max(MIN_M, Math.min(MAX_SIDE_M, v));

type Draft = Omit<Piece, "id" | "pos"> & { x: number; z: number; y: number };
type Group = { code: string; label: string; step: number; drafts: Draft[]; w: number; d: number };

function box(code: string, step: number, x: number, z: number, w: number, h: number, t: number): Draft {
  return { code, kind: "box", step, floor: 0, x, y: h / 2, z, dims: { w, h, t }, vol: w * h * t, area: w * t };
}

function resolveRoles(a: GenericArgs): Roles {
  const m = a.mapping;
  const r: Roles = {
    L: num(a.values, m.length), W: num(a.values, m.width), H: num(a.values, m.height),
    R: num(a.values, m.run), N: num(a.values, m.count), A: num(a.values, m.area),
  };
  if (r.N !== undefined) r.N = Math.max(1, Math.round(r.N));
  if (!r.L && !r.W && !r.H && !r.R && !r.N && !r.A) r.V = num(a.values, a.volumeKey);
  return r;
}

export function layoutGeneric(a: GenericArgs): GeometryModel {
  const warnings: string[] = [];
  const { L, W, H, R, N, A, V } = resolveRoles(a);
  const groups: Group[] = [];

  const foot = N === undefined && L !== undefined && W !== undefined;
  // A single length with an area is one side of a slab; a single length alone is a run.
  const slabFromSide = A !== undefined && R === undefined && N === undefined && !foot && (L !== undefined) !== (W !== undefined);
  const run = R ?? (!foot && N === undefined && !slabFromSide && L !== undefined && W === undefined ? L : undefined);

  if (foot) {
    const h = H !== undefined ? side(H) : FLOOR_THICKNESS_M;
    groups.push({ code: "FP", label: "Footprint", step: 1, drafts: [box("FP", 1, 0, 0, side(L!), h, side(W!))], w: side(L!), d: side(W!) });
  }

  if (N !== undefined && (L !== undefined || W !== undefined || H !== undefined || run === undefined)) {
    const n = Math.min(N, MAX_UNITS);
    if (N > MAX_UNITS) warnings.push(`Only ${MAX_UNITS} of the ${N} units are drawn.`);
    const ul = side(L ?? W ?? 1.2);
    const uw = side(W ?? L ?? 1.2);
    const uh = side(H ?? Math.max(0.6, Math.min(ul, uw) * 0.8));
    const gap = Math.min(1.5, 0.2 * Math.min(ul, uw));
    const cols = n <= 10 ? n : Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const w = cols * ul + (cols - 1) * gap;
    const d = rows * uw + (rows - 1) * gap;
    const drafts: Draft[] = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const rr = Math.floor(i / cols);
      drafts.push(box("UN", 2, -w / 2 + ul / 2 + c * (ul + gap), -d / 2 + uw / 2 + rr * (uw + gap), ul, uh, uw));
    }
    groups.push({ code: "UN", label: "Repeated units", step: 2, drafts, w, d });
  }

  if (run !== undefined) {
    const total = Math.min(run, MAX_SIDE_M);
    if (run > MAX_SIDE_M) warnings.push(`The run is drawn at ${MAX_SIDE_M} m.`);
    const own = !foot && N === undefined; // width and height describe the run only when nothing else uses them
    let sw = own && W !== undefined ? side(W) : own && H !== undefined && H > 1.5 ? 0.15 : 0.6;
    let sh = own && H !== undefined ? side(H) : own && W !== undefined ? side(W) : 0.6;
    const seen = Math.min(10, total / 100);
    if (Math.max(sw, sh) < seen) {
      const k = seen / Math.max(sw, sh);
      sw *= k; sh *= k;
      warnings.push("The run is drawn thicker than it is so that it can be seen.");
    }
    const segs = Math.max(1, Math.min(MAX_RUN_SEGMENTS, Math.ceil(total / RUN_SEGMENT_M)));
    const segLen = total / segs;
    const drafts: Draft[] = [];
    for (let i = 0; i < segs; i++) drafts.push(box("RN", 1, -total / 2 + segLen / 2 + i * segLen, 0, segLen, sh, sw));
    groups.push({ code: "RN", label: "Run", step: 1, drafts, w: total, d: sw });
    // Units with no size of their own stand along the run (manholes on a pipe).
    if (N !== undefined && L === undefined && W === undefined && H === undefined) {
      const n = Math.min(N, MAX_UNITS);
      const s = Math.max(1.2, Math.max(sw, sh) * 2.5);
      const un: Draft[] = [];
      for (let i = 0; i < n; i++) un.push(box("UN", 2, -total / 2 + ((i + 0.5) / n) * total, 0, s, Math.max(s, sh * 1.5), s));
      groups[groups.length - 1].drafts.push(...un);
      groups[groups.length - 1].d = Math.max(sw, s);
    }
  }

  if (A !== undefined) {
    const overlapsFoot = foot && Math.abs(A - L! * W!) <= 0.1 * A;
    if (!overlapsFoot) {
      let sl: number;
      let sw: number;
      if (slabFromSide && L !== undefined) { sl = L; sw = A / L; }
      else if (slabFromSide && W !== undefined) { sw = W; sl = A / W; }
      else { sl = Math.sqrt(A * 1.5); sw = A / sl; }
      const thick = !foot && R === undefined && N === undefined && H !== undefined ? side(H) : SLAB_THICKNESS_M;
      groups.push({ code: "SL", label: "Slab", step: 1, drafts: [box("SL", 1, 0, 0, side(sl), thick, side(sw))], w: side(sl), d: side(sw) });
    }
  }

  if (V !== undefined) {
    const k = Math.cbrt(V / 3);
    groups.push({ code: "BL", label: "Block", step: 1, drafts: [box("BL", 1, 0, 0, side(2 * k), side(k), side(1.5 * k))], w: side(2 * k), d: side(1.5 * k) });
  }

  // Groups sit in lanes along z, each centred on x.
  let cursor = 0;
  const placed: { g: Group; zc: number }[] = [];
  for (const g of groups) { placed.push({ g, zc: cursor + g.d / 2 }); cursor += g.d + GROUP_GAP_M; }
  const totalD = Math.max(0, cursor - GROUP_GAP_M);
  const counts: Record<string, number> = {};
  const pieces: Piece[] = [];
  for (const { g, zc } of placed) {
    for (const dr of g.drafts) {
      counts[dr.code] = (counts[dr.code] ?? 0) + 1;
      const n = counts[dr.code];
      const { x, y, z, ...rest } = dr;
      pieces.push({
        ...rest, id: `${dr.code}-${n < 10 ? "0" : ""}${n}`, pos: [r4(x), r4(y), r4(z + zc - totalD / 2)],
        dims: { w: r4(dr.dims.w), h: r4(dr.dims.h), t: r4(dr.dims.t) }, vol: r4(dr.vol), area: r4(dr.area ?? 0),
      });
    }
  }

  const stepNames = ["Site", "Main works", ...(pieces.some((p) => p.step === 2) ? ["Repeated units"] : [])];
  const width = groups.reduce((m, g) => Math.max(m, g.w), 0);
  const model: GeometryModel = {
    geometry: GENERIC_KEY, pieces, w: r4(width), d: r4(totalD), step_names: stepNames, warnings,
    families: GENERIC_FAMILIES, slots: GENERIC_SLOTS, view_min_dist: 8, illustrative: true,
  };
  if (pieces.length === 0) return model;
  return tagPieces(model, a.lines ?? []);
}

// ── lines -> pieces ──────────────────────────────────────────────────────────

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, "");
const LENGTH_UOM = new Set(["m", "lm", "rm", "m.", "metre", "metres", "meter", "meters"]);
const AREA_UOM = new Set(["m2", "m²", "sqm"]);
const VOLUME_UOM = new Set(["m3", "m³", "cum"]);
const COUNT_UOM = new Set(["nr", "nrs", "nos", "no", "each", "ea", "pcs", "pc", "unit", "units", "set", "sets", "qty"]);

const FAMILIES_FOR: Record<"length" | "area" | "volume" | "count", readonly string[]> = {
  length: ["RN", "FP", "SL"],
  area: ["FP", "SL", "BL", "RN"],
  volume: ["FP", "BL", "SL", "RN", "UN"],
  count: ["UN"],
};

/** The family a cost line is measured on, by its unit; null for a line no piece stands for (labour, lump sums, weights). */
export function familyForLine(uom: string | null | undefined, present: ReadonlySet<string>): string | null {
  const u = norm(uom);
  const kind = LENGTH_UOM.has(u) ? "length" : AREA_UOM.has(u) ? "area" : VOLUME_UOM.has(u) ? "volume" : COUNT_UOM.has(u) ? "count" : null;
  if (!kind) return null;
  return FAMILIES_FOR[kind].find((f) => present.has(f)) ?? null;
}

const SLOT_WORDS: readonly { slot: string; re: RegExp }[] = [
  { slot: "soil", re: /\b(soil|excavat\w*|backfill|trench\w*|earth\w*|fill|sand|gravel|spoil|bedding|aggregate|grading)\b/i },
  { slot: "timber", re: /\b(timber|wood\w*|ply\w*|joist\w*|batten\w*|formwork|door\w*|carpent\w*)\b/i },
  { slot: "steel", re: /\b(steel|pipe\w*|rebar|reinforc\w*|cable\w*|mesh|post\w*|fence\w*|fabric|duct\w*|conduit\w*|valve\w*|fitting\w*|galvanis\w*|wire)\b/i },
  { slot: "concrete", re: /\b(concrete|precast|screed|slab\w*|block\w*|cement|plaster\w*|mortar|tile\w*|grout|brick\w*)\b/i },
];
const SLOT_DEFAULT: Record<string, string> = { FP: "concrete", RN: "steel", UN: "concrete", SL: "concrete", BL: "concrete" };

/** The slot a family is painted with: the one the most cost of its lines points at, else the family's default. */
function slotFor(code: string, lines: readonly GenericLine[], present: ReadonlySet<string>): string {
  const weight: Record<string, number> = {};
  for (const l of lines) {
    if (familyForLine(l.uom, present) !== code) continue;
    const hit = SLOT_WORDS.find((s) => s.re.test(l.description));
    if (hit) weight[hit.slot] = (weight[hit.slot] ?? 0) + Math.max(0.01, l.cost_total ?? 0);
  }
  const best = Object.entries(weight).sort((x, y) => y[1] - x[1])[0];
  return best ? best[0] : SLOT_DEFAULT[code] ?? "concrete";
}

/** Gives every piece its design slot and the codes of the cost lines it stands for. */
function tagPieces(model: GeometryModel, lines: readonly GenericLine[]): GeometryModel {
  const present = new Set(model.pieces.map((p) => p.code));
  const slots = new Map([...present].map((c) => [c, slotFor(c, lines, present)]));
  const linesBy = new Map<string, string[]>();
  for (const l of lines) {
    const f = familyForLine(l.uom, present);
    if (f && l.code) linesBy.set(f, [...(linesBy.get(f) ?? []), l.code]);
  }
  return {
    ...model,
    pieces: model.pieces.map((p) => ({ ...p, slot: slots.get(p.code), ...(linesBy.has(p.code) ? { lines: linesBy.get(p.code) } : {}) })),
  };
}

/**
 * The cost lines with a mark range filled in where they have none, so a line lights up its pieces ("Show in 3D") and the inspector
 * splits cost over them exactly as it does for the villa. A line no piece stands for stays without marks and is shared by all.
 */
export function withGenericRefs<T extends GenericLine>(model: GeometryModel, lines: readonly T[]): T[] {
  const present = new Set(model.pieces.map((p) => p.code));
  return lines.map((l) => {
    if (l.element_ref) return l;
    const f = familyForLine(l.uom, present);
    const marks = f ? model.pieces.filter((p) => p.code === f) : [];
    if (marks.length === 0) return l;
    const ref = marks.length === 1 ? marks[0].id : `${marks[0].id}..${marks[marks.length - 1].id}`;
    return { ...l, element_ref: ref };
  });
}
