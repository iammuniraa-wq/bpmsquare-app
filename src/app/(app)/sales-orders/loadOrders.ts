import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { SalesOrder } from "@/lib/salesOrders/types";

export type OrderListRow = Pick<SalesOrder, "id" | "ref" | "status" | "status_label" | "spine" | "account_id" | "total" | "currency" | "expected_date" | "requested_date" | "customer_po" | "created_at" | "origin"> & {
  account_name: string;
  /** The ERP's own order number when an ERP holds this order (the link's key); null otherwise. */
  erp_number: string | null;
  /** The customer is named by the ERP and has no Account here yet. */
  customer_not_synced: boolean;
};

const COLUMNS = "id, ref, status, status_label, spine, account_id, total, currency, expected_date, requested_date, customer_po, created_at, origin";

/**
 * The list page's rows, read with the signed-in session and the tenant filter written out (RLS is the backstop).
 * The table comes from a hand-applied migration: while it is pending (or a column is not there yet) the answer is an
 * empty list, never an error page.
 */
export async function loadOrderRows(supabase: SupabaseClient, tenantId: string): Promise<{ rows: OrderListRow[]; available: boolean }> {
  // erp_customer_name comes with migration 0216: while that is pending the list still loads, without it.
  const read = (cols: string) => supabase.from("sales_orders").select(cols).eq("tenant_id", tenantId).order("created_at", { ascending: false });
  let res = await read(`${COLUMNS}, erp_customer_name`);
  if (res.error && isSchemaPending(res.error)) res = await read(COLUMNS);
  const { data, error } = res;
  if (error) return { rows: [], available: false };
  const orders = (data ?? []) as unknown as (Omit<OrderListRow, "account_name" | "erp_number" | "customer_not_synced"> & { erp_customer_name?: string | null })[];
  const erpNumbers = new Map<string, string>();
  const { data: links } = await supabase.from("connector_links").select("object_id, external_key").eq("tenant_id", tenantId).eq("object_type", "sales_orders").limit(5000);
  for (const l of (links ?? []) as { object_id: string; external_key: string | null }[]) if (l.external_key) erpNumbers.set(l.object_id, l.external_key);
  const ids = [...new Set(orders.map((o) => o.account_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: accounts } = await supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", ids);
    for (const a of accounts ?? []) names.set(a.id as string, a.name as string);
  }
  return {
    rows: orders.map((o) => ({
      ...o, total: Number(o.total ?? 0), erp_number: erpNumbers.get(o.id) ?? null,
      account_name: (o.account_id ? names.get(o.account_id) : null) ?? o.erp_customer_name ?? "—",
      customer_not_synced: !o.account_id && !!o.erp_customer_name,
    })),
    available: true,
  };
}
