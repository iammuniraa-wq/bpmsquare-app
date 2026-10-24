// Pure helpers behind the DXF viewer: turning the model into one SVG path per layer, and the pan / zoom / fit maths.
// The picture is drawn with y negated (a drawing's y points up, the screen's down), so every number here is "view" space.

import { MAX_DRAWN, type DxfEntity, type DxfModel, type Extents, type Pt } from "@/lib/estimator/drawing/model";

export type View = { x: number; y: number; w: number; h: number };

export type TextItem = { x: number; y: number; text: string; h: number; layer: string };

export type DrawnLayers = {
  /** SVG path data per layer name. */
  paths: Record<string, string>;
  texts: TextItem[];
  /** Primitives drawn / primitives the drawing has. */
  drawn: number;
  total: number;
  capped: boolean;
};

const MAX_DEPTH = 3;
const MAX_TEXTS = 400;
const f = (n: number) => String(Math.round(n * 1000) / 1000);

type Xf = { at: Pt; sx: number; sy: number; cos: number; sin: number; layer: string | null };
const IDENTITY: Xf = { at: [0, 0], sx: 1, sy: 1, cos: 1, sin: 0, layer: null };
const apply = (p: Pt, t: Xf): Pt => [t.at[0] + p[0] * t.sx * t.cos - p[1] * t.sy * t.sin, t.at[1] + p[0] * t.sx * t.sin + p[1] * t.sy * t.cos];

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  let sweep = (a1 - a0) % 360;
  if (sweep <= 0) sweep += 360;
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt = (a: number) => `${f(cx + r * Math.cos(rad(a)))} ${f(-(cy + r * Math.sin(rad(a))))}`;
  if (sweep >= 359.999) {
    return `M${pt(a0)}A${f(r)} ${f(r)} 0 1 0 ${pt(a0 + 180)}A${f(r)} ${f(r)} 0 1 0 ${pt(a0)}`;
  }
  return `M${pt(a0)}A${f(r)} ${f(r)} 0 ${sweep > 180 ? 1 : 0} 0 ${pt(a0 + sweep)}`;
}

/** Path data for one entity (not an insert or text); "" when there is nothing to draw. */
export function entityPath(e: DxfEntity, t: Xf = IDENTITY): string {
  if (e.t === "line") {
    const a = apply(e.a, t), b = apply(e.b, t);
    return `M${f(a[0])} ${f(-a[1])}L${f(b[0])} ${f(-b[1])}`;
  }
  if (e.t === "poly") {
    const pts = e.pts.map((p) => apply(p, t));
    return `M${pts.map((p) => `${f(p[0])} ${f(-p[1])}`).join("L")}${e.closed ? "Z" : ""}`;
  }
  if (e.t === "circle") {
    const c = apply(e.c, t);
    return arcPath(c[0], c[1], e.r * Math.abs(t.sx), 0, 360);
  }
  if (e.t === "arc") {
    const c = apply(e.c, t);
    const rot = (Math.atan2(t.sin, t.cos) * 180) / Math.PI;
    return arcPath(c[0], c[1], e.r * Math.abs(t.sx), e.a0 + rot, e.a1 + rot);
  }
  return "";
}

/** One path per layer, the contents of inserted blocks included (up to 3 levels), stopping at `cap` primitives. */
export function buildDrawn(model: Pick<DxfModel, "entities" | "blocks">, cap = MAX_DRAWN): DrawnLayers {
  const parts = new Map<string, string[]>();
  const texts: TextItem[] = [];
  let drawn = 0, total = 0;
  const add = (layer: string, d: string) => {
    if (!d) return;
    const list = parts.get(layer);
    if (list) list.push(d); else parts.set(layer, [d]);
  };
  const walk = (list: readonly DxfEntity[], t: Xf, depth: number) => {
    for (const e of list) {
      total++;
      if (drawn >= cap) continue;
      const layer = t.layer !== null && e.layer === "0" ? t.layer : e.layer;
      if (e.t === "insert") {
        const key = Object.keys(model.blocks).find((k) => k === e.name) ?? Object.keys(model.blocks).find((k) => k.toLowerCase() === e.name.toLowerCase());
        const block = key === undefined ? undefined : model.blocks[key];
        if (block && depth < MAX_DEPTH) {
          const at = apply(e.at, t);
          const rot = (e.rot * Math.PI) / 180 + Math.atan2(t.sin, t.cos);
          walk(block, { at, sx: e.sx * t.sx, sy: e.sy * t.sy, cos: Math.cos(rot), sin: Math.sin(rot), layer }, depth + 1);
        } else {
          // No contents to draw: mark the insertion point so the block is still visible.
          const p = apply(e.at, t);
          add(layer, `M${f(p[0] - 0.5)} ${f(-p[1])}L${f(p[0] + 0.5)} ${f(-p[1])}M${f(p[0])} ${f(-p[1] - 0.5)}L${f(p[0])} ${f(-p[1] + 0.5)}`);
        }
        drawn++;
        continue;
      }
      if (e.t === "text") {
        if (texts.length < MAX_TEXTS) { const p = apply(e.at, t); texts.push({ x: p[0], y: -p[1], text: e.text, h: e.h * Math.abs(t.sy), layer }); }
        continue;
      }
      add(layer, entityPath(e, t));
      drawn++;
    }
  };
  walk(model.entities, IDENTITY, 0);
  return { paths: Object.fromEntries([...parts].map(([k, v]) => [k, v.join("")])), texts, drawn, total, capped: total > drawn && drawn >= cap };
}

// ── View maths ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A view that shows the extents with a margin, matching the canvas's aspect ratio (width / height). */
export function fitView(ext: Extents | null, aspect: number, margin = 0.06): View {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (!ext) return { x: 0, y: 0, w: 100 * a, h: 100 };
  let w = Math.max(ext.maxX - ext.minX, 1e-6), h = Math.max(ext.maxY - ext.minY, 1e-6);
  w *= 1 + margin * 2; h *= 1 + margin * 2;
  const cx = (ext.minX + ext.maxX) / 2, cy = -((ext.minY + ext.maxY) / 2);
  if (w / h < a) w = h * a; else h = w / a;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export const MIN_SCALE = 1e-4;

/** Zoom by `factor` (>1 zooms in) about a point given as fractions (0..1) of the canvas. */
export function zoomAt(v: View, factor: number, fx = 0.5, fy = 0.5, limits?: { minW: number; maxW: number }): View {
  if (!Number.isFinite(factor) || factor <= 0) return v;
  let w = v.w / factor, h = v.h / factor;
  if (limits) {
    const clamped = Math.min(limits.maxW, Math.max(limits.minW, w));
    h = h * (clamped / w); w = clamped;
  }
  return { x: v.x + (v.w - w) * fx, y: v.y + (v.h - h) * fy, w, h };
}

/** Move the view by fractions of its own size. */
export function panBy(v: View, dxFrac: number, dyFrac: number): View {
  return { ...v, x: v.x + v.w * dxFrac, y: v.y + v.h * dyFrac };
}

/** Zoom limits for a drawing: a thousandth of its fitted width up to ten times it. */
export function zoomLimits(fit: View): { minW: number; maxW: number } {
  return { minW: fit.w / 1000, maxW: fit.w * 10 };
}

export const viewBoxOf = (v: View) => `${f(v.x)} ${f(v.y)} ${f(v.w)} ${f(v.h)}`;

/** Black and white are not colours on a screen that can be either; draw them in the theme's ink. */
export function layerStroke(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return "var(--ink)";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.92 || lum < 0.08 ? "var(--ink)" : color;
}
