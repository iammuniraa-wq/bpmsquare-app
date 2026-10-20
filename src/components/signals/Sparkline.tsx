// A tiny score history, drawn as an inline SVG from the theme's own variables
// (no hex, no chart library). It is a cue next to words, never the only carrier
// of meaning: the aria-label says where the score went and rows also print the
// "Warming / Cooling / Steady" text.

const TONE: Record<"warming" | "cooling" | "steady", string> = {
  warming: "var(--greenink, currentColor)",
  cooling: "var(--amberink, currentColor)",
  steady: "var(--muted, currentColor)",
};

export default function Sparkline({ values, tone = "steady", width = 64, height = 22, weeks = true }: {
  values: number[]; tone?: "warming" | "cooling" | "steady"; width?: number; height?: number; weeks?: boolean;
}) {
  const v = values.length >= 2 ? values : [0, ...values, 0].slice(0, 2);
  const max = Math.max(10, ...v);
  const pad = 3;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (v.length - 1);
  const y = (s: number) => height - pad - (s / max) * (height - pad * 2);
  const pts = v.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(" ");
  const last = v[v.length - 1];
  const label = `Score ${weeks ? `over the last ${v.length} weeks` : "history"}: ${v[0]} then ${last} now`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} style={{ color: TONE[tone], flex: "none" }}>
      <title>{label}</title>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(v.length - 1)} cy={y(last)} r="2.2" fill="currentColor" />
    </svg>
  );
}
