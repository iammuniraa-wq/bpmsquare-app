// Reads a DXF drawing into the small model in model.ts, using the open-source dxf-parser (MIT). Never throws: a file it
// cannot read comes back as { ok: false, error } with a sentence a person can act on. Server side (it parses up to 15 MB).

import DxfParser from "dxf-parser";
import {
  MAX_DXF_BYTES, MAX_DXF_ENTITIES,
  type DxfEntity, type DxfLayer, type DxfModel, type DxfUnit, type Extents, type Pt,
} from "./model";

export type DxfParseResult = { ok: true; model: DxfModel } | { ok: false; error: string };

/** $INSUNITS code -> name and metres per unit. 0 (unitless) is deliberately absent: the person is asked. */
const UNITS: Record<number, { name: string; factor: number }> = {
  1: { name: "inches", factor: 0.0254 },
  2: { name: "feet", factor: 0.3048 },
  3: { name: "miles", factor: 1609.344 },
  4: { name: "millimetres", factor: 0.001 },
  5: { name: "centimetres", factor: 0.01 },
  6: { name: "metres", factor: 1 },
  7: { name: "kilometres", factor: 1000 },
  8: { name: "microinches", factor: 0.0254e-6 },
  9: { name: "mils", factor: 0.0254e-3 },
  10: { name: "yards", factor: 0.9144 },
  11: { name: "angstroms", factor: 1e-10 },
  12: { name: "nanometres", factor: 1e-9 },
  13: { name: "microns", factor: 1e-6 },
  14: { name: "decimetres", factor: 0.1 },
  15: { name: "decametres", factor: 10 },
  16: { name: "hectometres", factor: 100 },
  17: { name: "gigametres", factor: 1e9 },
};

export function unitFromCode(code: unknown): DxfUnit {
  const c = typeof code === "number" && Number.isInteger(code) ? code : 0;
  const u = UNITS[c];
  return u ? { code: c, name: u.name, factor: u.factor } : { code: c, name: "not stated", factor: null };
}

/** Units a person can pick when the drawing does not say (and to correct a wrong one), as { label, metres per unit }. */
export const PICKABLE_UNITS: readonly { code: number; name: string; factor: number }[] =
  [4, 5, 6, 2, 1].map((code) => ({ code, name: UNITS[code].name, factor: UNITS[code].factor }));

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const pt = (p: { x?: unknown; y?: unknown } | undefined | null): Pt | null => {
  if (!p) return null;
  const x = num(p.x, NaN), y = num(p.y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};
const layerOf = (e: { layer?: unknown }): string => (typeof e.layer === "string" && e.layer !== "" ? e.layer : "0");
const deg = (rad: unknown) => (num(rad) * 180) / Math.PI;

/** MTEXT carries formatting codes ({\fArial;...}, \P for a new line); keep the words. */
export function plainMtext(s: string): string {
  return s
    .replace(/\\P/gi, " ")
    .replace(/\\[ACcFfHhLlOoQqTtWw][^;]*;/g, "")
    .replace(/\\[~\\{}]/g, (m) => m.slice(1))
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const hex = (n: unknown): string => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(0xffffff, Math.trunc(n))) : 0xffffff;
  return `#${v.toString(16).padStart(6, "0")}`;
};

type RawEntity = Record<string, unknown> & { type?: string; layer?: string; inPaperSpace?: boolean };

type Ctx = { skipped: Record<string, number>; bulgy: boolean };

function convert(e: RawEntity, ctx: Ctx): DxfEntity | null {
  const layer = layerOf(e);
  const type = String(e.type ?? "");
  switch (type) {
    case "LINE": {
      const v = (e.vertices as { x: number; y: number }[] | undefined) ?? [];
      const a = pt(v[0]), b = pt(v[1]);
      return a && b ? { t: "line", layer, a, b } : null;
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      if (e.isPolyfaceMesh === true || e.is3dPolygonMesh === true) { ctx.skipped[type] = (ctx.skipped[type] ?? 0) + 1; return null; }
      const v = (e.vertices as { x: number; y: number; bulge?: number }[] | undefined) ?? [];
      const pts: Pt[] = [];
      let bulge = false;
      for (const p of v) {
        const q = pt(p);
        if (!q) continue;
        pts.push(q);
        if (num(p.bulge) !== 0) bulge = true;
      }
      if (pts.length < 2) return null;
      if (bulge) ctx.bulgy = true;
      return { t: "poly", layer, pts, closed: e.shape === true, ...(bulge ? { bulge: true as const } : {}) };
    }
    case "ARC": {
      const c = pt(e.center as { x: number; y: number });
      const r = num(e.radius, NaN);
      if (!c || !Number.isFinite(r) || r <= 0) return null;
      return { t: "arc", layer, c, r, a0: deg(e.startAngle), a1: deg(e.endAngle) };
    }
    case "CIRCLE": {
      const c = pt(e.center as { x: number; y: number });
      const r = num(e.radius, NaN);
      if (!c || !Number.isFinite(r) || r <= 0) return null;
      return { t: "circle", layer, c, r };
    }
    case "INSERT": {
      const at = pt(e.position as { x: number; y: number });
      const name = typeof e.name === "string" ? e.name : "";
      if (!at || !name) return null;
      const cols = Math.max(1, Math.trunc(num(e.columnCount, 1))), rows = Math.max(1, Math.trunc(num(e.rowCount, 1)));
      const sx = num(e.xScale, 1) || 1;
      return {
        t: "insert", layer, name, at, sx, sy: num(e.yScale, sx) || sx, rot: num(e.rotation),
        ...(cols > 1 ? { cols } : {}), ...(rows > 1 ? { rows } : {}),
      };
    }
    case "TEXT": {
      const at = pt(e.startPoint as { x: number; y: number });
      const text = typeof e.text === "string" ? e.text.trim() : "";
      return at && text ? { t: "text", layer, at, text: text.slice(0, 120), h: num(e.textHeight, 0) } : null;
    }
    case "MTEXT": {
      const at = pt(e.position as { x: number; y: number });
      const text = typeof e.text === "string" ? plainMtext(e.text) : "";
      return at && text ? { t: "text", layer, at, text: text.slice(0, 120), h: num(e.height, 0) } : null;
    }
    default:
      if (type) ctx.skipped[type] = (ctx.skipped[type] ?? 0) + 1;
      return null;
  }
}

function grow(b: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number) {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
}

/** The box around the drawing's own geometry (blocks are not included). Null for an empty drawing. */
export function modelExtents(entities: readonly DxfEntity[]): Extents | null {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const e of entities) {
    if (e.t === "line") { grow(b, e.a[0], e.a[1]); grow(b, e.b[0], e.b[1]); }
    else if (e.t === "poly") for (const p of e.pts) grow(b, p[0], p[1]);
    else if (e.t === "arc" || e.t === "circle") { grow(b, e.c[0] - e.r, e.c[1] - e.r); grow(b, e.c[0] + e.r, e.c[1] + e.r); }
    else if (e.t === "insert") grow(b, e.at[0], e.at[1]);
  }
  return Number.isFinite(b.minX) ? b : null;
}

function looksBinary(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 22)).toString("latin1");
  return head.startsWith("AutoCAD Binary DXF");
}

function decode(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const utf8 = buf.toString("utf8");
  // Older DXF (before 2007) is in the machine's code page; read it as latin1 rather than lose the accents.
  return utf8.includes("�") ? buf.toString("latin1") : utf8;
}

/** Parse DXF text or bytes. Caps: 15 MB, 200,000 entities. */
export function parseDxf(input: string | Uint8Array): DxfParseResult {
  try {
    const size = typeof input === "string" ? Buffer.byteLength(input) : input.byteLength;
    if (size === 0) return { ok: false, error: "The file is empty." };
    if (size > MAX_DXF_BYTES) return { ok: false, error: `The drawing is ${(size / 1048576).toFixed(1)} MB; the limit is ${MAX_DXF_BYTES / 1048576} MB. Save a smaller DXF (purge unused blocks and layers) and try again.` };
    if (typeof input !== "string" && looksBinary(input)) return { ok: false, error: "This is a binary DXF. Save it as an ASCII DXF (the usual \"Save as\" choice) and try again." };
    const text = typeof input === "string" ? input : decode(input);

    let dxf;
    try { dxf = new DxfParser().parseSync(text); } catch (e) {
      return { ok: false, error: `This does not look like a DXF drawing (${e instanceof Error ? e.message.slice(0, 120) : "unreadable"}).` };
    }
    if (!dxf) return { ok: false, error: "This does not look like a DXF drawing." };

    const raw = (dxf.entities ?? []) as unknown as RawEntity[];
    const blocksRaw = (dxf.blocks ?? {}) as unknown as Record<string, { entities?: RawEntity[] }>;
    let blockEntityCount = 0;
    for (const b of Object.values(blocksRaw)) blockEntityCount += b.entities?.length ?? 0;
    if (raw.length + blockEntityCount > MAX_DXF_ENTITIES) {
      return { ok: false, error: `The drawing has ${(raw.length + blockEntityCount).toLocaleString("en-US")} objects; the limit is ${MAX_DXF_ENTITIES.toLocaleString("en-US")}. Save a smaller DXF (one floor or one area) and try again.` };
    }

    const ctx: Ctx = { skipped: {}, bulgy: false };
    const entities: DxfEntity[] = [];
    let paperSpace = 0;
    for (const e of raw) {
      if (e.inPaperSpace === true) { paperSpace++; continue; }
      const c = convert(e, ctx);
      if (c) entities.push(c);
    }

    // Only the blocks that are inserted (directly or through another block) are kept, for drawing.
    const blockMap = new Map<string, DxfEntity[]>();
    const want: string[] = [];
    const seen = new Set<string>();
    const lookup = new Map(Object.entries(blocksRaw).map(([k, v]) => [k.toLowerCase(), k] as const));
    const need = (name: string) => { const k = lookup.get(name.toLowerCase()); if (k && !seen.has(k)) { seen.add(k); want.push(k); } };
    for (const e of entities) if (e.t === "insert") need(e.name);
    for (let i = 0; i < want.length && i < 500; i++) {
      const key = want[i];
      const list: DxfEntity[] = [];
      for (const e of blocksRaw[key]?.entities ?? []) {
        const c = convert(e, ctx);
        if (!c) continue;
        list.push(c);
        if (c.t === "insert") need(c.name);
      }
      blockMap.set(key, list);
    }

    const blocks: Record<string, DxfEntity[]> = Object.fromEntries(blockMap);

    // Layers: the drawing's own table first, then any layer only entities mention.
    const table = ((dxf.tables?.layer?.layers ?? {}) as unknown as Record<string, { name?: string; visible?: boolean; frozen?: boolean; color?: number }>);
    const layers = new Map<string, DxfLayer>();
    for (const [key, l] of Object.entries(table)) {
      const name = typeof l.name === "string" && l.name ? l.name : key;
      layers.set(name, { name, color: hex(l.color), hidden: l.visible === false || l.frozen === true });
    }
    for (const e of [...entities, ...Object.values(blocks).flat()]) {
      if (!layers.has(e.layer) && e.layer !== "0") layers.set(e.layer, { name: e.layer, color: "#ffffff", hidden: false });
    }
    if (entities.some((e) => e.layer === "0") && !layers.has("0")) layers.set("0", { name: "0", color: "#ffffff", hidden: false });

    const unit = unitFromCode((dxf.header as Record<string, unknown> | undefined)?.["$INSUNITS"]);
    const warnings: string[] = [];
    if (ctx.bulgy) warnings.push("Some polylines have curved segments; they are measured as straight lines between their points, so lengths on those layers can be slightly short.");
    if (paperSpace > 0) warnings.push(`${paperSpace.toLocaleString("en-US")} object${paperSpace === 1 ? "" : "s"} on paper-space layouts were left out; only the model drawing is read.`);
    const skippedTotal = Object.values(ctx.skipped).reduce((a, n) => a + n, 0);
    if (skippedTotal > 0) {
      const top = Object.entries(ctx.skipped).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ");
      warnings.push(`Not measured (not lines, polylines, arcs, circles, blocks or text): ${top}${Object.keys(ctx.skipped).length > 4 ? " and more" : ""}.`);
    }
    if (unit.factor === null) warnings.push("The drawing does not say what its units are. Choose them before the numbers are used.");

    return {
      ok: true,
      model: {
        layers: [...layers.values()], entities, blocks, unit, extents: modelExtents(entities),
        warnings, entityCount: raw.length - paperSpace, skipped: ctx.skipped,
      },
    };
  } catch (e) {
    return { ok: false, error: `The drawing could not be read (${e instanceof Error ? e.message.slice(0, 120) : "unexpected error"}).` };
  }
}
