import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tenant } from "@/lib/tenant";
import type { StandardQuoteProduct } from "./new/StandardQuoteForm";

// What the Standard Quote form needs from the catalog (0114): the products
// a line can name, only when the tenant bought the module. Shared by the
// new and edit pages so they cannot drift.
export async function standardQuoteProducts(supabase: SupabaseClient, tenantId: string, tenant: Tenant | null): Promise<StandardQuoteProduct[]> {
  if (tenant?.features?.products !== true) return [];
  const { data } = await supabase
    .from("products").select("id, ref, name, uom, list_price")
    .eq("tenant_id", tenantId).eq("status", "active").order("name").limit(500);
  return (data ?? []) as StandardQuoteProduct[];
}

/** Both flags required, same as quotations/new/page.tsx: pricing_engine
 *  gates the workcenter existing at all, pricing_engine_quotes is the
 *  narrower opt-in for touching real quote lines. */
export function pricingOnStandardQuotes(tenant: Tenant | null): boolean {
  return Boolean(tenant?.features?.pricing_engine && tenant?.features?.pricing_engine_quotes);
}
