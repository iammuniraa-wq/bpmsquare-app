import { RING_TONE_VAR, type RingTone } from "./Ring";

/**
 * Points -> SVG path, smoothed with midpoint quadratic curves. Fewer than two finite points is a flat line, so the shape never
 * collapses. Exported so the maths is tested without rendering.
 */
export function sparklinePath(values: number[], width: number, height: number, pad = 4): { d: string; last: { x: number; y: number } } {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) {
    const y = height / 2;
    return { d: `M${pad} ${y} L${width - pad} ${y}`, last: { x: width - pad, y } };
  }
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((n, i) => ({
    x: pad + (i * (width - pad * 2)) / (v.length - 1),
    y: height - pad - ((n - min) / span) * (height - pad * 2),
  }));
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2;
    const my = (pts[i - 1].y + pts[i].y) / 2;
    d += ` Q${pts[i - 1].x.toFixed(1)} ${pts[i - 1].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` T${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return { d, last };
}

/** A tiny trend line with a dot on the latest value. Decorative unless `label` is given. Server-safe, token-coloured. */
export default function Sparkline({ values, width = 112, height = 36, tone = "violet", label }: {
  values: number[];
  width?: number;
  height?: number;
  tone?: RingTone;
  /** Spoken description of the trend; without it the SVG is hidden from assistive tech. */
  label?: string;
}) {
  const { d, last } = sparklinePath(values, width, height);
  const color = RING_TONE_VAR[tone];
  return (
    <svg
      className="rich-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible", flex: "none" }}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    >
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={3.5} fill={color} />
    </svg>
  );
}
