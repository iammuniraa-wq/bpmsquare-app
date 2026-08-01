import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { firstFreeRef, nextSeqFromRefs } from "./refSeq";

/**
 * Computes the next sequential Standard Quote ref for a tenant:
 * SQ-{YYYY}-{NNNN}, yearly-reset. Fixed format, not the configurable
 * quote_id_format system the (separate) Quotation object uses -- see
 * src/lib/invoiceRef.ts for the identical pattern this mirrors.
 */
export async function generateNextStandardQuoteRef(
  supabase: SupabaseClient,
  tenantId: string,
  date: Date = new Date()
): Promise<string> {
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
