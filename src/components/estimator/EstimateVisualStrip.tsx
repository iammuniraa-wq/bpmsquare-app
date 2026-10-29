import InfoTip from "@/components/ui/InfoTip";
import { pillar } from "@/lib/theme";
import type { CompositionStrip, CustomerStrip } from "@/lib/estimator/visualStrip";
import { VISUAL_TIPS } from "@/lib/estimator/visualTips";
import type { EstimateComponent } from "@/lib/estimator/types";

// The estimate as a picture of its parts, for every template (docs/design/estimator-visual-for-every-estimate.md). Internal: a bar per
// group with its amount and share, the cost components as one stacked bar, a pill per line without a price. Customer: the groups as a
// static SVG with shares only. Colours are theme pillars, never literals here.

const GROUP_TONES = [pillar.blue, pillar.teal, pillar.amber, pillar.purple, pillar.green, pillar.red] as const;
const toneAt = (i: number): string => GROUP_TONES[i % GROUP_TONES.length].base;

const COMPONENT_TONE: Record<EstimateComponent, string> = {
  materials: pillar.blue.base, moulds: pillar.purple.base, labour: pillar.teal.base, overhead: pillar.amber.base,
  transport: pillar.green.base, erection: pillar.red.base, other: pillar.amber.fg,
};

const pctLabel = (pct: number, frac: number): string => (pct === 0 && frac > 0 ? "<1%" : `${pct}%`);

export default function EstimateVisualStrip({ strip, money }: { strip: CompositionStrip; money: (n: number) => string }) {
  return (
    <div className="est-strip" data-guide="estimate.strip">
      <div className="est-strip-title">
        <span className="bpm-t-label">Where the cost goes</span>
        <InfoTip label="where the cost goes">{VISUAL_TIPS.strip}</InfoTip>
      </div>
      <ul className="est-strip-rows" aria-label="Cost by group">
        {strip.groups.map((g, i) => (
          <li key={g.key} className="est-strip-row">
            <div className="est-strip-head">
              <span className="est-strip-label">{g.label}</span>
              <span className="est-strip-figs">{money(g.amount)} · {pctLabel(g.pct, g.frac)}</span>
            </div>
            <div className="est-strip-track" role="img" aria-label={`${g.label}: ${pctLabel(g.pct, g.frac)} of the cost`}>
              <div className="est-strip-fill" style={{ width: `${Math.max(g.frac * 100, 0.8)}%`, background: toneAt(i) }} />
            </div>
          </li>
        ))}
      </ul>
      {strip.components.length > 0 && (
        <div className="est-strip-comp">
          <div className="est-strip-stack" role="img" aria-label={`Cost split: ${strip.components.map((c) => `${c.label} ${pctLabel(c.pct, c.frac)}`).join(", ")}`}>
            {strip.components.map((c) => (
              <div key={c.key} style={{ flexGrow: c.frac, flexBasis: 0, background: COMPONENT_TONE[c.key as EstimateComponent] }} />
            ))}
          </div>
          <ul className="est-strip-legend">
            {strip.components.map((c) => (
              <li key={c.key}>
                <span aria-hidden className="est-strip-dot" style={{ background: COMPONENT_TONE[c.key as EstimateComponent] }} />
                {c.label} {pctLabel(c.pct, c.frac)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {strip.unpriced.length > 0 && (
        <ul className="est-strip-pills" aria-label="Lines without a price">
          {strip.unpriced.map((u) => <li key={u.code} className="est-strip-pill">No price yet: {u.label}</li>)}
        </ul>
      )}
    </div>
  );
}

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
