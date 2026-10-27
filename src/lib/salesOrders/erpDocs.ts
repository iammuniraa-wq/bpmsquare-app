// Deliveries and invoices an ERP reports for a Sales Order (table erp_documents, migration 0216). Client-safe and pure:
// the column list, the throttle, and how a row becomes the shape the screens and the API read. The reading and writing
// is src/lib/connectors/d365/orders.ts; nothing here touches a database.

/** The hand-applied database update that creates erp_documents and the ERP columns on sales_orders. */
export const ERP_DOCUMENTS_BUNDLE = "scripts/run-bundle-27-erp-documents-2026-10-24.sql";

/** A webhook or a Refresh press for the same order inside this window reads the ERP once. */
export const REFRESH_THROTTLE_MS = 10_000;

export const ERP_DOCUMENT_KINDS = ["delivery", "invoice"] as const;
export type ErpDocumentKind = (typeof ERP_DOCUMENT_KINDS)[number];

export const ERP_DOCUMENT_COLUMNS = "id, order_id, kind, erp_number, doc_date, due_date, amount, currency, status, status_spine, raw_ref, fetched_at";

export type ErpDocumentRow = {
  id: string;
  order_id: string;
  kind: ErpDocumentKind;
  erp_number: string | null;
  doc_date: string | null;
  due_date: string | null;
  amount: number | string | null;
  currency: string | null;
  /** The ERP's own wording. */
  status: string | null;
  /** invoice: open | closed | paid | cancelled. delivery: open | delivered | cancelled. */
  status_spine: string | null;
  raw_ref: string;
  fetched_at: string | null;
};

/** What the order screens and GET /api/sales-orders/[id] carry for one document. */
export type ErpDocumentView = {
  id: string;
  kind: ErpDocumentKind;
  number: string | null;
  date: string | null;
  due: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  spine: string | null;
  delivered: boolean;
  paid: boolean;
  fetched_at: string | null;
  /** Opens the record in the ERP (a link out, never a BPMSquare page). */
  href: string | null;
};

export function shapeErpDocument(r: ErpDocumentRow, href: string | null = null): ErpDocumentView {
  const amount = r.amount === null || r.amount === undefined || r.amount === "" ? null : Number(r.amount);
  return {
    id: r.id,
    kind: r.kind,
    number: r.erp_number,
    date: r.doc_date,
    due: r.due_date,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    currency: r.currency,
    status: r.status,
    spine: r.status_spine,
    delivered: r.kind === "delivery" && r.status_spine === "delivered",
    paid: r.kind === "invoice" && r.status_spine === "paid",
    fetched_at: r.fetched_at,
    href,
  };
}

/** An invoice that is finished with: paid or cancelled. A completed order whose invoices all are needs no more follow-up. */
export const invoiceSettled = (spine: string | null): boolean => spine === "paid" || spine === "cancelled";

/** True while a refresh of this order would only repeat the one just done. */
export function refreshedJustNow(checkedAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!checkedAt) return false;
  const t = Date.parse(checkedAt);
  return Number.isFinite(t) && nowMs - t < REFRESH_THROTTLE_MS;
}
