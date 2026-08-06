"use client";

import { c } from "@/lib/theme";

export type DonutSlice = {
  label: string;
  value: number;
  /** Any CSS colour. Callers should pass a theme token (pillar.*.base) or a
   * CSS variable rather than inventing a hex. */
  color: string;
};

/**
 * Small SVG donut with a centred total and a legend — used above the WFM
 * table views to give a proportional read before the row detail. Pure SVG
 * (no charting dependency): a donut is one circle per slice with a
 * stroke-dasharray arc and a rotating offset, which is less code than
 * wiring up a library and has no bundle cost.
 *
 * `onSelect` makes the legend (and slices) act as a filter control — the
 * currently applied filter is passed back as `selected` so it can be shown
 * as active. Omit both for a purely informational chart.
 */
export default function Donut({
  slices,
  title,
  centerLabel,
  size = 132,
  thickness = 16,
  selected,
  onSelect,
}: {
  slices: DonutSlice[];
  title?: string;
  /** Defaults to "total" under the summed value. */
  centerLabel?: string;
  size?: number;
  thickness?: number;
  selected?: string | null;
  onSelect?: (label: string | null) => void;
}) {
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((s, x) => s + x.value, 0);

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = shown.map((s) => {
    const fraction = s.value / total;
    const arc = { ...s, dash: fraction * circumference, offset };
    offset += fraction * circumference;
    return arc;
  });

  const clickable = !!onSelect;
  const toggle = (label: string) => onSelect?.(selected === label ? null : label);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={c.line} strokeWidth={thickness}
          />
          {arcs.map((a) => (
            <circle
              key={a.label}
              cx={size / 2} cy={size / 2} r={radius}
              fill="none"
              stroke={a.color}
              strokeWidth={thickness}
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={-a.offset}
              opacity={selected && selected !== a.label ? 0.3 : 1}
              onClick={clickable ? () => toggle(a.label) : undefined}
              style={{ cursor: clickable ? "pointer" : "default", transition: "opacity 0.15s" }}
            >
              <title>{`${a.label}: ${a.value}`}</title>
            </circle>
          ))}
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: c.ink, lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: 10.5, color: c.hint, marginTop: 2 }}>{centerLabel ?? "total"}</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        {title && <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>{title}</div>}
        {shown.length === 0 && <div style={{ fontSize: 12, color: c.hint }}>Nothing to show yet.</div>}
        {shown.map((s) => {
          const active = selected === s.label;
          return (
            <div
              key={s.label}
              onClick={clickable ? () => toggle(s.label) : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 7, fontSize: 12,
                cursor: clickable ? "pointer" : "default",
                opacity: selected && !active ? 0.5 : 1,
                fontWeight: active ? 700 : 400,
                transition: "opacity 0.15s",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              <span style={{ color: c.muted, whiteSpace: "nowrap" }}>{s.label}</span>
              <span style={{ color: c.ink, fontWeight: 700 }}>{s.value}</span>
              <span style={{ color: c.hint, fontSize: 11 }}>{Math.round((s.value / total) * 100)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
