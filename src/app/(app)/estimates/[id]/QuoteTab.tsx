import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusPill from "@/components/ui/StatusPill";
import { buildQuoteLines, alternativesInput } from "@/lib/estimator/quoteLines";
import { templateGroupNames, toQuoteSource } from "@/lib/estimator/lines";
import type { EstimateLine, EstimateTemplate } from "@/lib/types";
import CreateQuoteButton from "./CreateQuoteButton";

type Props = {
  estimateId: string;
  quote: { id: string; ref: string; status: string } | null;
  template: EstimateTemplate | null;
  lines: EstimateLine[];
  marginPct: number;
  blockers: string[];
  money: (n: number) => string;
  /** The workspace has Standard Quotes and the user may create one. */
  canQuote: boolean;
  quoteUnavailable: string | null;
};

/** The linked Standard Quote, or what "Create quote" will put in front of the customer. */
export default function QuoteTab(p: Props) {
  if (p.quote) {
    return (
      <Card title="Quote" padding={18}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Link href={ROUTES.standardQuote(p.quote.id)} style={{ fontSize: 15, fontWeight: 700, color: c.accent, textDecoration: "none" }}>{p.quote.ref}</Link>
          <StatusPill label={p.quote.status} tone="amber" />
        </div>
        <p className="bpm-t-help" style={{ margin: "10px 0 14px" }}>
          This estimate is locked to its quote. Send, revise or print the quote from there; the customer sees one price per group, never your costs.
        </p>
        <Button href={ROUTES.standardQuote(p.quote.id)} variant="primary">Open quote</Button>
      </Card>
    );
  }

  const groups = p.template ? templateGroupNames(p.template.rules) : new Map<string, string>();
  const granularity = p.template?.quote_granularity ?? "group";
  const built = buildQuoteLines(p.lines.filter((l) => l.qty > 0).map((l) => toQuoteSource(l, groups)), { granularity, margin_pct: p.marginPct });
  const alt = p.template ? alternativesInput(p.template.inputs) : null;
  const blocked = p.blockers.length > 0;

  return (
    <>
      <Card title="What the customer will see" padding={18}>
        <p className="bpm-t-help" style={{ marginTop: 0 }}>
          {granularity === "line" ? "One quote line per BOM line" : "One quote line per group"}, priced at cost plus your {p.marginPct}% margin, with the workspace's VAT on the quote. Unit costs, quantities of materials and the margin never appear on the quote.
          {alt && <> Each option of "{alt.label}" is added as an alternative, with the one chosen on this estimate selected.</>}
        </p>
        {built.ok && built.lines.length > 0 ? (
          <div>
            {built.lines.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
                <span style={{ color: c.ink, minWidth: 0, wordBreak: "break-word" }}>{l.description}</span>
                <span style={{ fontWeight: 600, color: c.ink, whiteSpace: "nowrap" }}>{p.money(l.amount)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0 0", borderTop: `1px solid ${c.line}`, fontSize: 14, fontWeight: 700, color: c.ink }}>
              <span>Before VAT</span><span>{p.money(built.price)}</span>
            </div>
          </div>
        ) : (
          <div className="bpm-t-help">{built.ok ? "There are no lines to quote yet." : built.problems[0]}</div>
        )}
      </Card>

      {blocked && (
        <Card title="Fix these before quoting" padding={16}>
          <ul role="alert" style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--err-ink)" }}>
            {p.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </Card>
      )}

      {p.quoteUnavailable && <div className="bpm-t-help">{p.quoteUnavailable}</div>}
      {p.canQuote && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          {blocked || !built.ok || built.lines.length === 0
            ? <Button variant="primary" disabled>Create quote</Button>
            : <CreateQuoteButton estimateId={p.estimateId} />}
        </div>
      )}
    </>
  );
}
