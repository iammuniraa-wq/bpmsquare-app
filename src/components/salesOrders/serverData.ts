import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The order already made from this quote / quotation / deal, if any (the newest). Null when there is none, and also on
 * any failure (the table is created by a hand-applied migration): a quote page then simply offers the button.
 */
export async function findOrderForSource(
  supabase: SupabaseClient, tenantId: string, sourceType: "standard_quote" | "quotation" | "opportunity", sourceId: string,
): Promise<{ id: string; ref: string } | null> {
  try {
    const { data, error } = await supabase.from("sales_orders").select("id, ref").eq("tenant_id", tenantId).eq("source_type", sourceType).eq("source_id", sourceId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    return error || !data ? null : (data as { id: string; ref: string });
  } catch {
    return null;
  }
}
