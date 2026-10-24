"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { layTiles, PATTERNS, PATTERN_DIAGONAL } from "@/lib/estimator/geometry/tilesFloor";
import type { TileLayout } from "@/lib/estimator/geometry/tilesFloor";
import { buildFloorDrawing, speckleDots } from "@/lib/estimator/geometry/floorDrawing";
import { swatchFor } from "@/lib/estimator/geometry/tileSwatches";
import type { TileSwatch } from "@/lib/estimator/geometry/tileSwatches";

const REVEAL_MS = 2200;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** The procedural texture a swatch asks for, as an SVG pattern in metres. */
function TexturePattern({ id, swatch }: { id: string; swatch: TileSwatch }) {
  if (swatch.texture === "speckle") {
    const size = 0.9;
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={size} height={size}>
        {speckleDots(46, size).map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={swatch.mark} opacity={0.55} />)}
      </pattern>
    );
  }
  if (swatch.texture === "veined") {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={1.2} height={1.2}>
        <path d="M0 0.35 C0.3 0.2 0.5 0.6 0.8 0.45 S1.1 0.3 1.2 0.4" fill="none" stroke={swatch.mark} strokeWidth={0.7} vectorEffect="non-scaling-stroke" opacity={0.55} />
        <path d="M0.2 1.2 C0.35 0.9 0.6 0.95 0.75 0.7 S1 0.5 1.2 0.6" fill="none" stroke={swatch.mark} strokeWidth={0.5} vectorEffect="non-scaling-stroke" opacity={0.4} />
      </pattern>
    );
  }
  if (swatch.texture === "wood") {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={0.6} height={0.1}>
        <path d="M0 0.03 Q0.15 0.012 0.3 0.03 T0.6 0.03" fill="none" stroke={swatch.mark} strokeWidth={0.6} vectorEffect="non-scaling-stroke" opacity={0.5} />
        <path d="M0 0.075 Q0.2 0.09 0.4 0.072 T0.6 0.078" fill="none" stroke={swatch.mark} strokeWidth={0.5} vectorEffect="non-scaling-stroke" opacity={0.35} />
      </pattern>
    );
  }
  return null;
}

const fmt = (n: number, dp = 1): string => n.toLocaleString(undefined, { maximumFractionDigits: dp });

/**
 * The floor from above: the room outline, every tile (whole ones in the tile
 * colour, cut ones hatched), the joints, the dimensions, and a pattern switcher
 * that re-lays the floor live. It lays from the numbers stored on the model
 * (`model.inputs`), so a saved estimate draws the floor it was priced from.
 * Switching the pattern here only previews it; `onUsePattern` (when given)
 * makes it the estimate's own pattern.
 */
export default function FloorPreview({
  model, onUsePattern,
}: {
  model: GeometryModel | null;
  onUsePattern?: (pattern: number) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const base = model?.inputs ?? null;
  const [pattern, setPattern] = useState<number | null>(null);
  const [turned, setTurned] = useState(false);
  const [reveal, setReveal] = useState(1);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // A new estimate pattern (typed in the form) takes over the preview.
  const basePattern = base?.pattern;
  useEffect(() => { setPattern(null); setTurned(false); }, [basePattern, model?.geometry]);

  const lays = useMemo(() => {
    if (!base) return null;
    const dir = turned ? (base.direction === 2 ? 1 : 2) : base.direction;
    return PATTERNS.map((p) => ({ p, res: layTiles({ ...base, pattern: p.value, direction: dir }) }));
  }, [base, turned]);

  if (!model || !base || !lays) {
    return <EmptyState title="Fill in the room and the tile to see the floor" text="The floor is laid out tile by tile from the sizes you give." />;
  }
  const shown = pattern ?? base.pattern;
  const current = lays.find((l) => l.p.value === shown) ?? lays[0];
  if (!current.res.ok) {
    return <div role="alert" className="est-warn">{current.res.error}</div>;
  }
  const layout: TileLayout = current.res.layout;
  const draw = buildFloorDrawing(layout);
  const swatch = swatchFor(base.tile_color);
  const vb = draw.viewBox;
  const s = layout.stats;
  const previewing = shown !== base.pattern;
  const texId = `tex${uid}`;
  const hatchId = `hatch${uid}`;
  const clipId = `clip${uid}`;
  const revealing = reveal < 1;
  const ink = "var(--ink)";
  const muted = "var(--muted)";

  const play = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / REVEAL_MS);
      setReveal(k);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    setReveal(0);
    raf.current = requestAnimationFrame(step);
  };

  return (
    <div>
      <div role="group" aria-label="Pattern" className="est-opts" style={{ margin: "0 0 12px" }}>
        {lays.map(({ p, res }) => (
          <button
            key={p.value} type="button" className="est-opt" aria-pressed={shown === p.value}
            style={{ minHeight: 44 }} onClick={() => setPattern(p.value)}
          >
            <b>{p.label}</b>
            <span>{res.ok ? `${res.layout.stats.n_order} tiles to order` : "does not fit"}{p.value === base.pattern ? " · in the estimate" : ""}</span>
          </button>
        ))}
      </div>

      <div
        style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel2)", padding: 8, overflow: "hidden" }}
      >
        <svg
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" preserveAspectRatio="xMidYMid meet"
          aria-label={`Floor plan: ${fmt(layout.inputs.length, 2)} by ${fmt(layout.inputs.width, 2)} metres, ${s.n_tile} whole tiles and ${s.n_cut} cut tiles in a ${current.p.label.toLowerCase()} pattern.`}
          style={{ display: "block", width: "100%", height: "auto", maxHeight: 430 }}
        >
          <defs>
            <TexturePattern id={texId} swatch={swatch} />
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width={draw.hatchPitch} height={draw.hatchPitch} patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={draw.hatchPitch} stroke={swatch.grout} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.75} />
            </pattern>
            <clipPath id={clipId}><rect x={vb.x} y={vb.y} width={Math.max(0.0001, (vb.w) * reveal)} height={vb.h} /></clipPath>
          </defs>

          <g clipPath={revealing ? `url(#${clipId})` : undefined}>
            <path d={draw.room} fill={swatch.grout} />
            {draw.whole.map((d, i) => d && <path key={i} d={d} fill={swatch.tones[i]} stroke={swatch.grout} strokeWidth={0.7} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
            {swatch.texture !== "plain" && <path d={draw.whole.join("")} fill={`url(#${texId})`} pointerEvents="none" />}
            {draw.strips && <path d={draw.strips} fill={swatch.tones[1]} stroke={swatch.grout} strokeWidth={0.7} vectorEffect="non-scaling-stroke" strokeLinejoin="round" opacity={0.92} />}
            {draw.cut && (
              <>
                <path d={draw.cut} fill={swatch.tones[0]} stroke={swatch.grout} strokeWidth={0.7} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                <path d={draw.cut} fill={`url(#${hatchId})`} pointerEvents="none" />
              </>
            )}
          </g>
          <path d={draw.room} fill="none" style={{ stroke: ink }} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />

          {/* dimensions */}
          <g style={{ stroke: muted, fill: muted }} strokeWidth={1} vectorEffect="non-scaling-stroke">
            <line x1={draw.dims.top.x1} x2={draw.dims.top.x2} y1={draw.dims.top.y} y2={draw.dims.top.y} vectorEffect="non-scaling-stroke" />
            <line x1={draw.dims.top.x1} x2={draw.dims.top.x1} y1={draw.dims.top.y - draw.fontSize * 0.3} y2={draw.dims.top.y + draw.fontSize * 0.3} vectorEffect="non-scaling-stroke" />
            <line x1={draw.dims.top.x2} x2={draw.dims.top.x2} y1={draw.dims.top.y - draw.fontSize * 0.3} y2={draw.dims.top.y + draw.fontSize * 0.3} vectorEffect="non-scaling-stroke" />
            <text x={(draw.dims.top.x1 + draw.dims.top.x2) / 2} y={draw.dims.top.y - draw.fontSize * 0.45} textAnchor="middle" fontSize={draw.fontSize} stroke="none">{draw.dims.top.label}</text>
            <line x1={draw.dims.left.x} x2={draw.dims.left.x} y1={draw.dims.left.y1} y2={draw.dims.left.y2} vectorEffect="non-scaling-stroke" />
            <line x1={draw.dims.left.x - draw.fontSize * 0.3} x2={draw.dims.left.x + draw.fontSize * 0.3} y1={draw.dims.left.y1} y2={draw.dims.left.y1} vectorEffect="non-scaling-stroke" />
            <line x1={draw.dims.left.x - draw.fontSize * 0.3} x2={draw.dims.left.x + draw.fontSize * 0.3} y1={draw.dims.left.y2} y2={draw.dims.left.y2} vectorEffect="non-scaling-stroke" />
            <text
              x={draw.dims.left.x - draw.fontSize * 0.45} y={(draw.dims.left.y1 + draw.dims.left.y2) / 2} textAnchor="middle" fontSize={draw.fontSize} stroke="none"
              transform={`rotate(-90 ${draw.dims.left.x - draw.fontSize * 0.45} ${(draw.dims.left.y1 + draw.dims.left.y2) / 2})`}
            >{draw.dims.left.label}</text>
          </g>
        </svg>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "10px 0 4px" }}>
        {!reduced && <Button size="sm" variant="secondary" style={{ minHeight: 44 }} onClick={play} disabled={revealing}>Watch it being laid</Button>}
        <Button size="sm" variant="secondary" style={{ minHeight: 44 }} onClick={() => setTurned((t) => !t)} aria-pressed={turned}>Turn the tiles 90°</Button>
        {previewing && onUsePattern && (
          <Button size="sm" variant="primary" style={{ minHeight: 44 }} onClick={() => onUsePattern(shown)}>Use {current.p.label.toLowerCase()} in the estimate</Button>
        )}
        {previewing && !onUsePattern && <span className="bpm-t-help" role="status">Previewing {current.p.label.toLowerCase()}; the estimate keeps its own pattern.</span>}
        {turned && <span className="bpm-t-help" role="status">Previewing the tiles turned 90°; the estimate keeps its own direction.</span>}
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, margin: "12px 0 0" }}>
        <Stat label="Whole tiles" value={String(s.n_tile)} />
        <Stat label="Cut tiles" value={String(s.n_cut)} tip="A tile that is trimmed by a wall, a corner or the border. Each cut counts as one tile; the waste allowance covers breakage." />
        <Stat label={`To order (+${s.waste_pct_used}%)`} value={String(s.n_order)} tip="Whole and cut tiles plus the waste allowance for the pattern. Diagonal needs the most." />
        <Stat label="Floor" value={`${fmt(s.area_floor, 2)} m²`} />
        <Stat label="Grout joint" value={`${fmt(s.len_joint, 1)} m`} />
        <Stat label="Skirting" value={`${fmt(s.len_skirting, 1)} m`} />
      </dl>
      <div className="bpm-t-help" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, background: swatch.tones[0], border: "1px solid var(--line)", display: "inline-block" }} />
        {fmt(layout.inputs.tileLength * 1000, 0)} × {fmt(layout.inputs.tileWidth * 1000, 0)} mm, {fmt(layout.inputs.grout * 1000, 1)} mm joint, {swatch.name.toLowerCase()}
        {current.p.value === PATTERN_DIAGONAL ? ", laid from the centre" : ""}
      </div>
      {layout.warnings.map((w) => <div key={w} className="est-warn" style={{ marginTop: 8 }}>{w}</div>)}
    </div>
  );
}

function Stat({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        {tip && <InfoTip label={label}>{tip}</InfoTip>}
      </dt>
      <dd style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{value}</dd>
    </div>
  );
}
