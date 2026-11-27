import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { documentTotal } from "@/lib/sales/lineTotals";
import type { StandardQuote, StandardQuoteLine } from "@/lib/types";
import { c } from "@/lib/theme";

type Props = {
  quote: Pick<StandardQuote, "header_discount_pct" | "tax_pct" | "shipping_amount" | "total">;
  lines: StandardQuoteLine[];
  taxLabel: string;
  money: (n: number) => string;
};

/** Under the Lines tab: the total, with the PDF's own breakdown above it when discount, tax or shipping make it differ from the lines. */
export default function StandardQuoteLinesTotals({ quote, lines, taxLabel, money }: Props) {
  const totals = computeStandardQuoteTotals(documentTotal(lines), quote.header_discount_pct, quote.tax_pct, quote.shipping_amount);
  const rows: [string, string][] = [];
  if (quote.header_discount_pct > 0) rows.push([`Discount (${quote.header_discount_pct}%)`, `− ${money(totals.discountAmount)}`]);
  if (quote.tax_pct > 0) rows.push([`${taxLabel} (${quote.tax_pct}%)`, money(totals.taxAmount)]);
  if (quote.shipping_amount > 0) rows.push(["Shipping / Handling", money(totals.shipping)]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {(rows.length > 0 ? [["Subtotal", money(totals.subtotal)] as [string, string], ...rows] : []).map(([label, value]) => (
        <div key={label} style={{ fontSize: 13, color: c.muted }}>{label}: {value}</div>
      ))}
      <div style={{ fontSize: 14, fontWeight: 700 }}>Total: {money(quote.total)}</div>
    </div>
  );
}
