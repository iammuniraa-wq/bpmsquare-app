import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { firstFreeRef, nextSeqFromRefs } from "@/lib/refSeq";

/**
 * Next sales order ref for a tenant and numbering prefix: `<prefix>-0001`. Counted per workspace and per
 * prefix, never reset by year (an order type chooses its own prefix, so two types never share a sequence).
 * Same probing pattern as invoiceRef / poRef: the highest existing number + 1, then walk forward to a ref that
 * really is free; the unique (tenant_id, ref) index stays the final arbiter and the route retries on 23505.
 */
export async function generateNextSalesOrderRef(supabase: SupabaseClient, tenantId: string, prefix: string): Promise<string> {
  const { data } = await supabase
    .from("sales_orders")
    .select("ref")
    .eq("tenant_id", tenantId)
    .like("ref", `${prefix}-%`)
    .order("created_at", { ascending: false })
    .limit(1000);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const seq = nextSeqFromRefs((data ?? []).map((r) => r.ref as string), pattern);
  const makeRef = (s: number) => `${prefix}-${String(s).padStart(4, "0")}`;
  return firstFreeRef(supabase, "sales_orders", tenantId, makeRef, seq);
}
