import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Computes the next sequential Invoice ref for a tenant: INV-{YYYY}-{NNNN}, yearly-reset.
 * Fixed format for v1 -- mirrors src/lib/poRef.ts, not the configurable quote_id_format system.
 */
export async function generateNextInvoiceRef(
  supabase: SupabaseClient,
  tenantId: string,
  date: Date = new Date()
): Promise<string> {
  const yearStart = new Date(date.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(date.getFullYear() + 1, 0, 1).toISOString();

  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd);

  const seq = String((count ?? 0) + 1).padStart(4, "0");
  return `INV-${date.getFullYear()}-${seq}`;
}
