import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange, type ChangeEntry } from "@/lib/changeLog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { orderFingerprintValues, orderStatusOf, type MappedLine, type MappedOrder } from "@/lib/connectors/d365/orderMap";
import { fingerprint } from "@/lib/connectors/d365/mapping";
import { ERP_DOCUMENTS_BUNDLE, type ErpDocumentKind } from "./erpDocs";

import { readAllPages } from "@/lib/pagedRead";
// What every ERP's order reader writes the same way (SO2, extended for SAP in SO4b): one ERP order into sales_orders, its lines,
// its connector link, and the deliveries and invoices it reports into erp_documents. The connector supplies the mapped rows (a
// MappedOrder / MappedDocument, built from its own system's words) and a way to read the lines when the header did not carry them.
//
// What this guarantees, because it writes to a table people also edit:
//   - an order that came from the ERP (origin 'erp') is read-only here and is only ever changed by this reader;
//   - an order made in BPMSquare (origin 'bpmsquare') is never overwritten: only its status words and its ERP link are touched,
//     and only through its connector_links row;
//   - the ERP's customer is matched to an Account through that account's own link; an account that was not synced yet does not
//     fail the order -- the order keeps the customer's name from the ERP and says so;
//   - every query names the tenant; documents land in erp_documents (service-role writes only, RLS select-only).

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

export type WriteCtx = {
  admin: SupabaseClient;
  tenantId: string;
  /** connector_links.connector_id of the system that holds these orders. */
  connectorId: string;
  /** "Dynamics 365", "SAP S/4HANA": the word in the change log. */
  erpWord: string;
  /** The workspace currency, used when the ERP row names none. */
  fallbackCurrency: string;
  linkCache: Map<string, string | null>;
  /** The lines of one order, when the header row did not carry them. */
  readLines: (externalId: string) => Promise<MappedLine[]>;
};

export type LinkRow = { external_id: string; object_id: string; content_hash: string | null };

export type ApplyResult = { result: "created" | "updated" | "unchanged" | "skipped"; orderId: string | null; /** The link a created order now has. */ link?: LinkRow };

/** The BPMSquare record a connector link points at (an account for a customer, a product for an item), or null. */
export async function linkedObject(ctx: WriteCtx, entity: "customers" | "products", externalId: string | null): Promise<string | null> {
  if (!externalId) return null;
  const key = `${entity}:${externalId}`;
  if (ctx.linkCache.has(key)) return ctx.linkCache.get(key) ?? null;
  const { data } = await ctx.admin.from("connector_links").select("object_id").eq("tenant_id", ctx.tenantId).eq("connector_id", ctx.connectorId)
    .eq("entity", entity).eq("external_id", externalId).maybeSingle();
  const id = (data as { object_id?: string } | null)?.object_id ?? null;
  ctx.linkCache.set(key, id);
  return id;
}

async function replaceLines(ctx: WriteCtx, orderId: string, m: MappedOrder, productIds: (string | null)[]): Promise<void> {
  const { admin, tenantId } = ctx;
  const { data: old } = await readAllPages((lo, hi) => admin.from("sales_order_lines").select("id").eq("order_id", orderId).eq("tenant_id", tenantId).order("id", { ascending: true }).range(lo, hi));
  const oldIds = ((old ?? []) as { id: string }[]).map((r) => r.id);
  if (m.lines.length) {
    const rows = m.lines.map((l, i) => ({
      tenant_id: tenantId, order_id: orderId, line_no: l.lineNo, product_id: productIds[i] ?? null, description: l.description, printed_text: null,
      qty: l.qty, uom: l.uom, unit_price: l.unitPrice, discount_pct: l.discountPct, tax_pct: l.taxPct, line_total: l.lineTotal, requested_date: l.requestedDate,
      // An ERP that reports what it can confirm per line (SAP schedule lines) gives the Availability tab its ERP row.
      ...(l.confirmedQty !== undefined ? { confirmed_qty: l.confirmedQty, confirmed_date: l.confirmedDate ?? null, availability_source: "erp", availability_at: new Date().toISOString() } : {}),
    }));
    const { error } = await admin.from("sales_order_lines").insert(rows);
    if (error) throw error;
  }
  // The new set is in; only now go the old one. A failed insert leaves the order with the lines it had.
  if (oldIds.length) await admin.from("sales_order_lines").delete().in("id", oldIds).eq("tenant_id", tenantId);
}

const viaIntegration = { via: "integration" as string };

export async function note(admin: SupabaseClient, tenantId: string, orderId: string, label: string, action: "create" | "update", changes: ChangeEntry[]): Promise<void> {
  await logChange(admin, { tenantId, objectType: "sales_orders", objectId: orderId, objectLabel: label, action, actorId: null, actorEmail: null, changes, ...viaIntegration });
}

/**
 * Write one ERP order. `link` is the connector_links row it already has, if any. Never throws for a customer that is not
 * synced; throws for a real database failure so the caller can count the row as failed and keep the watermark.
 */
export async function applyOrder(ctx: WriteCtx, m: MappedOrder, link: LinkRow | undefined): Promise<ApplyResult> {
  const { admin, tenantId } = ctx;
  const now = new Date().toISOString();
  const status = orderStatusOf(m.spine);

  if (link) {
    const { data: cur } = await admin.from("sales_orders").select("id, ref, origin, status, status_label, spine").eq("id", link.object_id).eq("tenant_id", tenantId).maybeSingle();
    if (!cur) {
      // The BPMSquare order is gone: forget the link so the next run makes it again instead of failing for ever.
      await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", ctx.connectorId).eq("entity", "sales_orders").eq("external_id", link.external_id);
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
        .eq("tenant_id", tenantId).eq("connector_id", ctx.connectorId).eq("entity", "sales_orders").eq("external_id", link.external_id);
      link.content_hash = hash;
      if (beforeLabel !== m.statusLabel) await note(admin, tenantId, order.id, order.ref, "update", [{ field: "ERP status", from: beforeLabel, to: m.statusLabel }]);
      return { result: "updated", orderId: order.id };
    }

    const lines = m.hasLines ? m.lines : await ctx.readLines(m.externalId);
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
      .eq("tenant_id", tenantId).eq("connector_id", ctx.connectorId).eq("entity", "sales_orders").eq("external_id", link.external_id);
    link.content_hash = hash;
    const changes: ChangeEntry[] = [];
    if (beforeLabel !== full.statusLabel) changes.push({ field: "ERP status", from: beforeLabel, to: full.statusLabel });
    if (changes.length === 0) changes.push({ field: `synced from ${ctx.erpWord}`, from: null, to: full.number });
    await note(admin, tenantId, order.id, order.ref, "update", changes);
    return { result: "updated", orderId: order.id };
  }

  const lines = m.hasLines ? m.lines : await ctx.readLines(m.externalId);
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
    tenant_id: tenantId, connector_id: ctx.connectorId, entity: "sales_orders", object_type: "sales_orders", object_id: orderId,
    external_id: full.externalId, external_key: full.number, direction: "pull", content_hash: hash,
  });
  if (linkErr) {
    // An order without its link would be made again by every run: take it back out (a concurrent run that won keeps its own).
    const { error: undo } = await admin.from("sales_orders").delete().eq("id", orderId).eq("tenant_id", tenantId);
    if (undo) throw new Error(`could not link the new order (${linkErr.message}) and could not remove it (${undo.message}) -- remove the duplicate by hand`);
    throw new Error(`could not link the new order (${linkErr.message}); it was removed and will be retried`);
  }
  await note(admin, tenantId, orderId, full.number, "create", [{ field: `created from ${ctx.erpWord}`, from: null, to: full.number }]);
  return { result: "created", orderId, link: { external_id: full.externalId, object_id: orderId, content_hash: hash } };
}

// ── Documents ───────────────────────────────────────────────────────────────

export type MappedDocument = {
  rawRef: string;
  number: string | null;
  docDate: string | null;
  dueDate: string | null;
  /** Null for a document with no amount (a delivery). */
  amount: number | null;
  /** The ERP's own wording. */
  status: string;
  /** invoice: open | closed | paid | cancelled; delivery: open | delivered | cancelled. */
  spine: string;
};

export type DocumentsResult = { read: number; created: number; updated: number; unchanged: number; removed: number; failed: number; error: string | null };

const KIND_WORD: Record<ErpDocumentKind, string> = { invoice: "Invoice", delivery: "Delivery" };

/**
 * Mirror the ERP's documents of one kind for one order into erp_documents. `found` is what the ERP returned; `complete` says the
 * whole list was read, so a stored document the ERP no longer has can be removed. A document that raced in from a webhook and the
 * hourly job is kept once (unique index) and the loser is a no-op.
 */
export async function mirrorDocuments(
  ctx: Pick<WriteCtx, "admin" | "tenantId">, orderId: string, orderLabel: string, kind: ErpDocumentKind, found: MappedDocument[], currency: string | null, complete: boolean,
  res: DocumentsResult = { read: 0, created: 0, updated: 0, unchanged: 0, removed: 0, failed: 0, error: null },
): Promise<DocumentsResult> {
  const { admin, tenantId } = ctx;
  const word = KIND_WORD[kind];
  const seen = new Set(found.map((m) => m.rawRef));
  const { data: have, error: haveErr } = await admin.from("erp_documents").select("id, kind, erp_number, doc_date, due_date, amount, currency, status, status_spine, raw_ref")
    .eq("tenant_id", tenantId).eq("order_id", orderId).eq("kind", kind);
  if (haveErr) return { ...res, error: isSchemaPending(haveErr) ? PENDING_MESSAGE : haveErr.message };
  const existing = new Map(((have ?? []) as { id: string; raw_ref: string; erp_number: string | null; doc_date: string | null; due_date: string | null; amount: number | string | null; currency: string | null; status: string | null; status_spine: string | null }[]).map((r) => [r.raw_ref, r]));
  const now = new Date().toISOString();
  const changes: ChangeEntry[] = [];

  for (const m of found) {
    const row = { erp_number: m.number, doc_date: m.docDate, due_date: m.dueDate, amount: m.amount, currency, status: m.status, status_spine: m.spine };
    const cur = existing.get(m.rawRef);
    try {
      if (cur) {
        const beforeStatus = cur.status;
        const same = cur.erp_number === row.erp_number && cur.doc_date === row.doc_date && cur.due_date === row.due_date && (cur.amount === null || cur.amount === undefined ? null : Number(cur.amount)) === row.amount && cur.status === row.status && cur.status_spine === row.status_spine;
        if (same) { res.unchanged++; await admin.from("erp_documents").update({ fetched_at: now }).eq("id", cur.id).eq("tenant_id", tenantId); continue; }
        const { error } = await admin.from("erp_documents").update({ ...row, fetched_at: now }).eq("id", cur.id).eq("tenant_id", tenantId);
        if (error) throw error;
        res.updated++;
        if (beforeStatus !== row.status) changes.push({ field: `${word} ${m.number ?? m.rawRef}`, from: beforeStatus, to: row.status });
      } else {
        const { error } = await admin.from("erp_documents").insert({ ...row, tenant_id: tenantId, order_id: orderId, kind, raw_ref: m.rawRef, fetched_at: now });
        if (error && error.code !== "23505") throw error;
        if (error) res.unchanged++;
        else { res.created++; changes.push({ field: `${word} ${m.number ?? m.rawRef}`, from: null, to: m.status }); }
      }
    } catch (e) {
      res.failed++;
      res.error ??= (e as Error).message;
    }
  }

  // A document the ERP no longer has is no longer shown. Only when the whole list was read.
  if (complete && !res.error) {
    for (const [ref, cur] of existing) {
      if (seen.has(ref)) continue;
      const { error } = await admin.from("erp_documents").delete().eq("id", cur.id).eq("tenant_id", tenantId);
      if (!error) { res.removed++; changes.push({ field: `${word} ${cur.erp_number ?? ref}`, from: cur.status, to: "removed in the ERP" }); }
    }
  }
  if (changes.length) await note(admin, tenantId, orderId, orderLabel, "update", changes);
  return res;
}

export async function stampChecked(admin: SupabaseClient, tenantId: string, orderId: string, iso: string): Promise<void> {
  await admin.from("sales_orders").update({ erp_docs_checked_at: iso }).eq("id", orderId).eq("tenant_id", tenantId);
}
