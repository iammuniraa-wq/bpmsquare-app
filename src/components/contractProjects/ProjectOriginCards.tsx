import Link from "next/link";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import { ROUTES } from "@/lib/constants";
import { day, money, pct, signedMoney } from "@/lib/contractProjects/format";
import type { BidAgainstBudget, ProjectOrigin } from "@/lib/contractProjects/originServer";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

// Two small cards on the Overview of a project that came from a tender: where it came from (read-only links) and how the budget now
// stands against the cost recorded when the winning bid went in. Labels and values only; the explanations are behind the "i".

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 13, minHeight: 28, flexWrap: "wrap" };

const link: React.CSSProperties = { color: c.accent, display: "inline-flex", alignItems: "center", minHeight: 28 };

export function ProjectOriginCard({ origin }: { origin: ProjectOrigin }) {
  const deal = origin.deal;
  const dealHref = deal ? ROUTES.pipelineDetail(deal.id) : null;
  return (
    <Card title="Came from" info={PROJECT_TIPS.origin} padding={16} style={{ minWidth: 0 }}>
      <dl data-guide="cp.origin" style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0 }}>
        {deal && dealHref && (
          <div style={row}><dt style={{ color: c.muted }}>Tender</dt><dd style={{ margin: 0 }}><Link href={dealHref} data-guide="cp.origin.deal" style={link}>{deal.ref ?? deal.title}</Link></dd></div>
        )}
        <div style={row}>
          <dt style={{ color: c.muted }}>Winning bid</dt>
          <dd style={{ margin: 0, color: c.ink }}>
            {origin.bid && dealHref ? (
              <Link href={`${dealHref}?tab=bids`} data-guide="cp.origin.bid" style={link}>Version {origin.bid.version_no} · {day(origin.bid.submitted_at)} · {money(origin.bid.total, origin.bid.currency)}</Link>
            ) : "No bid version"}
          </dd>
        </div>
        <div style={row}>
          <dt style={{ color: c.muted }}>BOQ file</dt>
          <dd style={{ margin: 0, color: c.ink, overflowWrap: "anywhere" }}>
            {origin.boq && dealHref ? <Link href={`${dealHref}?tab=boq`} data-guide="cp.origin.boq" style={link}>{origin.boq.file_name}</Link> : "No BOQ file"}
          </dd>
        </div>
        <div style={row}>
          <dt style={{ color: c.muted }}>Estimates</dt>
          <dd style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "0 12px", justifyContent: "flex-end" }}>
            {origin.estimates.length === 0 ? <span style={{ color: c.ink }}>None used</span> : origin.estimates.map((e) => (
              <Link key={e.id} href={ROUTES.estimate(e.id)} data-guide="cp.origin.estimate" style={link}>{e.ref ?? e.name}</Link>
            ))}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

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
