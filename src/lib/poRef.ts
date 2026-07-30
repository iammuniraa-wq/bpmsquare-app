import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { firstFreeRef, nextSeqFromRefs } from "./refSeq";

/**
 * Computes the next sequential Purchase Order ref for a tenant: PO-{YYYY}-{NNNN}, yearly-reset.
 * Fixed format for v1 -- unlike quotes' quote_id_format, no per-tenant template system.
 * Sequence comes from the highest existing ref (not a row count), then probes
 * forward to a genuinely free ref -- see refSeq.ts for both rationales.
 */
export async function generateNextPoRef(
  supabase: SupabaseClient,
  tenantId: string,
  date: Date = new Date()
): Promise<string> {
  const yearStart = new Date(date.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(date.getFullYear() + 1, 0, 1).toISOString();

  const { data } = await supabase
    .from("purchase_orders")
    .select("ref")
    .eq("tenant_id", tenantId)
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd)
    .order("created_at", { ascending: false })
    .limit(1000);

  const seq = nextSeqFromRefs((data ?? []).map((r) => r.ref as string), /^PO-\d{4}-(\d+)$/);
  const makeRef = (s: number) => `PO-${date.getFullYear()}-${String(s).padStart(4, "0")}`;
  return firstFreeRef(supabase, "purchase_orders", tenantId, makeRef, seq);
}
