import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SalesOrder } from "@/lib/salesOrders/types";

export type OrderListRow = Pick<SalesOrder, "id" | "ref" | "status" | "status_label" | "spine" | "account_id" | "total" | "currency" | "expected_date" | "requested_date" | "customer_po" | "created_at"> & {
  account_name: string;
};

const COLUMNS = "id, ref, status, status_label, spine, account_id, total, currency, expected_date, requested_date, customer_po, created_at";

/**
 * The list page's rows, read with the signed-in session and the tenant filter written out (RLS is the backstop).
 * The table comes from a hand-applied migration: while it is pending (or a column is not there yet) the answer is an
 * empty list, never an error page.
 */
export async function loadOrderRows(supabase: SupabaseClient, tenantId: string): Promise<{ rows: OrderListRow[]; available: boolean }> {
  const { data, error } = await supabase.from("sales_orders").select(COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) return { rows: [], available: false };
  const orders = (data ?? []) as unknown as Omit<OrderListRow, "account_name">[];
  const ids = [...new Set(orders.map((o) => o.account_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: accounts } = await supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", ids);
    for (const a of accounts ?? []) names.set(a.id as string, a.name as string);
  }
  return { rows: orders.map((o) => ({ ...o, total: Number(o.total ?? 0), account_name: names.get(o.account_id) ?? "—" })), available: true };
}
