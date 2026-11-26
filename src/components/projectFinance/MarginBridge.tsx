import { money, signedMoney } from "@/lib/contractProjects/format";
import { bridgeBars, bridgeExtent, type BridgeBar } from "@/lib/projectFinance/bridge";
import type { BridgeStep } from "@/lib/projectFinance/rules";
import { c } from "@/lib/theme";
import { toneTokens } from "@/lib/ui/tone";
import s from "./projectFinance.module.css";

const W = 720, H = 230, TOP = 16, BOTTOM = 56, PAD = 8;

/** The fill of a bar: totals are information, a gain is good, a loss is bad. */
const fillOf = (b: BridgeBar): string => toneTokens(b.kind === "delta" ? ((b.amount ?? 0) >= 0 ? "good" : "bad") : "info").edge;

/**
 * The margin bridge (design section 11): baseline margin to forecast margin in a few steps. A waterfall where there is room, signed rows on a
 * phone (the two are the same data; CSS shows one). A step that needs the ERP cost and does not have it is hatched and says so, in words.
 */
export default function MarginBridge({ steps, currency }: { steps: readonly BridgeStep[]; currency: string | null }) {
  const bars = bridgeBars(steps);
  const { min, max } = bridgeExtent(bars);
  const plotH = H - TOP - BOTTOM;
  const y = (v: number) => TOP + ((max - v) / (max - min)) * plotH;
  const slot = (W - PAD * 2) / bars.length;
  const barW = Math.min(56, slot * 0.62);
  const summary = bars.map((b) => `${b.label}: ${b.amount === null ? "not connected" : money(b.amount, currency)}`).join(", ");

  return (
    <div data-guide="pf.bridge">
      <div className={s.bridgeWide}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Margin bridge. ${summary}`} style={{ display: "block", maxHeight: 260 }}>
          <defs>
            <pattern id="pf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={c.hint} strokeWidth="2" />
            </pattern>
          </defs>
          <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke={c.line} strokeWidth="1" />
          {bars.map((b, i) => {
            const x = PAD + slot * i + (slot - barW) / 2;
            const top = y(Math.max(b.from, b.to)), bottom = y(Math.min(b.from, b.to));
            const h = Math.max(b.hatched ? 18 : 2, bottom - top);
            const yTop = b.hatched ? y(b.from) - h / 2 : top;
            return (
              <g key={b.id}>
                {b.hatched
                  ? <rect x={x} y={yTop} width={barW} height={h} fill="url(#pf-hatch)" stroke={c.hint} strokeWidth="1" strokeDasharray="3 3" rx="3" />
                  : <rect x={x} y={yTop} width={barW} height={h} fill={fillOf(b)} rx="3" />}
                <text x={x + barW / 2} y={H - BOTTOM + 14} textAnchor="middle" fontSize="10.5" fill={c.muted}>{b.label.length > 18 ? `${b.label.slice(0, 17)}…` : b.label}</text>
                <text x={x + barW / 2} y={H - BOTTOM + 28} textAnchor="middle" fontSize="11" fontWeight="600" fill={c.ink}>
                  {b.hatched ? (b.needsErp ? "Needs ERP cost" : "Not known") : b.kind === "delta" ? signedMoney(b.amount, null) : money(b.amount, null)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ul className={s.bridgeRows} aria-label="Margin bridge, step by step">
        {bars.map((b) => (
          <li key={b.id}>
            <span>{b.label}</span>
            <b className={s.mono} style={{ color: b.amount === null ? c.hint : c.ink }}>
              {b.amount === null ? (b.needsErp ? "Needs ERP cost" : "Not known") : b.kind === "delta" ? signedMoney(b.amount, currency) : money(b.amount, currency)}
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}
