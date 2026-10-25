import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async (u: string, init: RequestInit) => fetch(u, init) }));
const logged: { objectType: string; objectId: string; via?: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[] = [];
vi.mock("@/lib/changeLog", () => ({
  logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); },
  logChangeBatch: async () => {},
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: () => {} }));

import { fakeDb, type Row } from "@/lib/connectors/d365/syncHarness";
import { shapeErpDocument, type ErpDocumentRow } from "@/lib/salesOrders/erpDocs";
import { orderPath } from "@/components/salesOrders/logic";
import { orderEditable } from "@/lib/salesOrders/types";
import { fakeAdmin } from "@/lib/middleware/testHarness";
import { FakeS4 } from "./fakeS4";
import { followUpSapOrders, orderChangedFilter, refreshSapOrder, runPullSapOrders } from "./orders";
import {
  BILLING_DOCUMENT_METADATA, OUTBOUND_DELIVERY_METADATA, SALES_ORDER_HEADER_PROPS, SALES_ORDER_ITEM_PROPS, SALES_ORDER_METADATA, SIMULATION_HEADER_PROPS, SIMULATION_METADATA,
} from "./metadataFixtures";
import {
  buildCreatePayload, buildSimulationPayload, creditFromSimulation, lineBlocker, mapBillingRow, mapDeliveryRow, mapSapOrderRow, readSimulation, sapOrderStatus,
} from "./orderMap";
import { parseServiceMeta, missingProps, pickProp } from "./serviceMeta";
import { SapClient } from "./odata";
import { runSapPull } from "./server";

const T1 = "t-1";
const T2 = "t-2";
const HOST = "my426318-api.s4hana.cloud.sap";
const SECRET = "pw-secret-9f3";

beforeEach(() => { logged.length = 0; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const server = (o: ConstructorParameters<typeof FakeS4>[0] = {}) => new FakeS4({ user: "BPM_USER", password: SECRET, ...o });

function seed(over: { entities?: Record<string, unknown>; features?: Record<string, boolean>; erpOrder?: boolean; sentOrder?: boolean } = {}): Record<string, Row[]> {
  const s: Record<string, Row[]> = {
    tenants: [
      { id: T1, features: { sales_orders: true, integration_middleware: true, accounts: true, products: true, ...(over.features ?? {}) }, config: { currency: "EUR" } },
      { id: T2, features: { sales_orders: true, integration_middleware: true }, config: {} },
    ],
    tenant_connectors: [{
      tenant_id: T1, connector_id: "sap_s4", status: "connected", last_error: null,
      config: { auth_mode: "basic", api_host: HOST, username: "BPM_USER", schedule: "off", entities: over.entities ?? { sales_orders: { enabled: true, field_map: {} } } },
      credentials: { password: SECRET },
    }],
    accounts: [{ id: "acc-1", tenant_id: T1, name: "Alpha GmbH" }],
    products: [{ id: "prod-1", tenant_id: T1, name: "Pump" }, { id: "prod-2", tenant_id: T1, name: "Valve" }],
    connector_links: [
      { tenant_id: T1, connector_id: "sap_s4", entity: "customers", object_type: "accounts", object_id: "acc-1", external_id: "0000001000", external_key: "0000001000", direction: "pull" },
      { tenant_id: T1, connector_id: "sap_s4", entity: "products", object_type: "products", object_id: "prod-1", external_id: "TG11", external_key: "TG11", direction: "pull" },
      { tenant_id: T1, connector_id: "sap_s4", entity: "products", object_type: "products", object_id: "prod-2", external_id: "TG12", external_key: "TG12", direction: "pull" },
    ],
    sales_orders: [], sales_order_lines: [], erp_documents: [], integration_messages: [], connector_sync_runs: [],
  };
  if (over.sentOrder) {
    // An order made here that SAP accepted: the link is the push row a send writes.
    s.sales_orders.push({ id: "so-1", tenant_id: T1, ref: "SO-0001", origin: "bpmsquare", status: "confirmed", status_label: "Submitted", spine: "in_progress", account_id: "acc-1", currency: "EUR", total: 20 });
    s.connector_links.push({ tenant_id: T1, connector_id: "sap_s4", entity: "sales_orders", object_type: "sales_orders", object_id: "so-1", external_id: "0000000069", external_key: "0000000069", direction: "push" });
  }
  return s;
}

const orders = (f: FakeS4) => f.addOrders(
  { number: "0000000069", soldTo: "0000001000", changed: "2026-10-20", requested: "2026-11-10", process: "B", delivery: "B", po: "PO-7", items: [
    { item: "10", material: "TG11", qty: 2, net: 20, text: "Pump TG11", tax: 3.8, confirmed: { qty: 2, date: "2026-11-12" } },
    { item: "20", material: "TG12", qty: 4, net: 80, confirmed: { qty: 3, date: "2026-11-20" } },
  ] },
  { number: "0000000070", soldTo: "0000009999", changed: "2026-10-21", items: [{ item: "10", material: "TG99", qty: 1, net: 5 }] },
);

const pull = (db: ReturnType<typeof fakeDb>, f: FakeS4, o: Partial<Parameters<typeof runPullSapOrders>[2]> = {}, tenant = T1) =>
  runPullSapOrders(db.client, tenant, { trigger: "manual", userId: "u-1", fetch: f.fetch, ...o });

// ── Reading orders ──────────────────────────────────────────────────────────

describe("SAP sales orders in", () => {
  it("creates read-only orders with their items, the customer from its business partner link, and SAP's own status words", async () => {
    const db = fakeDb(seed());
    const f = orders(server());
    const r = await pull(db, f);
    expect(r.error).toBeNull();
    expect(r.counts).toMatchObject({ read: 2, created: 2, failed: 0 });

    const o = db.tables.sales_orders.find((x) => x.ref === "0000000069")!;
    expect(o).toMatchObject({ origin: "erp", status: "confirmed", spine: "in_progress", account_id: "acc-1", currency: "EUR", pricing_mode: "external", requested_date: "2026-11-10" });
    expect(o.status_label).toBe("In process · Delivery partly");
    expect(orderEditable({ origin: o.origin as "erp", status: o.status as "confirmed" }, true)).toBe(false);
    expect(Number(o.subtotal)).toBe(100);
    expect(Number(o.tax_total)).toBe(3.8);
    expect(Number(o.total)).toBe(103.8);

    const lines = db.tables.sales_order_lines.filter((l) => l.order_id === o.id).sort((a, b) => Number(a.line_no) - Number(b.line_no));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ line_no: 1, product_id: "prod-1", description: "Pump TG11", uom: "PC", confirmed_date: "2026-11-12", availability_source: "erp" });
    expect(Number(lines[0].unit_price)).toBe(10);
    expect(Number(lines[0].qty)).toBe(2);
    expect(Number(lines[1].confirmed_qty)).toBe(3);   // asked 4, SAP confirms 3: the Availability tab shows it short

    // A customer SAP has that was not synced yet does not fail the order.
    const other = db.tables.sales_orders.find((x) => x.ref === "0000000070")!;
    expect(other.account_id).toBeNull();
    expect(other.erp_customer_name).toBe("Customer 0000009999");

    const links = db.tables.connector_links.filter((l) => l.entity === "sales_orders");
    expect(links.map((l) => l.external_id).sort()).toEqual(["0000000069", "0000000070"]);
    expect(links.every((l) => l.direction === "pull" && l.connector_id === "sap_s4" && l.tenant_id === T1)).toBe(true);
    expect(logged.filter((e) => e.action === "create").every((e) => e.via === "integration")).toBe(true);
    // The Monitor line is the run's, named for SAP.
    expect(db.tables.integration_messages.some((m) => m.connector_id === "sap_s4" && m.entity === "sales_orders")).toBe(true);
  });

  it("is idempotent: a second run reads the same orders and changes nothing; a changed order is updated once", async () => {
    const db = fakeDb(seed());
    const f = orders(server());
    await pull(db, f);
    const again = await pull(db, f, { full: true });
    expect(again.counts).toMatchObject({ read: 2, created: 0, updated: 0, unchanged: 2 });
    expect(db.tables.sales_orders).toHaveLength(2);
    expect(db.tables.sales_order_lines).toHaveLength(3);

    (f.orders[0].to_Item as { results: Row[] }).results[0].RequestedQuantity = "3";
    f.orders[0].OverallSDProcessStatus = "C";
    const third = await pull(db, f, { full: true });
    expect(third.counts).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    const o = db.tables.sales_orders.find((x) => x.ref === "0000000069")!;
    expect(o.spine).toBe("completed");
    expect(String(o.status_label)).toMatch(/^Completed/);
    expect(db.tables.sales_order_lines.filter((l) => l.order_id === o.id)).toHaveLength(2);
  });

  it("reads incrementally: the second run asks only for orders changed since the first", async () => {
    const db = fakeDb(seed());
    const f = orders(server());
    await pull(db, f);
    const before = f.calls.length;
    f.addOrders({ number: "0000000071", soldTo: "0000001000", changed: "2026-10-25" });
    const r = await pull(db, f);
    expect(r.counts.created).toBe(1);
    const filters = f.calls.slice(before).map((c) => c.url.searchParams.get("$filter") ?? "");
    expect(filters.some((x) => x.includes("LastChangeDateTime ge datetimeoffset'2026-10-21T00:00:00Z'"))).toBe(true);
    expect(db.tables.sales_orders).toHaveLength(3);
  });

  it("is switched off by default and by the module flag, and a pending database update is said, not crashed on", async () => {
    const f = orders(server());
    expect((await pull(fakeDb(seed({ entities: {} })), f)).error).toMatch(/switched off/);
    expect((await pull(fakeDb(seed({ features: { sales_orders: false } })), f)).error).toMatch(/module isn't enabled/);
    // Migration 0216 not run yet: the table does not exist. The run says so (and names the bundle) and creates nothing.
    const pending = fakeAdmin(seed(), { missing: ["erp_documents"] });
    const r = await pull(pending as never, f);
    expect(r.error).toMatch(/database update is needed first/);
    expect(pending.tables.sales_orders).toHaveLength(0);
    // A refresh of a linked order degrades the same way.
    const linked = fakeAdmin(seed({ sentOrder: true }), { missing: ["erp_documents"] });
    expect(await refreshSapOrder(linked.client, T1, "so-1", { withHeader: false, trigger: "manual", fetch: f.fetch })).toEqual({ kind: "pending" });
  });

  it("goes through runSapPull for the sales_orders entity (the Resync and cron entry point)", async () => {
    const db = fakeDb(seed());
    const f = orders(server());
    const r = await runSapPull(db.client, T1, "sales_orders", { trigger: "manual", userId: "u-1", fetch: f.fetch });
    expect(r.counts.created).toBe(2);
  });

  it("reads one order by its number (Resync by id), also when it is typed without leading zeros", async () => {
    const db = fakeDb(seed());
    const f = orders(server());
    const r = await pull(db, f, { ids: ["69"] });
    expect(r.counts.read).toBe(1);
    expect(db.tables.sales_orders.map((o) => o.ref)).toEqual(["0000000069"]);
  });

  it("another tenant's workspace never sees this tenant's SAP connection or orders", async () => {
    const db = fakeDb(seed());
    const f = orders(server());
    const r = await pull(db, f, {}, T2);
    expect(r.error).toMatch(/isn't connected/);
    expect(db.tables.sales_orders).toHaveLength(0);
  });
});

// ── Deliveries and billing documents ────────────────────────────────────────

const docRows = (db: ReturnType<typeof fakeDb>, kind: string) => (db.tables.erp_documents as ErpDocumentRow[]).filter((d) => d.kind === kind);
const docViews = (db: ReturnType<typeof fakeDb>) => (db.tables.erp_documents as ErpDocumentRow[]).map((d) => shapeErpDocument(d));

describe("SAP deliveries and invoices as erp_documents", () => {
  it("writes the deliveries (by the order they reference) and the billing documents, and rolls the path forward", async () => {
    const db = fakeDb(seed({ sentOrder: true }));
    const f = orders(server())
      .addDelivery({ number: "80000001", order: "0000000069", issued: "2026-11-12" })
      .addDelivery({ number: "80000002", order: "0000000069", planned: "2026-11-25" })
      .addDelivery({ number: "80000009", order: "0000000070", issued: "2026-11-12" })
      .addBilling({ number: "90000001", order: "0000000069", net: 20, tax: 3.8, date: "2026-11-13" })
      .addBilling({ number: "90000002", order: "0000000070", net: 5 });
    const r = await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", userId: "u-1", fetch: f.fetch });
    expect(r).toMatchObject({ kind: "ok", throttled: false, erpNumber: "0000000069" });
    expect(docRows(db, "delivery").map((d) => [d.erp_number, d.status, d.status_spine]).sort()).toEqual([["80000001", "Goods issued", "delivered"], ["80000002", "Open", "open"]]);
    const inv = docRows(db, "invoice");
    expect(inv.map((d) => d.erp_number)).toEqual(["90000001"]);
    expect(Number(inv[0].amount)).toBe(23.8);
    expect(inv[0]).toMatchObject({ status: "Open", status_spine: "open", doc_date: "2026-11-13", currency: "EUR" });
    // Every document row names this tenant and this order.
    expect(db.tables.erp_documents.every((d) => d.tenant_id === T1 && d.order_id === "so-1")).toBe(true);

    const order = db.tables.sales_orders.find((o) => o.id === "so-1")!;
    const path = orderPath({ status: order.status as "confirmed", confirmed_at: "2026-10-20T00:00:00Z" }, docViews(db) as never);
    expect(path.steps.find((s) => s.key === "delivered")!.state).not.toBe("pending");
    expect(path.steps.find((s) => s.key === "invoiced")!.state).not.toBe("pending");
    expect(path.steps.find((s) => s.key === "paid")!.state).toBe("pending");
  });

  it("marks a cleared billing document Paid, and a cancelled one Cancelled; a document SAP no longer has is removed", async () => {
    const db = fakeDb(seed({ sentOrder: true }));
    const f = orders(server()).addBilling({ number: "90000001", order: "0000000069", net: 20, clearing: "C" }).addBilling({ number: "90000003", order: "0000000069", net: 10, cancelled: true });
    await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", skipThrottle: true, fetch: f.fetch });
    expect(docRows(db, "invoice").map((d) => [d.erp_number, d.status_spine]).sort()).toEqual([["90000001", "paid"], ["90000003", "cancelled"]]);
    expect(docViews(db).find((d) => d.number === "90000001")!.paid).toBe(true);

    f.billingHeaders.splice(1, 1);
    f.billingItems.splice(1, 1);
    await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", skipThrottle: true, fetch: f.fetch });
    expect(docRows(db, "invoice").map((d) => d.erp_number)).toEqual(["90000001"]);
  });

  it("finds a billing document made from a delivery through the delivery's number", async () => {
    const db = fakeDb(seed({ sentOrder: true }));
    const f = orders(server()).addDelivery({ number: "80000001", order: "0000000069", issued: "2026-11-12" }).addBilling({ number: "90000007", order: "0000000069", net: 15, viaDelivery: "80000001" });
    await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", fetch: f.fetch });
    expect(docRows(db, "invoice").map((d) => d.erp_number)).toEqual(["90000007"]);
  });

  it("refreshes the status words of an order made here without touching its lines, and logs the change as via integration", async () => {
    const db = fakeDb(seed({ sentOrder: true }));
    const f = orders(server());
    f.orders[0].OverallSDProcessStatus = "C";
    f.orders[0].OverallTotalDeliveryStatus = "C";
    const r = await refreshSapOrder(db.client, T1, "so-1", { withHeader: true, trigger: "manual", fetch: f.fetch });
    expect(r).toMatchObject({ kind: "ok", header: "updated" });
    const o = db.tables.sales_orders.find((x) => x.id === "so-1")!;
    expect(o).toMatchObject({ spine: "completed", origin: "bpmsquare", status: "confirmed" });
    expect(String(o.status_label)).toBe("Completed · Delivery complete");
    expect(o.total).toBe(20);
    expect(logged.some((e) => e.objectId === "so-1" && e.via === "integration" && e.changes?.[0]?.field === "ERP status")).toBe(true);
  });

  it("names a missing property of the connected system instead of guessing, and still writes the other kind", async () => {
    const noRef = OUTBOUND_DELIVERY_METADATA.replace('<Property Name="ReferenceSDDocument" Type="Edm.String"/>', "");
    const db = fakeDb(seed({ sentOrder: true }));
    const f = orders(server({ metadata: { API_OUTBOUND_DELIVERY_SRV: noRef } })).addBilling({ number: "90000001", order: "0000000069", net: 20 });
    const r = await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", fetch: f.fetch });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.documents?.error).toMatch(/API_OUTBOUND_DELIVERY_SRV has no ReferenceSDDocument/);
    expect(docRows(db, "invoice")).toHaveLength(1);
    expect(docRows(db, "delivery")).toHaveLength(0);
  });

  it("keeps what is stored and says why when a service refuses the user", async () => {
    const db = fakeDb(seed({ sentOrder: true }));
    const f = orders(server({ deny: { API_OUTBOUND_DELIVERY_SRV: 403 } })).addBilling({ number: "90000001", order: "0000000069", net: 20 });
    const r = await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", fetch: f.fetch });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.documents?.error).toMatch(/API_OUTBOUND_DELIVERY_SRV/);
    expect(docRows(db, "invoice")).toHaveLength(1);
  });

  it("reads documents when the system's $metadata cannot be read (the property is then assumed and the call tells)", async () => {
    const db = fakeDb(seed({ sentOrder: true }));
    const f = orders(server({ metadataFails: true })).addDelivery({ number: "80000001", order: "0000000069", issued: "2026-11-12" });
    await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", fetch: f.fetch });
    expect(docRows(db, "delivery")).toHaveLength(1);
  });

  it("answers missing for another tenant's order id, not_linked for an order no ERP holds, and throttles a second press", async () => {
    const db = fakeDb(seed({ sentOrder: true }));
    const f = orders(server());
    expect(await refreshSapOrder(db.client, T2, "so-1", { withHeader: false, trigger: "manual", fetch: f.fetch })).toEqual({ kind: "missing" });
    db.tables.sales_orders.push({ id: "so-9", tenant_id: T1, ref: "SO-0009", origin: "bpmsquare", currency: "EUR" });
    expect(await refreshSapOrder(db.client, T1, "so-9", { withHeader: false, trigger: "manual", fetch: f.fetch })).toEqual({ kind: "not_linked" });
    const first = await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", fetch: f.fetch });
    expect(first).toMatchObject({ kind: "ok", throttled: false });
    const second = await refreshSapOrder(db.client, T1, "so-1", { withHeader: false, trigger: "manual", fetch: f.fetch });
    expect(second).toMatchObject({ kind: "ok", throttled: true });
  });

  it("the follow-up job refreshes open linked orders in a bounded batch and leaves other workspaces alone", async () => {
    const s = seed({ sentOrder: true });
    s.sales_orders.push({ id: "so-t2", tenant_id: T2, ref: "SO-T2", origin: "bpmsquare", status: "confirmed", spine: "in_progress", currency: "EUR" });
    s.connector_links.push({ tenant_id: T2, connector_id: "sap_s4", entity: "sales_orders", object_type: "sales_orders", object_id: "so-t2", external_id: "0000000500", external_key: "0000000500", direction: "push" });
    const db = fakeDb(s);
    const f = orders(server()).addBilling({ number: "90000001", order: "0000000069", net: 20 });
    const r = await followUpSapOrders(db.client, T1, { deadline: Date.now() + 60_000, fetch: f.fetch });
    expect(r).toMatchObject({ checked: 1, failed: 0, skipped: null });
    expect(docRows(db, "invoice")).toHaveLength(1);
    expect(db.tables.erp_documents.every((d) => d.tenant_id === T1)).toBe(true);
    // Checked a moment ago: the next run leaves it for the following hour.
    expect((await followUpSapOrders(db.client, T1, { deadline: Date.now() + 60_000, fetch: f.fetch })).checked).toBe(0);
    expect((await followUpSapOrders(db.client, T1, { deadline: Date.now() + 60_000, fetch: f.fetch, nowMs: Date.now() + 2 * 3_600_000 })).checked).toBe(1);
  });
});

// ── The pure parts ──────────────────────────────────────────────────────────

describe("the CSRF token on a write", () => {
  const client = (fetchImpl: (u: string, i: RequestInit) => Promise<Response>) => new SapClient(`https://${HOST}/sap/opu/odata/sap/API_SALES_ORDER_SRV`, async () => ({ Authorization: "Basic x" }), { fetch: fetchImpl, sleep: async () => {} });

  it("fetches the token once, keeps the cookies, and asks for a fresh token a single time when SAP says it expired", async () => {
    const log: string[] = [];
    let token = 0;
    const c = client(async (u, init) => {
      const h = new Headers(init.headers);
      const method = init.method ?? "GET";
      log.push(`${method} ${new URL(u).pathname.split("/").pop() || "/"} ${h.get("x-csrf-token") ?? "-"} ${h.get("cookie") ?? "-"}`);
      if (method === "GET") {
        const r = new Response("{}", { status: 200, headers: { "content-type": "application/json", "x-csrf-token": `t${++token}` } });
        r.headers.append("set-cookie", `s=${token}; path=/`);
        return r;
      }
      if (h.get("x-csrf-token") === "t1") return new Response(JSON.stringify({ error: { message: { value: "CSRF token validation failed" } } }), { status: 403, headers: { "x-csrf-token": "Required", "content-type": "application/json" } });
      return new Response(JSON.stringify({ d: { SalesOrder: "5" } }), { status: 201, headers: { "content-type": "application/json" } });
    });
    expect(await c.create("A_SalesOrder", { a: 1 })).toEqual({ SalesOrder: "5" });
    expect(log).toEqual(["GET / Fetch -", "POST A_SalesOrder t1 s=1", "GET / Fetch -", "POST A_SalesOrder t2 s=2"]);
    // The token is reused for the next write.
    await c.create("A_SalesOrder", { a: 2 });
    expect(log.slice(4)).toEqual(["POST A_SalesOrder t2 s=2"]);
  });

  it("never repeats a write: a timeout surfaces as an error after exactly one POST", async () => {
    let posts = 0;
    const c = client(async (_u, init) => {
      if ((init.method ?? "GET") === "GET") return new Response("{}", { headers: { "x-csrf-token": "t" } });
      posts++;
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await expect(c.create("A_SalesOrder", {})).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/did not answer in time/) });
    expect(posts).toBe(1);
  });

  it("refuses to write when SAP hands out no token", async () => {
    const c = client(async () => new Response("{}", { status: 200 }));
    await expect(c.create("A_SalesOrder", {})).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/security token/) });
  });
});

describe("order status words and the spine", () => {
  it("reads SAP's three-letter statuses; a fully rejected order is cancelled", () => {
    expect(sapOrderStatus({ OverallSDProcessStatus: "A" }, [])).toEqual({ label: "Open", spine: "open" });
    expect(sapOrderStatus({ OverallSDProcessStatus: "B", OverallTotalDeliveryStatus: "B" }, [])).toEqual({ label: "In process · Delivery partly", spine: "in_progress" });
    expect(sapOrderStatus({ OverallSDProcessStatus: "C", OverallTotalDeliveryStatus: "C", OverallOrdReltdBillgStatus: "C" }, [])).toEqual({ label: "Completed · Delivery complete · Billing complete", spine: "completed" });
    expect(sapOrderStatus({ OverallSDProcessStatus: "A", OverallSDDocumentRejectionSts: "C" }, [])).toEqual({ label: "Rejected", spine: "cancelled" });
  });

  it("tolerates every status property being absent, and sums the item-level statuses where the header has none", () => {
    expect(sapOrderStatus({}, [])).toEqual({ label: "Open", spine: "open" });
    expect(sapOrderStatus({ OverallSDProcessStatus: "B" }, [{ DeliveryStatus: "C", OrderRelatedBillingStatus: "A" }, { DeliveryStatus: "C", OrderRelatedBillingStatus: "C" }]).label).toBe("In process · Delivery complete · Billing partly");
  });

  it("maps an order row without items to hasLines false, so the lines are read per order", () => {
    const m = mapSapOrderRow({ SalesOrder: "1", SoldToParty: "5", TotalNetAmount: "10", TransactionCurrency: "usd" });
    if ("error" in m) throw new Error(m.error);
    expect(m).toMatchObject({ hasLines: false, currency: "USD", customerExternalId: "5", subtotal: 10, total: 10 });
    expect(mapSapOrderRow({})).toEqual({ error: "no SalesOrder" });
  });

  it("maps documents: goods issued, clearing and cancellation", () => {
    expect(mapDeliveryRow({ DeliveryDocument: "8", OverallGoodsMovementStatus: "C", ActualGoodsMovementDate: "/Date(1763000000000)/" })).toMatchObject({ spine: "delivered", status: "Goods issued", docDate: "2025-11-13" });
    expect(mapDeliveryRow({ DeliveryDocument: "8", DeliveryDate: "/Date(1763000000000)/" })).toMatchObject({ spine: "open", amount: null });
    expect(mapBillingRow({ BillingDocument: "9", TotalNetAmount: "10", TaxAmount: "1.5", InvoiceClearingStatus: "C" })).toMatchObject({ amount: 11.5, spine: "paid", status: "Paid" });
    expect(mapBillingRow({ BillingDocument: "9", TotalGrossAmount: "12", BillingDocumentIsCancelled: true })).toMatchObject({ amount: 12, spine: "cancelled" });
    expect(mapBillingRow({ BillingDocument: "9" })).toMatchObject({ spine: "open", status: "Open" });
    expect(mapDeliveryRow({})).toEqual({ error: "no DeliveryDocument" });
  });

  it("builds the incremental filter as an Edm.DateTimeOffset literal", () => {
    expect(orderChangedFilter("2026-10-21")).toBe("LastChangeDateTime ge datetimeoffset'2026-10-21T00:00:00Z'");
    expect(orderChangedFilter(null)).toBeUndefined();
    expect(orderChangedFilter("x'; drop")).toBeUndefined();
  });
});

describe("payloads and the simulation answer", () => {
  const area = { salesOrganization: "1010", distributionChannel: "10", division: "00", salesGroup: "G01", salesOffice: "O01" };
  const lines = [{ item: "10", material: "TG11", qty: 2 }, { item: "20", material: "TG12", qty: 4.5 }];

  it("the create body carries the sales area parts, the sold-to party, the PO and the items", () => {
    const b = buildCreatePayload({ area, soldTo: "0000001000", currency: "EUR", requestedDate: "2026-11-10", lines, customerPo: "PO-7", orderRef: "SO-0001", carrier: null });
    expect(b).toMatchObject({
      SalesOrderType: "OR", SalesOrganization: "1010", DistributionChannel: "10", OrganizationDivision: "00", SalesGroup: "G01", SalesOffice: "O01",
      SoldToParty: "0000001000", TransactionCurrency: "EUR", RequestedDeliveryDate: "2026-11-10T00:00:00", PurchaseOrderByCustomer: "PO-7",
    });
    expect(b.to_Item).toEqual([{ SalesOrderItem: "10", Material: "TG11", RequestedQuantity: "2" }, { SalesOrderItem: "20", Material: "TG12", RequestedQuantity: "4.5" }]);
    expect("AccountingDocExternalReference" in b).toBe(false);
  });

  it("without a customer PO the order ref is the PO, and a writable carrier holds the ref too; the group and office are left out when not given", () => {
    const b = buildCreatePayload({ area: { salesOrganization: "1010", distributionChannel: "10", division: "00" }, soldTo: "5", currency: null, requestedDate: null, lines, customerPo: "  ", orderRef: "SO-0001", carrier: "AccountingDocExternalReference" });
    expect(b.PurchaseOrderByCustomer).toBe("SO-0001");
    expect(b.AccountingDocExternalReference).toBe("SO-0001");
    expect("SalesGroup" in b || "SalesOffice" in b || "RequestedDeliveryDate" in b || "TransactionCurrency" in b).toBe(false);
    expect(buildSimulationPayload({ area, soldTo: "5", currency: "EUR", requestedDate: null, lines })).not.toHaveProperty("PurchaseOrderByCustomer");
  });

  it("reads a simulation answer: net per item, the quantity confirmed over its schedule lines, the credit status", () => {
    const sim = readSimulation({
      TransactionCurrency: "EUR",
      to_Pricing: { results: [{ TotalNetAmount: "30", TransactionCurrency: "EUR" }] },
      to_Credit: { results: [{ TotalCreditCheckStatus: "A" }] },
      to_Item: { results: [
        { SalesOrderItem: "10", RequestedQuantity: "2", NetAmount: "20", to_ScheduleLine: { results: [{ ConfdOrderQtyByMatlAvailCheck: "1", ConfirmedDeliveryDate: "/Date(1763000000000)/" }, { ConfdOrderQtyByMatlAvailCheck: "1", ConfirmedDeliveryDate: "/Date(1763600000000)/" }] } },
        { SalesOrderItem: "20", RequestedQuantity: "1", NetAmount: "10" },
      ] },
    });
    expect(sim).toMatchObject({ currency: "EUR", totalNet: 30, creditStatus: "A" });
    expect(sim.items[0]).toMatchObject({ item: "10", net: 20, asked: 2, confirmedQty: 2, confirmedDate: "2025-11-20" });
    expect(sim.items[1]).toMatchObject({ confirmedQty: null, confirmedDate: null });
    expect(readSimulation({}).creditStatus).toBeNull();
    expect(readSimulation({ to_Credit: { __deferred: { uri: "x" } } }).creditStatus).toBeNull();
  });

  it("maps the credit status; no result is Not run with the reason, an unknown code a Warning, never a pass", () => {
    expect(creditFromSimulation("A").status).toBe("passed");
    expect(creditFromSimulation("D").status).toBe("passed");
    expect(creditFromSimulation("B").status).toBe("failed");
    expect(creditFromSimulation("C").status).toBe("warning");
    expect(creditFromSimulation("Z").status).toBe("warning");
    expect(creditFromSimulation(null)).toMatchObject({ status: "not_run", message: "SAP credit exposure is not read yet." });
    expect(creditFromSimulation("")).toMatchObject({ status: "not_run" });
  });

  it("names a free-text line, then a product SAP does not know", () => {
    const l = [{ line_no: 1, description: "Pump", product_id: "p1" }, { line_no: 2, description: "Installation work", product_id: null }];
    expect(lineBlocker(l, new Map([["p1", "TG11"]]))).toBe('Line 2 ("Installation work") has no catalogue product. SAP orders need a material: pick the product on that line.');
    expect(lineBlocker([l[0]], new Map())).toMatch(/Line 1 \("Pump"\) is not in SAP yet/);
    expect(lineBlocker([l[0]], new Map([["p1", "TG11"]]))).toBeNull();
  });
});

describe("the checked-in $metadata fixtures", () => {
  it("list every property the code requires (so a fixture can not drift from the code)", () => {
    const so = parseServiceMeta(SALES_ORDER_METADATA);
    expect(missingProps(so, "API_SALES_ORDER_SRV", [
      { set: "A_SalesOrderType", props: ["SalesOrderType", "SalesOrganization", "DistributionChannel", "OrganizationDivision", "SoldToParty", "PurchaseOrderByCustomer"], navs: ["to_Item"] },
      { set: "A_SalesOrderItemType", props: ["SalesOrderItem", "Material", "RequestedQuantity"] },
    ])).toEqual([]);
    expect(so.get("A_SalesOrder")).toBe(so.get("A_SalesOrderType"));
    const sim = parseServiceMeta(SIMULATION_METADATA);
    expect(missingProps(sim, "API_SALES_ORDER_SIMULATION_SRV", [{ set: "A_SalesOrderSimulation", props: ["SalesOrderType", "SoldToParty"], navs: ["to_Item", "to_Credit", "to_Pricing"] }])).toEqual([]);
    expect(parseServiceMeta(OUTBOUND_DELIVERY_METADATA).get("A_OutbDeliveryItem")!.props.has("ReferenceSDDocument")).toBe(true);
    expect(parseServiceMeta(BILLING_DOCUMENT_METADATA).get("A_BillingDocumentItem")!.props.has("SalesDocument")).toBe(true);
  });

  it("reports what a release lacks by property and service, and picks a writable carrier only when the system lists it as writable", () => {
    const lacking = parseServiceMeta(SALES_ORDER_METADATA.replace('<Property Name="Material" Type="Edm.String"/>', ""));
    const msgs = missingProps(lacking, "API_SALES_ORDER_SRV", [{ set: "A_SalesOrderItemType", props: ["Material"] }, { set: "A_Nope", props: ["X"] }]);
    expect(msgs).toEqual(["A_SalesOrderItemType has no Material in API_SALES_ORDER_SRV", "API_SALES_ORDER_SRV does not list A_Nope"]);
    expect(missingProps(null, "S", [{ set: "x", props: ["y"] }])).toEqual([]);
    const withCarrier = parseServiceMeta(SALES_ORDER_METADATA.replace("</EntityType>", '<Property Name="AccountingDocExternalReference" Type="Edm.String" sap:creatable="false"/></EntityType>'));
    expect(withCarrier.get("A_SalesOrderType")!.props.get("AccountingDocExternalReference")).toMatchObject({ creatable: false });
    expect(pickProp(withCarrier, "A_SalesOrderType", ["Nope", "SalesOrder"])).toBe("SalesOrder");
    expect(SALES_ORDER_HEADER_PROPS).toContain("OverallTotalDeliveryStatus");
    expect(SALES_ORDER_ITEM_PROPS).toContain("OrderRelatedBillingStatus");
    expect(SIMULATION_HEADER_PROPS).toContain("AccountingDocExternalReference");
  });
});

