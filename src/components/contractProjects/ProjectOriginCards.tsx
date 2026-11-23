import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import { money, pct, signedMoney } from "@/lib/contractProjects/format";
import { coverageText, type MarginCoverage } from "@/lib/contractProjects/budget";
import type { BidAgainstBudget, QuoteOrigin } from "@/lib/contractProjects/originServer";
import { PROJECT_SOURCE_LABEL } from "@/lib/contractProjects/types";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

// The card on the Overview of a project that came from a tender: how the budget now stands against the cost recorded when the winning bid
// went in. Where the project came from is the page header's origin line (a back link to the tender), not a card. Labels and values only;
// the explanations are behind the "i".

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 13, minHeight: 28, flexWrap: "wrap" };

/** What a person on the project may open from the origin card: each link is offered only where the module is on and the caller may view it. */
export type QuoteOriginLinks = { quote: boolean; estimate: boolean; deal: boolean };

/** The card on the Overview of a project made from a quote: the quote, the estimate it was made from and the deal, each a link where allowed. */
export function QuoteOriginCard({ origin, links, currency }: { origin: QuoteOrigin; links: QuoteOriginLinks; currency: string | null }) {
  const quoteLabel = `${PROJECT_SOURCE_LABEL[origin.type]}${origin.ref ? ` ${origin.ref}` : ""}`;
  const link = (href: string, text: string, on: boolean) => (on ? <Link href={href} style={{ color: c.accent, textDecoration: "none", display: "inline-flex", alignItems: "center", minHeight: 44 }}>{text}</Link> : <span style={{ color: c.ink }}>{text}</span>);
  return (
    <Card title="Made from" info={PROJECT_TIPS.quoteOrigin} padding={16} style={{ minWidth: 0 }}>
      <dl data-guide="cp.quote_origin" style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0 }}>
        <div style={row}><dt style={{ color: c.muted }}>{origin.type === "standard_quote" ? "Standard quote" : "Quotation"}</dt><dd style={{ margin: 0 }}>{link(origin.type === "standard_quote" ? ROUTES.standardQuote(origin.id) : ROUTES.quotation(origin.id), origin.ref ?? quoteLabel, links.quote)}</dd></div>
        {origin.total !== null && <div style={row}><dt style={{ color: c.muted }}>Quote total</dt><dd style={{ margin: 0, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{money(origin.total, currency)}</dd></div>}
        {origin.estimate && <div style={row}><dt style={{ color: c.muted }}>Estimate</dt><dd style={{ margin: 0 }}>{link(ROUTES.estimate(origin.estimate.id), origin.estimate.ref ?? origin.estimate.name, links.estimate)}</dd></div>}
        {origin.deal && <div style={row}><dt style={{ color: c.muted }}>Deal</dt><dd style={{ margin: 0 }}>{link(ROUTES.pipelineDetail(origin.deal.id), origin.deal.ref ?? origin.deal.title, links.deal)}</dd></div>}
      </dl>
    </Card>
  );
}

/** `coverage` is given while lines still wait for a cost: the bid and planned margins are then not comparable, so none is shown. */
export function BidAgainstBudgetCard({ bid, currency, coverage = null }: { bid: BidAgainstBudget; currency: string | null; coverage?: MarginCoverage | null }) {
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
        <div style={row}><dt style={{ color: c.muted }}>Margin at bid → planned now</dt><dd style={{ margin: 0, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{coverage ? `Not complete · ${coverageText(coverage)}` : `${pct(f.bid_margin_pct)} → ${pct(f.planned_margin_pct)}`}</dd></div>
      </dl>
    </Card>
  );
}
