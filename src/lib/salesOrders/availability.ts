import type { SupabaseClient } from "@supabase/supabase-js";
import { inventoryItemForProduct, loadInventoryCandidates, loadProductSkus } from "@/lib/inventoryForProduct";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { SalesOrder, SalesOrderLine } from "./types";

// Master-data availability (SO1): what can be promised from data this product already holds, before any ERP is
// asked. Stock on hand comes from inventory_items matched to the product by SKU (inventoryItemForProduct); the
// lead time from products.lead_time_days. It is an ESTIMATE and is stored with availability_source = 'master'.
// ERP rows (SO2) overwrite it with source 'erp'; those are never touched here.

export type AvailabilityLine = { id: string; product_id: string | null; qty: number; availability_source?: string | null };
export type AvailabilityResult = { confirmed_qty: number | null; confirmed_date: string | null };
export type StockBasis = "stock" | "lead_time" | "short" | "unknown";

const DAY_MS = 86_400_000;

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * One line. `stock` is null when the product has no matching inventory item (or the line has no product);
 * `leadTimeDays` is null when the product has none.
 *  - stock covers the quantity: confirmed in full, today.
 *  - otherwise a lead time promises the full quantity at today + lead time (even when stock is unknown).
 *  - short stock with no lead time confirms what is on the shelf and no date.
 *  - nothing known: nothing confirmed.
 */
export function masterAvailability(
  line: { qty: number },
  basis: { stock: number | null; leadTimeDays: number | null },
  today: string,
): AvailabilityResult & { basis: StockBasis } {
  const { stock, leadTimeDays } = basis;
  if (stock !== null && stock >= line.qty) return { confirmed_qty: line.qty, confirmed_date: today, basis: "stock" };
  if (leadTimeDays !== null && leadTimeDays >= 0) return { confirmed_qty: line.qty, confirmed_date: addDays(today, Math.floor(leadTimeDays)), basis: "lead_time" };
  if (stock !== null) return { confirmed_qty: Math.max(0, stock), confirmed_date: null, basis: "short" };
  return { confirmed_qty: null, confirmed_date: null, basis: "unknown" };
}

export type ComputedAvailability = Record<string, AvailabilityResult & { basis: StockBasis }>;

/**
 * Availability for each line that is not already answered by the ERP. Everything is read tenant-scoped; a
 * missing inventory table or column simply means "no stock data". Returns lineId -> result.
 */
export async function computeMasterAvailability(
  supabase: SupabaseClient,
  tenantId: string,
  lines: readonly AvailabilityLine[],
  today: string,
): Promise<ComputedAvailability> {
  const mine = lines.filter((l) => l.availability_source !== "erp");
  const productIds = mine.map((l) => l.product_id).filter((x): x is string => !!x);
  const skus = await loadProductSkus(supabase, tenantId, productIds);
  const inventory = skus.size > 0 ? await loadInventoryCandidates(supabase, tenantId) : [];

  const leadTimes = new Map<string, number | null>();
  if (productIds.length > 0) {
    const { data, error } = await supabase.from("products").select("id, lead_time_days").eq("tenant_id", tenantId).in("id", [...new Set(productIds)]);
    if (!error) for (const r of (data ?? []) as { id: string; lead_time_days: number | null }[]) leadTimes.set(r.id, typeof r.lead_time_days === "number" ? r.lead_time_days : null);
    else if (!isSchemaPending(error)) throw new Error(error.message);
  }

  const itemIdByProduct = new Map<string, string | null>();
  for (const [pid, p] of skus) itemIdByProduct.set(pid, inventoryItemForProduct(tenantId, p, inventory));
  const itemIds = [...new Set([...itemIdByProduct.values()].filter((x): x is string => !!x))];
  const onHand = new Map<string, number>();
  if (itemIds.length > 0) {
    const { data, error } = await supabase.from("inventory_items").select("id, qty_on_hand").eq("tenant_id", tenantId).in("id", itemIds);
    if (!error) for (const r of (data ?? []) as { id: string; qty_on_hand: number | null }[]) onHand.set(r.id, Number(r.qty_on_hand ?? 0));
  }

  const out: ComputedAvailability = {};
  for (const l of mine) {
    const itemId = l.product_id ? itemIdByProduct.get(l.product_id) ?? null : null;
    const stock = itemId && onHand.has(itemId) ? (onHand.get(itemId) as number) : null;
    const lead = l.product_id ? leadTimes.get(l.product_id) ?? null : null;
    out[l.id] = masterAvailability(l, { stock, leadTimeDays: lead }, today);
  }
  return out;
}

/** The note shown beside a computed date, for the Availability tab's source tag. */
export function availabilityBasisLabel(b: StockBasis): string {
  return { stock: "In stock", lead_time: "Product lead time", short: "Short on stock, no lead time set", unknown: "No stock or lead time on file" }[b];
}

export function lineIsLate(l: Pick<SalesOrderLine, "requested_date" | "confirmed_date">): boolean {
  return !!l.requested_date && !!l.confirmed_date && l.confirmed_date > l.requested_date;
}

export function lineIsShort(l: Pick<SalesOrderLine, "qty" | "confirmed_qty">): boolean {
  return l.confirmed_qty !== null && l.confirmed_qty !== undefined && Number(l.confirmed_qty) < Number(l.qty);
}

/**
 * The Availability tab (GET /api/sales-orders/[id]/availability): per line what was asked and wanted-by against what is
 * confirmed and when, with where the answer came from. `state` per line: not_checked (never asked), stale (edited since
 * the last check; the earlier answer is kept on show), late (confirmed after the date asked), short (confirmed less than
 * asked) or ok.
 */
export function availabilityView(order: Pick<SalesOrder, "id" | "expected_date" | "status">, lines: SalesOrderLine[]) {
  const rows = lines.map((l) => {
    const checked = l.availability_at ?? null;
    const hasAnswer = l.confirmed_qty !== null || l.confirmed_date !== null;
    const state: "not_checked" | "stale" | "late" | "short" | "ok" = !l.availability_source && !hasAnswer ? "not_checked"
      : !checked ? "stale"
      : lineIsLate(l) ? "late"
      : lineIsShort(l) ? "short"
      : "ok";
    return {
      id: l.id, line_no: l.line_no, description: l.description, qty: Number(l.qty), uom: l.uom,
      requested_date: l.requested_date, confirmed_qty: l.confirmed_qty === null ? null : Number(l.confirmed_qty), confirmed_date: l.confirmed_date,
      source: l.availability_source, source_label: l.availability_source === "erp" ? "ERP" : l.availability_source === "master" ? "Master data (estimate)" : null,
      checked_at: checked, state,
    };
  });
  const times = rows.map((r) => r.checked_at).filter((x): x is string => !!x).sort();
  return {
    order_id: order.id,
    stale: rows.some((r) => r.state === "stale"),
    refreshed_at: times.length ? times[times.length - 1] : null,
    expected_date: order.expected_date ?? null,
    needs_attention: order.status !== "cancelled" && rows.some((r) => r.state === "late" || r.state === "short"),
    lines: rows,
  };
}
