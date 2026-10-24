import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMasterAvailability } from "./availability";
import { loadLines } from "./server";
import { expectedDateOf } from "./totals";
import type { SalesOrderLine } from "./types";

export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/**
 * Re-asks master data (stock on hand, product lead time) for every line the ERP has not answered, stores the
 * result on the lines (availability_source 'master', availability_at now) and re-derives the order's expected
 * delivery date from ALL lines, so an ERP-confirmed date still counts. ERP rows (source 'erp') are never touched.
 */
export async function refreshOrderAvailability(
  db: SupabaseClient,
  tenantId: string,
  orderId: string,
  now: Date = new Date(),
): Promise<{ lines: SalesOrderLine[]; expected_date: string | null; refreshed_at: string }> {
  const lines = await loadLines(db, tenantId, orderId);
  const stamp = now.toISOString();
  const computed = await computeMasterAvailability(db, tenantId, lines, todayIso(now));

  for (const l of lines) {
    const r = computed[l.id];
    if (!r) continue;
    const { error } = await db.from("sales_order_lines").update({
      confirmed_qty: r.confirmed_qty, confirmed_date: r.confirmed_date, availability_source: "master", availability_at: stamp,
    }).eq("id", l.id).eq("order_id", orderId).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    l.confirmed_qty = r.confirmed_qty;
    l.confirmed_date = r.confirmed_date;
    l.availability_source = "master";
    l.availability_at = stamp;
  }

  const expected = expectedDateOf(lines);
  const { error } = await db.from("sales_orders").update({ expected_date: expected, updated_at: stamp }).eq("id", orderId).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return { lines, expected_date: expected, refreshed_at: stamp };
}
