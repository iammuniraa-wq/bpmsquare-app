import { asStepError, ErpStepError, type ErpHttp } from "./erp";
import { hasMarker } from "./payload";

// The Dataverse sales order. Verified live against the Dynamics trial
// (2026-10-21): a sales order is ONE POST to `salesorders` with its lines
// deep-inserted as `order_details` (write-in lines, no uomid); `Prefer:
// return=representation` returns `ordernumber` (ORD-01000-Q3T6T0) and
// `totalamount`; it is born Active (statecode 0 / statuscode 1), so there is no
// activate, win or close step. The BPMSquare marker sits at the end of the
// description exactly as it does for quotes.

export type DataverseOrderState = {
  orderId: string;
  orderNumber: string | null;
  statecode: number;
  total: number | null;
  name: string | null;
  description: string | null;
};

function toOrderState(row: Record<string, unknown>): DataverseOrderState | null {
  const id = typeof row.salesorderid === "string" ? row.salesorderid : null;
  if (!id) return null;
  return {
    orderId: id,
    orderNumber: typeof row.ordernumber === "string" ? row.ordernumber : null,
    statecode: typeof row.statecode === "number" ? row.statecode : 0,
    total: typeof row.totalamount === "number" ? row.totalamount : null,
    name: typeof row.name === "string" ? row.name : null,
    description: typeof row.description === "string" ? row.description : null,
  };
}

const ORDER_SELECT = "salesorderid,ordernumber,statecode,statuscode,totalamount,name,description";

export async function getOrderState(http: ErpHttp, orderId: string): Promise<DataverseOrderState | null> {
  try {
    const row = (await http.get(`salesorders(${orderId})`, { $select: ORDER_SELECT })) as Record<string, unknown> | null;
    return row ? toOrderState({ salesorderid: orderId, ...row }) : null;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw asStepError("find", e);
  }
}

/** The order this BPMSquare quote already is in Dataverse, found by the quote-id marker in its description.
 *  The ref only narrows the search: two workspaces sharing one environment can both own an SQ-0003. */
export async function findOrderByMarker(http: ErpHttp, ref: string, docId: string): Promise<DataverseOrderState | null> {
  const safe = ref.replace(/'/g, "''");
  try {
    const page = (await http.get("salesorders", { $select: ORDER_SELECT, $filter: `startswith(name,'${safe} ')`, $top: "50" })) as { value?: Record<string, unknown>[] } | null;
    const row = (page?.value ?? []).find((r) => hasMarker(r.description, docId));
    return row ? toOrderState(row) : null;
  } catch (e) {
    throw asStepError("find", e);
  }
}

export type OrderSendResult = { orderId: string; orderNumber: string | null; total: number | null; created: boolean; steps: string[]; alreadyDone: boolean };

/** Create the order, unless this quote already is one (from its link, or found again by its marker). */
export async function sendDataverseSalesOrder(
  http: ErpHttp,
  a: { ref: string; docId: string | null; existingId: string | null; create: Record<string, unknown>; onCreated: (s: DataverseOrderState) => Promise<void> },
): Promise<OrderSendResult> {
  let state: DataverseOrderState | null = null;
  if (a.existingId) state = await getOrderState(http, a.existingId);
  if (!state && a.docId) {
    state = await findOrderByMarker(http, a.ref, a.docId);
    if (state) await a.onCreated(state);
  }
  if (state) return { orderId: state.orderId, orderNumber: state.orderNumber, total: state.total, created: false, steps: ["Found the order already in Dynamics."], alreadyDone: true };
  try {
    const { row, entityId } = await http.create("salesorders", a.create);
    const made = toOrderState({ salesorderid: row.salesorderid ?? entityId, ...row });
    if (!made) throw new ErpStepError("create", 0, "Dynamics did not return the new order's id");
    await a.onCreated(made);
    return { orderId: made.orderId, orderNumber: made.orderNumber, total: made.total, created: true, steps: ["Created the order with its lines."], alreadyDone: false };
  } catch (e) {
    throw asStepError("create", e);
  }
}
