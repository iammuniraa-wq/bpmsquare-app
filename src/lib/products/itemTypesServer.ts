import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { itemTypeLabel, validateItemType, KIT_ITEM_TYPE, type ItemTypeCheck } from "@/lib/products/itemTypes";

/** The tenant's config, read by the tenant id the request was authenticated
 *  for (never a client-supplied one). */
export async function getTenantItemTypeConfig(supabase: SupabaseClient, tenantId: string): Promise<Pick<TenantConfig, "item_types">> {
  const { data } = await supabase.from("tenants").select("config").eq("id", tenantId).single();
  return (data?.config ?? {}) as Pick<TenantConfig, "item_types">;
}

/** True when this error is Postgres / PostgREST saying a table or column is not there. */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || error.code === "PGRST204";
}

/** How many component lines this product has as a BOM parent (0 when the
 *  BOM table is absent). */
export async function countBomComponents(supabase: SupabaseClient, tenantId: string, productId: string): Promise<number> {
  const { count, error } = await supabase
    .from("product_bom_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("parent_product_id", productId);
  if (error) return 0;
  return count ?? 0;
}

/** Validate an item_type being written to a product: against the tenant's own
 *  list, and (for a change AWAY from bom_kit) against existing components --
 *  a product that has components can't stop being a kit. `currentType` is the
 *  stored value, or undefined for a create. */
export async function checkItemTypeWrite(
  supabase: SupabaseClient,
  tenantId: string,
  value: unknown,
  opts: { productId?: string; currentType?: string | null } = {}
): Promise<ItemTypeCheck> {
  const config = await getTenantItemTypeConfig(supabase, tenantId);
  const res = validateItemType(config, value, opts.currentType);
  if (!res.ok) return res;
  if (opts.productId && opts.currentType === KIT_ITEM_TYPE && res.key !== KIT_ITEM_TYPE) {
    const n = await countBomComponents(supabase, tenantId, opts.productId);
    if (n > 0) {
      return {
        ok: false,
        message: `This item has ${n} component${n === 1 ? "" : "s"}. Remove them first: only ${itemTypeLabel(config, KIT_ITEM_TYPE)} items can have components.`,
      };
    }
  }
  return res;
}
