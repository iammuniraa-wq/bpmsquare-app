"use client";

import { useState } from "react";
import { c } from "@/lib/theme";

export type DonutSlice = {
  label: string;
  value: number;
  /** Any CSS colour. Callers should pass a theme token (pillar.*.base) or a
   * CSS variable rather than inventing a hex. */
  color: string;
};

const TAU = Math.PI * 2;
const POP_PX = 7; // how far a hovered wedge lifts out of the ring

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** Donut wedge (outer arc → inner arc → close) between two angles. */
function wedgePath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number) {
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = polar(cx, cy, rOuter, a0);
  const o1 = polar(cx, cy, rOuter, a1);
  const i1 = polar(cx, cy, rInner, a1);
  const i0 = polar(cx, cy, rInner, a0);
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${i0.x} ${i0.y}`,
    "Z",
  ].join(" ");
}

/**
 * Small interactive SVG donut with a centred readout and a legend — used
 * above the WFM table views to give a proportional read before the row
 * detail. Pure SVG (no charting dependency): each slice is an arc wedge
 * path, which is what lets a hovered slice lift out of the ring — a
 * stroke-dasharray circle can't be moved independently.
 *
 * Hovering a slice (or its legend row) pops that wedge outward, brightens
 * it, dims the rest, and swaps the centre readout to that slice's label,
 * count and share. `onSelect` additionally makes it a filter control; the
 * applied filter comes back as `selected` so it renders as active.
 */
export default function Donut({
  slices,
  title,
  centerLabel,
  size = 132,
  thickness = 16,
  selected,
  onSelect,
  formatValue = String,
}: {
  slices: DonutSlice[];
  title?: string;
  /** Defaults to "total" under the summed value. */
  centerLabel?: string;
  size?: number;
  thickness?: number;
  selected?: string | null;
  onSelect?: (label: string | null) => void;
  /** How a value reads wherever it is printed (centre, legend, tooltip).
   *  Counts need nothing; minutes want h:mm. Shares are always computed
   *  from the raw value. */
  formatValue?: (value: number) => string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((s, x) => s + x.value, 0);

  // Leave room for a popped wedge so it can't clip at the viewBox edge.
  const box = size + POP_PX * 2;
  const cx = box / 2;
  const cy = box / 2;
  const rOuter = (size - thickness) / 2 + thickness / 2;
  const rInner = rOuter - thickness;

  const clickable = !!onSelect;
  const toggle = (label: string) => onSelect?.(selected === label ? null : label);

  // The centre shows the hovered slice when there is one, otherwise the total.
  const focus = shown.find((s) => s.label === (hovered ?? selected)) ?? null;

  let angle = -Math.PI / 2; // start at 12 o'clock
  const arcs = shown.map((s) => {
    const sweep = (s.value / total) * TAU;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const mid = (a0 + a1) / 2;
    return {
      ...s,
      // A lone 100% slice can't be drawn as a wedge (start and end angles
      // coincide) — render it as a plain ring instead.
      full: shown.length === 1,
      d: wedgePath(cx, cy, rOuter, rInner, a0, a1),
      // Static hover target, extended to cover the popped-out position too.
      hit: wedgePath(cx, cy, rOuter + POP_PX, rInner, a0, a1),
      dx: Math.cos(mid) * POP_PX,
      dy: Math.sin(mid) * POP_PX,
    };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: box, height: box, flexShrink: 0 }}>
        <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} role="img" aria-label={title}>
          <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke={c.line} strokeWidth={thickness} />
          {/* Two layers per slice. The VISIBLE wedge moves on hover but takes
              no pointer events; a STATIC, invisible hit wedge underneath owns
              them. Putting the handlers on the moving element instead makes
              it pop out from under the cursor, which fires mouseleave, which
              moves it back under the cursor, which fires mouseenter -- an
              endless flicker loop. The hit wedge also extends POP_PX beyond
              the ring so the cursor stays "on" the slice once it has popped. */}
          {arcs.map((a) => {
            const isHovered = hovered === a.label;
            const dimmed = (hovered && !isHovered) || (!hovered && selected && selected !== a.label);
            const lifted = isHovered || selected === a.label;
            const style: React.CSSProperties = {
              transform: lifted ? `translate(${a.dx}px, ${a.dy}px)` : undefined,
              pointerEvents: "none",
            };
            return a.full ? (
              <circle
                key={a.label}
                className={`donut-slice${isHovered ? " is-hovered" : ""}`}
                style={style}
                opacity={dimmed ? 0.32 : 1}
                cx={cx} cy={cy} r={(rOuter + rInner) / 2}
                fill="none" stroke={a.color} strokeWidth={thickness}
              />
            ) : (
              <path
                key={a.label}
                className={`donut-slice${isHovered ? " is-hovered" : ""}`}
                style={style}
                opacity={dimmed ? 0.32 : 1}
                d={a.d}
                fill={a.color}
              />
            );
          })}
          {arcs.map((a) => (
            <path
              key={`hit-${a.label}`}
              d={a.hit}
              fill="transparent"
              style={{ pointerEvents: "all", cursor: clickable ? "pointer" : "default" }}
              onMouseEnter={() => setHovered(a.label)}
              onMouseLeave={() => setHovered(null)}
              onClick={clickable ? () => toggle(a.label) : undefined}
            >
              <title>{`${a.label}: ${formatValue(a.value)}`}</title>
            </path>
          ))}
        </svg>

        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none", padding: "0 18px",
        }}>
          <div style={{ fontSize: focus ? 20 : 22, fontWeight: 800, color: focus ? focus.color : c.ink, lineHeight: 1 }}>
            {formatValue(focus ? focus.value : total)}
          </div>
          <div style={{
            fontSize: 10, color: c.hint, marginTop: 3, textAlign: "center",
            lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%",
          }}>
            {focus ? `${focus.label} · ${Math.round((focus.value / total) * 100)}%` : (centerLabel ?? "total")}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        {title && <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>{title}</div>}
        {shown.length === 0 && <div style={{ fontSize: 12, color: c.hint }}>Nothing to show yet.</div>}
        {shown.map((s) => {
          const active = selected === s.label;
          const isHovered = hovered === s.label;
          return (
            <div
              key={s.label}
              className={`donut-legend-row${clickable ? " is-interactive" : ""}`}
              onMouseEnter={() => setHovered(s.label)}
              onMouseLeave={() => setHovered(null)}
              onClick={clickable ? () => toggle(s.label) : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 7, fontSize: 12,
                cursor: clickable ? "pointer" : "default",
                opacity: hovered && !isHovered ? 0.55 : selected && !active ? 0.55 : 1,
                fontWeight: active || isHovered ? 700 : 400,
              }}
            >
              <span style={{
                width: 9, height: 9, borderRadius: "50%", background: s.color, flexShrink: 0,
                transform: isHovered || active ? "scale(1.35)" : undefined,
                transition: "transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)",
              }} />
              <span style={{ color: c.muted, whiteSpace: "nowrap" }}>{s.label}</span>
              <span style={{ color: c.ink, fontWeight: 700 }}>{formatValue(s.value)}</span>
              <span style={{ color: c.hint, fontSize: 11 }}>{Math.round((s.value / total) * 100)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
