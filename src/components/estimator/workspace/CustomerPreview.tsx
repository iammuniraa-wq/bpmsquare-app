import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import Card from "@/components/ui/Card";
import Chip from "./Chip";
import type { PriceOption, PriceView } from "@/lib/estimator/preview";

/**
 * "What the customer sees": one line per section, VAT, the total, and the finish
 * options. Built from the same lines as the quote, so there are no unit costs
 * and no margin in it by construction. Shown once the quote exists.
 */
export default function CustomerPreview({
  view, options, money, customer, quote,
}: {
  view: PriceView;
  options: { label: string; items: PriceOption[] } | null;
  money: (n: number) => string;
  customer: string;
  quote: { id: string; ref: string } | null;
}) {
  return (
    <Card padding={18}>
      <Chip label="What the customer sees" tone="green" />
      <h2 className="bpm-t-title" style={{ margin: "10px 0 2px", fontSize: 18 }}>
        {quote ? <>Quotation <Link href={ROUTES.standardQuote(quote.id)} style={{ color: "var(--accent)", textDecoration: "none" }}>{quote.ref}</Link></> : "Quotation"}
      </h2>
      <p className="bpm-t-help" style={{ margin: "0 0 10px" }}>For {customer || "the customer"}</p>
      <div style={{ maxWidth: 640 }}>
        {view.sections.map((s) => (
          <div key={s.key} className="est-row"><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{s.name}</span><span>{money(s.amount)}</span></div>
        ))}
        <div className="est-row" style={{ fontWeight: 700 }}><span>Total before VAT</span><span>{money(view.price)}</span></div>
        <div className="est-row"><span>VAT {view.vat_pct}%</span><span>{money(view.vat)}</span></div>
        <div className="est-row" style={{ fontWeight: 700 }}><span>Total</span><span>{money(view.total)}</span></div>
      </div>
      {options && (
        <p className="bpm-t-help" style={{ margin: "10px 0 0" }}>
          Options: {options.items.map((o) => `${o.label} ${money(o.total)}`).join(" · ")}.
        </p>
      )}
      <p className="bpm-t-help" style={{ margin: "8px 0 0" }}>No unit costs or margin appear here.</p>
    </Card>
  );
}
