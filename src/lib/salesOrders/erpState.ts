import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadActorNames } from "@/lib/actorNames";
import { isSchemaPending } from "@/lib/marketing/pending";
import {
  CHECK_COLUMNS, TRANSFER_COLUMNS, quantityHash, shapeCheck, shapeTransfer,
  type CheckRow, type ErpCheckView, type ErpTransferView, type HashLine, type TransferRow,
} from "./erpChecks";
import type { SalesOrder, SalesOrderLine } from "./types";

// Reading what Check with ERP and Send to ERP stored (migration 0217), for the order view and the API. A missing table is
// "nothing yet" and `pending` says so, so the screen can show "Needs a database update" instead of an empty log.

export const hashOf = (order: { account_id: string | null; currency: string | null; shipping_amount: number | string | null }, lines: Pick<SalesOrderLine, "line_no" | "product_id" | "qty" | "unit_price" | "discount_pct" | "tax_pct">[]): string =>
  quantityHash(order, lines.map((l): HashLine => ({ line_no: Number(l.line_no), product_id: l.product_id, qty: Number(l.qty), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct), tax_pct: Number(l.tax_pct) })));

export async function loadChecks(
  db: SupabaseClient, tenantId: string, order: Pick<SalesOrder, "id" | "account_id" | "currency" | "shipping_amount">, lines: SalesOrderLine[],
): Promise<{ checks: ErpCheckView[]; pending: boolean }> {
  const { data, error } = await db.from("sales_order_checks").select(CHECK_COLUMNS).eq("order_id", order.id).eq("tenant_id", tenantId);
  if (error) return { checks: [], pending: isSchemaPending(error) };
  const current = hashOf(order, lines);
  const checks = ((data ?? []) as unknown as CheckRow[]).flatMap((r) => { const v = shapeCheck(r, current); return v ? [v] : []; });
  return { checks, pending: false };
}

export async function loadTransfers(db: SupabaseClient, tenantId: string, orderId: string): Promise<{ transfers: ErpTransferView[]; pending: boolean }> {
  const { data, error } = await db.from("sales_order_transfers").select(TRANSFER_COLUMNS).eq("order_id", orderId).eq("tenant_id", tenantId)
    .order("attempted_at", { ascending: false }).limit(50);
  if (error) return { transfers: [], pending: isSchemaPending(error) };
  const rows = (data ?? []) as unknown as TransferRow[];
  let names = new Map<string, string>();
  try {
    names = await loadActorNames(createAdminSupabase() as unknown as SupabaseClient, tenantId, rows.map((r) => r.user_id));
  } catch {
    // A name is a nicety: the row still shows its time, result and ERP number.
  }
  return { transfers: rows.flatMap((r) => { const v = shapeTransfer(r, names); return v ? [v] : []; }), pending: false };
}

/** Are both 0217 tables there? One tenant-scoped probe each. */
export async function erpTablesReady(db: SupabaseClient, tenantId: string): Promise<boolean> {
  for (const table of ["sales_order_checks", "sales_order_transfers"]) {
    const { error } = await db.from(table).select("id").eq("tenant_id", tenantId).limit(1);
    if (error && isSchemaPending(error)) return false;
  }
  return true;
}
