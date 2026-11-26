import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { standingBars } from "@/lib/site/standingBars";
import { fmtMoney } from "@/lib/site/clientHelpers";
import type { LineStanding } from "@/lib/site/standing";

const SEG_COLOR: Record<string, string> = { posted: "var(--greenink)", recorded: "var(--blueink)", this: "var(--amberink)" };

/**
 * The expense's budget line as one bar: what is posted by the ERP, what other approved expenses recorded, and this expense, against the
 * line's allocated cost, with the committed amount as a tick. Only drawn for the people who manage the money; a site person never sees it.
 */
export default function LineStandingBar({ standing }: { standing: LineStanding }) {
  const bars = standingBars(standing);
  const budget = standing.budget;
  return (
    <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10 }} aria-label="Budget line" data-guide="site.expense.standing">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14, color: c.ink }}>{standing.label}</strong>
        <span style={{ fontSize: 13, color: bars.over > 0 ? "var(--redink)" : c.muted }}>
          {budget === null ? "No cost allocated yet" : bars.over > 0 ? `Over by ${fmtMoney(bars.over, standing.currency)}` : `${fmtMoney(bars.left, standing.currency)} left`}
        </span>
      </div>
      <div style={{ position: "relative", height: 14, borderRadius: 7, background: c.panel2, overflow: "hidden", display: "flex" }} role="img"
        aria-label={`Used ${fmtMoney(bars.used, standing.currency)}${budget !== null ? ` of ${fmtMoney(budget, standing.currency)}` : ""}`}>
        {bars.segments.map((s) => <div key={s.key} style={{ width: `${s.pct}%`, background: SEG_COLOR[s.key] }} title={`${s.label} ${fmtMoney(s.amount, standing.currency)}`} />)}
        {standing.committed !== null && standing.committed > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${Math.min(100, (standing.committed / bars.scale) * 100)}%`, width: 2, background: c.ink }} title={`Committed ${fmtMoney(standing.committed, standing.currency)}`} />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12.5, color: c.muted }}>
        <span>Budget {fmtMoney(budget, standing.currency)}</span>
        {standing.committed !== null && <span>Committed {fmtMoney(standing.committed, standing.currency)}</span>}
        <span style={{ color: "var(--greenink)" }}>Posted {fmtMoney(standing.posted ?? 0, standing.currency)}</span>
        <span style={{ color: "var(--blueink)" }}>Recorded {fmtMoney(standing.recorded_others, standing.currency)}</span>
        <span style={{ color: "var(--amberink)" }}>This expense {fmtMoney(standing.this_one, standing.currency)}</span>
      </div>
    </section>
  );
}
