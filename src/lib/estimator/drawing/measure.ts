// Measuring a parsed DXF drawing, per layer (pure; no I/O). The rules, kept deliberately simple so they can be explained:
//   length  lines, open polylines, the perimeter of closed polylines, arcs (radius x sweep) and circles (circumference).
//           Polylines with curved segments are measured as straight chords (the reader warns).
//   area    closed polylines (shoelace) and circles. A polyline whose first and last points coincide counts as closed.
//           A closed shape wholly inside another closed shape on the same layer is netted out (a hole), alternating
//           with each level of nesting; nothing else is netted (no overlaps, no shapes across layers).
//   count   block inserts by block name (an array insert counts rows x columns). Contents of blocks are not measured.
// Numbers here are in drawing units; the unit factor (metres per unit) or a rule's own scale turns them into metres.

import type { DxfEntity, DxfModel, DxfUnit, Pt } from "./model";
import type { DrawingMapRule } from "@/lib/estimator/types";

export type LayerMeasure = {
  layer: string;
  /** Drawing objects on the layer (every kind the reader understood). */
  entities: number;
  /** Total length and net area in DRAWING units (units and units squared). */
  length: number;
  area: number;
  /** Inserts by block name (name as first seen). */
  blocks: Record<string, number>;
};

export type MeasuredLayerRow = LayerMeasure & {
  /** Metres and square metres, or null while the drawing's unit is not known. */
  lengthM: number | null;
  areaM2: number | null;
};

export type MeasuredTable = {
  unit: DxfUnit;
  /** The metres-per-unit used for lengthM / areaM2 (the drawing's own unless the person chose one); null = unknown. */
  factor: number | null;
  rows: MeasuredLayerRow[];
  warnings: string[];
};

const TOL = 1e-9;
const MAX_NET_SHAPES = 3000;
const MAX_ARRAY = 100_000;

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polyLength(pts: readonly Pt[], closed: boolean): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) s += dist(pts[pts.length - 1], pts[0]);
  return s;
}

/** Absolute shoelace area. */
export function polyArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Counter-clockwise sweep of an arc in degrees, in (0, 360]. */
export function arcSweepDeg(a0: number, a1: number): number {
  let s = (a1 - a0) % 360;
  if (s <= 0) s += 360;
  return s;
}

const isClosedRing = (pts: readonly Pt[]) => pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) <= TOL * Math.max(1, Math.abs(pts[0][0]) + Math.abs(pts[0][1]));

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

type Shape = { area: number; ring: Pt[]; box: [number, number, number, number] };

const boxOf = (ring: readonly Pt[]): [number, number, number, number] => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ring) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return [a, b, c, d];
};

const circleRing = (c: Pt, r: number): Pt[] => Array.from({ length: 32 }, (_, i) => [c[0] + r * Math.cos((i * Math.PI) / 16), c[1] + r * Math.sin((i * Math.PI) / 16)] as Pt);

/** Net area of closed shapes: alternating +/- by how many other shapes wholly contain each one. */
export function netArea(shapes: readonly Shape[]): number {
  let total = 0;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    let depth = 0;
    for (let j = 0; j < shapes.length; j++) {
      if (i === j) continue;
      const o = shapes[j];
      if (o.area <= s.area) continue;
      if (s.box[0] < o.box[0] || s.box[1] < o.box[1] || s.box[2] > o.box[2] || s.box[3] > o.box[3]) continue;
      if (s.ring.every((p) => pointInPolygon(p, o.ring))) depth++;
    }
    total += depth % 2 === 0 ? s.area : -s.area;
  }
  return Math.max(0, total);
}

/** Per-layer totals in drawing units. */
export function measureModel(model: Pick<DxfModel, "entities">): { layers: LayerMeasure[]; warnings: string[] } {
  const by = new Map<string, LayerMeasure>();
  const blockCounts = new Map<string, Map<string, number>>();
  const shapes = new Map<string, Shape[]>();
  const get = (layer: string) => {
    let m = by.get(layer);
    if (!m) { m = { layer, entities: 0, length: 0, area: 0, blocks: {} }; by.set(layer, m); blockCounts.set(layer, new Map()); }
    return m;
  };
  const addShape = (layer: string, ring: Pt[], area: number) => {
    const list = shapes.get(layer) ?? [];
    list.push({ area, ring, box: boxOf(ring) });
    shapes.set(layer, list);
  };

  for (const e of model.entities as readonly DxfEntity[]) {
    const m = get(e.layer);
    m.entities++;
    if (e.t === "line") m.length += dist(e.a, e.b);
    else if (e.t === "poly") {
      const closed = e.closed || isClosedRing(e.pts);
      m.length += polyLength(e.pts, e.closed);
      if (closed && e.pts.length >= 3) addShape(e.layer, e.pts, polyArea(e.pts));
    } else if (e.t === "arc") m.length += e.r * (arcSweepDeg(e.a0, e.a1) * Math.PI) / 180;
    else if (e.t === "circle") {
      m.length += 2 * Math.PI * e.r;
      addShape(e.layer, circleRing(e.c, e.r), Math.PI * e.r * e.r);
    } else if (e.t === "insert") {
      const n = Math.min(MAX_ARRAY, (e.cols ?? 1) * (e.rows ?? 1));
      const counts = blockCounts.get(e.layer)!;
      const key = [...counts.keys()].find((k) => k.toLowerCase() === e.name.toLowerCase()) ?? e.name;
      counts.set(key, (counts.get(key) ?? 0) + n);
    }
  }

  const warnings: string[] = [];
  for (const [layer, list] of shapes) {
    const m = get(layer);
    if (list.length > MAX_NET_SHAPES) {
      m.area = list.reduce((a, s) => a + s.area, 0);
      warnings.push(`Layer ${layer} has ${list.length.toLocaleString("en-US")} closed shapes, so holes were not netted out of its area.`);
    } else m.area = netArea(list);
  }
  for (const [layer, counts] of blockCounts) by.get(layer)!.blocks = Object.fromEntries(counts);
  return { layers: [...by.values()].sort((a, b) => a.layer.localeCompare(b.layer)), warnings };
}

/** The "what is in this drawing" table. `factor` = metres per drawing unit (null = unknown: metres columns stay empty). */
export function measureByLayer(model: Pick<DxfModel, "entities" | "unit">, factor: number | null = model.unit.factor): MeasuredTable {
  const { layers, warnings } = measureModel(model);
  const f = factor !== null && Number.isFinite(factor) && factor > 0 ? factor : null;
  return {
    unit: model.unit, factor: f, warnings,
    rows: layers.map((l) => ({ ...l, lengthM: f === null ? null : l.length * f, areaM2: f === null ? null : l.area * f * f })),
  };
}

// ── One rule of a template's layer map ──────────────────────────────────────────────────────────────────────────────

export type RuleMeasure = {
  /** The number, in the input's unit (m, m2 or a count), unrounded; null when nothing could be measured. */
  value: number | null;
  /** Layers of the drawing that the rule matched, as the drawing spells them. */
  matched: string[];
  /** Layers the rule names that the drawing does not have. */
  absent: string[];
  /** Why there is no value, or what to know about it. */
  note: string | null;
};

const lower = (s: string) => s.trim().toLowerCase();

/** Measure one DrawingMapRule on a table. A rule's own `scale` replaces the drawing's unit factor (it is the fix for missing or wrong units). */
export function measureRule(table: Pick<MeasuredTable, "rows" | "factor">, rule: DrawingMapRule): RuleMeasure {
  const named = (rule.layers ?? []).map(lower).filter(Boolean);
  const rows = named.length === 0 ? table.rows : table.rows.filter((r) => named.includes(lower(r.layer)));
  const have = new Set(table.rows.map((r) => lower(r.layer)));
  const absent = (rule.layers ?? []).filter((l) => !have.has(lower(l)));
  const matched = rows.map((r) => r.layer);
  if (rule.measure === "count") {
    const blocks = (rule.blocks ?? []).map(lower).filter(Boolean);
    let n = 0;
    const counted: string[] = [];
    for (const r of rows) {
      let here = 0;
      for (const [name, c] of Object.entries(r.blocks)) if (blocks.length === 0 || blocks.includes(lower(name))) here += c;
      if (here > 0) counted.push(r.layer);
      n += here;
    }
    return n > 0
      ? { value: n, matched: counted, absent, note: null }
      : { value: null, matched, absent, note: blocks.length ? `No ${(rule.blocks ?? []).join(" / ")} blocks found${named.length ? ` on ${rule.layers!.join(" / ")}` : ""}.` : "No blocks found on those layers." };
  }
  if (rows.length === 0) return { value: null, matched, absent, note: `No layer ${(rule.layers ?? []).join(" / ")} in this drawing.` };
  const factor = rule.scale !== undefined && Number.isFinite(rule.scale) && rule.scale > 0 ? rule.scale : table.factor;
  if (factor === null) return { value: null, matched, absent, note: "The drawing does not say what its units are. Choose them first." };
  const raw = rows.reduce((a, r) => a + (rule.measure === "length_m" ? r.length : r.area), 0);
  const value = rule.measure === "length_m" ? raw * factor : raw * factor * factor;
  return value > 0
    ? { value, matched, absent, note: null }
    : { value: null, matched, absent, note: `Nothing to ${rule.measure === "length_m" ? "measure" : "measure as an area (the shapes must be closed)"} on ${matched.join(" / ")}.` };
}
