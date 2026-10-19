import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBomGraph, rollUpFor } from "@/lib/products/bomServer";
import { tenantOwnsObject } from "@/lib/objectFeatures";
import type { RollUp } from "@/lib/products/bom";
import { isKitType, type CatalogueProduct } from "./productItems";
import { isMissingRelation, resolveProducts, toCatalogueProducts } from "./server";

// The catalogue as the estimator sees it: the picker for hand-added lines, the
// products behind the lines on a saved estimate, and a kit's components. Every
// read is tenant-scoped (MULTI_TENANT_GUARDRAILS.md); the tenant's own Products
// module has to be on, otherwise there is no catalogue and the screens fall back
// to free-text lines.

/** Strips the characters that have a meaning in PostgREST's `.or()` filter language. */
export function cleanSearch(q: string): string {
  return q.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export const CATALOGUE_LIMIT = 25;

const COLS = "id, sku, ref, name, item_type, uom, cost_price, status, created_at";
const COLS_NO_TYPE = "id, sku, ref, name, uom, cost_price, status, created_at";

/** Active products and kits matching the text (name, SKU or reference), newest names first alphabetically. */
export async function searchCatalogue(
  supabase: SupabaseClient, tenantId: string, q: string, limit: number = CATALOGUE_LIMIT
): Promise<{ items: CatalogueProduct[]; available: boolean }> {
  if (!(await tenantOwnsObject(tenantId, "products"))) return { items: [], available: false };
  const term = cleanSearch(q);
  for (const cols of [COLS, COLS_NO_TYPE]) {
    let query = supabase.from("products").select(cols).eq("tenant_id", tenantId).neq("status", "inactive");
    if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,ref.ilike.%${term}%`);
    const { data, error } = await query.order("name").limit(Math.min(Math.max(limit, 1), 50));
    if (!error) return { items: toCatalogueProducts(data), available: true };
    if (!isMissingRelation(error)) throw { status: 500, message: error.message };
  }
  return { items: [], available: false };
}

/** The products behind a saved estimate's lines, by id (ids that are not this tenant's do not come back). */
export async function loadLineProducts(supabase: SupabaseClient, tenantId: string, ids: readonly string[]): Promise<Map<string, CatalogueProduct>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  return (await resolveProducts(supabase, tenantId, [], unique)).byId;
}

export type KitComponentRow = {
  lineId: string;
  componentId: string;
  name: string;
  sku: string | null;
  itemType: string | null;
  qty: number;
  uom: string | null;
  scrapPct: number;
  lineKind: "consumed" | "used";
  /** Cost of one unit of the component (null = none on file). */
  unitCost: number | null;
  /** What it adds to the cost of ONE unit of the kit. */
  lineCost: number | null;
  /** The component's own rolled-up cost when it is a kit with lines. */
  nested: boolean;
};

export type KitComponents = {
  productId: string;
  name: string;
  /** Cost of one unit of the kit. */
  total: number;
  incomplete: boolean;
  missing: string[];
  rows: KitComponentRow[];
};

/** The components behind a kit line, read-only. Null when the product is not this tenant's kit (or has none). */
export async function kitComponents(supabase: SupabaseClient, tenantId: string, product: CatalogueProduct): Promise<KitComponents | null> {
  if (!isKitType(product.item_type)) return null;
  const graph = await loadBomGraph(supabase, tenantId, product.id);
  if (graph.getLines(product.id).length === 0) return null;
  const r: RollUp = rollUpFor(graph, product.id);
  return {
    productId: product.id,
    name: product.name,
    total: r.total,
    incomplete: r.incomplete,
    missing: r.missing.map((m) => m.name),
    rows: r.lines.map((l) => ({
      lineId: l.lineId, componentId: l.componentId, name: l.name, sku: l.sku, itemType: l.itemType, qty: l.qty, uom: l.uom,
      scrapPct: l.scrapPct, lineKind: l.lineKind, unitCost: l.unitCost, lineCost: l.lineCost, nested: !!l.sub,
    })),
  };
}
