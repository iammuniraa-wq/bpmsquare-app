import type { SupabaseClient } from "@supabase/supabase-js";

// Products (the sellable catalogue) and inventory items (stock) have no foreign key between them; they
// describe the same thing only when their SKU is the same. This resolver is that rule, kept pure so it can
// be tested without a database: a PO line raised from a product only moves stock on receipt when it
// carries the inventory item's id.

export type InventoryCandidate = { id: string; tenant_id: string; sku: string | null };

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/**
 * The tenant's inventory item for this product: the one whose SKU equals the product's, ignoring case and
 * surrounding spaces. Null when the product has no SKU, when nothing matches, and when more than one item
 * matches (two items on the same SKU is ambiguous, and guessing would put received stock on the wrong one).
 * Candidates and the product from another tenant are never matched, whatever the caller passed in.
 */
export function inventoryItemForProduct(
  tenantId: string,
  product: { sku: string | null | undefined; tenant_id?: string | null },
  items: readonly InventoryCandidate[]
): string | null {
  if (product.tenant_id && product.tenant_id !== tenantId) return null;
  const sku = norm(product.sku);
  if (!sku) return null;
  const matches = items.filter((i) => i.tenant_id === tenantId && norm(i.sku) === sku);
  return matches.length === 1 ? matches[0].id : null;
}

/** The tenant's inventory items (id and SKU only) that carry a SKU. A failed read yields none: the link is an extra, never a blocker. */
export async function loadInventoryCandidates(supabase: SupabaseClient, tenantId: string): Promise<InventoryCandidate[]> {
  const PAGE = 1000;
  const out: InventoryCandidate[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id, tenant_id, sku")
      .eq("tenant_id", tenantId)
      .not("sku", "is", null)
      .range(from, from + PAGE - 1);
    if (error) return [];
    const batch = (data ?? []) as InventoryCandidate[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** product id -> { sku, tenant_id } for the given products, tenant-scoped; products from other tenants are simply absent. */
export async function loadProductSkus(
  supabase: SupabaseClient,
  tenantId: string,
  productIds: (string | null | undefined)[]
): Promise<Map<string, { sku: string | null; tenant_id: string }>> {
  const wanted = [...new Set(productIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await supabase.from("products").select("id, tenant_id, sku").eq("tenant_id", tenantId).in("id", wanted);
  if (error) return new Map();
  return new Map(((data ?? []) as { id: string; tenant_id: string; sku: string | null }[]).map((p) => [p.id, { sku: p.sku, tenant_id: p.tenant_id }]));
}
