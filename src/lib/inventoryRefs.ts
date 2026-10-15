import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Inventory item ids from a request body that really are this tenant's
 *  (MULTI_TENANT_GUARDRAILS.md: every foreign id from the body is verified
 *  before it is written). Unknown or foreign ids are simply absent from the
 *  result -- the caller decides whether that is a 404 or a dropped link. */
export async function verifiedInventoryItemIds(supabase: SupabaseClient, tenantId: string, ids: (string | null | undefined)[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (!wanted.length) return new Set();
  const { data } = await supabase.from("inventory_items").select("id").eq("tenant_id", tenantId).in("id", wanted);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}
