import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_QUOTE_ID_FORMAT, type QuoteIdFormat } from "./constants";
import { formatQuoteRef } from "./quoteRefFormat";

export { formatQuoteRef };

/**
 * Computes the next sequential Quote ID for a tenant. When reset is "yearly" (default),
 * the count is scoped to quotes created this calendar year, so the sequence restarts at 1
 * each January -- otherwise it's a running total since the tenant's first quote.
 */
export async function generateNextQuoteRef(
  supabase: SupabaseClient,
  tenantId: string,
  fmt: QuoteIdFormat = DEFAULT_QUOTE_ID_FORMAT,
  date: Date = new Date()
): Promise<string> {
  let query = supabase.from("quotes").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);

  if (fmt.reset === "yearly") {
    const yearStart = new Date(date.getFullYear(), 0, 1).toISOString();
    const yearEnd = new Date(date.getFullYear() + 1, 0, 1).toISOString();
    query = query.gte("created_at", yearStart).lt("created_at", yearEnd);
  }

  const { count } = await query;
  return formatQuoteRef(fmt, date, (count ?? 0) + 1);
}
