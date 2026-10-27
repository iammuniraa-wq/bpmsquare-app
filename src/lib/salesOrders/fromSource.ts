import type { SupabaseClient } from "@supabase/supabase-js";
import { selectedLines } from "@/lib/sales/lineTotals";
import { clampPercent, cleanOrderLines, foldHeaderDiscount, r2, type CleanOrderLine } from "./totals";
import type { OrderSourceType, PricingMode } from "./types";

// A sales order made from something that was already agreed: an accepted Standard Quote, a won Quotation or
// Deal, or another order. The server copies the lines, prices, discount, tax, account, contact, customer PO
// and notes; the person never retypes them. Every row is read tenant-scoped, and every id the source row
// itself carries (contact, deal) is verified again before it is used (MULTI_TENANT_GUARDRAILS.md).

export const SOURCE_TYPES = ["standard_quote", "quotation", "opportunity", "order"] as const;
export type SourceKind = (typeof SOURCE_TYPES)[number];

export type SourceDraft = {
  source_type: OrderSourceType;
  source_id: string;
  source_ref: string | null;
  account_id: string;
  contact_id: string | null;
  opportunity_id: string | null;
  /** The source's own pricing mode. Quotes carry no toggle: they are priced here, so internal unless a row says otherwise. */
  pricing_mode: PricingMode;
  customer_po: string | null;
  notes: string | null;
  terms: string | null;
  shipping_amount: number;
  /** Set only when the source states one; otherwise the tenant currency is used. */
  currency: string | null;
  lines: CleanOrderLine[];
};

export type SourceResult = { ok: true; draft: SourceDraft } | { ok: false; status: number; error: string };

type Row = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const sourcePricingMode = (row: Row): PricingMode => (row.pricing_mode === "external" ? "external" : "internal");

/** Lines of a quote-shaped source: only the ones charged, at their net amount, with the header discount folded in. */
function mapQuoteLines(
  lines: Row[],
  opts: { headerDiscountPct: number; taxPct: number; selectedOptionId?: string | null },
): CleanOrderLine[] {
  const charged = selectedLines(
    lines.map((l) => ({
      id: String(l.id), amount: num(l.amount), group_id: str(l.group_id), group_type: str(l.group_type), break_of: str(l.break_of),
      break_qty: l.break_qty as number | null, is_selected: l.is_selected as boolean | null, row: l,
    })),
    opts.selectedOptionId !== undefined ? { selectedOptionId: opts.selectedOptionId } : {},
  );
  return cleanOrderLines(
    charged.map(({ row }) => ({
      product_id: row.product_id,
      description: row.description,
      qty: row.qty,
      uom: row.uom,
      unit_price: row.rate ?? row.unit_price,
      discount_pct: foldHeaderDiscount(clampPercent(row.discount_pct), opts.headerDiscountPct),
      tax_pct: opts.taxPct,
    })),
  );
}

/** A contact id carried by a source row, kept only when it is this tenant's. */
async function verifiedContact(db: SupabaseClient, tenantId: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !id) return null;
  const { data } = await db.from("contacts").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function verifiedOpportunity(db: SupabaseClient, tenantId: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !id) return null;
  const { data, error } = await db.from("opportunities").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return null;
  return (data as { id: string } | null)?.id ?? null;
}

export async function loadSourceDraft(db: SupabaseClient, tenantId: string, source: { type: string; id: string }): Promise<SourceResult> {
  const id = source.id;
  if (!(SOURCE_TYPES as readonly string[]).includes(source.type) || typeof id !== "string" || !id) {
    return { ok: false, status: 400, error: `source.type must be one of: ${SOURCE_TYPES.join(", ")}` };
  }

  if (source.type === "standard_quote") {
    const { data: q } = await db.from("standard_quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!q) return { ok: false, status: 404, error: "Standard quote not found" };
    const quote = q as Row;
    if (quote.status !== "accepted") return { ok: false, status: 422, error: "Only an accepted standard quote can become a sales order" };
    const { data: lines } = await db.from("standard_quote_lines").select("*").eq("standard_quote_id", id).eq("tenant_id", tenantId).order("sl_no");
    return {
      ok: true,
      draft: {
        source_type: "standard_quote", source_id: id, source_ref: str(quote.ref),
        account_id: quote.account_id as string, contact_id: await verifiedContact(db, tenantId, quote.contact_id),
        opportunity_id: await verifiedOpportunity(db, tenantId, quote.opportunity_id),
        pricing_mode: sourcePricingMode(quote), customer_po: null, notes: str(quote.notes), terms: str(quote.terms),
        shipping_amount: r2(num(quote.shipping_amount)), currency: str(quote.currency),
        lines: mapQuoteLines((lines ?? []) as Row[], { headerDiscountPct: clampPercent(quote.header_discount_pct), taxPct: clampPercent(quote.tax_pct) }),
      },
    };
  }

  if (source.type === "quotation") {
    const { data: q } = await db.from("quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!q) return { ok: false, status: 404, error: "Quotation not found" };
    const quote = q as Row;
    if (quote.superseded_by) return { ok: false, status: 409, error: "This quotation version has been superseded; use the latest version" };
    if (!(quote.outcome === "won" || quote.status === "approved")) return { ok: false, status: 422, error: "Only a won (approved) quotation can become a sales order" };
    const { data: lines } = await db.from("quote_lines").select("*").eq("quote_id", id).eq("tenant_id", tenantId).order("sl_no");
    const rows = (lines ?? []) as Row[];
    const mapped = mapQuoteLines(rows, { headerDiscountPct: 0, taxPct: clampPercent(quote.gst_rate), selectedOptionId: (quote.selected_option_id as string | null) ?? null });
    // A fixed discount has no percentage of its own: carry it as the equivalent share of the charged subtotal.
    const gross = mapped.reduce((s, l) => s + l.line_total, 0);
    const headerPct = quote.discount_type === "fixed"
      ? (gross > 0 ? clampPercent(Math.round((num(quote.discount_fixed) / gross) * 10000) / 100) : 0)
      : clampPercent(quote.discount_pct);
    const folded = headerPct > 0
      ? cleanOrderLines(mapped.map((l) => ({ ...l, discount_pct: foldHeaderDiscount(l.discount_pct, headerPct) })))
      : mapped;
    return {
      ok: true,
      draft: {
        source_type: "quotation", source_id: id, source_ref: str(quote.ref),
        account_id: quote.account_id as string, contact_id: await verifiedContact(db, tenantId, quote.contact_id),
        opportunity_id: await verifiedOpportunity(db, tenantId, quote.opportunity_id),
        pricing_mode: sourcePricingMode(quote), customer_po: str(quote.po_number), notes: str(quote.notes), terms: str(quote.terms),
        shipping_amount: 0, currency: str(quote.currency), lines: folded,
      },
    };
  }

  if (source.type === "opportunity") {
    const { data: o, error } = await db.from("opportunities").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error || !o) return { ok: false, status: 404, error: "Deal not found" };
    const opp = o as Row;
    if (opp.outcome !== "won") return { ok: false, status: 422, error: "Only a won deal can become a sales order" };
    const { data: lines } = await db.from("opportunity_lines").select("*").eq("opportunity_id", id).eq("tenant_id", tenantId).order("sl_no");
    return {
      ok: true,
      draft: {
        source_type: "opportunity", source_id: id, source_ref: str(opp.ref),
        account_id: opp.account_id as string, contact_id: await verifiedContact(db, tenantId, opp.contact_id), opportunity_id: id,
        pricing_mode: sourcePricingMode(opp), customer_po: null, notes: str(opp.description), terms: null, shipping_amount: 0, currency: str(opp.currency),
        lines: mapQuoteLines((lines ?? []) as Row[], { headerDiscountPct: 0, taxPct: 0 }),
      },
    };
  }

  // Another order: a copy for a repeat purchase. Prices and tax are kept; availability, dates and the PO are not.
  const { data: src } = await db.from("sales_orders").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!src) return { ok: false, status: 404, error: "Order not found" };
  const order = src as Row;
  const { data: lines } = await db.from("sales_order_lines").select("*").eq("order_id", id).eq("tenant_id", tenantId).order("line_no");
  return {
    ok: true,
    draft: {
      source_type: "order", source_id: id, source_ref: str(order.ref),
      account_id: order.account_id as string, contact_id: await verifiedContact(db, tenantId, order.contact_id),
      opportunity_id: await verifiedOpportunity(db, tenantId, order.opportunity_id),
      pricing_mode: sourcePricingMode(order), customer_po: null, notes: str(order.notes), terms: str(order.terms),
      shipping_amount: r2(num(order.shipping_amount)), currency: str(order.currency),
      lines: cleanOrderLines(((lines ?? []) as Row[]).map((l) => ({
        product_id: l.product_id, description: l.description, printed_text: l.printed_text, qty: l.qty, uom: l.uom,
        unit_price: l.unit_price, discount_pct: l.discount_pct, tax_pct: l.tax_pct,
      }))),
    },
  };
}

/** A live (not cancelled) order already made from this source, if any. */
export async function findOrderFromSource(
  db: SupabaseClient,
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<{ id: string; ref: string; status: string }[]> {
  const { data, error } = await db.from("sales_orders").select("id, ref, status").eq("tenant_id", tenantId).eq("source_type", sourceType).eq("source_id", sourceId).neq("status", "cancelled");
  if (error) return [];
  return (data ?? []) as { id: string; ref: string; status: string }[];
}
