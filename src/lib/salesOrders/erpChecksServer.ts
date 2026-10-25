import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { priceFacts, readCreditFacts, readPriceListId, readProductFacts, type ProductFacts } from "@/lib/connectors/d365/checks";
import type { ErpHttp } from "@/lib/middleware/erp";
import {
  CHECK_KINDS, CHECK_LABEL, CHECK_STATUS_LABEL, ORDER_CHECKS_BUNDLE, compareCredit, comparePrice, compareStock, sendReadiness, shapeCheck,
  type CheckOutcome, type ErpCheckView, type ErpRead, type PriceLineInput, type StockLineInput,
} from "./erpChecks";
import { customerErpId, loadTenantRow, openErp, productErpIds } from "./erpContext";
import { hashOf } from "./erpState";
import { loadLines, loadOrder } from "./server";

// Check with ERP: read the order's customer and products in the ERP, compare, store the three results on the order.
// NOTHING IS WRITTEN TO THE ERP -- every ERP call below is a GET (src/lib/connectors/d365/checks.ts). The order is looked up
// with the tenant filter, and the ids sent to the ERP are the ones this workspace's own connector links hold, never an id from
// a request.

export type CheckRun =
  | { kind: "ok"; checks: ErpCheckView[] }
  | { kind: "missing" }
  | { kind: "pending"; bundle: string }
  | { kind: "not_ready"; message: string }
  | { kind: "no_connector" | "unsupported" | "unreachable"; message: string }
  | { kind: "error"; message: string };

export async function runOrderChecks(
  admin: SupabaseClient, tenantId: string, orderId: string, opts: { userId?: string | null; http?: ErpHttp; now?: Date } = {},
): Promise<CheckRun> {
  const loaded = await loadOrder(admin, tenantId, orderId);
  if (loaded.kind === "missing") return { kind: "missing" };
  if (loaded.kind === "pending") return { kind: "pending", bundle: "scripts/run-bundle-21-sales-orders-2026-10-23.sql" };
  if (loaded.kind === "error") return { kind: "error", message: loaded.message };
  const { order, erpLinked } = loaded.value;

  const probe = await admin.from("sales_order_checks").select("id").eq("tenant_id", tenantId).limit(1);
  if (probe.error && isSchemaPending(probe.error)) return { kind: "pending", bundle: ORDER_CHECKS_BUNDLE };

  const lines = await loadLines(admin, tenantId, orderId);
  const customerId = await customerErpId(admin, tenantId, order.account_id);
  const why = sendReadiness({
    origin: order.origin, status: order.status, erpLinked, hasAccount: !!order.account_id, customerLinked: customerId !== null,
    lineCount: lines.length, allQuantitiesPositive: lines.every((l) => Number(l.qty) > 0), forCheck: true,
  });
  if (why) return { kind: "not_ready", message: why };

  const tenant = await loadTenantRow(admin, tenantId);
  if (!tenant) return { kind: "error", message: "Workspace not found" };
  const erp = await openErp(admin, tenantId, tenant, opts.http);
  if (!erp.ok) return { kind: erp.kind, message: erp.message };
  const { http, cfg } = erp;

  const currency = order.currency || "USD";
  const productIds = lines.map((l) => l.product_id).filter((x): x is string => !!x);
  const erpIds = await productErpIds(admin, tenantId, productIds);
  const hash = hashOf(order, lines);

  // Credit
  const credit = compareCredit({
    customerLinked: customerId !== null,
    read: customerId ? await readCreditFacts(http, customerId) : null,
    orderTotal: Number(order.total), currency,
  });

  // Price and stock share one read per product.
  const priceListId = await readPriceListId(http, customerId, cfg.price_list_id ?? null);
  const facts = new Map<string, ErpRead<ProductFacts>>();
  let down: string | null = null;
  for (const pid of new Set(productIds)) {
    const ext = erpIds.get(pid);
    if (!ext) continue;
    if (down) { facts.set(pid, { ok: false, reason: down }); continue; }
    const r = await readProductFacts(http, ext, priceListId);
    if (!r.ok && !/no longer exists/.test(r.reason)) down = r.reason;
    facts.set(pid, r);
  }
  const factsOf = (pid: string | null): ErpRead<ProductFacts> | null => (pid ? facts.get(pid) ?? null : null);

  const priceLines: PriceLineInput[] = lines.map((l) => {
    const f = factsOf(l.product_id);
    return {
      lineId: l.id, lineNo: l.line_no, description: l.description, unitPrice: Number(l.unit_price),
      hasProduct: !!l.product_id, productLinked: !!l.product_id && erpIds.has(l.product_id),
      erp: f ? (f.ok ? { ok: true, value: priceFacts(f.value) } : f) : null,
    };
  });
  const stockLines: StockLineInput[] = lines.map((l) => {
    const f = factsOf(l.product_id);
    return {
      lineId: l.id, lineNo: l.line_no, description: l.description, qty: Number(l.qty), uom: l.uom,
      hasProduct: !!l.product_id, productLinked: !!l.product_id && erpIds.has(l.product_id),
      erp: f ? (f.ok ? { ok: true, value: { onHand: f.value.onHand } } : f) : null,
    };
  });
  const outcomes: CheckOutcome[] = [credit, comparePrice({ lines: priceLines, currency }), compareStock({ lines: stockLines })];

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
