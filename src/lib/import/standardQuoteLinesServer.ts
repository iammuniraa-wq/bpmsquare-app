import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeDbError } from "./server";
import { selectedLines, type SelectableLine } from "@/lib/sales/lineTotals";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";

type QuoteMoney = { id: string; header_discount_pct: number; tax_pct: number; shipping_amount: number };
type LineRow = SelectableLine & { standard_quote_id: string };

const CHUNK = 150;

/**
 * Re-derives the stored subtotal and total of standard quotes after their lines changed in bulk.
 * Uses the same two rules as the quote form's save: which lines count (alternative options and
 * quantity breaks, src/lib/sales/lineTotals.ts) and the one total formula
 * (src/lib/standardQuoteTotals.ts), so a file can never leave a total the form would not produce.
 * A database still missing the 0116 columns reads every line as an ordinary selected line.
 * Every query carries the tenant filter.
 */
export async function recomputeStandardQuoteTotals(
  supabase: SupabaseClient,
  tenantId: string,
  quoteIds: string[]
): Promise<void> {
  const ids = [...new Set(quoteIds)];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [{ data: quotes }, full] = await Promise.all([
      supabase.from("standard_quotes").select("id, header_discount_pct, tax_pct, shipping_amount").in("id", chunk).eq("tenant_id", tenantId),
      supabase.from("standard_quote_lines").select("id, standard_quote_id, amount, group_id, group_type, break_of, is_selected").in("standard_quote_id", chunk).eq("tenant_id", tenantId),
    ]);
    let lineData = full.data as LineRow[] | null;
    if (full.error) {
      const base = await supabase.from("standard_quote_lines").select("id, standard_quote_id, amount").in("standard_quote_id", chunk).eq("tenant_id", tenantId);
      lineData = base.data as LineRow[] | null;
    }

    const byQuote = new Map<string, LineRow[]>();
    for (const l of lineData ?? []) {
      const list = byQuote.get(l.standard_quote_id);
      if (list) list.push(l); else byQuote.set(l.standard_quote_id, [l]);
    }

    for (const q of (quotes ?? []) as QuoteMoney[]) {
      const subtotal = selectedLines(byQuote.get(q.id) ?? []).reduce((s, l) => s + (l.amount || 0), 0);
      const total = computeStandardQuoteTotals(subtotal, q.header_discount_pct, q.tax_pct, q.shipping_amount).total;
      const { error } = await supabase
        .from("standard_quotes")
        .update({ subtotal, total, updated_at: new Date().toISOString() })
        .eq("id", q.id)
        .eq("tenant_id", tenantId);
      if (error) console.error("[standard_quote_lines] total recompute failed", describeDbError(error));
    }
  }
}
