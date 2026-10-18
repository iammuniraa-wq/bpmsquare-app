"use client";

import Card from "@/components/ui/Card";
import type { CostModel, RiskResult, WhatIfResult } from "@/lib/estimator/simulation";
import { ESTIMATE_COMPONENTS, ESTIMATE_COMPONENT_LABEL } from "@/lib/estimator/types";
import { CostHistogram, Tornado } from "./RiskCharts";
import WhatIfPanel from "./WhatIfPanel";

const tile: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--panel2)", minWidth: 0 };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)", overflowWrap: "anywhere" }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: "var(--hint)" }}>{hint}</div>}
    </div>
  );
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (n: number, f: (n: number) => string) => (n === 0 ? f(0) : `${n > 0 ? "+" : "-"}${f(Math.abs(n))}`);

export default function RiskSection({
  model, risk, result, money, compact, mult, margin, baseMargin, target, price,
  onMult, onMargin, onTarget, onReset,
}: {
  model: CostModel;
  risk: RiskResult;
  result: WhatIfResult;
  money: (n: number) => string;
  compact: (n: number) => string;
  mult: Record<string, number>;
  margin: number;
  baseMargin: number;
  target: number;
  price: number;
  onMult: (k: string, v: number) => void;
  onMargin: (v: number) => void;
  onTarget: (v: number) => void;
  onReset: () => void;
}) {
  const parts = ESTIMATE_COMPONENTS.filter((k) => result.by_component[k] > 0.005 || model.base_by_component[k] > 0.005);
  return (
    <Card title="What if costs move?" padding={18}>
      <p className="bpm-t-help" style={{ margin: "0 0 12px" }}>
        Worked out in your browser from this estimate&apos;s lines and the template&apos;s rates. Nothing here is saved, and the quote price stays as quoted.
        A rate with a low and high range in the template is a risk driver; moving a driver re-prices every line that uses that rate, and overhead follows its base.
        Quantities, product-priced lines and manual lines are held fixed.
      </p>

      {model.drivers.length === 0 ? (
        <div className="bpm-t-help">This template has no risk ranges, so there is nothing to simulate. Add a low and high to rates in Settings, Estimate templates, Rates.</div>
      ) : (
        <>
          <WhatIfPanel
            drivers={model.drivers} multipliers={mult} marginPct={margin} baseMarginPct={baseMargin} targetPct={target}
            maxMargin={Math.max(50, Math.ceil(baseMargin * 2))} onMultiplier={onMult} onMargin={onMargin} onTarget={onTarget} onReset={onReset}
          />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "16px 0" }} aria-label="What-if result">
            <Tile label="Cost with these sliders" value={money(result.cost)} hint={`${signed(result.cost_delta, money)} against the estimate`} />
            <Tile label={`Price at ${result.margin_pct.toFixed(1)}% margin`} value={money(result.price)} hint={`${signed(result.price_delta, money)} against the quote`} />
            <Tile label="Price incl. VAT" value={money(result.price_incl_vat)} />
            <Tile label="Quote price (fixed)" value={money(price)} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>
            By component: {parts.map((k) => `${ESTIMATE_COMPONENT_LABEL[k]} ${money(result.by_component[k])}`).join(", ")}.
          </div>

          {risk.available ? (
            <>
              <h3 className="bpm-t-label" style={{ margin: "0 0 8px" }}>Risk run ({risk.runs.toLocaleString("en-GB")} draws, seed {risk.seed})</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
                <Tile label="Likely cost" value={money(risk.likely)} />
                <Tile label="Cost range (P10 to P90)" value={`${compact(risk.p10)} to ${compact(risk.p90)}`} hint={`Median ${compact(risk.p50)}`} />
                <Tile label="Chance cost exceeds the quote price" value={pct(risk.prob_over_price)} />
                <Tile label={`Chance margin falls under ${risk.target_margin_pct.toFixed(1)}%`} value={pct(risk.prob_below_target)} hint="Markup on cost" />
              </div>
              <CostHistogram risk={risk} compact={compact} />
              <h3 className="bpm-t-label" style={{ margin: "16px 0 8px" }}>What moves the cost most</h3>
              <Tornado risk={risk} compact={compact} />
              <div className="bpm-t-help" style={{ marginTop: 10 }}>
                The same seed gives the same result every time, so a number here can be reproduced. Each driver is sampled from a triangle between its low, its template value and its high.
              </div>
            </>
          ) : (
            <div className="bpm-t-help">{risk.reason}</div>
          )}
        </>
      )}
    </Card>
  );
}
