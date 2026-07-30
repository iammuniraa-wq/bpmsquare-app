import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextSeqFromRefs } from "./refSeq";

/**
 * Computes the next sequential Invoice ref for a tenant: INV-{YYYY}-{NNNN}, yearly-reset.
 * Fixed format for v1 -- mirrors src/lib/poRef.ts, not the configurable quote_id_format system.
 * Sequence comes from the highest existing ref, not a row count (see refSeq.ts).
 */
export async function generateNextInvoiceRef(
  supabase: SupabaseClient,
  tenantId: string,
  date: Date = new Date()
): Promise<string> {
  const yearStart = new Date(date.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(date.getFullYear() + 1, 0, 1).toISOString();

  const { data } = await supabase
    .from("invoices")
    .select("ref")
    .eq("tenant_id", tenantId)
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd);

  const seq = nextSeqFromRefs((data ?? []).map((r) => r.ref as string), /^INV-\d{4}-(\d+)$/);
  return `INV-${date.getFullYear()}-${String(seq).padStart(4, "0")}`;
}
