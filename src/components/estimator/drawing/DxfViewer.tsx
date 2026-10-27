"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import type { DxfModel } from "@/lib/estimator/drawing/model";
import { DRAWING_TIPS } from "@/lib/estimator/drawing/tips";
import { buildDrawn, entityPath, fitView, layerStroke, panBy, viewBoxOf, zoomAt, zoomLimits, type View } from "./viewerGeometry";
import css from "./DxfViewer.module.css";

const lower = (s: string) => s.toLowerCase();

/**
 * A pan-and-zoom picture of a parsed DXF drawing with a list of its layers. Lines keep a constant on-screen width, layers can
 * be switched on and off, and `highlightLayers` (names) or `highlightIds` (indexes into model.entities) are drawn bold
 * while everything else fades back. Load it with next/dynamic where it is used so the geometry code stays out of other bundles.
 */
export default function DxfViewer({
  model, highlightLayers, highlightIds, note,
}: {
  model: DxfModel;
  highlightLayers?: readonly string[];
  highlightIds?: readonly number[];
  /** A sentence shown over the corner of the picture (for example "simplified for display"). */
  note?: string | null;
}) {
  const drawn = useMemo(() => buildDrawn(model), [model]);
  const layers = useMemo(() => {
    const names = new Set(model.layers.map((l) => l.name));
    for (const k of Object.keys(drawn.paths)) names.add(k);
    const color = new Map(model.layers.map((l) => [l.name, l.color]));
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, color: color.get(name) ?? "#ffffff", has: Object.prototype.hasOwnProperty.call(drawn.paths, name) }));
  }, [model.layers, drawn.paths]);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set(model.layers.filter((l) => l.hidden).map((l) => l.name)));
  const svgRef = useRef<SVGSVGElement>(null);
  const fit = useMemo(() => fitView(model.extents, 1.6), [model.extents]);
  const [view, setView] = useState<View>(fit);
  const viewRef = useRef(view);
  viewRef.current = view;
  const limits = useMemo(() => zoomLimits(fit), [fit]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const size = () => {
    const r = svgRef.current?.getBoundingClientRect();
    return { w: r && r.width > 0 ? r.width : 640, h: r && r.height > 0 ? r.height : 400 };
  };
  const fitToDrawing = useCallback(() => {
    const s = size();
    setView(fitView(model.extents, s.w / s.h));
  }, [model.extents]);

  // Fit to the real canvas once it has a size, and keep the view's aspect equal to the canvas's when it is resized.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    fitToDrawing();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const s = size();
      setView((v) => {
        const h = v.w / (s.w / s.h);
        return Math.abs(h - v.h) < 1e-9 ? v : { ...v, y: v.y + (v.h - h) / 2, h };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToDrawing]);

  // The wheel must not scroll the page while the pointer is over the picture, which needs a non-passive listener.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const fx = r.width > 0 ? (e.clientX - r.left) / r.width : 0.5;
      const fy = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5;
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), fx, fy, limits));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [limits]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not every environment supports capture */ }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const s = size();
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.current.size >= 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0 && after > 0) {
        const r = svgRef.current!.getBoundingClientRect();
        setView((v) => zoomAt(v, after / before, ((now.x + other.x) / 2 - r.left) / s.w, ((now.y + other.y) / 2 - r.top) / s.h, limits));
      }
    } else {
      setView((v) => panBy(v, -(now.x - prev.x) / s.w, -(now.y - prev.y) / s.h));
    }
    pointers.current.set(e.pointerId, now);
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => { pointers.current.delete(e.pointerId); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowLeft") setView((v) => panBy(v, -0.1, 0));
    else if (k === "ArrowRight") setView((v) => panBy(v, 0.1, 0));
    else if (k === "ArrowUp") setView((v) => panBy(v, 0, -0.1));
    else if (k === "ArrowDown") setView((v) => panBy(v, 0, 0.1));
    else if (k === "+" || k === "=") setView((v) => zoomAt(v, 1.4, 0.5, 0.5, limits));
    else if (k === "-" || k === "_") setView((v) => zoomAt(v, 1 / 1.4, 0.5, 0.5, limits));
    else if (k === "0") fitToDrawing();
    else return;
    e.preventDefault();
  };

  const hl = useMemo(() => new Set((highlightLayers ?? []).map(lower)), [highlightLayers]);
  const emphasise = hl.size > 0 || (highlightIds?.length ?? 0) > 0;
  const idPath = useMemo(() => (highlightIds ?? []).map((i) => { const e = model.entities[i]; return e && e.t !== "insert" && e.t !== "text" ? entityPath(e) : ""; }).join(""), [highlightIds, model.entities]);

  const toggle = (name: string) => setHidden((h) => { const n = new Set(h); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const textSize = (h: number) => Math.min(view.w / 40, Math.max(view.w / 600, h || view.w / 150));

  return (
    <div className={css.wrap} data-guide="estimate.drawing-viewer">
      <div
        className={css.stage} tabIndex={0} role="group" onKeyDown={onKeyDown}
        aria-label="Drawing viewer. Arrow keys move, plus and minus zoom, zero fits the drawing."
      >
        <svg
          ref={svgRef} className={css.canvas} viewBox={viewBoxOf(view)} role="img"
          aria-label={`Drawing with ${layers.length} layer${layers.length === 1 ? "" : "s"}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        >
          {layers.filter((l) => l.has && !hidden.has(l.name)).map((l) => {
            const on = hl.has(lower(l.name));
            return (
              <path
                key={l.name} d={drawn.paths[l.name]} fill="none" vectorEffect="non-scaling-stroke"
                stroke={on ? "var(--accent)" : layerStroke(l.color)} strokeWidth={on ? 3 : 1.25} strokeLinecap="round" strokeLinejoin="round"
                opacity={emphasise && !on ? 0.3 : 1}
              />
            );
          })}
          {idPath && <path d={idPath} fill="none" vectorEffect="non-scaling-stroke" stroke="var(--accent)" strokeWidth={3.5} strokeLinecap="round" />}
          {drawn.texts.filter((t) => !hidden.has(t.layer)).map((t, i) => (
            <text key={i} x={t.x} y={t.y} fontSize={textSize(t.h)} fill="var(--muted)" opacity={emphasise ? 0.4 : 0.9} style={{ pointerEvents: "none" }}>{t.text}</text>
          ))}
        </svg>
        <div className={css.tools}>
          <button type="button" className={css.tool} aria-label="Zoom in" onClick={() => setView((v) => zoomAt(v, 1.5, 0.5, 0.5, limits))}>+</button>
          <button type="button" className={css.tool} aria-label="Zoom out" onClick={() => setView((v) => zoomAt(v, 1 / 1.5, 0.5, 0.5, limits))}>−</button>
          <button type="button" className={`${css.tool} ${css.toolWide}`} aria-label="Fit the whole drawing" onClick={fitToDrawing}>Fit</button>
        </div>
        {(note || drawn.capped) && (
          <div className={css.note} role="status">
            {drawn.capped ? `Showing ${drawn.drawn.toLocaleString("en-US")} of ${drawn.total.toLocaleString("en-US")} objects. ` : ""}{note ?? ""}
          </div>
        )}
      </div>
      <div className={css.layers}>
        <div className={css.layersHead}>
          <span className="bpm-label-row">Layers <InfoTip label="Layers">{DRAWING_TIPS.viewer}</InfoTip></span>
          <span className={css.layersHeadBtns}>
            <button type="button" className={css.mini} onClick={() => setHidden(new Set())}>All</button>
            <button type="button" className={css.mini} onClick={() => setHidden(new Set(layers.map((l) => l.name)))}>None</button>
          </span>
        </div>
        <ul className={css.list}>
          {layers.map((l) => (
            <li key={l.name}>
              <label className={`${css.toggle} ${hl.has(lower(l.name)) ? css.toggleOn : ""}`}>
                <input type="checkbox" checked={!hidden.has(l.name)} onChange={() => toggle(l.name)} aria-label={`Show layer ${l.name}`} />
                <span className={css.swatch} style={{ background: layerStroke(l.color) }} aria-hidden="true" />
                <span className={css.name}>{l.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
