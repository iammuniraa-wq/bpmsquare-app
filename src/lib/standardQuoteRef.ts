import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "./constants";
import { firstFreeRef, nextSeqFromRefs } from "./refSeq";
import { generateNextQuoteRef } from "./quoteRef";
import { sanitizeIdFormat } from "./quoteRefFormat";

/**
 * Computes the next sequential Standard Quote ref for a tenant.
 *
 * A workspace that set a number pattern (config.standard_quote_id_format, Settings > Company > Numbering) gets its own
 * series in that pattern, for example "167 / 2026". Without one the format is the fixed SQ-{YYYY}-{NNNN}, yearly reset,
 * exactly as before. Tender bids and project quotations are separate series: the pattern here counts only Standard Quote
 * refs, and a tender bid never draws from it. The revision of a quotation is NOT part of the number (src/lib/revisions).
 */
export async function generateNextStandardQuoteRef(
  supabase: SupabaseClient,
  tenantId: string,
  date: Date = new Date()
): Promise<string> {
  const { data: tenantRow } = await supabase.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const fmt = sanitizeIdFormat((tenantRow?.config as Partial<TenantConfig> | null | undefined)?.standard_quote_id_format);
  if (fmt) return generateNextQuoteRef(supabase, tenantId, fmt, date, "standard_quotes");

  const yearStart = new Date(date.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(date.getFullYear() + 1, 0, 1).toISOString();

  const { data } = await supabase
    .from("standard_quotes")
    .select("ref")
    .eq("tenant_id", tenantId)
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd)
    .order("created_at", { ascending: false })
    .limit(1000);

  const seq = nextSeqFromRefs((data ?? []).map((r) => r.ref as string), /^SQ-\d{4}-(\d+)$/);
  const makeRef = (s: number) => `SQ-${date.getFullYear()}-${String(s).padStart(4, "0")}`;
  return firstFreeRef(supabase, "standard_quotes", tenantId, makeRef, seq);
}
