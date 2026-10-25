// SAP S/4HANA sales orders, deliveries, billing documents and the order simulation, as pure transforms (no server import): row -> the
// shapes Sales Orders store, and order -> the payloads SAP is sent. orders.ts / orderCheck.ts / orderSend.ts do the I/O.
//
// WHICH NAMES ARE VERIFIED (SO4b, 2026-10-24) -- every property below is one of three kinds, and the kind is stated where it is used:
//   [verified-response]  seen in a real A_SalesOrder response (SAP-samples/s4hana-ext-geo-report-app, A_SalesOrder('69').json)
//   [verified-simulation] listed in the generated client of API_SALES_ORDER_SIMULATION_SRV (ballerinax/sap.s4hana.api_sales_order_simulation_srv 2.1.0)
//   [documented]         named in SAP's published API documentation / community answers but NOT seen in a response or generated client
//                        by this product; read only when present in the row (or listed by the connected system's own $metadata) and never required
// A property of the [documented] kind is looked up in the row and the system's $metadata; if it is absent the field is simply empty. See
// docs/design/sales-order.md "SO4b built" for the full list.

import { sapDay } from "./mapping";
import type { MappedDocument } from "@/lib/salesOrders/erpOrderWrite";
import type { MappedLine, MappedOrder, OrderSpineValue } from "@/lib/connectors/d365/orderMap";
import type { CheckOutcome, CheckStatus } from "@/lib/salesOrders/erpChecks";
import type { SalesOrderLine } from "@/lib/salesOrders/types";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;
const results = (v: unknown): Row[] => {
  const r = Array.isArray(v) ? v : (v as { results?: unknown } | null)?.results;
  return Array.isArray(r) ? (r.filter((x) => x && typeof x === "object") as Row[]) : [];
};
const isExpanded = (v: unknown): boolean => Array.isArray(v) || Array.isArray((v as { results?: unknown } | null)?.results);

// ── Status ──────────────────────────────────────────────────────────────────

/** SAP's three-letter process status: A not yet processed, B partly processed, C completely processed. [verified-response: OverallSDProcessStatus] */
const PROCESS_WORD: Record<string, string> = { A: "Open", B: "In process", C: "Completed" };
const PROCESS_SPINE: Record<string, OrderSpineValue> = { A: "open", B: "in_progress", C: "completed" };
const PART_WORD: Record<string, string> = { A: "open", B: "partly", C: "complete" };

/** Delivery status of the whole order. OverallTotalDeliveryStatus is [verified-response]; OverallDeliveryStatus is [documented]. */
export const ORDER_DELIVERY_STATUS_PROPS = ["OverallTotalDeliveryStatus", "OverallDeliveryStatus"] as const;
/** Billing status of the whole order. OverallOrdReltdBillgStatus is [documented]; the item-level OrderRelatedBillingStatus is [verified-response]. */
export const ORDER_BILLING_STATUS_PROPS = ["OverallOrdReltdBillgStatus"] as const;

const code = (v: unknown): string | null => {
  const s = str(v);
  return s && /^[A-Za-z]$/.test(s) ? s.toUpperCase() : null;
};

/** The billing status of the order: the header's own when the system gives one, else summed up from the items'. */
function billingCode(h: Row, items: Row[]): string | null {
  for (const p of ORDER_BILLING_STATUS_PROPS) { const c = code(h[p]); if (c) return c; }
  const per = items.map((i) => code(i.OrderRelatedBillingStatus)).filter((c): c is string => !!c);
  if (per.length === 0) return null;
  if (per.every((c) => c === "C")) return "C";
  return per.some((c) => c === "B" || c === "C") ? "B" : "A";
}

function deliveryCode(h: Row, items: Row[]): string | null {
  for (const p of ORDER_DELIVERY_STATUS_PROPS) { const c = code(h[p]); if (c) return c; }
  const per = items.map((i) => code(i.DeliveryStatus)).filter((c): c is string => !!c);
  if (per.length === 0) return null;
  if (per.every((c) => c === "C")) return "C";
  return per.some((c) => c === "B" || c === "C") ? "B" : "A";
}

/** The status words and the spine of one order. A fully rejected order (OverallSDDocumentRejectionSts C, [verified-response]) is cancelled. */
export function sapOrderStatus(h: Row, items: Row[]): { label: string; spine: OrderSpineValue } {
  const rejected = code(h.OverallSDDocumentRejectionSts) === "C";
  const p = code(h.OverallSDProcessStatus);
  const main = rejected ? "Rejected" : p && PROCESS_WORD[p] ? PROCESS_WORD[p] : "Open";
  const spine: OrderSpineValue = rejected ? "cancelled" : p && PROCESS_SPINE[p] ? PROCESS_SPINE[p] : "open";
  const d = deliveryCode(h, items);
  const b = billingCode(h, items);
  const label = [main, d && PART_WORD[d] ? `Delivery ${PART_WORD[d]}` : null, b && PART_WORD[b] ? `Billing ${PART_WORD[b]}` : null].filter(Boolean).join(" · ");
  return { label: label.slice(0, 80), spine };
}

// ── The order ───────────────────────────────────────────────────────────────

/** Items by their item number, 10 before 20 before 100. */
const itemNo = (r: Row): number => num(r.SalesOrderItem) ?? 0;

/** What a line can be confirmed for, from its schedule lines. Undefined when the row carried none (the ERP did not say). */
function confirmation(item: Row): { qty: number; date: string | null } | undefined {
  const sl = results(item.to_ScheduleLine);
  if (sl.length === 0) return undefined;
  let qty = 0;
  let date: string | null = null;
  for (const s of sl) {
    const q = num(s.ConfdOrderQtyByMatlAvailCheck) ?? 0;     // [verified-simulation: A_SalesOrderScheduleLineSimln]
    qty += q;
    const d = sapDay(s.ConfirmedDeliveryDate);                // [verified-simulation]
    if (q > 0 && d && (!date || d > date)) date = d;
  }
  return { qty: r2(qty), date };
}

export function mapSapLine(item: Row, index: number, headerDate: string | null): MappedLine {
  const qty = num(item.RequestedQuantity) ?? 0;             // [verified-response]
  const net = num(item.NetAmount) ?? 0;                       // [verified-response]
  const tax = num(item.TaxAmount) ?? 0;                       // [verified-simulation]; absent on older releases -> 0
  const material = str(item.Material);                        // [verified-response]
  const conf = confirmation(item);
  const asked = results(item.to_ScheduleLine).map((s) => sapDay(s.RequestedDeliveryDate)).find((d) => !!d) ?? headerDate;
  return {
    lineNo: Math.max(1, Math.round(itemNo(item) / 10) || index + 1),
    externalProductId: material,
    description: (str(item.SalesOrderItemText) ?? material ?? "Item").slice(0, 500),
    qty: r2(qty),
    uom: str(item.RequestedQuantityUnit),
    unitPrice: qty > 0 ? r2(net / qty) : 0,
    discountPct: 0,
    taxPct: net > 0 ? Math.round((tax / net) * 100_000) / 1_000 : 0,
    lineTotal: r2(net),
    requestedDate: asked,
    ...(conf ? { confirmedQty: conf.qty, confirmedDate: conf.date } : {}),
  };
}

/** One A_SalesOrder row (with `to_Item` expanded when asked for) or an error naming what is missing. */
export function mapSapOrderRow(r: Row): MappedOrder | { error: string } {
  const number = str(r.SalesOrder);                           // [verified-response]
  if (!number) return { error: "no SalesOrder" };
  const itemRows = results(r.to_Item).sort((a, b) => itemNo(a) - itemNo(b));
  const headerDate = sapDay(r.RequestedDeliveryDate);         // [verified-response]
  const lines = itemRows.map((i, idx) => mapSapLine(i, idx, headerDate));
  const status = sapOrderStatus(r, itemRows);
  const soldTo = str(r.SoldToParty);                          // [verified-response]
  const net = num(r.TotalNetAmount);                          // [verified-response]
  const subtotal = net !== null ? r2(net) : r2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const taxTotal = r2(itemRows.reduce((s, i) => s + (num(i.TaxAmount) ?? 0), 0));
  const cur = str(r.TransactionCurrency);                     // [verified-response]
  return {
    externalId: number,
    number: number.slice(0, 100),
    statecode: null,
    statusLabel: status.label,
    spine: status.spine,
    customerExternalId: soldTo,
    customerIsAccount: true,
    customerName: soldTo ? `Customer ${soldTo}` : null,
    currency: cur && /^[A-Za-z]{3}$/.test(cur) ? cur.toUpperCase() : null,
    subtotal,
    discountTotal: 0,
    taxTotal,
    shipping: 0,
    total: r2(subtotal + taxTotal),
    requestedDate: headerDate,
    createdOn: sapDay(r.CreationDate),                        // [verified-response]
    lines,
    hasLines: isExpanded(r.to_Item),
  };
}

/** The columns an order pull cannot do without; everything else is read from the whole row. */
export const ORDER_EXPANDS = ["to_Item,to_Item/to_ScheduleLine", "to_Item"] as const;

// ── Deliveries (API_OUTBOUND_DELIVERY_SRV) -- all [documented] ──────────────

/** The delivery item property that names the sales order a delivery was made for. [documented: A_OutbDeliveryItem.ReferenceSDDocument] */
export const DELIVERY_ORDER_REF = "ReferenceSDDocument";
export const DELIVERY_MOVEMENT_PROPS = ["OverallGoodsMovementStatus", "GoodsMovementStatus"] as const;
export const DELIVERY_DATE_PROPS = ["ActualGoodsMovementDate", "DeliveryDate", "PlannedGoodsIssueDate", "CreationDate"] as const;

export function mapDeliveryRow(r: Row): MappedDocument | { error: string } {
  const number = str(r.DeliveryDocument);
  if (!number) return { error: "no DeliveryDocument" };
  let move: string | null = null;
  for (const p of DELIVERY_MOVEMENT_PROPS) { move = code(r[p]); if (move) break; }
  const issued = sapDay(r.ActualGoodsMovementDate);
  const delivered = move === "C" || (move === null && !!issued);
  const date = (delivered ? issued : null) ?? DELIVERY_DATE_PROPS.map((p) => sapDay(r[p])).find((d) => !!d) ?? null;
  return {
    rawRef: number, number, docDate: date, dueDate: null, amount: null,
    status: delivered ? "Goods issued" : move === "B" ? "Partly issued" : "Open",
    spine: delivered ? "delivered" : "open",
  };
}

// ── Billing documents (API_BILLING_DOCUMENT_SRV) -- all [documented] ────────

/** Billing items name the sales order in SalesDocument and, for a bill made from a delivery, the delivery in ReferenceSDDocument. */
export const BILLING_ORDER_REFS = ["SalesDocument", "ReferenceSDDocument"] as const;
export const BILLING_CLEARING_PROPS = ["InvoiceClearingStatus"] as const;
export const BILLING_DATE_PROPS = ["BillingDocumentDate", "CreationDate"] as const;

export function mapBillingRow(r: Row): MappedDocument | { error: string } {
  const number = str(r.BillingDocument);
  if (!number) return { error: "no BillingDocument" };
  const cancelled = r.BillingDocumentIsCancelled === true || r.BillingDocumentIsCancelled === "X";
  let clearing: string | null = null;
  for (const p of BILLING_CLEARING_PROPS) { clearing = code(r[p]); if (clearing) break; }
  const gross = num(r.TotalGrossAmount);
  const amount = gross !== null ? r2(gross) : r2((num(r.TotalNetAmount) ?? 0) + (num(r.TaxAmount) ?? 0));
  return {
    rawRef: number, number,
    docDate: BILLING_DATE_PROPS.map((p) => sapDay(r[p])).find((d) => !!d) ?? null,
    dueDate: sapDay(r.NetDueDate),
    amount,
    status: cancelled ? "Cancelled" : clearing === "C" ? "Paid" : clearing === "B" ? "Partly paid" : "Open",
    spine: cancelled ? "cancelled" : clearing === "C" ? "paid" : "open",
  };
}

/** What a person reads when a line cannot go to SAP, with the line named: a free-text line has no material, and a product must exist in SAP. */
export function lineBlocker(lines: Pick<SalesOrderLine, "line_no" | "description" | "product_id">[], erpProducts: Map<string, string>): string | null {
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  const free = sorted.find((l) => !l.product_id);
  if (free) return `Line ${free.line_no} ("${free.description.slice(0, 40)}") has no catalogue product. SAP orders need a material: pick the product on that line.`;
  const missing = sorted.find((l) => !erpProducts.has(l.product_id as string));
  if (missing) return `Line ${missing.line_no} ("${missing.description.slice(0, 40)}") is not in SAP yet. Sync products from SAP first.`;
  return null;
}

// ── Simulation and create payloads ──────────────────────────────────────────

export type SalesAreaParts = { salesOrganization: string; distributionChannel: string; division: string; salesGroup?: string; salesOffice?: string };

/** SAP's standard order type. Verified in the sample response. A workspace's own order types are not yet mapped to SAP types (deferred). */
export const SAP_DEFAULT_ORDER_TYPE = "OR";

export type SapOrderLine = { item: string; material: string; qty: number };

/** Items are numbered 10, 20, 30 as SAP does. */
export const sapItemNo = (index: number): string => String((index + 1) * 10);

const isoDay = (d: string | null): string | undefined => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(0, 10)}T00:00:00` : undefined);

type HeaderIn = { area: SalesAreaParts; soldTo: string; currency: string | null; requestedDate: string | null; lines: SapOrderLine[] };

/** The header fields both the simulation and the create send. Names: [verified-response] and [verified-simulation] (same on both). */
function headerBody(a: HeaderIn): Record<string, unknown> {
  return {
    SalesOrderType: SAP_DEFAULT_ORDER_TYPE,
    SalesOrganization: a.area.salesOrganization,
    DistributionChannel: a.area.distributionChannel,
    OrganizationDivision: a.area.division,
    ...(a.area.salesGroup ? { SalesGroup: a.area.salesGroup } : {}),
    ...(a.area.salesOffice ? { SalesOffice: a.area.salesOffice } : {}),
    SoldToParty: a.soldTo,
    ...(a.currency ? { TransactionCurrency: a.currency } : {}),
    ...(isoDay(a.requestedDate) ? { RequestedDeliveryDate: isoDay(a.requestedDate) } : {}),
    to_Item: a.lines.map((l) => ({ SalesOrderItem: l.item, Material: l.material, RequestedQuantity: String(l.qty) })),
  };
}

export function buildSimulationPayload(a: HeaderIn): Record<string, unknown> {
  return headerBody(a);
}

/** The BPMSquare marker the order carries so a create that timed out can be found again. `carrier` is the header property the system lets us write. */
export function buildCreatePayload(a: HeaderIn & { customerPo: string | null; orderRef: string; carrier: string | null }): Record<string, unknown> {
  const body = headerBody(a);
  // The customer's own PO when there is one; otherwise our order ref, so the order is recognisable in SAP and findable by it.
  body.PurchaseOrderByCustomer = (a.customerPo?.trim() || a.orderRef).slice(0, 35);
  if (a.carrier) body[a.carrier] = a.orderRef.slice(0, 16);
  return body;
}

/** Candidates for the property that carries our order ref. [verified-simulation: AccountingDocExternalReference is on the simulation header; it is used only when the connected system lists it as writable] */
export const MARKER_CARRIERS = ["AccountingDocExternalReference"] as const;

export type SimItem = { item: string; net: number | null; asked: number | null; confirmedQty: number | null; confirmedDate: string | null };
export type SimResult = { currency: string | null; totalNet: number | null; creditStatus: string | null; items: SimItem[] };

/** Read what the simulation answers. Every part is optional: SAP returns what the customer's configuration produces. */
export function readSimulation(json: Row): SimResult {
  const items = results(json.to_Item).map((i): SimItem => {
    const sl = results(i.to_ScheduleLine);
    const confQty = sl.length ? sl.reduce((s, x) => s + (num(x.ConfdOrderQtyByMatlAvailCheck) ?? 0), 0) : null;
    let date: string | null = null;
    for (const x of sl) {
      const d = sapDay(x.ConfirmedDeliveryDate);
      if (d && (num(x.ConfdOrderQtyByMatlAvailCheck) ?? 0) > 0 && (!date || d > date)) date = d;
    }
    return { item: str(i.SalesOrderItem) ?? "", net: num(i.NetAmount), asked: num(i.RequestedQuantity), confirmedQty: confQty === null ? null : r2(confQty), confirmedDate: date };
  });
  const credit = results(json.to_Credit)[0] ?? (json.to_Credit && typeof json.to_Credit === "object" && !("__deferred" in (json.to_Credit as object)) ? (json.to_Credit as Row) : null);
  const pricing = results(json.to_Pricing)[0] ?? (json.to_Pricing && typeof json.to_Pricing === "object" && !("__deferred" in (json.to_Pricing as object)) ? (json.to_Pricing as Row) : null);
  return {
    currency: str(json.TransactionCurrency) ?? str(pricing?.TransactionCurrency),
    totalNet: num(pricing?.TotalNetAmount),
    creditStatus: credit ? str(credit.TotalCreditCheckStatus) : null,   // [verified-simulation]
    items,
  };
}

/**
 * The credit result of a simulation. TotalCreditCheckStatus is the document's credit status; its codes are SAP's own (A: checked, no
 * error, B: checked and blocked, C: partly released, D: released after the check). The mapping is [documented], so an unknown code
 * is a Warning and never a pass. No result at all is "Not run" with the reason, never a guess.
 */
export const CREDIT_NOT_READ = "SAP credit exposure is not read yet.";

export function creditFromSimulation(status: string | null): CheckOutcome {
  const out = (s: CheckStatus, message: string): CheckOutcome => ({ kind: "credit", status: s, message, detail: status ? { sap_credit_status: status } : null });
  const c = code(status);
  if (!c) return out("not_run", CREDIT_NOT_READ);
  if (c === "A") return out("passed", "SAP's credit check on this order passed.");
  if (c === "D") return out("passed", "SAP released this order after its credit check.");
  if (c === "B") return out("failed", "SAP's credit check blocks this order.");
  if (c === "C") return out("warning", "SAP's credit check released this order only in part.");
  return out("warning", `SAP returned the credit status ${c}, which this product does not read yet.`);
}
