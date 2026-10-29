import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { firstFreeRef, nextSeqFromRefs } from "./refSeq";

/**
 * Next Work Order ref for a tenant: WO-{YYYY}-{NNNN}, yearly reset. Same format Data Workbench import
 * assigns (api/import/work_orders), so both creators draw from one numbering. Highest existing ref + 1,
 * then probed forward to a free one -- see refSeq.ts.
 */
export async function generateNextWorkOrderRef(
  supabase: SupabaseClient,
  tenantId: string,
  date: Date = new Date()
): Promise<string> {
  const year = date.getFullYear();
  const { data } = await supabase
    .from("work_orders")
    .select("ref")
    .eq("tenant_id", tenantId)
    .like("ref", `WO-${year}-%`)
    .order("created_at", { ascending: false })
    .limit(1000);
  const seq = nextSeqFromRefs((data ?? []).map((r) => r.ref as string), new RegExp(`^WO-${year}-(\\d+)$`));
  return firstFreeRef(supabase, "work_orders", tenantId, (s) => `WO-${year}-${String(s).padStart(4, "0")}`, seq);
}
