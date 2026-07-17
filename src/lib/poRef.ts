import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Computes the next sequential Purchase Order ref for a tenant: PO-{YYYY}-{NNNN}, yearly-reset.
 * Fixed format for v1 -- unlike quotes' quote_id_format, no per-tenant template system.
 */
export async function generateNextPoRef(
  supabase: SupabaseClient,
  tenantId: string,
  date: Date = new Date()
): Promise<string> {
  const yearStart = new Date(date.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(date.getFullYear() + 1, 0, 1).toISOString();

  const { count } = await supabase
    .from("purchase_orders")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd);

  const seq = String((count ?? 0) + 1).padStart(4, "0");
  return `PO-${date.getFullYear()}-${seq}`;
}
