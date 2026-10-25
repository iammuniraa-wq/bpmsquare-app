import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";

// The follow-up job's choice of orders, shared by every ERP connector (Dynamics 365 since SO2, SAP S/4HANA since SO4b). The
// connector asks the ERP about the orders this returns; what it reads is its own.

/** A follow-up run touches this many orders per workspace, oldest check first. */
export const FOLLOW_UP_BATCH = 25;
/** An order checked more recently than this is left for the next hour's run. */
export const FOLLOW_UP_MIN_AGE_MS = 50 * 60 * 1000;

const settled = (s: string | null): boolean => s === "paid" || s === "cancelled";

/**
 * Which orders the follow-up job asks the ERP about: open or completed orders this connector holds a link for, least recently
 * checked first, not checked in the last 50 minutes. With the Sales orders pull off only orders made here are followed. A
 * completed order whose invoices are all paid or cancelled drops out for good. Every query names the tenant.
 */
export async function pickFollowUpOrders(
  admin: SupabaseClient, tenantId: string, a: { connectorId: string; pullOn: boolean; batch?: number; nowMs?: number },
): Promise<{ ids: string[] } | { skipped: string }> {
  const nowMs = a.nowMs ?? Date.now();
  const { data: cand, error } = await admin.from("sales_orders").select("id, origin, spine, erp_docs_checked_at").eq("tenant_id", tenantId)
    .in("spine", ["open", "in_progress", "completed"]).order("erp_docs_checked_at", { ascending: true, nullsFirst: true }).limit(200);
  if (error) return { skipped: isSchemaPending(error) ? "database update pending" : error.message };
  const orders = ((cand ?? []) as { id: string; origin: string; spine: string; erp_docs_checked_at: string | null }[])
    .filter((o) => !o.erp_docs_checked_at || nowMs - Date.parse(o.erp_docs_checked_at) >= FOLLOW_UP_MIN_AGE_MS);
  if (orders.length === 0) return { ids: [] };

  const ids = orders.map((o) => o.id);
  const linked = new Set<string>();
  const docs = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data: ls } = await admin.from("connector_links").select("object_id").eq("tenant_id", tenantId).eq("connector_id", a.connectorId).eq("entity", "sales_orders").in("object_id", chunk);
    for (const l of (ls ?? []) as { object_id: string }[]) linked.add(l.object_id);
    const { data: ds } = await admin.from("erp_documents").select("order_id, status_spine").eq("tenant_id", tenantId).eq("kind", "invoice").in("order_id", chunk);
    for (const d of (ds ?? []) as { order_id: string; status_spine: string | null }[]) docs.set(d.order_id, [...(docs.get(d.order_id) ?? []), d.status_spine ?? "open"]);
  }
  const todo = orders.filter((o) => {
    if (!linked.has(o.id)) return false;
    if (!a.pullOn && o.origin !== "bpmsquare") return false;
    const spines = docs.get(o.id) ?? [];
    return !(o.spine === "completed" && spines.length > 0 && spines.every(settled));
  }).slice(0, a.batch ?? FOLLOW_UP_BATCH);
  return { ids: todo.map((o) => o.id) };
}

/** Does this workspace have an order made here that this ERP accepted (a link written by a send)? Decides whether the job runs while the pull is off. */
export async function hasSentOrdersTo(admin: SupabaseClient, tenantId: string, connectorId: string): Promise<boolean> {
  const { data, error } = await admin.from("connector_links").select("id").eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", "sales_orders").eq("direction", "push").limit(1);
  return !error && (data ?? []).length > 0;
}
