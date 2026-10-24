// Dynamics 365 Sales (Dataverse) sales orders and their invoices, read into BPMSquare. Pure transforms (no server
// import) so the status mapping and the row shapes are unit-tested; orders.ts does the I/O.
//
// What is verified and what is assumed (docs/design/sales-order.md, "SO2"): the state codes of a sales order and of
// an invoice are the standard Dataverse ones. The finer `statuscode` table is NOT assumed -- its wording is the
// organisation's own and arrives as the OData formatted value. A column the organisation lacks simply reads as null.

export const FORMATTED = "@OData.Community.Display.V1.FormattedValue";
export const LOOKUP_TYPE = "@Microsoft.Dynamics.CRM.lookuplogicalname";
/** Asks Dataverse for the readable wording of option sets and lookups. */
export const PREFER_FORMATTED = `odata.include-annotations="OData.Community.Display.V1.FormattedValue,Microsoft.Dynamics.CRM.lookuplogicalname"`;

export type OrderSpineValue = "open" | "in_progress" | "completed" | "cancelled";

/** salesorder.statecode: 0 Active, 1 Submitted, 2 Canceled, 3 Fulfilled, 4 Invoiced. */
const ORDER_STATE_SPINE: Record<number, OrderSpineValue> = { 0: "in_progress", 1: "in_progress", 2: "cancelled", 3: "completed", 4: "completed" };
const ORDER_STATE_WORD: Record<number, string> = { 0: "Active", 1: "Submitted", 2: "Canceled", 3: "Fulfilled", 4: "Invoiced" };

export const orderSpine = (statecode: number | null): OrderSpineValue => (statecode !== null && statecode in ORDER_STATE_SPINE ? ORDER_STATE_SPINE[statecode] : "in_progress");

export type InvoiceSpine = "open" | "closed" | "paid" | "cancelled";
/** invoice.statecode: 0 Active, 1 Closed, 2 Paid, 3 Canceled. */
const INVOICE_STATE_SPINE: Record<number, InvoiceSpine> = { 0: "open", 1: "closed", 2: "paid", 3: "cancelled" };
const INVOICE_STATE_WORD: Record<number, string> = { 0: "Active", 1: "Closed", 2: "Paid", 3: "Canceled" };

export const invoiceSpine = (statecode: number | null): InvoiceSpine => (statecode !== null && statecode in INVOICE_STATE_SPINE ? INVOICE_STATE_SPINE[statecode] : "open");

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const money = (v: unknown): number => Math.round((num(v) ?? 0) * 100) / 100;
/** A date column ("2026-11-01" or "2026-11-01T00:00:00Z") as YYYY-MM-DD. */
export const dateOnly = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const guid = (v: unknown): string | null => str(v)?.toLowerCase() ?? null;

/** The fields every order read asks for. `order_details` is expanded separately. */
export const ORDER_COLUMNS = [
  "salesorderid", "ordernumber", "name", "totalamount", "totallineitemamount", "totaltax", "totaldiscountamount", "freightamount",
  "statecode", "statuscode", "requestdeliveryby", "createdon", "modifiedon", "_customerid_value",
];
export const LINE_COLUMNS = [
  "salesorderdetailid", "lineitemnumber", "productdescription", "_productid_value", "_uomid_value", "quantity", "priceperunit",
  "baseamount", "extendedamount", "manualdiscountamount", "tax", "requestdeliveryby",
];
export const ORDER_EXPAND = `order_details($select=${LINE_COLUMNS.join(",")}),transactioncurrencyid($select=isocurrencycode)`;

export type MappedLine = {
  lineNo: number;
  externalProductId: string | null;
  description: string;
  qty: number;
  uom: string | null;
  unitPrice: number;
  discountPct: number;
  taxPct: number;
  lineTotal: number;
  requestedDate: string | null;
};

export type MappedOrder = {
  externalId: string;
  number: string;
  statecode: number | null;
  /** The organisation's own wording of the status. */
  statusLabel: string;
  spine: OrderSpineValue;
  customerExternalId: string | null;
  customerIsAccount: boolean;
  customerName: string | null;
  currency: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shipping: number;
  total: number;
  requestedDate: string | null;
  createdOn: string | null;
  lines: MappedLine[];
  /** True when the row carried its lines (`order_details`); false means ask for them separately. */
  hasLines: boolean;
};

export function mapLineRow(r: Row, index: number): MappedLine {
  const qty = num(r.quantity) ?? 0;
  const unit = num(r.priceperunit) ?? 0;
  const gross = num(r.baseamount) ?? qty * unit;
  const discount = num(r.manualdiscountamount) ?? 0;
  const extended = num(r.extendedamount) ?? Math.max(0, gross - discount);
  const tax = num(r.tax) ?? 0;
  return {
    lineNo: num(r.lineitemnumber) ?? index + 1,
    externalProductId: guid(r._productid_value),
    description: (str(r.productdescription) ?? str(r[`_productid_value${FORMATTED}`]) ?? "Item").slice(0, 500),
    qty: Math.round(qty * 100) / 100,
    uom: str(r[`_uomid_value${FORMATTED}`]),
    unitPrice: Math.round(unit * 100) / 100,
    discountPct: gross > 0 ? Math.min(100, Math.round((discount / gross) * 1_000_000) / 10_000) : 0,
    taxPct: extended > 0 ? Math.round((tax / extended) * 100_000) / 1_000 : 0,
    lineTotal: Math.round(extended * 100) / 100,
    requestedDate: dateOnly(r.requestdeliveryby),
  };
}

/** One Dataverse sales order row (with `order_details` expanded when asked for) or an error naming what is missing. */
export function mapOrderRow(r: Row): MappedOrder | { error: string } {
  const externalId = guid(r.salesorderid);
  if (!externalId) return { error: "no salesorderid" };
  const number = str(r.ordernumber) ?? str(r.name);
  if (!number) return { error: "no order number" };
  const statecode = num(r.statecode);
  const label = str(r[`statuscode${FORMATTED}`]) ?? str(r[`statecode${FORMATTED}`]) ?? (statecode !== null ? ORDER_STATE_WORD[statecode] : null) ?? "Active";
  const cur = r.transactioncurrencyid as Row | null | undefined;
  const details = Array.isArray(r.order_details) ? (r.order_details as Row[]) : null;
  const lines = (details ?? []).map(mapLineRow).sort((a, b) => a.lineNo - b.lineNo);
  const lookupType = str(r[`_customerid_value${LOOKUP_TYPE}`]);
  const subtotal = num(r.totallineitemamount);
  return {
    externalId,
    number: number.slice(0, 100),
    statecode,
    statusLabel: label.slice(0, 80),
    spine: orderSpine(statecode),
    customerExternalId: guid(r._customerid_value),
    customerIsAccount: lookupType === null || lookupType === "account",
    customerName: str(r[`_customerid_value${FORMATTED}`])?.slice(0, 200) ?? null,
    currency: str(cur && typeof cur === "object" ? cur.isocurrencycode : null)?.toUpperCase().slice(0, 3) ?? null,
    subtotal: subtotal !== null ? money(subtotal) : Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100,
    discountTotal: money(r.totaldiscountamount),
    taxTotal: money(r.totaltax),
    shipping: money(r.freightamount),
    total: money(r.totalamount),
    requestedDate: dateOnly(r.requestdeliveryby),
    createdOn: str(r.createdon),
    lines,
    hasLines: details !== null,
  };
}

/** The status a row of `sales_orders` carries for an order whose status the ERP owns. */
export const orderStatusOf = (spine: OrderSpineValue): "confirmed" | "cancelled" => (spine === "cancelled" ? "cancelled" : "confirmed");

export const INVOICE_COLUMNS = ["invoiceid", "invoicenumber", "totalamount", "duedate", "createdon", "modifiedon", "statecode", "statuscode", "_salesorderid_value"];

export type MappedInvoice = {
  rawRef: string;
  number: string | null;
  docDate: string | null;
  dueDate: string | null;
  amount: number;
  status: string;
  spine: InvoiceSpine;
};

export function mapInvoiceRow(r: Row): MappedInvoice | { error: string } {
  const rawRef = guid(r.invoiceid);
  if (!rawRef) return { error: "no invoiceid" };
  const statecode = num(r.statecode);
  const status = str(r[`statuscode${FORMATTED}`]) ?? str(r[`statecode${FORMATTED}`]) ?? (statecode !== null ? INVOICE_STATE_WORD[statecode] : null) ?? "Active";
  return {
    rawRef,
    number: str(r.invoicenumber)?.slice(0, 100) ?? null,
    docDate: dateOnly(r.createdon),
    dueDate: dateOnly(r.duedate),
    amount: money(r.totalamount),
    status: status.slice(0, 80),
    spine: invoiceSpine(statecode),
  };
}

/** What an order write compares to decide "unchanged": every value a pull would write, lines included. */
export function orderFingerprintValues(m: MappedOrder, accountId: string | null, productIds: (string | null)[]): Record<string, unknown> {
  return {
    n: m.number, s: m.statusLabel, sp: m.spine, a: accountId, cn: m.customerName, cur: m.currency, st: m.subtotal, dt: m.discountTotal, tt: m.taxTotal,
    sh: m.shipping, t: m.total, rd: m.requestedDate,
    l: m.lines.map((l, i) => [l.lineNo, productIds[i] ?? null, l.description, l.qty, l.uom, l.unitPrice, l.discountPct, l.taxPct, l.lineTotal, l.requestedDate]),
  };
}
