import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_QUOTE_ID_FORMAT, type QuoteIdFormat } from "./constants";
import { formatQuoteRef } from "./quoteRefFormat";

export { formatQuoteRef };

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Computes the next sequential Quote ID for a tenant. When reset is "yearly" (default),
 * the sequence is scoped to quotes created this calendar year, so it restarts at 1
 * each January -- otherwise it runs on since the tenant's first quote.
 *
 * The next number is derived from the HIGHEST sequence among existing refs, not
 * from a row count. count+1 breaks permanently as soon as any quote is deleted:
 * with refs 0001..0005 and one deleted, count is 4, so the "next" ref is 0005 --
 * which still exists, and every retry recomputes the same collision
 * ("quotes_tenant_ref_uniq" violations on save until a human intervenes).
 */
export async function generateNextQuoteRef(
  supabase: SupabaseClient,
  tenantId: string,
  fmt: QuoteIdFormat = DEFAULT_QUOTE_ID_FORMAT,
  date: Date = new Date()
): Promise<string> {
  let query = supabase.from("quotes").select("ref").eq("tenant_id", tenantId);

  if (fmt.reset === "yearly") {
    const yearStart = new Date(date.getFullYear(), 0, 1).toISOString();
    const yearEnd = new Date(date.getFullYear() + 1, 0, 1).toISOString();
    query = query.gte("created_at", yearStart).lt("created_at", yearEnd);
  }

  const { data } = await query;

  // Match refs produced by the current format, capturing the sequence part.
  // Date tokens become wildcards (the yearly window above already scopes the
  // rows; refs from other months of the same year must still count toward max).
  const pattern = new RegExp(
    "^" + escRe(fmt.template)
      .replaceAll(escRe("{PREFIX}"), escRe(fmt.prefix))
      .replaceAll(escRe("{YYYY}"), "\\d{4}")
      .replaceAll(escRe("{YY}"), "\\d{2}")
      .replaceAll(escRe("{MM}"), "\\d{2}")
      .replaceAll(escRe("{SEQ}"), "(\\d+)") + "$"
  );

  let maxSeq = 0;
  for (const row of data ?? []) {
    const m = pattern.exec((row as { ref: string }).ref);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }

  return formatQuoteRef(fmt, date, maxSeq + 1);
}
