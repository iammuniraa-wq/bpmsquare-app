import { pillar } from "@/lib/theme";
import type { CustomerStrip } from "@/lib/estimator/visualStrip";

// The estimate as a picture of its parts (docs/design/estimator-visual-for-every-estimate.md). The internal breakdown is the Price card's
// own list (one bar per quote line, workspace/PriceCard.tsx); this file keeps the bar colours and the customer-facing SVG, which shows
// shares only. Colours are theme pillars, never literals here.

const GROUP_TONES = [pillar.blue, pillar.teal, pillar.amber, pillar.purple, pillar.green, pillar.red] as const;
/** The bar colour of the i-th group, the same on the Price card and on the customer's strip. */
export const groupTone = (i: number): string => GROUP_TONES[i % GROUP_TONES.length].base;
const toneAt = groupTone;

const pctLabel = (pct: number, frac: number): string => (pct === 0 && frac > 0 ? "<1%" : `${pct}%`);

const ROW_H = 30;
const SVG_W = 320;
const LABEL_MAX = 34;
const short = (s: string): string => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s);

/** The customer-facing strip: one static SVG, the groups as bars with their share and no amount. */
export function CustomerVisualStrip({ strip }: { strip: CustomerStrip }) {
  const h = strip.groups.length * ROW_H + 4;
  const summary = strip.groups.map((g) => `${g.label} ${pctLabel(g.pct, g.frac)}`).join(", ");
  return (
    <svg viewBox={`0 0 ${SVG_W} ${h}`} width="100%" role="img" aria-label={`How the price is made up: ${summary}`} className="est-strip-svg" style={{ maxWidth: 480, display: "block" }}>
      {strip.groups.map((g, i) => {
        const y = 2 + i * ROW_H;
        return (
          <g key={g.key}>
            <text x={0} y={y + 11} style={{ fontSize: 11, fill: "var(--ink)" }}>{short(g.label)}</text>
            <text x={SVG_W} y={y + 11} textAnchor="end" style={{ fontSize: 11, fill: "var(--muted)" }}>{pctLabel(g.pct, g.frac)}</text>
            <rect x={0} y={y + 16} width={SVG_W} height={8} rx={4} style={{ fill: "var(--line)" }} />
            <rect x={0} y={y + 16} width={Math.max(g.frac * SVG_W, 3)} height={8} rx={4} fill={toneAt(i)} />
          </g>
        );
      })}
    </svg>
  );
}
