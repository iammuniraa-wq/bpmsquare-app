import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange, type ChangeEntry } from "@/lib/changeLog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { recordConnectorRun, recordMessage } from "@/lib/middleware/messages";
import type { TenantFeatures } from "@/lib/constants";
import { ERP_DOCUMENTS_BUNDLE, invoiceSettled, refreshedJustNow } from "@/lib/salesOrders/erpDocs";
import { entityConfig } from "./catalog";
import { D365Error, type D365Client } from "./odata";
import { fingerprint, modifiedSinceFilter, nextModifiedWatermark, normalizeModified } from "./mapping";
import { buildSelection, describeSelection, type RunSelection } from "./selection";
import {
  INVOICE_COLUMNS, LINE_COLUMNS, ORDER_COLUMNS, ORDER_EXPAND, PREFER_FORMATTED,
  mapInvoiceRow, mapLineRow, mapOrderRow, orderFingerprintValues, orderStatusOf, type MappedInvoice, type MappedOrder,
} from "./orderMap";
import {
  ALREADY_RUNNING, CONNECTOR_ID, RUN_BUDGET_MS, clientFor, fetchLinks, finishRun, lastWatermark, loadD365, markStatus, startRun,
  type PullResult, type RunCounts,
} from "./server";
import type { D365Config } from "./types";

// Dynamics 365 Sales (Dataverse) orders and their invoices -> BPMSquare Sales Orders (SO2, docs/design/sales-order.md).
//
// What this file guarantees, because it writes to a table people also edit:
//   - an order that came from the ERP (origin 'erp') is read-only here and is only ever changed by this reader;
//   - an order made in BPMSquare (origin 'bpmsquare') is never overwritten: only its status words and its ERP link
//     are touched, and only through its connector_links row;
//   - the ERP's customer is matched to an Account through that account's own link; an account that was not synced
//     yet does not fail the order -- the order keeps the customer's name from the ERP and says so;
//   - every query names the tenant; invoices land in erp_documents (service-role writes only, RLS select-only).

const IDENT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS_PER_RUN = 2000;
const INVOICE_CAP = 200;
/** A follow-up run touches this many orders per workspace, oldest check first. */
export const FOLLOW_UP_BATCH = 25;
/** An order checked more recently than this is left for the next hour's run. */
const FOLLOW_UP_MIN_AGE_MS = 50 * 60 * 1000;

type Row = Record<string, unknown>;

/** Which migration-0216 objects are missing, or none. A missing table or column is "nothing there yet", never a crash. */
export async function ordersSchemaReady(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const docs = await admin.from("erp_documents").select("id").eq("tenant_id", tenantId).limit(1);
  if (docs.error && isSchemaPending(docs.error)) return false;
  const cols = await admin.from("sales_orders").select("erp_customer_name, erp_docs_checked_at").eq("tenant_id", tenantId).limit(1);
  if (cols.error && isSchemaPending(cols.error)) return false;
  return true;
}

export const PENDING_MESSAGE = `A database update is needed first: run ${ERP_DOCUMENTS_BUNDLE} once.`;

type Ctx = {
  admin: SupabaseClient;
  tenantId: string;
  client: D365Client;
  cfg: D365Config;
  /** The workspace currency, used when the ERP row names none. */
  fallbackCurrency: string;
  linkCache: Map<string, string | null>;
};

/** The BPMSquare record a connector link points at (an account for a customer, a product for an item), or null. */
async function linkedObject(ctx: Ctx, entity: "customers" | "products", externalId: string | null): Promise<string | null> {
  if (!externalId) return null;
  const key = `${entity}:${externalId}`;
  if (ctx.linkCache.has(key)) return ctx.linkCache.get(key) ?? null;
  const { data } = await ctx.admin.from("connector_links").select("object_id").eq("tenant_id", ctx.tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", entity).eq("external_id", externalId).maybeSingle();
  const id = (data as { object_id?: string } | null)?.object_id ?? null;
  ctx.linkCache.set(key, id);
  return id;
}

type LinkRow = { external_id: string; object_id: string; content_hash: string | null };

type ApplyResult = { result: "created" | "updated" | "unchanged" | "skipped"; orderId: string | null; /** The link a created order now has. */ link?: LinkRow };

async function readLines(ctx: Ctx, externalId: string): Promise<ReturnType<typeof mapLineRow>[]> {
  const out: ReturnType<typeof mapLineRow>[] = [];
  let i = 0;
  for await (const r of ctx.client.list("salesorderdetails", { select: LINE_COLUMNS, filter: `_salesorderid_value eq ${externalId}`, maxRows: 500, prefer: PREFER_FORMATTED })) out.push(mapLineRow(r, i++));
  return out.sort((a, b) => a.lineNo - b.lineNo);
}

async function replaceLines(ctx: Ctx, orderId: string, m: MappedOrder, productIds: (string | null)[]): Promise<void> {
  const { admin, tenantId } = ctx;
  const { data: old } = await admin.from("sales_order_lines").select("id").eq("order_id", orderId).eq("tenant_id", tenantId);
  const oldIds = ((old ?? []) as { id: string }[]).map((r) => r.id);
  if (m.lines.length) {
    const rows = m.lines.map((l, i) => ({
      tenant_id: tenantId, order_id: orderId, line_no: l.lineNo, product_id: productIds[i] ?? null, description: l.description, printed_text: null,
      qty: l.qty, uom: l.uom, unit_price: l.unitPrice, discount_pct: l.discountPct, tax_pct: l.taxPct, line_total: l.lineTotal, requested_date: l.requestedDate,
    }));
    const { error } = await admin.from("sales_order_lines").insert(rows);
    if (error) throw error;
  }
  // The new set is in; only now go the old one. A failed insert leaves the order with the lines it had.
  if (oldIds.length) await admin.from("sales_order_lines").delete().in("id", oldIds).eq("tenant_id", tenantId);
}

const viaIntegration = { via: "integration" as string };

async function note(admin: SupabaseClient, tenantId: string, orderId: string, label: string, action: "create" | "update", changes: ChangeEntry[]): Promise<void> {
  await logChange(admin, { tenantId, objectType: "sales_orders", objectId: orderId, objectLabel: label, action, actorId: null, actorEmail: null, changes, ...viaIntegration });
}

/**
 * Write one ERP order. `link` is the connector_links row it already has, if any. Never throws for a customer that is not
 * synced; throws for a real database failure so the caller can count the row as failed and keep the watermark.
 */
async function applyOrder(ctx: Ctx, m: MappedOrder, link: LinkRow | undefined): Promise<ApplyResult> {
  const { admin, tenantId } = ctx;
  const now = new Date().toISOString();
  const status = orderStatusOf(m.spine);

  if (link) {
    const { data: cur } = await admin.from("sales_orders").select("id, ref, origin, status, status_label, spine").eq("id", link.object_id).eq("tenant_id", tenantId).maybeSingle();
    if (!cur) {
      // The BPMSquare order is gone: forget the link so the next run makes it again instead of failing for ever.
      await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "sales_orders").eq("external_id", link.external_id);
      return { result: "skipped", orderId: null };
    }
    const order = cur as { id: string; ref: string; origin: string; status: string; status_label: string | null; spine: string };

    if (order.origin === "bpmsquare") {
      // Made here, accepted by the ERP: only the status words follow the ERP. Lines, totals and customer stay as sent.
      const hash = fingerprint({ s: m.statusLabel, sp: m.spine, n: m.number });
      if (link.content_hash === hash) return { result: "unchanged", orderId: order.id };
      const beforeLabel = order.status_label;
      const patch: Row = { status_label: m.statusLabel, spine: m.spine, updated_at: now };
      if (m.spine === "cancelled" && order.status !== "cancelled") { patch.status = "cancelled"; patch.cancelled_at = now; patch.cancel_reason = "Cancelled in the ERP"; }
      const { error } = await admin.from("sales_orders").update(patch).eq("id", order.id).eq("tenant_id", tenantId);
      if (error) throw error;
      await admin.from("connector_links").update({ content_hash: hash, synced_at: now, external_key: m.number })
        .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "sales_orders").eq("external_id", link.external_id);
      link.content_hash = hash;
      if (beforeLabel !== m.statusLabel) await note(admin, tenantId, order.id, order.ref, "update", [{ field: "ERP status", from: beforeLabel, to: m.statusLabel }]);
      return { result: "updated", orderId: order.id };
    }

    const lines = m.hasLines ? m.lines : await readLines(ctx, m.externalId);
    const full: MappedOrder = { ...m, lines, hasLines: true };
    const accountId = full.customerIsAccount ? await linkedObject(ctx, "customers", full.customerExternalId) : null;
    const productIds = await Promise.all(full.lines.map((l) => linkedObject(ctx, "products", l.externalProductId)));
    const hash = fingerprint(orderFingerprintValues(full, accountId, productIds));
    if (link.content_hash === hash) return { result: "unchanged", orderId: order.id };
    const beforeLabel = order.status_label;
    const patch: Row = {
      status, status_label: full.statusLabel, spine: full.spine, account_id: accountId, erp_customer_name: full.customerName,
      currency: full.currency ?? ctx.fallbackCurrency, subtotal: full.subtotal, discount_total: full.discountTotal, tax_total: full.taxTotal,
      shipping_amount: full.shipping, total: full.total, requested_date: full.requestedDate, updated_at: now,
    };
    const { error } = await admin.from("sales_orders").update(patch).eq("id", order.id).eq("tenant_id", tenantId);
    if (error) throw error;
    await replaceLines(ctx, order.id, full, productIds);
    await admin.from("connector_links").update({ content_hash: hash, synced_at: now, external_key: full.number })
      .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "sales_orders").eq("external_id", link.external_id);
    link.content_hash = hash;
    const changes: ChangeEntry[] = [];
    if (beforeLabel !== full.statusLabel) changes.push({ field: "ERP status", from: beforeLabel, to: full.statusLabel });
    if (changes.length === 0) changes.push({ field: "synced from Dynamics 365", from: null, to: full.number });
    await note(admin, tenantId, order.id, order.ref, "update", changes);
    return { result: "updated", orderId: order.id };
  }

  const lines = m.hasLines ? m.lines : await readLines(ctx, m.externalId);
  const full: MappedOrder = { ...m, lines, hasLines: true };
  const accountId = full.customerIsAccount ? await linkedObject(ctx, "customers", full.customerExternalId) : null;
  const productIds = await Promise.all(full.lines.map((l) => linkedObject(ctx, "products", l.externalProductId)));
  const hash = fingerprint(orderFingerprintValues(full, accountId, productIds));
  const base = {
    tenant_id: tenantId, origin: "erp", status, status_label: full.statusLabel, spine: full.spine, account_id: accountId, erp_customer_name: full.customerName,
    contact_id: null, source_type: "erp", pricing_mode: "external", type_id: null,
    currency: full.currency ?? ctx.fallbackCurrency, subtotal: full.subtotal, discount_total: full.discountTotal, tax_total: full.taxTotal,
    shipping_amount: full.shipping, total: full.total, requested_date: full.requestedDate, confirmed_at: full.createdOn ?? now,
  };
  // Order numbers are unique per workspace; a number that is already a BPMSquare ref (SO-0001 against an ERP SO-0001) keeps the ERP's marked.
  let ins = await admin.from("sales_orders").insert({ ...base, ref: full.number }).select("id").single();
  if (ins.error?.code === "23505") ins = await admin.from("sales_orders").insert({ ...base, ref: `ERP-${full.number}`.slice(0, 100) }).select("id").single();
  if (ins.error || !ins.data) throw ins.error ?? new Error("insert failed");
  const orderId = (ins.data as { id: string }).id;
  try {
    await replaceLines(ctx, orderId, full, productIds);
  } catch (e) {
    await admin.from("sales_orders").delete().eq("id", orderId).eq("tenant_id", tenantId);
    throw e;
  }
  const { error: linkErr } = await admin.from("connector_links").insert({
    tenant_id: tenantId, connector_id: CONNECTOR_ID, entity: "sales_orders", object_type: "sales_orders", object_id: orderId,
    external_id: full.externalId, external_key: full.number, direction: "pull", content_hash: hash,
  });
  if (linkErr) {
    // An order without its link would be made again by every run: take it back out (a concurrent run that won keeps its own).
    const { error: undo } = await admin.from("sales_orders").delete().eq("id", orderId).eq("tenant_id", tenantId);
    if (undo) throw new Error(`could not link the new order (${linkErr.message}) and could not remove it (${undo.message}) -- remove the duplicate by hand`);
    throw new Error(`could not link the new order (${linkErr.message}); it was removed and will be retried`);
  }
  await note(admin, tenantId, orderId, full.number, "create", [{ field: "created from Dynamics 365", from: null, to: full.number }]);
  return { result: "created", orderId, link: { external_id: full.externalId, object_id: orderId, content_hash: hash } };
}

async function contextFor(admin: SupabaseClient, tenantId: string, cfg: D365Config, creds: Record<string, string>, config: unknown): Promise<Ctx> {
  const client = await clientFor(admin, tenantId, cfg, creds);
  const cur = (config as { currency?: unknown } | null)?.currency;
  return { admin, tenantId, client, cfg, fallbackCurrency: typeof cur === "string" && /^[A-Za-z]{3}$/.test(cur) ? cur.toUpperCase() : "USD", linkCache: new Map() };
}

// ── Invoices ────────────────────────────────────────────────────────────────

export type DocumentsResult = { read: number; created: number; updated: number; unchanged: number; removed: number; failed: number; error: string | null };

/**
 * Read the ERP's invoices for one order and mirror them into erp_documents (kind 'invoice'). `externalOrderId` is the
 * Dataverse salesorderid from the order's link, validated as a GUID before it reaches a $filter. The delivery kind is
 * not written here: Dataverse Sales has no shipment record, and F&O / SAP deliveries arrive with their own connectors.
 */
async function syncInvoices(ctx: Ctx, orderId: string, orderLabel: string, externalOrderId: string, currency: string | null): Promise<DocumentsResult> {
  const { admin, tenantId } = ctx;
  const res: DocumentsResult = { read: 0, created: 0, updated: 0, unchanged: 0, removed: 0, failed: 0, error: null };
  if (!IDENT_GUID.test(externalOrderId)) return { ...res, error: "The order's ERP id is not a record id." };
  const seen = new Set<string>();
  const found: MappedInvoice[] = [];
  try {
    for await (const r of ctx.client.list("invoices", { select: INVOICE_COLUMNS, filter: `_salesorderid_value eq ${externalOrderId}`, maxRows: INVOICE_CAP, prefer: PREFER_FORMATTED })) {
      res.read++;
      const m = mapInvoiceRow(r);
      if ("error" in m) { res.failed++; continue; }
      seen.add(m.rawRef);
      found.push(m);
    }
  } catch (e) {
    // The ERP could not be asked: keep what is stored, say why.
    return { ...res, error: (e as Error).message ?? "Could not read invoices" };
  }

  const { data: have, error: haveErr } = await admin.from("erp_documents").select("id, kind, erp_number, doc_date, due_date, amount, currency, status, status_spine, raw_ref")
    .eq("tenant_id", tenantId).eq("order_id", orderId).eq("kind", "invoice");
  if (haveErr) return { ...res, error: isSchemaPending(haveErr) ? PENDING_MESSAGE : haveErr.message };
  const existing = new Map(((have ?? []) as { id: string; raw_ref: string; erp_number: string | null; doc_date: string | null; due_date: string | null; amount: number | string; currency: string | null; status: string | null; status_spine: string | null }[]).map((r) => [r.raw_ref, r]));
  const now = new Date().toISOString();
  const changes: ChangeEntry[] = [];

  for (const m of found) {
    const row = { erp_number: m.number, doc_date: m.docDate, due_date: m.dueDate, amount: m.amount, currency, status: m.status, status_spine: m.spine };
    const cur = existing.get(m.rawRef);
    try {
      if (cur) {
        const beforeStatus = cur.status;
        const same = cur.erp_number === row.erp_number && cur.doc_date === row.doc_date && cur.due_date === row.due_date && Number(cur.amount) === row.amount && cur.status === row.status && cur.status_spine === row.status_spine;
        if (same) { res.unchanged++; await admin.from("erp_documents").update({ fetched_at: now }).eq("id", cur.id).eq("tenant_id", tenantId); continue; }
        const { error } = await admin.from("erp_documents").update({ ...row, fetched_at: now }).eq("id", cur.id).eq("tenant_id", tenantId);
        if (error) throw error;
        res.updated++;
        if (beforeStatus !== row.status) changes.push({ field: `Invoice ${m.number ?? m.rawRef}`, from: beforeStatus, to: row.status });
      } else {
        const { error } = await admin.from("erp_documents").insert({ ...row, tenant_id: tenantId, order_id: orderId, kind: "invoice", raw_ref: m.rawRef, fetched_at: now });
        // A webhook and the hourly job can race to the same invoice; the unique index keeps one and the loser is a no-op.
        if (error && error.code !== "23505") throw error;
        if (error) res.unchanged++;
        else { res.created++; changes.push({ field: `Invoice ${m.number ?? m.rawRef}`, from: null, to: m.status }); }
      }
    } catch (e) {
      res.failed++;
      res.error ??= (e as Error).message;
    }
  }

  // An invoice the ERP no longer has is no longer shown. Only when the whole list was read.
  if (res.read < INVOICE_CAP && !res.error) {
    for (const [ref, cur] of existing) {
      if (seen.has(ref)) continue;
      const { error } = await admin.from("erp_documents").delete().eq("id", cur.id).eq("tenant_id", tenantId);
      if (!error) { res.removed++; changes.push({ field: `Invoice ${cur.erp_number ?? ref}`, from: cur.status, to: "removed in the ERP" }); }
    }
  }
  if (changes.length) await note(admin, tenantId, orderId, orderLabel, "update", changes);
  return res;
}

// ── Pull ────────────────────────────────────────────────────────────────────

async function* readOrders(client: D365Client, entitySet: string, filters: (string | undefined)[], orderby: string | undefined, maxRows: number, withLines: { value: boolean }, onRead: () => number): AsyncGenerator<Record<string, unknown>> {
  for (const f of filters) {
    const left = maxRows - onRead();
    if (left <= 0) return;
    const run = (expand: boolean) => client.list(entitySet, {
      select: ORDER_COLUMNS, filter: f, orderby, maxRows: left, prefer: PREFER_FORMATTED, ...(expand ? { extraQuery: { $expand: ORDER_EXPAND } } : { extraQuery: { $expand: "transactioncurrencyid($select=isocurrencycode)" } }),
    });
    if (withLines.value) {
      // Lines ride along as order_details. An environment that refuses the expand is asked again without it (lines are then read per order).
      let started = false;
      try {
        for await (const r of run(true)) { started = true; yield r; }
        continue;
      } catch (e) {
        if (started || !(e instanceof D365Error) || e.status !== 400) throw e;
        withLines.value = false;
      }
    }
    yield* run(false);
  }
}

/** Pull Dynamics 365 Sales orders into Sales Orders. Same run lifecycle as the other entities (lock, watermark, counts, Monitor line). */
export async function runPullSalesOrders(admin: SupabaseClient, tenantId: string, opts: {
  trigger: "manual" | "schedule"; userId: string | null; full?: boolean; deadline?: number; maxRows?: number; select?: RunSelection;
}): Promise<PullResult> {
  const deadline = opts.deadline ?? Date.now() + RUN_BUDGET_MS;
  const maxRows = opts.maxRows ?? MAX_ROWS_PER_RUN;
  const counts: RunCounts = { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const issues: string[] = [];
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { runId: null, counts, issues, error: "Dynamics 365 isn't connected." };
  const { cfg, creds } = loaded;
  if (cfg.product !== "dataverse") return { runId: null, counts, issues, error: "Sales orders are read from Dynamics 365 Sales (Dataverse). This connection is a different product." };
  const ec = entityConfig(cfg, "sales_orders");
  if (!ec?.enabled) return { runId: null, counts, issues, error: "This entity is switched off." };
  const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  if (!(t?.features as TenantFeatures | undefined)?.sales_orders) return { runId: null, counts, issues, error: "The sales orders module isn't enabled for this workspace." };
  if (!(await ordersSchemaReady(admin, tenantId))) return { runId: null, counts, issues, error: PENDING_MESSAGE };

  const sel = opts.select && Object.keys(opts.select).length ? opts.select : undefined;
  const planned = sel ? buildSelection(cfg.product, ec, sel) : null;
  if (sel && planned?.nothingUsable) return { runId: null, counts, issues, error: planned.unsupported.join(" ") || "Nothing matches that selection.", unsupported: planned.unsupported };

  const started = await startRun(admin, tenantId, "sales_orders", "pull", opts.trigger, opts.userId);
  if (started.locked) return { runId: null, counts, issues, error: ALREADY_RUNNING };
  const runId = started.runId;
  const filtered = !!planned;
  if (filtered) counts.filtered = 1;
  const selectionWord = sel ? describeSelection(sel) : null;
  const mw = (t?.features as TenantFeatures | undefined)?.integration_middleware === true;
  const startedAtMs = Date.now();
  const capture = (t?.config as { integration_middleware?: { payload_capture?: boolean } } | null)?.integration_middleware?.payload_capture === true;
  const record = (error: string | null) => mw ? recordConnectorRun(admin, tenantId, { runId, entity: "sales_orders", direction: "pull", trigger: opts.trigger, counts: { ...counts }, issues, error, startedAtMs, entitySet: ec.entity_set, capture, selection: selectionWord }) : Promise.resolve();
  let stoppedEarly = false;
  try {
    const startMark = opts.full || filtered ? null : await lastWatermark(admin, tenantId, "sales_orders");
    const startIso = startMark && /^\d{4}-/.test(startMark) ? startMark : null;
    const ctx = await contextFor(admin, tenantId, cfg, creds, t?.config);
    const modField = ec.modified_field && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ec.modified_field) ? ec.modified_field : "modifiedon";
    const filters = planned ? planned.filters : [modifiedSinceFilter(modField, startIso, ec.filter)];
    const links = await fetchLinks<LinkRow>(admin, tenantId, "sales_orders", "external_id, object_id, content_hash");
    const linkOf = new Map(links.map((l) => [l.external_id.toLowerCase(), l]));
    let maxSeen: string | null = startIso;
    let firstSeen: string | null = null;
    let firstHold: string | null = null;
    const withLines = { value: true };

    for await (const row of readOrders(ctx.client, ec.entity_set, filters, planned ? undefined : `${modField} asc`, maxRows, withLines, () => counts.read)) {
      if (Date.now() > deadline) { stoppedEarly = true; break; }
      counts.read++;
      const mod = normalizeModified(row[modField]);
      if (mod) { firstSeen ??= mod; if (!maxSeen || mod > maxSeen) maxSeen = mod; }
      const hold = () => { if (mod && firstHold === null) firstHold = mod; };
      const m = mapOrderRow(row);
      if ("error" in m) { counts.skipped++; if (issues.length < 25) issues.push(`Skipped an order: ${m.error}`); continue; }
      try {
        const r = await applyOrder(ctx, m, linkOf.get(m.externalId));
        if (r.result === "skipped") { hold(); counts.skipped++; continue; }
        counts[r.result]++;
        if (r.link) linkOf.set(m.externalId, r.link);
      } catch (e) {
        hold();
        counts.failed++;
        if (issues.length < 25) issues.push(`Sales order ${m.number}: ${(e as { message?: string }).message ?? "failed"}`);
      }
    }

    const capHit = counts.read >= maxRows;
    const incomplete = stoppedEarly || capHit;
    let watermark: string | null = null;
    if (!filtered) {
      const next = nextModifiedWatermark({ start: startIso, firstSeen, maxSeen, firstHold, stoppedEarly: incomplete });
      watermark = next.watermark;
      if (next.releasedStall) issues.push("Some orders could not be applied and were passed over so the sync could move on; they are tried again only when they change in Dynamics or on a full sync.");
    }
    if (filtered) {
      if (stoppedEarly) issues.push("Stopped at this run's time limit -- run it again.");
      const asked = sel?.ids?.length ?? 0;
      if (asked && !incomplete && counts.read < asked) issues.push(`${asked - counts.read} of ${asked} ${asked === 1 ? "order was" : "orders were"} not found in the ERP.`);
    } else if (stoppedEarly) issues.push("Stopped at this run's time limit -- the next run continues from here.");
    else if (capHit) issues.push(`Stopped at ${maxRows} orders -- the next run continues from here.`);
    await markStatus(admin, tenantId, true);
    await finishRun(admin, tenantId, runId, counts, issues, null, watermark);
    await record(null);
    return { runId, counts, issues, error: null, ...(planned?.unsupported.length ? { unsupported: planned.unsupported } : {}) };
  } catch (e) {
    const msg = (e as Error).message ?? "Sync failed";
    await markStatus(admin, tenantId, false, msg);
    await finishRun(admin, tenantId, runId, counts, issues, msg, null);
    await record(msg);
    return { runId, counts, issues, error: msg };
  }
}

// ── Refresh one order (Refresh button, webhook) and the follow-up job ───────

export type RefreshOutcome =
  | { kind: "ok"; throttled: boolean; header: ApplyResult["result"] | null; documents: DocumentsResult | null; erpNumber: string | null }
  | { kind: "missing" }
  | { kind: "not_linked" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

export type RefreshOpts = {
  /** Read the order header again (status, totals, lines for an ERP order). The follow-up job after a pull skips it. */
  withHeader: boolean;
  trigger: "manual" | "webhook" | "schedule";
  userId?: string | null;
  /** Ignore the 10-second window (the follow-up job never needs it). */
  skipThrottle?: boolean;
  /** Re-use a connection a batch has already opened. */
  prepared?: { cfg: D365Config; creds: Record<string, string>; config: unknown; mw: boolean };
};

async function stampChecked(admin: SupabaseClient, tenantId: string, orderId: string, iso: string): Promise<void> {
  await admin.from("sales_orders").update({ erp_docs_checked_at: iso }).eq("id", orderId).eq("tenant_id", tenantId);
}

/**
 * Bring one order's ERP state up to date: its header (optionally) and its invoices. `orderId` must be an id of THIS
 * tenant; it is looked up with the tenant filter and a foreign id finds nothing. Used by the Refresh button, the
 * inbound webhook and the follow-up job.
 */
export async function refreshOrderDocuments(admin: SupabaseClient, tenantId: string, orderId: string, opts: RefreshOpts): Promise<RefreshOutcome> {
  const { data: ord, error: ordErr } = await admin.from("sales_orders").select("id, ref, origin, currency, erp_docs_checked_at").eq("id", orderId).eq("tenant_id", tenantId).maybeSingle();
  if (ordErr) return isSchemaPending(ordErr) ? { kind: "pending" } : { kind: "error", message: ordErr.message };
  if (!ord) return { kind: "missing" };
  const order = ord as { id: string; ref: string; origin: string; currency: string | null; erp_docs_checked_at: string | null };

  const { data: link } = await admin.from("connector_links").select("external_id, object_id, content_hash, external_key").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", "sales_orders").eq("object_id", orderId).maybeSingle();
  if (!link) return { kind: "not_linked" };
  const lk = link as LinkRow & { external_key: string | null };
  // A send in flight holds the link as "pending:<uuid>" until the ERP has made the order: there is nothing to read yet.
  if (lk.external_id.startsWith("pending:")) return { kind: "not_linked" };
  const erpNumber = lk.external_key ?? order.ref;

  if (!opts.skipThrottle && refreshedJustNow(order.erp_docs_checked_at)) return { kind: "ok", throttled: true, header: null, documents: null, erpNumber };

  let prepared = opts.prepared;
  if (!prepared) {
    const loaded = await loadD365(admin, tenantId);
    if (!loaded) return { kind: "error", message: "Dynamics 365 isn't connected." };
    if (loaded.cfg.product !== "dataverse") return { kind: "error", message: "Order follow-up reads Dynamics 365 Sales (Dataverse). This connection is a different product." };
    const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
    prepared = { cfg: loaded.cfg, creds: loaded.creds, config: t?.config, mw: (t?.features as TenantFeatures | undefined)?.integration_middleware === true };
  }
  const startedAt = Date.now();
  const label = `Sales order ${erpNumber}`;
  const report = async (status: "ok" | "failed", headline: string, error: string | null) => {
    if (!prepared!.mw) return;
    await recordMessage(admin, {
      tenantId, direction: "in", channel: opts.trigger === "webhook" ? "webhook" : "connector", connectorId: CONNECTOR_ID, entity: "sales_orders", objectType: "sales_orders", objectId: orderId,
      refLabel: label, status, error, durationMs: Date.now() - startedAt, summary: { headline: `${label}: ${headline}`, trigger: opts.trigger },
    });
  };

  try {
    const ctx = await contextFor(admin, tenantId, prepared.cfg, prepared.creds, prepared.config);
    let header: ApplyResult["result"] | null = null;
    if (opts.withHeader) {
      let row: unknown;
      try {
        row = await ctx.client.get(`salesorders(${lk.external_id})`, { $select: ORDER_COLUMNS.join(","), $expand: ORDER_EXPAND }, { Prefer: PREFER_FORMATTED });
      } catch (e) {
        if (e instanceof D365Error && e.status === 400) row = await ctx.client.get(`salesorders(${lk.external_id})`, { $select: ORDER_COLUMNS.join(","), $expand: "transactioncurrencyid($select=isocurrencycode)" }, { Prefer: PREFER_FORMATTED });
        else throw e;
      }
      const m = mapOrderRow({ salesorderid: lk.external_id, ...(row as Row) });
      if ("error" in m) throw new Error(m.error);
      header = (await applyOrder(ctx, m, { external_id: lk.external_id, object_id: lk.object_id, content_hash: lk.content_hash })).result;
    }
    const documents = await syncInvoices(ctx, orderId, order.ref, lk.external_id, order.currency);
    const now = new Date().toISOString();
    await stampChecked(admin, tenantId, orderId, now);
    await admin.from("connector_links").update({ synced_at: now }).eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "sales_orders").eq("external_id", lk.external_id);
    const failed = documents.error !== null || documents.failed > 0;
    await report(failed ? "failed" : "ok", failed ? "the invoices could not be read" : `${documents.read} invoice${documents.read === 1 ? "" : "s"} checked`, documents.error);
    if (documents.error && documents.error === PENDING_MESSAGE) return { kind: "pending" };
    return { kind: "ok", throttled: false, header, documents, erpNumber };
  } catch (e) {
    const message = e instanceof D365Error && e.status === 404 ? "The order no longer exists in Dynamics 365." : (e as Error).message ?? "Refresh failed";
    await report("failed", "could not be refreshed", message);
    return { kind: "error", message };
  }
}

/**
 * The follow-up job (runs after the hourly pull): for orders that have an ERP link and are not finished, ask the ERP for
 * their invoices (and, when the Sales orders pull is off, for the order's status). Bounded: FOLLOW_UP_BATCH orders per
 * workspace, least recently checked first, nothing started after the deadline. A completed order whose invoices are all
 * paid or cancelled drops out for good.
 */
export async function followUpOrders(admin: SupabaseClient, tenantId: string, opts: { deadline: number; batch?: number; nowMs?: number }): Promise<{ checked: number; failed: number; skipped: string | null }> {
  const out = { checked: 0, failed: 0, skipped: null as string | null };
  const loaded = await loadD365(admin, tenantId);
  if (!loaded || loaded.cfg.product !== "dataverse") return { ...out, skipped: "not Dataverse" };
  const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  const features = (t?.features ?? {}) as TenantFeatures;
  if (!features.sales_orders) return { ...out, skipped: "module off" };
  if (!(await ordersSchemaReady(admin, tenantId))) return { ...out, skipped: "database update pending" };

  const ec = entityConfig(loaded.cfg, "sales_orders");
  const pullOn = ec?.enabled === true && (ec.schedule ?? loaded.cfg.schedule) !== "off";
  const nowMs = opts.nowMs ?? Date.now();

  const { data: cand, error } = await admin.from("sales_orders").select("id, origin, spine, erp_docs_checked_at").eq("tenant_id", tenantId)
    .in("spine", ["open", "in_progress", "completed"]).order("erp_docs_checked_at", { ascending: true, nullsFirst: true }).limit(200);
  if (error) return { ...out, skipped: isSchemaPending(error) ? "database update pending" : error.message };
  const orders = ((cand ?? []) as { id: string; origin: string; spine: string; erp_docs_checked_at: string | null }[])
    .filter((o) => !o.erp_docs_checked_at || nowMs - Date.parse(o.erp_docs_checked_at) >= FOLLOW_UP_MIN_AGE_MS);
  if (orders.length === 0) return out;

  const ids = orders.map((o) => o.id);
  const linked = new Set<string>();
  const docs = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data: ls } = await admin.from("connector_links").select("object_id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "sales_orders").in("object_id", chunk);
    for (const l of (ls ?? []) as { object_id: string }[]) linked.add(l.object_id);
    const { data: ds } = await admin.from("erp_documents").select("order_id, status_spine").eq("tenant_id", tenantId).eq("kind", "invoice").in("order_id", chunk);
    for (const d of (ds ?? []) as { order_id: string; status_spine: string | null }[]) docs.set(d.order_id, [...(docs.get(d.order_id) ?? []), d.status_spine ?? "open"]);
  }
  const todo = orders.filter((o) => {
    if (!linked.has(o.id)) return false;
    // With the Sales orders pull off, only orders made here (and accepted by the ERP) are followed; an order read from the ERP stops being refreshed.
    if (!pullOn && o.origin !== "bpmsquare") return false;
    const spines = docs.get(o.id) ?? [];
    return !(o.spine === "completed" && spines.length > 0 && spines.every((s) => invoiceSettled(s)));
  }).slice(0, opts.batch ?? FOLLOW_UP_BATCH);
  if (todo.length === 0) return out;

  const prepared = { cfg: loaded.cfg, creds: loaded.creds, config: t?.config, mw: features.integration_middleware === true };
  for (const o of todo) {
    if (Date.now() > opts.deadline) break;
    const r = await refreshOrderDocuments(admin, tenantId, o.id, { withHeader: !pullOn, trigger: "schedule", skipThrottle: true, prepared });
    out.checked++;
    if (r.kind === "error" || r.kind === "pending") out.failed++;
  }
  return out;
}

/** Does this workspace have an order made here that an ERP accepted (a link written by a send)? Decides whether the follow-up job runs while the Sales orders pull is off. */
export async function hasSentOrders(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data, error } = await admin.from("connector_links").select("id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "sales_orders").eq("direction", "push").limit(1);
  return !error && (data ?? []).length > 0;
}
