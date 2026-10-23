import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { isSchemaPending } from "@/lib/marketing/pending";

// Standard Quote -> Invoice. The link lives in invoices.standard_quote_id (migration 0209). Until that is
// applied the invoice keeps the same fact in custom_data.source_standard_quote_id, and the lookup reads
// whichever exists, so the conversion works (and still refuses to bill a quote twice) before and after.

export const SQ_LINK_KEY = "source_standard_quote_id";

type Db = Pick<SupabaseClient, "from">;
export type InvoiceLink = { id: string; ref: string };

/** The live (not cancelled) invoice already raised from this Standard Quote, if any. Always tenant-scoped. */
export async function findInvoiceForStandardQuote(db: Db, tenantId: string, quoteId: string): Promise<InvoiceLink | null> {
  const byColumn = await db.from("invoices").select("id, ref").eq("tenant_id", tenantId).eq("standard_quote_id", quoteId).neq("status", "cancelled").limit(1);
  if (!byColumn.error) return ((byColumn.data ?? [])[0] as InvoiceLink | undefined) ?? null;
  if (!isSchemaPending(byColumn.error)) return null;
  const byMarker = await db.from("invoices").select("id, ref").eq("tenant_id", tenantId).filter(`custom_data->>${SQ_LINK_KEY}`, "eq", quoteId).neq("status", "cancelled").limit(1);
  if (byMarker.error) return null;
  return ((byMarker.data ?? [])[0] as InvoiceLink | undefined) ?? null;
}

type SqLine = { sl_no?: string | null; description: string; uom?: string | null; qty: number; rate: number; discount_pct?: number | null; amount: number; is_selected?: boolean | null };
type SqHeader = { subtotal?: number | null; header_discount_pct?: number | null; tax_pct?: number | null; shipping_amount?: number | null };

export type InvoiceLineDraft = { sl_no: string; description: string; uom: string | null; qty: number; rate: number; amount: number };

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/**
 * The invoice's lines and total from a quote's lines. Invoice lines carry no discount column, no tax column and
 * no shipping, and the invoice total is the sum of its lines, so: each chosen line is copied at its net amount,
 * and the header discount, tax and shipping follow as their own lines. The total is then exactly what the
 * customer accepted, and nothing is applied twice.
 */
export function buildInvoiceFromQuote(header: SqHeader, lines: SqLine[]): { lines: InvoiceLineDraft[]; total: number } {
  const chosen = lines.filter((l) => l.is_selected !== false);
  const items: InvoiceLineDraft[] = chosen.map((l, i) => {
    const qty = Number(l.qty) || 0;
    const amount = r2(Number(l.amount) || 0);
    const discounted = Number(l.discount_pct ?? 0) > 0 && qty > 0;
    return {
      sl_no: l.sl_no || String(i + 1),
      description: l.description,
      uom: l.uom ?? null,
      qty,
      rate: discounted ? r2(amount / qty) : r2(Number(l.rate) || 0),
      amount,
    };
  });
  const subtotal = r2(items.reduce((s, l) => s + l.amount, 0));
  const t = computeStandardQuoteTotals(subtotal, Number(header.header_discount_pct) || 0, Number(header.tax_pct) || 0, Number(header.shipping_amount) || 0);
  const out = [...items];
  const extra = (description: string, amount: number) => {
    if (amount === 0) return;
    out.push({ sl_no: String(out.length + 1), description, uom: null, qty: 1, rate: amount, amount });
  };
  if (Number(header.header_discount_pct) > 0) extra(`Discount (${Number(header.header_discount_pct)}%)`, -r2(t.discountAmount));
  if (Number(header.tax_pct) > 0) extra(`Tax (${Number(header.tax_pct)}%)`, r2(t.taxAmount));
  extra("Shipping", r2(t.shipping));
  return { lines: out, total: r2(out.reduce((s, l) => s + l.amount, 0)) };
}
