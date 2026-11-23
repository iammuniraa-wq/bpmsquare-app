import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tenant } from "@/lib/tenant";
import type { StandardQuoteProduct } from "./new/StandardQuoteForm";
import { parseQtyBreaks } from "@/lib/products/qtyBreaks";

// What the Standard Quote form needs from the catalog (0114): the products
// a line can name, only when the tenant bought the module. Shared by the
// new and edit pages so they cannot drift. Category and quantity breaks
// (0118) feed the add-line panel's "alternatives" and "quantity breaks"
// questions; the select degrades to the pre-0118 column list while that
// migration is pending, so quoting never breaks because a migration is late.
export async function standardQuoteProducts(supabase: SupabaseClient, tenantId: string, tenant: Tenant | null): Promise<StandardQuoteProduct[]> {
  if (tenant?.features?.products !== true) return [];
  const load = async (columns: string) => {
    const { data, error } = await supabase.from("products").select(columns)
      .eq("tenant_id", tenantId).eq("status", "active").order("name").limit(500);
    return error ? null : ((data ?? []) as unknown as Record<string, unknown>[]);
  };
  const data = (await load("id, ref, name, uom, list_price, category, sub_category, qty_breaks"))
    ?? (await load("id, ref, name, uom, list_price, category, sub_category"))
    ?? [];
  return data.map((p) => ({
    id: p.id as string, ref: (p.ref as string | null) ?? null, name: p.name as string, uom: (p.uom as string | null) ?? null,
    list_price: (p.list_price as number | null) ?? null, category: (p.category as string | null) ?? null,
    sub_category: (p.sub_category as string | null) ?? null, qty_breaks: parseQtyBreaks(p.qty_breaks),
  }));
}

/** Both flags required, same as quotations/new/page.tsx: pricing_engine
 *  gates the workcenter existing at all, pricing_engine_quotes is the
 *  narrower opt-in for touching real quote lines. */
export function pricingOnStandardQuotes(tenant: Tenant | null): boolean {
  return Boolean(tenant?.features?.pricing_engine && tenant?.features?.pricing_engine_quotes);
}

/** Migration 0251 adds the framed-document columns. A loaded quote row only carries a key for a column that exists, so its
 *  presence is the cheapest proof the migration ran. */
export function docColumnsReady(quote: object): boolean {
  return "project_title" in quote;
}

/** The same question before any quote exists (the new-quote page): ask for the column and read 42703 as "not there yet". */
export async function docColumnsReadyForTenant(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  const { error } = await supabase.from("standard_quotes").select("project_title").eq("tenant_id", tenantId).limit(1);
  return !error;
}

/** The "Document" card of the form (project title, subject, issuing entity): only for a workspace that chose a page frame,
 *  so every other workspace sees the form it always had. */
export function docDetailsFor(tenant: Tenant | null): { entities: { id: string; name: string; is_default: boolean }[] } | undefined {
  if (!tenant?.config?.pdf_design) return undefined;
  return { entities: (tenant.config.entities ?? []).map((e) => ({ id: e.id, name: e.name, is_default: e.is_default })) };
}
