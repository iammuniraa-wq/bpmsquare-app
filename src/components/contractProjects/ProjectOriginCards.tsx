import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import { money, pct, signedMoney } from "@/lib/contractProjects/format";
import type { BidAgainstBudget } from "@/lib/contractProjects/originServer";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

// The card on the Overview of a project that came from a tender: how the budget now stands against the cost recorded when the winning bid
// went in. Where the project came from is the page header's origin line (a back link to the tender), not a card. Labels and values only;
// the explanations are behind the "i".

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 13, minHeight: 28, flexWrap: "wrap" };

export function BidAgainstBudgetCard({ bid, currency }: { bid: BidAgainstBudget; currency: string | null }) {
  if (!bid.available) {
    return (
      <Card title="Bid against budget" info={PROJECT_TIPS.bidAgainstBudget} padding={16} style={{ minWidth: 0 }}>
        <div data-guide="cp.bidvs" style={{ fontSize: 13, color: c.hint }}>Bid version {bid.version_no} was submitted before bid costs were stored, so there is nothing to compare.</div>
      </Card>
    );
  }
  const f = bid.figures;
  const grew = f.delta > 0;
  const tone = f.delta === 0 ? "blue" : grew ? "amber" : "green";
  return (
    <Card title="Bid against budget" info={PROJECT_TIPS.bidAgainstBudget} padding={16} style={{ minWidth: 0 }}>
      <dl data-guide="cp.bidvs" style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0 }}>
        <div style={row}><dt style={{ color: c.muted }}>Cost in bid {bid.version_no}</dt><dd style={{ margin: 0, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{money(f.bid_cost, currency)}</dd></div>
        <div style={row}><dt style={{ color: c.muted }}>Budget now</dt><dd style={{ margin: 0, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{money(f.budget, currency)}</dd></div>
        <div style={row}>
          <dt style={{ color: c.muted }}>Difference</dt>
          <dd style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontVariantNumeric: "tabular-nums", color: c.ink }}>
            {signedMoney(f.delta, currency)}{f.delta_pct !== null ? ` · ${f.delta > 0 ? "+" : ""}${pct(f.delta_pct)}` : ""}
            <StatusPill label={f.delta === 0 ? "On the bid" : grew ? "Over the bid" : "Under the bid"} tone={tone} />
          </dd>
        </div>
        <div style={row}><dt style={{ color: c.muted }}>Margin at bid → planned now</dt><dd style={{ margin: 0, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{pct(f.bid_margin_pct)} → {pct(f.planned_margin_pct)}</dd></div>
      </dl>
    </Card>
  );
}
