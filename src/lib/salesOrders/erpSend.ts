import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { emitOrderConfirmed } from "@/lib/events/emitters";
import type { ErpHttp } from "@/lib/middleware/erp";
import { recordMessage } from "@/lib/middleware/messages";
import { ORDER_CHECKS_BUNDLE, confirmNeeded, sendReadiness, type TransferResult } from "./erpChecks";
import { loadTenantRow } from "./erpContext";
import { erpTablesReady, loadChecks } from "./erpState";
import { pickOrderConnector, type ConnectorId, type OrderDeps } from "./orderConnector";
import { loadLines, loadOrder, SALES_ORDER_BUNDLE } from "./server";

export { outLines, orderNote } from "./erpPayload";

// Send to ERP (SO3, docs/design/sales-order.md; SAP added in SO4b): the order, with its lines, becomes a Sales Order in the connected ERP.
//
// What this guarantees, because it writes to somebody else's system:
//   - the order is loaded with the tenant filter and the customer's ERP id comes from this workspace's own link; no id in a
//     request body is ever used;
//   - one BPMSquare order is ONE ERP order, even when two presses overlap: the order's connector_links row is claimed
//     (external_id "pending:<uuid>") before the first ERP call, and an ERP order whose link was lost -- or whose answer timed out --
//     is found again by the BPMSquare marker the connector wrote into it (Dynamics: the description; SAP: see sap_s4/orderSend.ts);
//   - a failure before the ERP made anything gives the claim back, so the order stays editable and Retry works; a failure after
//     keeps it, holding the ERP's id, so Retry resumes from that order instead of making a twin;
//   - every attempt leaves a row in the transfer log and a line in the Monitor.
// Everything that is the ERP's own (its words, its calls, its payload) is behind the OrderConnector seam (orderConnector.ts).

export type SendResult =
  | { state: "sent"; erpNumber: string | null; link: string | null }
  /** The order is in the ERP already (a second press, or a lost link found again). */
  | { state: "already_sent"; erpNumber: string | null }
  /** A check is not a current pass and the caller did not confirm. */
  | { state: "needs_confirmation"; items: string[] }
  | { state: "not_ready"; message: string }
  | { state: "missing" }
  | { state: "pending"; bundle: string }
  | { state: "in_progress" }
  | { state: "no_connector" | "unsupported" | "unreachable"; message: string }
  | { state: "failed"; step: string; headline: string; fix: string }
  | { state: "error"; message: string };

const ENTITY = "sales_orders";
const PENDING_PREFIX = "pending:";
const isPending = (externalId: string) => externalId.startsWith(PENDING_PREFIX);
/** A send that died before reaching the ERP leaves its claim behind (routes stop at 60 s); after this long a later send may take it over. */
const CLAIM_STALE_MS = 10 * 60_000;

type LinkRow = { id?: string; external_id: string; external_key: string | null; synced_at: string | null; created_at?: string | null };

// An order's links are looked up across every ERP: an order already in SAP is not sent to Dynamics, and the other way round.
const linkRows = async (admin: SupabaseClient, tenantId: string, orderId: string): Promise<LinkRow[]> => {
  const { data } = await admin.from("connector_links").select("id, external_id, external_key, synced_at, created_at").eq("tenant_id", tenantId)
    .eq("entity", ENTITY).eq("object_id", orderId).order("created_at", { ascending: true }).order("id", { ascending: true });
  return (data ?? []) as LinkRow[];
};

type Claim = { pendingId: string; keep: boolean };

async function acquireClaim(admin: SupabaseClient, tenantId: string, connectorId: string, orderId: string): Promise<{ busy: true } | { busy: false; claim: Claim } | { busy: false; done: LinkRow }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await linkRows(admin, tenantId, orderId);
    const real = rows.find((r) => !isPending(r.external_id));
    if (real) return { busy: false, done: real };
    const pendingId = `${PENDING_PREFIX}${randomUUID()}`;
    const now = new Date().toISOString();
    if (rows.length === 0) {
      const { error } = await admin.from("connector_links").insert({
        tenant_id: tenantId, connector_id: connectorId, entity: ENTITY, object_type: "sales_orders", object_id: orderId,
        external_id: pendingId, external_key: null, direction: "push", synced_at: now,
      });
      if (error) {
        if (error.code !== "23505") throw new Error(`could not start the send (${error.message})`);
        continue;
      }
      // Two overlapping inserts can both succeed (no unique index on the order): the oldest row wins, the other stands down.
      const after = await linkRows(admin, tenantId, orderId);
      if (after.length <= 1 || after[0].external_id === pendingId) return { busy: false, claim: { pendingId, keep: false } };
      await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", ENTITY).eq("object_id", orderId).eq("external_id", pendingId);
      return { busy: true };
    }
    // Somebody else's claim is there. It is theirs unless it has gone stale; taking it over is a compare-and-swap on its placeholder.
    const held = rows[0];
    const age = Date.now() - Date.parse(held.synced_at ?? "");
    if (!(age > CLAIM_STALE_MS)) return { busy: true };
    const { data } = await admin.from("connector_links").update({ external_id: pendingId, synced_at: now, connector_id: connectorId })
      .eq("tenant_id", tenantId).eq("entity", ENTITY).eq("object_id", orderId).eq("external_id", held.external_id).select("id");
    if ((data as unknown[] | null)?.length) return { busy: false, claim: { pendingId, keep: false } };
  }
  return { busy: true };
}

async function writeLink(admin: SupabaseClient, tenantId: string, connectorId: string, orderId: string, externalId: string, key: string | null): Promise<string | null> {
  const patch = { external_id: externalId, external_key: key, synced_at: new Date().toISOString() };
  const { data, error } = await admin.from("connector_links").update(patch)
    .eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", ENTITY).eq("object_id", orderId).select("id");
  if (error) return error.message;
  if ((data as unknown[] | null)?.length) return null;
  const ins = await admin.from("connector_links").insert({ tenant_id: tenantId, connector_id: connectorId, entity: ENTITY, object_type: "sales_orders", object_id: orderId, direction: "push", ...patch });
  return ins.error ? ins.error.message : null;
}

async function releaseClaim(admin: SupabaseClient, tenantId: string, connectorId: string, orderId: string, claim: Claim | null): Promise<void> {
  if (!claim || claim.keep) return;
  // If this delete fails the placeholder simply goes stale and a later send takes it over.
  await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", ENTITY).eq("object_id", orderId).eq("external_id", claim.pendingId);
}

async function recordTransfer(
  admin: SupabaseClient, tenantId: string, orderId: string,
  t: { userId: string | null; result: TransferResult; erpNumber: string | null; step: string | null; message: string | null; at: Date },
): Promise<string | null> {
  const { error } = await admin.from("sales_order_transfers").insert({
    tenant_id: tenantId, order_id: orderId, attempted_at: t.at.toISOString(), user_id: t.userId, result: t.result, erp_number: t.erpNumber, step: t.step, message: t.message,
  });
  if (error) console.error("[sales-orders] could not write the transfer log", error.message);
  return error?.message ?? null;
}

// ── send ──────────────────────────────────────────────────────────────────────

export async function sendOrderToErp(
  admin: SupabaseClient, tenantId: string, orderId: string,
  opts: { userId?: string | null; confirm?: boolean; http?: ErpHttp; deps?: OrderDeps; now?: Date } = {},
): Promise<SendResult> {
  const t0 = Date.now();
  const at = opts.now ?? new Date();
  const userId = opts.userId ?? null;

  const loaded = await loadOrder(admin, tenantId, orderId);
  if (loaded.kind === "missing") return { state: "missing" };
  if (loaded.kind === "pending") return { state: "pending", bundle: SALES_ORDER_BUNDLE };
  if (loaded.kind === "error") return { state: "error", message: loaded.message };
  const { order } = loaded.value;
  if (!(await erpTablesReady(admin, tenantId))) return { state: "pending", bundle: ORDER_CHECKS_BUNDLE };

  const connector = await pickOrderConnector(admin, tenantId, orderId);
  const connectorId: ConnectorId = connector.id;
  const lines = await loadLines(admin, tenantId, orderId);
  const customerId = await connector.customerErpId(admin, tenantId, order.account_id);

  // A second press: the order is in the ERP already. Said plainly, logged, and nothing is sent.
  const existing = (await linkRows(admin, tenantId, orderId)).find((r) => !isPending(r.external_id));
  if (existing) {
    await recordTransfer(admin, tenantId, orderId, { userId, result: "already_sent", erpNumber: existing.external_key, step: null, message: "The order was already in the ERP.", at });
    return { state: "already_sent", erpNumber: existing.external_key };
  }

  const why = sendReadiness({
    origin: order.origin, status: order.status, erpLinked: false, hasAccount: !!order.account_id, customerLinked: customerId !== null,
    lineCount: lines.length, allQuantitiesPositive: lines.every((l) => Number(l.qty) > 0),
  }) ?? await connector.sendBlocker({ admin, tenantId, order, lines });
  if (why) return { state: "not_ready", message: why };

  // Warns, never blocks: the person reads what is not a current pass and confirms it.
  const { checks } = await loadChecks(admin, tenantId, order, lines);
  const need = confirmNeeded(checks);
  if (need.needed && opts.confirm !== true) return { state: "needs_confirmation", items: need.items };

  const tenant = await loadTenantRow(admin, tenantId);
  if (!tenant) return { state: "error", message: "Workspace not found" };
  const opened = await connector.open({ admin, tenantId, tenant, deps: { ...(opts.deps ?? {}), ...(opts.http ? { http: opts.http } : {}) } });
  if (!opened.ok) return { state: opened.kind, message: opened.message };

  const claimed = await acquireClaim(admin, tenantId, connectorId, orderId);
  if (claimed.busy) return { state: "in_progress" };
  if ("done" in claimed) {
    await recordTransfer(admin, tenantId, orderId, { userId, result: "already_sent", erpNumber: claimed.done.external_key, step: null, message: "The order was already in the ERP.", at });
    return { state: "already_sent", erpNumber: claimed.done.external_key };
  }
  const claim = claimed.claim;
  const label = `Sales order ${order.ref}`;
  const capture = (tenant.config as { integration_middleware?: { payload_capture?: boolean } } | null)?.integration_middleware?.payload_capture === true;
  const middleware = opened.middleware;

  let customerName = order.erp_customer_name ?? "";
  if (!customerName && order.account_id) {
    const { data } = await admin.from("accounts").select("name").eq("id", order.account_id).eq("tenant_id", tenantId).maybeSingle();
    customerName = String((data as { name?: string } | null)?.name ?? "");
  }
  const erpProducts = await connector.productErpIds(admin, tenantId, lines.map((l) => l.product_id).filter((x): x is string => !!x));

  const result = await opened.session.send(
    { admin, tenantId, order, lines, customerId, customerName, currency: (order.currency || "USD").toUpperCase(), erpProducts },
    {
      // The order exists in the ERP from here on: whatever happens next, the claim stays. A link that cannot be written
      // here is written again, and reported, right after the send returns.
      onCreated: async (erpId, erpNumber) => { claim.keep = true; await writeLink(admin, tenantId, connectorId, orderId, erpId, erpNumber); },
    },
  );

  if (!result.ok) {
    await releaseClaim(admin, tenantId, connectorId, orderId, claim);
    await recordTransfer(admin, tenantId, orderId, { userId, result: "failed", erpNumber: null, step: result.step, message: `${result.headline} ${result.fix}`.trim(), at });
    if (middleware) {
      await recordMessage(admin, {
        tenantId, direction: "out", channel: "connector", connectorId, entity: "sales_orders", objectType: "sales_orders", objectId: orderId, refLabel: label,
        status: "failed", httpStatus: result.status, error: result.raw, durationMs: Date.now() - t0, exchange: result.exchange,
        summary: { headline: `${label}: ${result.headline}`, fix: result.fix, step: result.step, trigger: "send_now" },
      }, capture);
    }
    return { state: "failed", step: result.step, headline: result.headline, fix: result.fix };
  }

  const recordErr = await writeLink(admin, tenantId, connectorId, orderId, result.orderId, result.orderNumber);
  if (recordErr) {
    const headline = "The order is in the ERP but could not be recorded here.";
    const fix = "Do not send it again; press Retry in ten minutes and it will be found.";
    await recordTransfer(admin, tenantId, orderId, { userId, result: "failed", erpNumber: null, step: "link", message: `${headline} ${fix}`, at });
    if (middleware) {
      await recordMessage(admin, {
        tenantId, direction: "out", channel: "connector", connectorId, entity: "sales_orders", objectType: "sales_orders", objectId: orderId, refLabel: label,
        status: "failed", httpStatus: null, error: recordErr, durationMs: Date.now() - t0, exchange: result.exchange,
        summary: { headline: `${label}: ${headline}`, fix, step: "link", trigger: "send_now" },
      }, capture);
    }
    return { state: "failed", step: "link", headline, fix };
  }

  // The ERP has it: the order is now Submitted and read-only here (orderEditable sees the link and the status).
  const was = order.status;
  const now = at.toISOString();
  const { error: flipErr } = await admin.from("sales_orders").update({
    status: "confirmed", spine: "in_progress", status_label: "Submitted", confirmed_at: order.confirmed_at ?? now, updated_at: now,
  }).eq("id", orderId).eq("tenant_id", tenantId);
  if (flipErr) console.error("[sales-orders] sent, but the status could not be updated", flipErr.message);

  const sentResult: TransferResult = result.alreadyDone ? "already_sent" : "sent";
  await recordTransfer(admin, tenantId, orderId, {
    userId, result: sentResult, erpNumber: result.orderNumber, step: null,
    message: result.alreadyDone ? "The order was already in the ERP." : result.steps.join(" "), at,
  });
  if (middleware) {
    await recordMessage(admin, {
      tenantId, direction: "out", channel: "connector", connectorId, entity: "sales_orders", objectType: "sales_orders", objectId: orderId,
      refLabel: result.orderNumber ? `Sales order ${result.orderNumber}` : label, status: "ok", durationMs: Date.now() - t0, exchange: result.exchange,
      summary: {
        headline: `${label}: ${result.alreadyDone ? "already in the ERP" : "sent"}${result.orderNumber ? ` as ${result.orderNumber}` : ""}`,
        erp_number: result.orderNumber, link: result.link, steps: result.steps, lines: lines.length, ...(result.summaryExtra ?? {}), total: result.total ?? Number(order.total), trigger: "send_now",
      },
    }, capture);
  }
  await logChange(admin, {
    tenantId, objectType: "sales_orders", objectId: orderId, objectLabel: order.ref, action: "update", actorId: userId, actorEmail: null,
    changes: [
      { field: `sent to ${connector.word}`, from: null, to: result.orderNumber ?? result.orderId },
      ...(was !== "confirmed" ? [{ field: "status", from: was, to: "confirmed" }] : []),
    ],
  });
  if (was === "draft") {
    try {
      await emitOrderConfirmed(tenantId, { orderId, ref: order.ref, total: Number(order.total), accountId: order.account_id, contactId: order.contact_id, actorId: userId });
    } catch (e) {
      console.error("[sales-orders] order.confirmed was not emitted", (e as Error).message);
    }
  }

  // Bring the ERP's own wording and any documents in now rather than at the next hourly run. Best effort: the send already succeeded.
  try {
    await connector.refresh(admin, tenantId, orderId, { withHeader: true, trigger: "manual", userId, skipThrottle: true, deps: opts.deps });
  } catch (e) {
    console.error("[sales-orders] sent, but the first refresh failed", (e as Error).message);
  }

  return result.alreadyDone ? { state: "already_sent", erpNumber: result.orderNumber } : { state: "sent", erpNumber: result.orderNumber, link: result.link };
}
