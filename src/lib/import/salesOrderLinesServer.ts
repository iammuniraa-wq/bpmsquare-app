import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeDbError } from "./server";
import { computeOrderTotals, expectedDateOf } from "@/lib/salesOrders/totals";
import { orderEditable } from "@/lib/salesOrders/types";

const CHUNK = 150;

/** Order ids (of the given orders, all this tenant's) that no ERP has accepted. A missing connector table means none. */
async function erpLinkedIds(supabase: SupabaseClient, tenantId: string, ids: string[]): Promise<Set<string>> {
  const linked = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from("connector_links").select("object_id").eq("tenant_id", tenantId).eq("object_type", "sales_orders").in("object_id", ids.slice(i, i + CHUNK));
    if (error) return linked;
    for (const r of (data ?? []) as { object_id: string }[]) linked.add(r.object_id);
  }
  return linked;
}

export type BulkOrder = { id: string; ref: string; status: string; origin: string };

/**
 * The orders (by id) that a file may still change under the one edit rule, orderEditable(): a draft made here that no
 * ERP has accepted. Bulk routes call this instead of re-deriving the rule.
 */
export async function editableOrderIds(supabase: SupabaseClient, tenantId: string, orders: BulkOrder[]): Promise<Set<string>> {
  const linked = await erpLinkedIds(supabase, tenantId, orders.map((o) => o.id));
  return new Set(orders.filter((o) => orderEditable({ origin: o.origin as "bpmsquare" | "erp", status: o.status as "draft" | "confirmed" | "cancelled" }, linked.has(o.id))).map((o) => o.id));
}

type LineRow = { id: string; order_id: string; qty: number; unit_price: number; discount_pct: number; tax_pct: number; line_total: number; confirmed_date: string | null };

/**
 * Re-derives the line totals, the stored header totals and the expected delivery date of orders after their lines
 * changed in bulk, with the same arithmetic as the order's own lines route (salesOrders/totals.ts). `markStale` clears
 * availability_at on the order's lines: editing lines makes an earlier availability answer stale until it is refreshed.
 * Every query carries the tenant filter.
 */
export async function recomputeSalesOrderTotals(supabase: SupabaseClient, tenantId: string, orderIds: string[], opts: { markStale?: boolean } = {}): Promise<void> {
  const ids = [...new Set(orderIds)];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [{ data: orders }, { data: lines }] = await Promise.all([
      supabase.from("sales_orders").select("id, shipping_amount").in("id", chunk).eq("tenant_id", tenantId),
      supabase.from("sales_order_lines").select("*").in("order_id", chunk).eq("tenant_id", tenantId),
    ]);
    const byOrder = new Map<string, LineRow[]>();
    for (const l of (lines ?? []) as LineRow[]) {
      const list = byOrder.get(l.order_id);
      if (list) list.push(l); else byOrder.set(l.order_id, [l]);
    }
    for (const o of (orders ?? []) as { id: string; shipping_amount: number }[]) {
      const own = byOrder.get(o.id) ?? [];
      const totals = computeOrderTotals(own.map((l) => ({ qty: Number(l.qty), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct), tax_pct: Number(l.tax_pct) })), Number(o.shipping_amount ?? 0));
      const { error } = await supabase.from("sales_orders").update({ ...totals, expected_date: expectedDateOf(own), updated_at: new Date().toISOString() }).eq("id", o.id).eq("tenant_id", tenantId);
      if (error) console.error("[sales_order_lines] total recompute failed", describeDbError(error));
      if (opts.markStale) {
        const { error: staleErr } = await supabase.from("sales_order_lines").update({ availability_at: null }).eq("order_id", o.id).eq("tenant_id", tenantId);
        if (staleErr) console.error("[sales_order_lines] stale mark failed", describeDbError(staleErr));
      }
    }
  }
}
