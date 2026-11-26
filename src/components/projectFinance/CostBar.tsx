import { money } from "@/lib/contractProjects/format";
import type { ProjectFinance } from "@/lib/projectFinance/model";
import { pillar } from "@/lib/theme";
import { toneTokens } from "@/lib/ui/tone";
import { NOT_CONNECTED, NextStep } from "./FinanceBits";
import s from "./projectFinance.module.css";

/**
 * The cost bar (design section 11), one scale: Actual (solid), Committed (lighter), Estimate to go (hatched, because it is an estimate), a mark
 * at the approved budget and one at the contract value; the part past the budget is red. While the ERP cost is not connected the bar shows what
 * is real, the awards in Buy-out against the budget, and the rest says "Not connected" with the one next step.
 */
export default function CostBar({ finance: f, isAdmin }: { finance: ProjectFinance; isAdmin: boolean }) {
  const cur = f.currency;
  const budget = f.budget;
  if (budget === null) return <p className={s.quiet} role="status">Baseline not approved. The cost bar starts once the first budget is approved.</p>;

  const cost = f.cost;
  const connected = f.costConnected && cost.actual !== null && cost.committed !== null && cost.etg !== null && cost.eac !== null;
  const eac = connected ? (cost.eac as number) : null;
  const scale = Math.max(budget, f.contractValue, eac ?? 0, f.buyout.awarded, 1) * 1.04;
  const w = (n: number) => `${Math.max(0, (n / scale) * 100)}%`;
  const at = (n: number) => `${Math.min(98, Math.max(2, (n / scale) * 100))}%`;
  const solid = toneTokens("info").edge;
  const light = toneTokens("info").bg;
  const over = eac !== null && eac > budget ? eac - budget : 0;

  return (
    <div data-guide="pf.cost_bar" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className={s.bar} role="img" aria-label={connected ? `Forecast cost ${money(eac, cur)} against a budget of ${money(budget, cur)}` : `Budget ${money(budget, cur)}, awarded in buy-out ${money(f.buyout.awarded, cur)}`} style={{ position: "relative" }}>
        {connected ? (
          <>
            <div className={s.seg} style={{ width: w(cost.actual as number), background: solid }} title={`Actual ${money(cost.actual, cur)}`} />
            <div className={s.seg} style={{ width: w(cost.committed as number), background: light, boxShadow: `inset 0 0 0 1px ${solid}` }} title={`Committed ${money(cost.committed, cur)}`} />
            <div className={`${s.seg} ${s.hatch}`} style={{ width: w(cost.etg as number), backgroundColor: solid, opacity: 0.55 }} title={`Estimate to go ${money(cost.etg, cur)}`} />
            {over > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: at(budget), width: w(over), background: pillar.red.base, opacity: 0.45 }} aria-hidden="true" />}
          </>
        ) : (
          f.buyout.awarded > 0 && <div className={s.seg} style={{ width: w(f.buyout.awarded), background: solid }} title={`Awarded in Buy-out ${money(f.buyout.awarded, cur)}`} />
        )}
      </div>
      <div className={s.marks} aria-hidden="true">
        <span className={s.mark} style={{ left: at(budget) }}><span className={s.markTick} />Budget {money(budget, cur)}</span>
        {f.contractValue > 0 && Math.abs(f.contractValue - budget) / scale > 0.12 && (
          <span className={s.mark} style={{ left: at(f.contractValue) }}><span className={s.markTick} />Contract {money(f.contractValue, cur)}</span>
        )}
      </div>
      {connected ? (
        <>
          <ul className={s.legend}>
            <li><span className={s.swatch} style={{ background: solid }} />Actual {money(cost.actual, cur)}</li>
            <li><span className={s.swatch} style={{ background: light, boxShadow: `inset 0 0 0 1px ${solid}` }} />Committed {money(cost.committed, cur)}</li>
            <li><span className={`${s.swatch} ${s.hatch}`} style={{ backgroundColor: solid, opacity: 0.55 }} />Estimate to go {money(cost.etg, cur)}</li>
          </ul>
          {over > 0 && <div role="status" style={{ fontSize: 13, color: pillar.red.fg, fontWeight: 600 }}>Over the budget by {money(over, cur)}</div>}
          {cost.firmPct !== null && <p className={s.quiet}>{`${cost.firmPct}% of the forecast is spent or committed.`}</p>}
        </>
      ) : (
        <ul className={s.legend}>
          <li><span className={s.swatch} style={{ background: solid }} />Awarded in Buy-out {money(f.buyout.awarded, cur)}</li>
          <li>Actual, committed and estimate to go: <b>{NOT_CONNECTED}</b></li>
          <li className={s.quiet}><NextStep isAdmin={isAdmin} /></li>
        </ul>
      )}
    </div>
  );
}
