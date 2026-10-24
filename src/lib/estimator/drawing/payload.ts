// What the measure route sends back for one drawing (pure). The numbers are always computed from the full drawing on the
// server; only the picture the viewer draws may be thinned to keep the response small, and the response says when it was.

import { MAX_DRAWN, type DxfEntity, type DxfModel, type DxfUnit, type Extents, type Pt } from "./model";
import { measureByLayer, type MeasuredTable } from "./measure";

/** The response is held under about 5 MB. */
export const MAX_PAYLOAD_BYTES = 4_500_000;

export type DrawingPayload = {
  file: string;
  unit: DxfUnit;
  warnings: string[];
  extents: Extents | null;
  /** The "what is in this drawing" table. Rows carry drawing-unit values too, so the browser can re-scale it without the geometry. */
  layers: MeasuredTable;
  counts: { entities: number; drawable: number; drawnCap: number; capped: boolean };
  /** The drawing for the viewer; null when it is too large to send (the table is still complete). */
  model: DxfModel | null;
  /** Why the picture is thinned or missing, or null. */
  modelNote: string | null;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const rp = (p: Pt): Pt => [r3(p[0]), r3(p[1])];

function roundEntity(e: DxfEntity): DxfEntity {
  switch (e.t) {
    case "line": return { ...e, a: rp(e.a), b: rp(e.b) };
    case "poly": return { ...e, pts: e.pts.map(rp) };
    case "arc": return { ...e, c: rp(e.c), r: r3(e.r), a0: r3(e.a0), a1: r3(e.a1) };
    case "circle": return { ...e, c: rp(e.c), r: r3(e.r) };
    case "insert": return { ...e, at: rp(e.at) };
    case "text": return { ...e, at: rp(e.at), h: r3(e.h) };
  }
}

/** Keep every nth vertex of long polylines (the ends always stay). */
function thin(e: DxfEntity, keepEvery: number): DxfEntity {
  if (e.t !== "poly" || e.pts.length <= 60) return e;
  const pts = e.pts.filter((_, i) => i % keepEvery === 0 || i === e.pts.length - 1);
  return { ...e, pts };
}

const size = (v: unknown) => JSON.stringify(v).length;

export function shrinkModel(model: DxfModel, maxBytes = MAX_PAYLOAD_BYTES): { model: DxfModel | null; note: string | null } {
  let m: DxfModel = {
    ...model,
    entities: model.entities.map(roundEntity),
    blocks: Object.fromEntries(Object.entries(model.blocks).map(([k, v]) => [k, v.map(roundEntity)])),
  };
  if (size(m) <= maxBytes) return { model: m, note: null };
  m = { ...m, entities: m.entities.filter((e) => e.t !== "text"), blocks: Object.fromEntries(Object.entries(m.blocks).map(([k, v]) => [k, v.filter((e) => e.t !== "text")])) };
  if (size(m) <= maxBytes) return { model: m, note: "Text labels are not shown because the drawing is large." };
  m = { ...m, blocks: {} };
  if (size(m) <= maxBytes) return { model: m, note: "Text and the contents of blocks are not shown because the drawing is large." };
  for (const every of [2, 4, 8, 16]) {
    const t: DxfModel = { ...m, entities: m.entities.map((e) => thin(e, every)) };
    if (size(t) <= maxBytes) return { model: t, note: "The picture is simplified because the drawing is large. The numbers use the full drawing." };
  }
  return { model: null, note: "The drawing is too large to show here. The table of layers and the numbers are complete." };
}

/** How many primitives the viewer would draw: entities, plus the contents of each insert (one level; an array insert is drawn once). */
export function drawableCount(model: Pick<DxfModel, "entities" | "blocks">): number {
  let n = 0;
  for (const e of model.entities) {
    if (e.t === "insert") n += (model.blocks[e.name]?.length ?? 0) + 1;
    else n++;
  }
  return n;
}

export function buildPayload(file: string, model: DxfModel, opts: { factor?: number | null; maxBytes?: number } = {}): DrawingPayload {
  const factor = opts.factor === undefined ? model.unit.factor : opts.factor;
  const table = measureByLayer(model, factor);
  const shrunk = shrinkModel(model, opts.maxBytes);
  const drawable = drawableCount(model);
  return {
    file, unit: model.unit, warnings: [...model.warnings, ...table.warnings], extents: model.extents,
    layers: table,
    counts: { entities: model.entityCount, drawable, drawnCap: MAX_DRAWN, capped: drawable > MAX_DRAWN },
    model: shrunk.model, modelNote: shrunk.note,
  };
}
