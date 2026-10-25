import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { recordConnectorRun, recordMessage } from "@/lib/middleware/messages";
import type { TenantFeatures } from "@/lib/constants";
import { refreshedJustNow } from "@/lib/salesOrders/erpDocs";
import { pickFollowUpOrders, hasSentOrdersTo } from "@/lib/salesOrders/erpFollowUp";
import {
  PENDING_MESSAGE, applyOrder, mirrorDocuments, ordersSchemaReady, stampChecked, type ApplyResult, type DocumentsResult, type LinkRow, type MappedDocument, type WriteCtx,
} from "@/lib/salesOrders/erpOrderWrite";
import { odataString } from "@/lib/connectors/d365/mapping";
import { describeSelection, parseSelection } from "@/lib/connectors/d365/selection";
import { ALREADY_RUNNING, RUN_BUDGET_MS, fetchLinks, finishRun, lastWatermark, startRun, type RunCounts } from "@/lib/connectors/runs";
import { SAP_ORDER_PRESET, entityConfig } from "./catalog";
import { EMPTY_POSITION, idVariants, keysetFilter, nextPosition, parsePosition, sapDay } from "./mapping";
import { SapClient, SapError } from "./odata";
import {
  BILLING_ORDER_REFS, DELIVERY_ORDER_REF, ORDER_EXPANDS, mapBillingRow, mapDeliveryRow, mapSapLine, mapSapOrderRow,
} from "./orderMap";
import { clientFor, loadSap, markStatus, type Creds, type Loaded, type PullOptions, type PullResult, type SapDeps } from "./server";
import { hasProp, parseServiceMeta, type MaybeMeta } from "./serviceMeta";
import { SAP_CONNECTOR_ID, SAP_NAME, SAP_ORDER_SERVICES, type SapConfig, type SapOrderService } from "./types";

// SAP S/4HANA sales orders, deliveries and billing documents -> BPMSquare Sales Orders (SO4b, docs/design/sales-order.md).
//
// The same guarantees as the Dynamics reader (salesOrders/erpOrderWrite.ts does the writing for both): an order read from SAP is
// origin 'erp' and read-only here; an order made here and accepted by SAP only has its status words follow SAP; the customer is
// matched through the business partner link; every query names the tenant. Reading is GET only. Which property carries what is
// stated in orderMap.ts -- a property this product has not seen in a real response is read only when the row (or the system's
// own $metadata) has it, and the code says so when it is missing instead of guessing.

const MAX_ROWS_PER_RUN = 2000;
const DOC_CAP = 200;
const PAGE = 100;

type Row = Record<string, unknown>;

// ── A connection used for one operation ─────────────────────────────────────

/** One SAP connection for the length of one operation (a run, a refresh, a batch): clients and `$metadata` are asked for once. */
export type SapSession = {
  cfg: SapConfig;
  creds: Creds;
  client(service: SapOrderService): Promise<SapClient>;
  /** The service's own property list, or null when `$metadata` could not be read (too large, refused); the call itself then tells. */
  meta(service: SapOrderService): Promise<MaybeMeta>;
};

export function openSapSession(loaded: Pick<Loaded, "cfg" | "creds">, deps: SapDeps = {}): SapSession {
  const clients = new Map<string, Promise<SapClient>>();
  const metas = new Map<string, Promise<MaybeMeta>>();
  const client = (service: SapOrderService): Promise<SapClient> => {
    let c = clients.get(service);
    if (!c) { c = clientFor(loaded.cfg, loaded.creds, service, deps); clients.set(service, c); }
    return c;
  };
  return {
    cfg: loaded.cfg, creds: loaded.creds, client,
    meta(service) {
      let m = metas.get(service);
      if (!m) {
        m = client(service).then((c) => c.metadata()).then((xml) => { const p = parseServiceMeta(xml); return p.size ? p : null; }).catch(() => null);
        metas.set(service, m);
      }
      return m;
    },
  };
}

function writeContext(admin: SupabaseClient, tenantId: string, session: SapSession, config: unknown): WriteCtx {
  const cur = (config as { currency?: unknown } | null)?.currency;
  return {
    admin, tenantId, connectorId: SAP_CONNECTOR_ID, erpWord: SAP_NAME,
    fallbackCurrency: typeof cur === "string" && /^[A-Za-z]{3}$/.test(cur) ? cur.toUpperCase() : "USD", linkCache: new Map(),
    readLines: async (externalId) => {
      const c = await session.client(SAP_ORDER_SERVICES.orders);
      const lines: ReturnType<typeof mapSapLine>[] = [];
      let i = 0;
      for await (const r of c.list("A_SalesOrderItem", { filter: `SalesOrder eq ${odataString(externalId)}`, pageSize: PAGE, maxRows: 500 })) lines.push(mapSapLine(r, i++, null));
      return lines.sort((a, b) => a.lineNo - b.lineNo);
    },
  };
}

export { ordersSchemaReady, PENDING_MESSAGE };

// ── Pull ────────────────────────────────────────────────────────────────────

/** `LastChangeDateTime` is an Edm.DateTimeOffset in the published service; the day granularity of the position re-reads the last day and the content hash says "unchanged". */
export function orderChangedFilter(day: string | null): string | undefined {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${SAP_ORDER_PRESET.modified_field} ge datetimeoffset'${day}T00:00:00Z'` : undefined;
}

/** Order rows for one filter. An environment that refuses the nested expansion is asked again with the plainer one, and finally without any (lines are then read per order). */
async function* readOrders(client: SapClient, filters: (string | undefined)[], maxRows: number, state: { level: number }, pageSize: number, onRead: () => number): AsyncGenerator<Row> {
  for (const filter of filters) {
    const left = maxRows - onRead();
    if (left <= 0) return;
    for (;;) {
      const expand = state.level < ORDER_EXPANDS.length ? [ORDER_EXPANDS[state.level]] : undefined;
      let started = false;
      try {
        for await (const r of client.list(SAP_ORDER_PRESET.entity_set, { filter, orderby: `${SAP_ORDER_PRESET.id_field} asc`, expand, pageSize, maxRows: left })) { started = true; yield r; }
        break;
      } catch (e) {
        if (started || !(e instanceof SapError) || e.status !== 400 || state.level >= ORDER_EXPANDS.length) throw e;
        state.level++;
      }
    }
  }
}

/** Pull SAP sales orders into Sales Orders. Same run lifecycle as the other entities (lock, watermark, counts, Monitor line). */
export async function runPullSapOrders(admin: SupabaseClient, tenantId: string, opts: PullOptions): Promise<PullResult> {
  const deadline = opts.deadline ?? Date.now() + RUN_BUDGET_MS;
  const maxRows = opts.maxRows ?? MAX_ROWS_PER_RUN;
  const counts: RunCounts = { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const issues: string[] = [];
  const loaded = await loadSap(admin, tenantId);
  if (!loaded) return { runId: null, counts, issues, error: `${SAP_NAME} isn't connected.` };
  const ec = entityConfig(loaded.cfg, "sales_orders");
  if (!ec.enabled) return { runId: null, counts, issues, error: "This entity is switched off." };
  const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  const features = (t?.features ?? {}) as TenantFeatures;
  if (!features.sales_orders) return { runId: null, counts, issues, error: "The sales orders module isn't enabled for this workspace." };
  if (opts.trigger === "schedule" && features.integration_middleware !== true) return { runId: null, counts, issues, error: "Integration middleware isn't enabled for this workspace." };
  if (!(await ordersSchemaReady(admin, tenantId))) return { runId: null, counts, issues, error: PENDING_MESSAGE };

  let selectedIds: string[] | null = null;
  if (opts.ids?.length) {
    const parsed = parseSelection({ ids: opts.ids });
    if (!parsed.ok) return { runId: null, counts, issues, error: parsed.error };
    selectedIds = (parsed.select?.ids ?? []).flatMap(idVariants);
    if (!selectedIds.length) return { runId: null, counts, issues, error: "Nothing matches that selection." };
  }
  const filtered = selectedIds !== null;

  const started = await startRun(admin, tenantId, SAP_CONNECTOR_ID, "sales_orders", "pull", opts.trigger, opts.userId);
  if (started.locked) return { runId: null, counts, issues, error: ALREADY_RUNNING };
  const runId = started.runId;
  if (filtered) counts.filtered = 1;
  const selectionWord = filtered ? describeSelection({ ids: opts.ids }) : null;
  const mw = features.integration_middleware === true;
  const startedAtMs = Date.now();
  const capture = (t?.config as { integration_middleware?: { payload_capture?: boolean } } | null)?.integration_middleware?.payload_capture === true;
  const note = (error: string | null) => mw ? recordConnectorRun(admin, tenantId, {
    runId, connectorId: SAP_CONNECTOR_ID, entity: "sales_orders", direction: "pull", trigger: opts.trigger, counts: { ...counts }, issues, error, startedAtMs, entitySet: ec.entity_set, capture, selection: selectionWord,
  }) : Promise.resolve();
  let stoppedEarly = false;
  try {
    const pos = opts.full || filtered ? EMPTY_POSITION : parsePosition(await lastWatermark(admin, tenantId, SAP_CONNECTOR_ID, "sales_orders"));
    const session = openSapSession(loaded, opts);
    const client = await session.client(SAP_ORDER_SERVICES.orders);
    const ctx = writeContext(admin, tenantId, session, t?.config);
    const links = await fetchLinks<LinkRow>(admin, tenantId, SAP_CONNECTOR_ID, "sales_orders", "external_id, object_id, content_hash");
    const linkOf = new Map(links.map((l) => [l.external_id, l]));
    const filters: (string | undefined)[] = filtered
      ? Array.from({ length: Math.ceil(selectedIds!.length / 20) }, (_, i) => `(${selectedIds!.slice(i * 20, i * 20 + 20).map((id) => `${SAP_ORDER_PRESET.id_field} eq ${odataString(id)}`).join(" or ")})`)
      : [[orderChangedFilter(pos.from), keysetFilter(SAP_ORDER_PRESET.id_field, pos.lastKey)].filter(Boolean).join(" and ") || undefined];

    const expandState = { level: 0 };
    let newest: string | null = null;
    let hold: string | null = null;
    let lastKey: string | null = pos.lastKey;
    for await (const row of readOrders(client, filters, maxRows, expandState, opts.pageSize ?? PAGE, () => counts.read)) {
      if (Date.now() > deadline) { stoppedEarly = true; break; }
      counts.read++;
      const m = mapSapOrderRow(row);
      if ("error" in m) { counts.skipped++; if (issues.length < 25) issues.push(`Skipped an order: ${m.error}`); continue; }
      lastKey = m.externalId;
      const changed = sapDay(row[SAP_ORDER_PRESET.modified_field]);
      if (changed && (!newest || changed > newest)) newest = changed;
      const holdRow = () => { if (changed && (!hold || changed < hold)) hold = changed; };
      try {
        const r: ApplyResult = await applyOrder(ctx, m, linkOf.get(m.externalId));
        if (r.result === "skipped") { holdRow(); counts.skipped++; linkOf.delete(m.externalId); continue; }
        counts[r.result]++;
        if (r.link) linkOf.set(m.externalId, r.link);
      } catch (e) {
        holdRow();
        counts.failed++;
        if (issues.length < 25) issues.push(`Sales order ${m.number}: ${(e as { message?: string }).message ?? "failed"}`);
      }
    }

    const incomplete = stoppedEarly || counts.read >= maxRows;
    const watermark = filtered ? null : nextPosition(pos, { newest, hold, lastKey }, !incomplete);
    if (filtered) {
      if (stoppedEarly) issues.push("Stopped at this run's time limit — run it again.");
      const asked = opts.ids?.length ?? 0;
      if (asked && !incomplete && counts.read < asked) issues.push(`${asked - counts.read} of ${asked} ${asked === 1 ? "order was" : "orders were"} not found in SAP.`);
    } else if (stoppedEarly) issues.push("Stopped at this run's time limit — the next run continues from here.");
    else if (incomplete) issues.push(`Stopped at ${maxRows} orders — the next run continues from here.`);
    await markStatus(admin, tenantId, true);
    await finishRun(admin, tenantId, runId, counts, issues, null, watermark);
    await note(null);
    return { runId, counts, issues, error: null };
  } catch (e) {
    const msg = (e as Error).message ?? "Sync failed";
    await markStatus(admin, tenantId, false, msg);
    await finishRun(admin, tenantId, runId, counts, issues, msg, null);
    await note(msg);
    return { runId, counts, issues, error: msg };
  }
}

// ── Deliveries and billing documents of one order ───────────────────────────

const chunks = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const orTerms = (terms: string[]): string => `(${terms.join(" or ")})`;

type Found = { docs: MappedDocument[]; complete: boolean; read: number; failed: number };

/** The deliveries made for an order: delivery items that reference the order, then their headers. */
async function readDeliveries(session: SapSession, externalOrderId: string): Promise<Found | { error: string }> {
  const service = SAP_ORDER_SERVICES.deliveries;
  const meta = await session.meta(service);
  if (!hasProp(meta, "A_OutbDeliveryItem", DELIVERY_ORDER_REF)) return { error: `This SAP system's ${service} has no ${DELIVERY_ORDER_REF} on its delivery items, so deliveries can't be matched to the order.` };
  const c = await session.client(service);
  const numbers = new Set<string>();
  let capHit = false;
  for await (const it of c.list("A_OutbDeliveryItem", { filter: `${DELIVERY_ORDER_REF} eq ${odataString(externalOrderId)}`, pageSize: PAGE, maxRows: DOC_CAP })) {
    if (typeof it.DeliveryDocument === "string" && it.DeliveryDocument.trim()) numbers.add(it.DeliveryDocument.trim());
    if (numbers.size >= DOC_CAP) { capHit = true; break; }
  }
  return readHeaders(c, "A_OutbDeliveryHeader", "DeliveryDocument", [...numbers], mapDeliveryRow, capHit);
}

async function readHeaders(c: SapClient, set: string, key: string, numbers: string[], map: (r: Row) => MappedDocument | { error: string }, capHit: boolean): Promise<Found> {
  const docs: MappedDocument[] = [];
  let read = 0;
  let failed = 0;
  for (const group of chunks(numbers, 20)) {
    for await (const r of c.list(set, { filter: orTerms(group.map((n) => `${key} eq ${odataString(n)}`)), pageSize: PAGE, maxRows: 40 })) {
      read++;
      const m = map(r);
      if ("error" in m) failed++;
      else docs.push(m);
    }
  }
  return { docs, complete: !capHit, read, failed };
}

/** The billing documents of an order: billing items that name the order (or one of its deliveries), then their headers. */
async function readBilling(session: SapSession, externalOrderId: string, deliveryNumbers: string[]): Promise<Found | { error: string }> {
  const service = SAP_ORDER_SERVICES.billing;
  const meta = await session.meta(service);
  const refs = BILLING_ORDER_REFS.filter((p) => hasProp(meta, "A_BillingDocumentItem", p));
  if (refs.length === 0) return { error: `This SAP system's ${service} has neither ${BILLING_ORDER_REFS.join(" nor ")} on its billing items, so invoices can't be matched to the order.` };
  const c = await session.client(service);
  const terms = refs.map((p) => `${p} eq ${odataString(externalOrderId)}`);
  if (refs.includes("ReferenceSDDocument")) for (const d of deliveryNumbers) terms.push(`ReferenceSDDocument eq ${odataString(d)}`);
  const numbers = new Set<string>();
  let capHit = false;
  outer: for (const group of chunks(terms, 20)) {
    for await (const it of c.list("A_BillingDocumentItem", { filter: orTerms(group), pageSize: PAGE, maxRows: DOC_CAP })) {
      if (typeof it.BillingDocument === "string" && it.BillingDocument.trim()) numbers.add(it.BillingDocument.trim());
      if (numbers.size >= DOC_CAP) { capHit = true; break outer; }
    }
  }
  return readHeaders(c, "A_BillingDocument", "BillingDocument", [...numbers], mapBillingRow, capHit);
}

const emptyDocs = (): DocumentsResult => ({ read: 0, created: 0, updated: 0, unchanged: 0, removed: 0, failed: 0, error: null });

/** Mirror both kinds into erp_documents. One service failing leaves what is stored for its kind and is reported; the other kind is still written. */
async function syncDocuments(ctx: WriteCtx, session: SapSession, orderId: string, orderLabel: string, externalOrderId: string, currency: string | null): Promise<DocumentsResult> {
  const total = emptyDocs();
  const add = (r: DocumentsResult) => {
    total.read += r.read; total.created += r.created; total.updated += r.updated; total.unchanged += r.unchanged; total.removed += r.removed; total.failed += r.failed;
    total.error ??= r.error;
  };
  let deliveryNumbers: string[] = [];
  for (const kind of ["delivery", "invoice"] as const) {
    let found: Found | { error: string };
    try {
      found = kind === "delivery" ? await readDeliveries(session, externalOrderId) : await readBilling(session, externalOrderId, deliveryNumbers);
    } catch (e) {
      found = { error: (e as Error).message ?? "SAP did not answer" };
    }
    if ("error" in found) { total.error ??= found.error; continue; }
    if (kind === "delivery") deliveryNumbers = found.docs.map((d) => d.rawRef);
    add(await mirrorDocuments(ctx, orderId, orderLabel, kind, found.docs, kind === "invoice" ? currency : null, found.complete && found.failed === 0, { ...emptyDocs(), read: found.read, failed: found.failed }));
  }
  return total;
}

// ── Refresh one order (Refresh button, webhook, send) and the follow-up job ─

export type SapRefreshOutcome =
  | { kind: "ok"; throttled: boolean; header: ApplyResult["result"] | null; documents: DocumentsResult | null; erpNumber: string | null }
  | { kind: "missing" }
  | { kind: "not_linked" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

export type SapRefreshOpts = {
  withHeader: boolean;
  trigger: "manual" | "webhook" | "schedule";
  userId?: string | null;
  skipThrottle?: boolean;
  /** Re-use a connection a batch already opened. */
  prepared?: { loaded: Loaded; config: unknown; mw: boolean; session: SapSession };
} & SapDeps;

async function readOrder(session: SapSession, externalId: string): Promise<Row> {
  const c = await session.client(SAP_ORDER_SERVICES.orders);
  const path = `${SAP_ORDER_PRESET.entity_set}(${odataString(externalId)})`;
  let last: unknown;
  for (const expand of [...ORDER_EXPANDS, undefined]) {
    try {
      const page = await c.get(path, expand ? { $expand: expand } : undefined);
      return { SalesOrder: externalId, ...(page.results[0] ?? {}) };
    } catch (e) {
      last = e;
      if (!(e instanceof SapError) || e.status !== 400) throw e;
    }
  }
  throw last;
}

/** Bring one order's SAP state up to date: its header (optionally), its deliveries and its billing documents. `orderId` must be an id of THIS tenant; a foreign id finds nothing. */
export async function refreshSapOrder(admin: SupabaseClient, tenantId: string, orderId: string, opts: SapRefreshOpts): Promise<SapRefreshOutcome> {
  const { data: ord, error: ordErr } = await admin.from("sales_orders").select("id, ref, origin, currency, erp_docs_checked_at").eq("id", orderId).eq("tenant_id", tenantId).maybeSingle();
  if (ordErr) return isSchemaPending(ordErr) ? { kind: "pending" } : { kind: "error", message: ordErr.message };
  if (!ord) return { kind: "missing" };
  const order = ord as { id: string; ref: string; origin: string; currency: string | null; erp_docs_checked_at: string | null };

  const { data: link } = await admin.from("connector_links").select("external_id, object_id, content_hash, external_key").eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID)
    .eq("entity", "sales_orders").eq("object_id", orderId).maybeSingle();
  if (!link) return { kind: "not_linked" };
  const lk = link as LinkRow & { external_key: string | null };
  if (lk.external_id.startsWith("pending:")) return { kind: "not_linked" };
  const erpNumber = lk.external_key ?? order.ref;
  if (!opts.skipThrottle && refreshedJustNow(order.erp_docs_checked_at)) return { kind: "ok", throttled: true, header: null, documents: null, erpNumber };

  let prepared = opts.prepared;
  if (!prepared) {
    const loaded = await loadSap(admin, tenantId);
    if (!loaded) return { kind: "error", message: `${SAP_NAME} isn't connected.` };
    const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
    prepared = { loaded, config: t?.config, mw: (t?.features as TenantFeatures | undefined)?.integration_middleware === true, session: openSapSession(loaded, opts) };
  }
  const startedAt = Date.now();
  const label = `Sales order ${erpNumber}`;
  const report = async (status: "ok" | "failed", headline: string, error: string | null) => {
    if (!prepared!.mw) return;
    await recordMessage(admin, {
      tenantId, direction: "in", channel: opts.trigger === "webhook" ? "webhook" : "connector", connectorId: SAP_CONNECTOR_ID, entity: "sales_orders", objectType: "sales_orders", objectId: orderId,
      refLabel: label, status, error, durationMs: Date.now() - startedAt, summary: { headline: `${label}: ${headline}`, trigger: opts.trigger },
    });
  };

  try {
    const ctx = writeContext(admin, tenantId, prepared.session, prepared.config);
    let header: ApplyResult["result"] | null = null;
    if (opts.withHeader) {
      const m = mapSapOrderRow(await readOrder(prepared.session, lk.external_id));
      if ("error" in m) throw new Error(m.error);
      header = (await applyOrder(ctx, m, { external_id: lk.external_id, object_id: lk.object_id, content_hash: lk.content_hash })).result;
    }
    const documents = await syncDocuments(ctx, prepared.session, orderId, order.ref, lk.external_id, order.currency);
    const now = new Date().toISOString();
    await stampChecked(admin, tenantId, orderId, now);
    await admin.from("connector_links").update({ synced_at: now }).eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID).eq("entity", "sales_orders").eq("external_id", lk.external_id);
    const failed = documents.error !== null || documents.failed > 0;
    await report(failed ? "failed" : "ok", failed ? "the deliveries or invoices could not be read" : `${documents.read} document${documents.read === 1 ? "" : "s"} checked`, documents.error);
    if (documents.error && documents.error === PENDING_MESSAGE) return { kind: "pending" };
    return { kind: "ok", throttled: false, header, documents, erpNumber };
  } catch (e) {
    const message = e instanceof SapError && e.status === 404 ? `The order no longer exists in ${SAP_NAME}.` : (e as Error).message ?? "Refresh failed";
    await report("failed", "could not be refreshed", message);
    return { kind: "error", message };
  }
}

/** The follow-up job for SAP: same choice of orders as the Dynamics one (erpFollowUp.ts), bounded per workspace, nothing started after the deadline. */
export async function followUpSapOrders(admin: SupabaseClient, tenantId: string, opts: { deadline: number; batch?: number; nowMs?: number } & SapDeps): Promise<{ checked: number; failed: number; skipped: string | null }> {
  const out = { checked: 0, failed: 0, skipped: null as string | null };
  const loaded = await loadSap(admin, tenantId);
  if (!loaded) return { ...out, skipped: "not connected" };
  const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  const features = (t?.features ?? {}) as TenantFeatures;
  if (!features.sales_orders) return { ...out, skipped: "module off" };
  if (!(await ordersSchemaReady(admin, tenantId))) return { ...out, skipped: "database update pending" };
  const ec = entityConfig(loaded.cfg, "sales_orders");
  const pullOn = ec.enabled === true && (ec.schedule ?? loaded.cfg.schedule) !== "off";
  const picked = await pickFollowUpOrders(admin, tenantId, { connectorId: SAP_CONNECTOR_ID, pullOn, batch: opts.batch, nowMs: opts.nowMs });
  if ("skipped" in picked) return { ...out, skipped: picked.skipped };
  if (picked.ids.length === 0) return out;
  const prepared = { loaded, config: t?.config, mw: features.integration_middleware === true, session: openSapSession(loaded, opts) };
  for (const id of picked.ids) {
    if (Date.now() > opts.deadline) break;
    const r = await refreshSapOrder(admin, tenantId, id, { withHeader: !pullOn, trigger: "schedule", skipThrottle: true, prepared, ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.sleep ? { sleep: opts.sleep } : {}) });
    out.checked++;
    if (r.kind === "error" || r.kind === "pending") out.failed++;
  }
  return out;
}

export const hasSentSapOrders = (admin: SupabaseClient, tenantId: string): Promise<boolean> => hasSentOrdersTo(admin, tenantId, SAP_CONNECTOR_ID);
