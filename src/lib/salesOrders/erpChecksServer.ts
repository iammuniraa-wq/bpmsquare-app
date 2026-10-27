import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { ErpHttp } from "@/lib/middleware/erp";
import {
  CHECK_KINDS, CHECK_LABEL, CHECK_STATUS_LABEL, ORDER_CHECKS_BUNDLE, sendReadiness, shapeCheck,
  type CheckOutcome, type ErpCheckView,
} from "./erpChecks";
import { loadTenantRow } from "./erpContext";
import { hashOf } from "./erpState";
import { pickOrderConnector, type OrderDeps } from "./orderConnector";
import { loadLines, loadOrder } from "./server";

// Check with ERP: read the order's customer and products in the ERP, compare, store the three results on the order.
// NOTHING IS WRITTEN TO THE ERP -- every ERP call is a read (the Dataverse GETs in connectors/d365/checks.ts, the SAP order simulation,
// which SAP itself does not save). The order is looked up with the tenant filter, and the ids sent to the ERP are the ones this
// workspace's own connector links hold, never an id from a request. Which ERP is asked is the connector seam's choice
// (salesOrders/orderConnector.ts); the storing, the stale fingerprint and the change-log line are the same for all of them.

export type CheckRun =
  | { kind: "ok"; checks: ErpCheckView[] }
  | { kind: "missing" }
  | { kind: "pending"; bundle: string }
  | { kind: "not_ready"; message: string }
  | { kind: "no_connector" | "unsupported" | "unreachable"; message: string }
  | { kind: "error"; message: string };

export async function runOrderChecks(
  admin: SupabaseClient, tenantId: string, orderId: string, opts: { userId?: string | null; http?: ErpHttp; deps?: OrderDeps; now?: Date } = {},
): Promise<CheckRun> {
  const loaded = await loadOrder(admin, tenantId, orderId);
  if (loaded.kind === "missing") return { kind: "missing" };
  if (loaded.kind === "pending") return { kind: "pending", bundle: "scripts/run-bundle-21-sales-orders-2026-10-23.sql" };
  if (loaded.kind === "error") return { kind: "error", message: loaded.message };
  const { order, erpLinked } = loaded.value;

  const probe = await admin.from("sales_order_checks").select("id").eq("tenant_id", tenantId).limit(1);
  if (probe.error && isSchemaPending(probe.error)) return { kind: "pending", bundle: ORDER_CHECKS_BUNDLE };

  const connector = await pickOrderConnector(admin, tenantId, orderId);
  const lines = await loadLines(admin, tenantId, orderId);
  const customerId = await connector.customerErpId(admin, tenantId, order.account_id);
  const why = sendReadiness({
    origin: order.origin, status: order.status, erpLinked, hasAccount: !!order.account_id, customerLinked: customerId !== null,
    lineCount: lines.length, allQuantitiesPositive: lines.every((l) => Number(l.qty) > 0), forCheck: true,
  });
  if (why) return { kind: "not_ready", message: why };

  const tenant = await loadTenantRow(admin, tenantId);
  if (!tenant) return { kind: "error", message: "Workspace not found" };
  const opened = await connector.open({ admin, tenantId, tenant, deps: { ...(opts.deps ?? {}), ...(opts.http ? { http: opts.http } : {}) } });
  if (!opened.ok) return { kind: opened.kind, message: opened.message };

  const erpProducts = await connector.productErpIds(admin, tenantId, lines.map((l) => l.product_id).filter((x): x is string => !!x));
  const hash = hashOf(order, lines);
  let outcomes: CheckOutcome[];
  try {
    outcomes = await opened.session.check({ admin, tenantId, order, lines, customerId, erpProducts });
  } catch (e) {
    return { kind: "unreachable", message: (e as Error).message ?? "The ERP did not answer." };
  }

  const at = (opts.now ?? new Date()).toISOString();
  for (const o of outcomes) {
    const { error } = await admin.from("sales_order_checks").upsert(
      { tenant_id: tenantId, order_id: orderId, kind: o.kind, status: o.status, message: o.message, detail: o.detail, checked_at: at, quantity_hash: hash },
      { onConflict: "tenant_id,order_id,kind" },
    );
    if (error) return isSchemaPending(error) ? { kind: "pending", bundle: ORDER_CHECKS_BUNDLE } : { kind: "error", message: error.message };
  }

  await logChange(admin, {
    tenantId, objectType: "sales_orders", objectId: orderId, objectLabel: order.ref, action: "update", actorId: opts.userId ?? null, actorEmail: null,
    changes: [{ field: "checked with ERP", from: null, to: outcomes.map((o) => `${CHECK_LABEL[o.kind]}: ${CHECK_STATUS_LABEL[o.status].toLowerCase()}`).join(", ") }],
  });

  const checks = outcomes.flatMap((o) => {
    const v = shapeCheck({ kind: o.kind, status: o.status, message: o.message, detail: o.detail, checked_at: at, quantity_hash: hash }, hash);
    return v ? [v] : [];
  });
  return { kind: "ok", checks: CHECK_KINDS.flatMap((k) => checks.filter((c) => c.kind === k)) };
}
