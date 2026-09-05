// Cost sheets (cost-based step 1): what one unit of a product consumes,
// turned into the cost_items a quote line hands the engine. Pure, no
// framework imports -- the server adapter and the product form both use it.

import type { CostCandidate, CostInputKind, CostItem } from "@/lib/pricing-core";

/** One row of a product's cost sheet: per UNIT of the product. */
export type CostSheetItem = { path: string; qty: number; kind?: CostInputKind };

/** The conventional path for a bought-in part's unit cost. A product with
 *  no cost sheet but a cost price is treated as one bought-in part. */
export const PURCHASE_PATH = "purchase.unit_cost";
export const PRODUCT_COST_SOURCE = "PRODUCT_COST";

export function parseCostSheet(raw: unknown): CostSheetItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CostSheetItem[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.path !== "string" || !r.path.trim()) continue;
    const qty = Number(r.qty);
    if (!Number.isFinite(qty) || qty < 0) continue;
    out.push({ path: r.path.trim(), qty, ...(typeof r.kind === "string" ? { kind: r.kind as CostInputKind } : {}) });
  }
  return out;
}

/**
 * Cost items for `quantity` units of a product. The sheet's per-unit
 * quantities scale with the line; `candidates` (this product's own cost
 * figures, keyed by path) ride along so the ladder sees them.
 */
export function costItemsForProduct(
  product: { cost_sheet?: unknown; cost_price?: number | null },
  quantity: number,
  candidates: Record<string, CostCandidate[]> = {}
): CostItem[] {
  const sheet = parseCostSheet(product.cost_sheet);
  const rows: CostSheetItem[] = sheet.length > 0
    ? sheet
    : [{ path: PURCHASE_PATH, qty: 1, kind: "PURCHASE" }];
  return rows.map((r) => ({
    path: r.path,
    qty: Math.round(r.qty * quantity * 10000) / 10000,
    ...(r.kind ? { kind: r.kind } : {}),
    ...(candidates[r.path]?.length ? { candidates: candidates[r.path] } : {}),
  }));
}

/** The product's own ERP cost as a ladder candidate for the purchase path. */
export function productCostCandidate(product: { cost_price?: number | null; cost_price_as_of?: string | null; updated_at?: string | null }): CostCandidate | null {
  if (product.cost_price === null || product.cost_price === undefined) return null;
  const value = Number(product.cost_price);
  if (!Number.isFinite(value) || value <= 0) return null;
  const asOf = product.cost_price_as_of ?? (product.updated_at ? String(product.updated_at).slice(0, 10) : null);
  return { source: PRODUCT_COST_SOURCE, quality: "actual", value, as_of: asOf, path: PURCHASE_PATH };
}
