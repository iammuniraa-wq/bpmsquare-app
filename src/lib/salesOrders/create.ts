import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateNextSalesOrderRef } from "./ref";
import type { CleanOrderLine } from "./totals";

type DbError = { code?: string; message: string } | null;

/**
 * Inserts the order header with the next `<prefix>-NNNN` ref. Two requests racing for the same number meet the
 * unique (tenant_id, ref) index; the loser gets 23505 and simply asks for the next ref again.
 */
export async function insertOrderWithRef(
  db: SupabaseClient,
  tenantId: string,
  prefix: string,
  row: Record<string, unknown>,
): Promise<{ data: { id: string; ref: string } | null; error: DbError }> {
  let last: DbError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await generateNextSalesOrderRef(db, tenantId, prefix);
    const { data, error } = await db.from("sales_orders").insert({ ...row, tenant_id: tenantId, ref }).select("id, ref").single();
    if (!error && data) return { data: data as { id: string; ref: string }, error: null };
    last = error;
    if (error?.code !== "23505") break;
  }
  return { data: null, error: last };
}

export type LineCarry = { confirmed_qty?: number | null; confirmed_date?: string | null; availability_source?: string | null; availability_at?: string | null };

export function lineRows(tenantId: string, orderId: string, lines: readonly CleanOrderLine[], carry: readonly (LineCarry | undefined)[] = []) {
  return lines.map((l, i) => ({
    tenant_id: tenantId,
    order_id: orderId,
    line_no: i + 1,
    product_id: l.product_id,
    description: l.description,
    printed_text: l.printed_text,
    qty: l.qty,
    uom: l.uom,
    unit_price: l.unit_price,
    discount_pct: l.discount_pct,
    tax_pct: l.tax_pct,
    line_total: l.line_total,
    requested_date: l.requested_date,
    confirmed_qty: carry[i]?.confirmed_qty ?? null,
    confirmed_date: carry[i]?.confirmed_date ?? null,
    availability_source: carry[i]?.availability_source ?? null,
    availability_at: carry[i]?.availability_at ?? null,
  }));
}
