import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { emitOrderConfirmed } from "@/lib/events/emitters";
import { outboundConfig } from "@/lib/connectors/d365/catalog";
import { CONNECTOR_ID } from "@/lib/connectors/d365/server";
import { refreshOrderDocuments } from "@/lib/connectors/d365/orders";
import type { D365Config } from "@/lib/connectors/d365/types";
import type { ErpHttp } from "@/lib/middleware/erp";
import { sendDataverseSalesOrder, type DataverseOrderState } from "@/lib/middleware/erpOrder";
import { buildExchangePayload, pickExchange, recordingHttp } from "@/lib/middleware/exchange";
import { erpDeepLink, money } from "@/lib/middleware/links";
import { recordMessage } from "@/lib/middleware/messages";
import { buildDataverseQuote, plainFailure, type QuoteForErp } from "@/lib/middleware/payload";
import type { OutLine } from "@/lib/middleware/fence";
import { resolveDataversePricing } from "@/lib/middleware/pricing";
import { ORDER_CHECKS_BUNDLE, confirmNeeded, sendReadiness, type TransferResult } from "./erpChecks";
import { customerErpId, loadTenantRow, openErp } from "./erpContext";
import { erpTablesReady, loadChecks } from "./erpState";
import { loadLines, loadOrder, SALES_ORDER_BUNDLE, type OrderRow } from "./server";
import type { SalesOrderLine } from "./types";

// Send to ERP (SO3, docs/design/sales-order.md): the order, with its lines, becomes a Sales Order in Dynamics 365 Sales.
//
// What this guarantees, because it writes to somebody else's system:
//   - the order is loaded with the tenant filter and the customer's ERP id comes from this workspace's own link; no id in a
//     request body is ever used;
//   - one BPMSquare order is ONE ERP order, even when two presses overlap: the order's connector_links row is claimed
//     (external_id "pending:<uuid>") before the first ERP call, and an ERP order whose link was lost is found again by the
//     BPMSquare marker in its description (sendDataverseSalesOrder);
//   - a failure before the ERP made anything gives the claim back, so the order stays editable and Retry works; a failure after
//     keeps it, holding the ERP's id, so Retry resumes from that order instead of making a twin;
//   - every attempt leaves a row in the transfer log and a line in the Monitor.

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

const linkRows = async (admin: SupabaseClient, tenantId: string, orderId: string): Promise<LinkRow[]> => {
  const { data } = await admin.from("connector_links").select("id, external_id, external_key, synced_at, created_at").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", ENTITY).eq("object_id", orderId).order("created_at", { ascending: true }).order("id", { ascending: true });
  return (data ?? []) as LinkRow[];
};

type Claim = { pendingId: string; keep: boolean };

async function acquireClaim(admin: SupabaseClient, tenantId: string, orderId: string): Promise<{ busy: true } | { busy: false; claim: Claim } | { busy: false; done: LinkRow }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await linkRows(admin, tenantId, orderId);
    const real = rows.find((r) => !isPending(r.external_id));
    if (real) return { busy: false, done: real };
    const pendingId = `${PENDING_PREFIX}${randomUUID()}`;
    const now = new Date().toISOString();
    if (rows.length === 0) {
      const { error } = await admin.from("connector_links").insert({
        tenant_id: tenantId, connector_id: CONNECTOR_ID, entity: ENTITY, object_type: "sales_orders", object_id: orderId,
        external_id: pendingId, external_key: null, direction: "push", synced_at: now,
      });
      if (error) {
        if (error.code !== "23505") throw new Error(`could not start the send (${error.message})`);
        continue;
      }
      // Two overlapping inserts can both succeed (no unique index on the order): the oldest row wins, the other stands down.
      const after = await linkRows(admin, tenantId, orderId);
      if (after.length <= 1 || after[0].external_id === pendingId) return { busy: false, claim: { pendingId, keep: false } };
      await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", ENTITY).eq("object_id", orderId).eq("external_id", pendingId);
      return { busy: true };
    }
    // Somebody else's claim is there. It is theirs unless it has gone stale; taking it over is a compare-and-swap on its placeholder.
    const held = rows[0];
    const age = Date.now() - Date.parse(held.synced_at ?? "");
    if (!(age > CLAIM_STALE_MS)) return { busy: true };
    const { data } = await admin.from("connector_links").update({ external_id: pendingId, synced_at: now })
      .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", ENTITY).eq("object_id", orderId).eq("external_id", held.external_id).select("id");
    if ((data as unknown[] | null)?.length) return { busy: false, claim: { pendingId, keep: false } };
  }
  return { busy: true };
}

async function writeLink(admin: SupabaseClient, tenantId: string, orderId: string, externalId: string, key: string | null): Promise<string | null> {
  const patch = { external_id: externalId, external_key: key, synced_at: new Date().toISOString() };
  const { data, error } = await admin.from("connector_links").update(patch)
    .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", ENTITY).eq("object_id", orderId).select("id");
  if (error) return error.message;
  if ((data as unknown[] | null)?.length) return null;
  const ins = await admin.from("connector_links").insert({ tenant_id: tenantId, connector_id: CONNECTOR_ID, entity: ENTITY, object_type: "sales_orders", object_id: orderId, direction: "push", ...patch });
  return ins.error ? ins.error.message : null;
}

async function releaseClaim(admin: SupabaseClient, tenantId: string, orderId: string, claim: Claim | null): Promise<void> {
  if (!claim || claim.keep) return;
  // If this delete fails the placeholder simply goes stale and a later send takes it over.
  await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", ENTITY).eq("object_id", orderId).eq("external_id", claim.pendingId);
}

// ── the document ──────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Lines as the ERP writer reads them. Prices go as the NET unit price: discounts are folded in, as for a quote (netRate). */
export function outLines(lines: Pick<SalesOrderLine, "line_no" | "description" | "uom" | "qty" | "unit_price" | "discount_pct" | "line_total">[]): OutLine[] {
  return [...lines].sort((a, b) => a.line_no - b.line_no).map((l) => {
    const qty = Number(l.qty);
    const rate = Number(l.unit_price);
    const disc = Number(l.discount_pct);
    const net = Number.isFinite(Number(l.line_total)) && l.line_total !== null ? Number(l.line_total) : qty * rate * (1 - disc / 100);
    return { sl_no: String(l.line_no), description: l.description, uom: l.uom, qty, rate, discount_pct: disc, amount: round2(net) };
  });
}

/** The lines of text the ERP order's description carries: what the ERP cannot hold as a field, kept readable. */
export function orderNote(o: Pick<OrderRow, "customer_po" | "requested_date" | "notes" | "terms" | "tax_total" | "shipping_amount" | "total">): string[] {
  const out: string[] = [];
  if (o.customer_po?.trim()) out.push(`Customer PO: ${o.customer_po.trim()}`);
  if (o.requested_date) out.push(`Requested delivery: ${o.requested_date}`);
  if (o.notes?.trim()) out.push(o.notes.trim().slice(0, 500));
  if (o.terms?.trim()) out.push(`Terms: ${o.terms.trim().slice(0, 500)}`);
  const bits: string[] = [];
  if (Number(o.tax_total) > 0) bits.push(`tax ${money(Number(o.tax_total))}`);
  if (Number(o.shipping_amount) > 0) bits.push(`shipping ${money(Number(o.shipping_amount))}`);
  out.push(`Total in BPMSquare: ${money(Number(o.total))}${bits.length ? ` (${bits.join(", ")})` : ""}`);
  return out;
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
  opts: { userId?: string | null; confirm?: boolean; http?: ErpHttp; now?: Date } = {},
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

  const lines = await loadLines(admin, tenantId, orderId);
  const customerId = await customerErpId(admin, tenantId, order.account_id);

  // A second press: the order is in the ERP already. Said plainly, logged, and nothing is sent.
  const existing = (await linkRows(admin, tenantId, orderId)).find((r) => !isPending(r.external_id));
  if (existing) {
    await recordTransfer(admin, tenantId, orderId, { userId, result: "already_sent", erpNumber: existing.external_key, step: null, message: "The order was already in the ERP.", at });
    return { state: "already_sent", erpNumber: existing.external_key };
  }

  const why = sendReadiness({
    origin: order.origin, status: order.status, erpLinked: false, hasAccount: !!order.account_id, customerLinked: customerId !== null,
    lineCount: lines.length, allQuantitiesPositive: lines.every((l) => Number(l.qty) > 0),
  });
  if (why) return { state: "not_ready", message: why };

  // Warns, never blocks: the person reads what is not a current pass and confirms it.
  const { checks } = await loadChecks(admin, tenantId, order, lines);
  const need = confirmNeeded(checks);
  if (need.needed && opts.confirm !== true) return { state: "needs_confirmation", items: need.items };

  const tenant = await loadTenantRow(admin, tenantId);
  if (!tenant) return { state: "error", message: "Workspace not found" };
  const erp = await openErp(admin, tenantId, tenant, opts.http);
  if (!erp.ok) return { state: erp.kind, message: erp.message };

  const claimed = await acquireClaim(admin, tenantId, orderId);
  if (claimed.busy) return { state: "in_progress" };
  if ("done" in claimed) {
    await recordTransfer(admin, tenantId, orderId, { userId, result: "already_sent", erpNumber: claimed.done.external_key, step: null, message: "The order was already in the ERP.", at });
    return { state: "already_sent", erpNumber: claimed.done.external_key };
  }
  const claim = claimed.claim;
  const rec = recordingHttp(erp.http);
  const http = rec.http;
  const label = `Sales order ${order.ref}`;
  const capture = (tenant.config as { integration_middleware?: { payload_capture?: boolean } } | null)?.integration_middleware?.payload_capture === true;

  const fail = async (step: string, headline: string, fix: string, raw: string | null, status: number | null): Promise<SendResult> => {
    await releaseClaim(admin, tenantId, orderId, claim);
    await recordTransfer(admin, tenantId, orderId, { userId, result: "failed", erpNumber: null, step, message: `${headline} ${fix}`.trim(), at });
    if (erp.middleware) {
      await recordMessage(admin, {
        tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, entity: "sales_orders", objectType: "sales_orders", objectId: orderId, refLabel: label,
        status: "failed", httpStatus: status, error: raw, durationMs: Date.now() - t0, exchange: buildExchangePayload(pickExchange(rec.calls)),
        summary: { headline: `${label}: ${headline}`, fix, step, trigger: "send_now" },
      }, capture);
    }
    return { state: "failed", step, headline, fix };
  };

  let customerName = order.erp_customer_name ?? "";
  if (!customerName && order.account_id) {
    const { data } = await admin.from("accounts").select("name").eq("id", order.account_id).eq("tenant_id", tenantId).maybeSingle();
    customerName = String((data as { name?: string } | null)?.name ?? "");
  }
  const cfg: D365Config = erp.cfg;
  const currency = (order.currency || "USD").toUpperCase();

  // Build the document. Price list and currency are decided per send, exactly as for a quote.
  let body: Record<string, unknown>;
  try {
    const pricing = await resolveDataversePricing(http, {
      accountExternalId: customerId, fallbackPriceListId: cfg.price_list_id ?? null, fallbackCurrencyId: cfg.currency_id ?? null, isoCode: currency, cache: {},
    });
    const out = outboundConfig(cfg);
    const qfe: QuoteForErp = {
      ref: order.ref, doc_id: order.id, title: customerName || order.ref, customer_name: customerName || order.ref, account_external_id: customerId,
      description: orderNote(order), lines: outLines(lines), subtotal: Number(order.subtotal), total: Number(order.total), valid_until: null, outcome: "awarded", currency,
    };
    const built = buildDataverseQuote(
      qfe, { price_list_id: pricing.priceListId, currency_id: pricing.currencyId },
      { quote: out.sales_order.field_map, quote_line: out.sales_order_line.field_map }, "sales_order",
    );
    if (built.problems.length > 0) {
      const p = built.problems[0];
      return await fail("prepare", p.message, p.fix, null, null);
    }
    body = built.body;
  } catch (e) {
    const x = e as { status?: number; message?: string };
    const f = plainFailure(x, undefined, "order");
    return await fail("prepare", f.headline, f.fix, x.message ?? null, x.status ?? null);
  }

  // Send.
  let result: Awaited<ReturnType<typeof sendDataverseSalesOrder>>;
  try {
    result = await sendDataverseSalesOrder(http, {
      ref: order.ref, docId: order.id, existingId: null, create: body,
      onCreated: async (s: DataverseOrderState) => {
        // The order exists in the ERP from here on: whatever happens next, the claim stays. A link that cannot be written
        // here is written again, and reported, right after the send returns.
        claim.keep = true;
        await writeLink(admin, tenantId, orderId, s.orderId, s.orderNumber);
      },
    });
  } catch (e) {
    const x = e as { status?: number; message?: string; step?: string };
    const f = plainFailure(x, x.step, "order");
    return await fail(x.step ?? "create", f.headline, f.fix, x.message ?? null, x.status ?? null);
  }
  const link = erpDeepLink(cfg, "salesorder", result.orderId);
  const recordErr = await writeLink(admin, tenantId, orderId, result.orderId, result.orderNumber);
  if (recordErr) {
    return await fail("link", "The order is in the ERP but could not be recorded here.", "Do not send it again; press Retry in ten minutes and it will be found.", recordErr, null);
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
  if (erp.middleware) {
    await recordMessage(admin, {
      tenantId, direction: "out", channel: "connector", connectorId: CONNECTOR_ID, entity: "sales_orders", objectType: "sales_orders", objectId: orderId,
      refLabel: result.orderNumber ? `Sales order ${result.orderNumber}` : label, status: "ok", durationMs: Date.now() - t0, exchange: buildExchangePayload(pickExchange(rec.calls)),
      summary: {
        headline: `${label}: ${result.alreadyDone ? "already in the ERP" : "sent"}${result.orderNumber ? ` as ${result.orderNumber}` : ""}`,
        erp_number: result.orderNumber, link, steps: result.steps, lines: lines.length, total: result.total ?? Number(order.total), trigger: "send_now",
      },
    }, capture);
  }
  await logChange(admin, {
    tenantId, objectType: "sales_orders", objectId: orderId, objectLabel: order.ref, action: "update", actorId: userId, actorEmail: null,
    changes: [
      { field: "sent to Dynamics 365 Sales", from: null, to: result.orderNumber ?? result.orderId },
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

  // Bring the ERP's own wording and any invoices in now rather than at the next hourly run. Best effort: the send already succeeded.
  try {
    await refreshOrderDocuments(admin, tenantId, orderId, { withHeader: true, trigger: "manual", userId, skipThrottle: true });
  } catch (e) {
    console.error("[sales-orders] sent, but the first refresh failed", (e as Error).message);
  }

  return result.alreadyDone ? { state: "already_sent", erpNumber: result.orderNumber } : { state: "sent", erpNumber: result.orderNumber, link };
}
