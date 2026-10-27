import { vi } from "vitest";
import { FORMATTED, LOOKUP_TYPE } from "./orderMap";
import { TENANT, seedConnector, type Row } from "./syncHarness";

// A scripted Dataverse for the sales order tests: orders (with lines), invoices and the filters a pull and a refresh send.
// Not a test file. It answers the way the live trial answered when the connector was built: lists as { value },
// a single record as the bare row, lookup and option-set wording as OData formatted values.

export const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
export const ORDER_A = "aaaaaaaa-0000-0000-0000-000000000001";
export const ORDER_B = "aaaaaaaa-0000-0000-0000-000000000002";
export const INVOICE_1 = "bbbbbbbb-0000-0000-0000-000000000001";

export type DvState = { orders: Row[]; invoices: Row[]; calls: URL[] };

export const dvLine = (n: number, over: Row = {}): Row => ({
  salesorderdetailid: `cccccccc-0000-0000-0000-00000000000${n}`, lineitemnumber: n, productdescription: `Item ${n}`, quantity: 2, priceperunit: 100,
  baseamount: 200, extendedamount: 200, manualdiscountamount: 0, tax: 36, requestdeliveryby: "2026-11-15", ...over,
});

export const dvOrder = (id: string, number: string, over: Row = {}): Row => ({
  salesorderid: id, ordernumber: number, name: `Order ${number}`, totalamount: 472, totallineitemamount: 400, totaltax: 72, totaldiscountamount: 0, freightamount: 0,
  statecode: 0, statuscode: 1, [`statuscode${FORMATTED}`]: "New", [`statecode${FORMATTED}`]: "Active",
  requestdeliveryby: "2026-11-20", createdon: "2026-10-20T08:00:00Z", modifiedon: "2026-10-21T10:00:00Z",
  _customerid_value: ACCOUNT_ID, [`_customerid_value${FORMATTED}`]: "Contoso Ltd", [`_customerid_value${LOOKUP_TYPE}`]: "account",
  transactioncurrencyid: { isocurrencycode: "USD" },
  order_details: [dvLine(1), dvLine(2, { productdescription: "Item 2", baseamount: 200, extendedamount: 200 })],
  ...over,
});

export const dvInvoice = (id: string, orderId: string, over: Row = {}): Row => ({
  invoiceid: id, invoicenumber: "INV-01001", totalamount: 472, duedate: "2026-12-01", createdon: "2026-11-02T09:00:00Z", modifiedon: "2026-11-02T09:00:00Z",
  statecode: 0, statuscode: 100001, [`statuscode${FORMATTED}`]: "Billed", [`statecode${FORMATTED}`]: "Active", _salesorderid_value: orderId, ...over,
});

/** Replaces global fetch with the scripted Dataverse. Returns its state: edit `orders` / `invoices` between runs. */
export function stubDataverse(initial: Partial<Pick<DvState, "orders" | "invoices">> = {}): DvState {
  const state: DvState = { orders: initial.orders ?? [], invoices: initial.invoices ?? [], calls: [] };
  vi.stubGlobal("fetch", async (u: string) => {
    const url = new URL(u);
    state.calls.push(url);
    const path = decodeURIComponent(url.pathname.replace(/^.*\/api\/data\/v9\.2\//, ""));
    const filter = url.searchParams.get("$filter") ?? "";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const one = /^salesorders\(([^)]+)\)$/.exec(path);
    if (one) {
      const row = state.orders.find((o) => o.salesorderid === one[1]);
      return row ? json(row) : json({ error: { code: "0x80040217", message: "salesorder With Id does not exist" } }, 404);
    }
    if (path === "salesorders") {
      let rows = state.orders;
      const since = /modifiedon ge (\S+)/.exec(filter);
      if (since) rows = rows.filter((o) => String(o.modifiedon) >= since[1]);
      const ids = [...filter.matchAll(/salesorderid eq ([0-9a-f-]{36})/g)].map((m) => m[1]);
      if (ids.length) rows = rows.filter((o) => ids.includes(String(o.salesorderid)));
      return json({ value: rows });
    }
    if (path === "invoices") {
      const m = /_salesorderid_value eq ([0-9a-f-]{36})/.exec(filter);
      return json({ value: state.invoices.filter((i) => !m || i._salesorderid_value === m[1]) });
    }
    return json({ error: { message: `unexpected ${path}` } }, 404);
  });
  return state;
}

/** The D365 connector seeded for sales orders: Dataverse, the entity on, the module flag on, one synced account. */
export function seedOrders(over: { features?: Record<string, boolean>; entity?: Record<string, unknown>; config?: Row } = {}): Record<string, Row[]> {
  const seed = seedConnector({ entities: { sales_orders: { enabled: true, schedule: "hourly", ...(over.entity ?? {}) } } });
  seed.tenants = [{ id: TENANT, features: { sales_orders: true, ...(over.features ?? {}) }, config: over.config ?? { currency: "USD" } }];
  seed.accounts = [{ id: "acc-1", tenant_id: TENANT, name: "Contoso Ltd" }];
  seed.connector_links = [{
    id: "l-acc", tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", object_type: "accounts", object_id: "acc-1", external_id: ACCOUNT_ID, direction: "pull",
  }];
  seed.sales_orders = [];
  seed.sales_order_lines = [];
  seed.erp_documents = [];
  return seed;
}
