import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
const logged: { objectType: string; objectId: string; action: string; via?: string | null; changes?: { field: string; from: unknown; to: unknown }[] }[] = [];
vi.mock("@/lib/changeLog", () => ({
  logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); },
  logChangeBatch: async () => {},
}));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: new Error("not used") }) }));

import { runPull } from "./server";
import { followUpOrders, refreshOrderDocuments, runPullSalesOrders } from "./orders";
import { mapInvoiceRow, mapOrderRow, orderSpine, invoiceSpine } from "./orderMap";
import { fakeDb, TENANT } from "./syncHarness";
import { ACCOUNT_ID, INVOICE_1, ORDER_A, ORDER_B, dvInvoice, dvLine, dvOrder, seedOrders, stubDataverse } from "./ordersHarness";
import { shapeErpDocument, type ErpDocumentRow } from "@/lib/salesOrders/erpDocs";
import { readErpDocument } from "@/lib/salesOrders/client";
import { orderPath } from "@/components/salesOrders/logic";
import { orderEditable } from "@/lib/salesOrders/types";

beforeEach(() => { logged.length = 0; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const pull = (db: ReturnType<typeof fakeDb>, over: Partial<Parameters<typeof runPullSalesOrders>[2]> = {}) =>
  runPullSalesOrders(db.client, TENANT, { trigger: "manual", userId: null, ...over });

describe("status spine from statecode (no statuscode table is assumed)", () => {
  it("maps the order states", () => {
    expect([0, 1, 2, 3, 4].map(orderSpine)).toEqual(["in_progress", "in_progress", "cancelled", "completed", "completed"]);
    expect(orderSpine(null)).toBe("in_progress");
  });

  it("maps the invoice states", () => {
    expect([0, 1, 2, 3].map(invoiceSpine)).toEqual(["open", "closed", "paid", "cancelled"]);
  });

  it("keeps the organisation's own wording, falling back to the state name", () => {
    const withLabel = mapOrderRow(dvOrder(ORDER_A, "ORD-1")) as ReturnType<typeof mapOrderRow> & { statusLabel: string };
    expect(withLabel.statusLabel).toBe("New");
    const bare = mapOrderRow({ salesorderid: ORDER_A, ordernumber: "ORD-2", statecode: 4 }) as { statusLabel: string; spine: string };
    expect(bare).toMatchObject({ statusLabel: "Invoiced", spine: "completed" });
    expect(mapInvoiceRow({ invoiceid: INVOICE_1, statecode: 2 })).toMatchObject({ status: "Paid", spine: "paid" });
  });

  it("derives the line discount and tax from the amounts", () => {
    const m = mapOrderRow(dvOrder(ORDER_A, "ORD-3", { order_details: [{ lineitemnumber: 1, productdescription: "Pump", quantity: 2, priceperunit: 100, baseamount: 200, manualdiscountamount: 20, extendedamount: 180, tax: 32.4 }] })) as { lines: { discountPct: number; taxPct: number; lineTotal: number }[] };
    expect(m.lines[0]).toMatchObject({ discountPct: 10, taxPct: 18, lineTotal: 180 });
  });
});

describe("pull: Dynamics 365 sales orders into Sales Orders", () => {
  it("creates read-only orders with their lines, linked to the synced account, and records the link", async () => {
    const db = fakeDb(seedOrders());
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")] });
    const r = await pull(db);
    expect(r.error).toBeNull();
    expect(r.counts).toMatchObject({ read: 1, created: 1, failed: 0 });

    const [o] = db.tables.sales_orders;
    expect(o).toMatchObject({
      tenant_id: TENANT, ref: "ORD-01000", origin: "erp", status: "confirmed", status_label: "New", spine: "in_progress", account_id: "acc-1",
      pricing_mode: "external", source_type: "erp", currency: "USD", total: 472, subtotal: 400, tax_total: 72, requested_date: "2026-11-20",
    });
    expect(db.tables.sales_order_lines).toHaveLength(2);
    expect(db.tables.sales_order_lines[0]).toMatchObject({ tenant_id: TENANT, order_id: o.id, description: "Item 1", qty: 2, unit_price: 100, tax_pct: 18, line_total: 200 });
    expect(db.tables.connector_links.find((l) => l.entity === "sales_orders")).toMatchObject({ object_type: "sales_orders", object_id: o.id, external_id: ORDER_A, external_key: "ORD-01000", direction: "pull" });
    // Read-only through the one lock rule, even though a link exists.
    expect(orderEditable({ origin: o.origin as "erp", status: o.status as "confirmed" }, true)).toBe(false);
    expect(orderEditable({ origin: o.origin as "erp", status: o.status as "confirmed" }, false)).toBe(false);
    expect(logged[0]).toMatchObject({ objectType: "sales_orders", action: "create", via: "integration" });
  });

  it("is idempotent: a second pull neither duplicates nor rewrites", async () => {
    const db = fakeDb(seedOrders());
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")] });
    await pull(db);
    logged.length = 0;
    const second = await pull(db);
    expect(second.counts).toMatchObject({ read: 1, created: 0, updated: 0, unchanged: 1 });
    expect(db.tables.sales_orders).toHaveLength(1);
    expect(db.tables.sales_order_lines).toHaveLength(2);
    expect(db.tables.connector_links.filter((l) => l.entity === "sales_orders")).toHaveLength(1);
    expect(logged).toHaveLength(0);
  });

  it("updates status, totals and lines when the order changes in the ERP, and logs the status change", async () => {
    const db = fakeDb(seedOrders());
    const dv = stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")] });
    await pull(db);
    logged.length = 0;
    dv.orders = [dvOrder(ORDER_A, "ORD-01000", { statecode: 3, statuscode: 4, [`statuscode${"@OData.Community.Display.V1.FormattedValue"}`]: "Complete", modifiedon: "2026-10-22T10:00:00Z", totalamount: 590, order_details: [dvLine(1), dvLine(2), dvLine(3)] })];
    const r = await pull(db);
    expect(r.counts).toMatchObject({ updated: 1, created: 0 });
    expect(db.tables.sales_orders[0]).toMatchObject({ status_label: "Complete", spine: "completed", total: 590 });
    expect(db.tables.sales_order_lines).toHaveLength(3);
    expect(logged[0]).toMatchObject({ action: "update", via: "integration" });
    expect(logged[0].changes?.[0]).toMatchObject({ field: "ERP status", from: "New", to: "Complete" });
  });

  it("still imports an order whose customer is not synced yet, naming the customer from the ERP", async () => {
    const seed = seedOrders();
    seed.connector_links = [];
    const db = fakeDb(seed);
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")] });
    const r = await pull(db);
    expect(r.counts).toMatchObject({ created: 1, failed: 0, skipped: 0 });
    expect(db.tables.sales_orders[0]).toMatchObject({ account_id: null, erp_customer_name: "Contoso Ltd" });

    // The customer arrives later: the next full pass links the order to the account.
    db.tables.connector_links.push({ id: "l-acc", tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", object_type: "accounts", object_id: "acc-1", external_id: ACCOUNT_ID, direction: "pull" });
    const again = await pull(db, { full: true });
    expect(again.counts.updated).toBe(1);
    expect(db.tables.sales_orders[0].account_id).toBe("acc-1");
  });

  it("stores a canceled order as cancelled", async () => {
    const db = fakeDb(seedOrders());
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000", { statecode: 2, statuscode: 5, [`statuscode${"@OData.Community.Display.V1.FormattedValue"}`]: "Canceled" })] });
    await pull(db);
    expect(db.tables.sales_orders[0]).toMatchObject({ status: "cancelled", status_label: "Canceled", spine: "cancelled" });
  });

  it("never overwrites an order made in BPMSquare except its status words", async () => {
    const seed = seedOrders();
    seed.sales_orders = [{ id: "so-1", tenant_id: TENANT, ref: "SO-0001", origin: "bpmsquare", status: "confirmed", status_label: null, spine: "open", account_id: "acc-1", total: 500, currency: "USD", notes: "mine" }];
    seed.sales_order_lines = [{ id: "ln-1", tenant_id: TENANT, order_id: "so-1", description: "Mine", qty: 1, unit_price: 500 }];
    seed.connector_links.push({ id: "l-so", tenant_id: TENANT, connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "so-1", external_id: ORDER_A, external_key: "old", direction: "push", content_hash: null });
    const db = fakeDb(seed);
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000", { statecode: 3, totalamount: 999 })] });
    const r = await pull(db);
    expect(r.counts).toMatchObject({ updated: 1, created: 0 });
    expect(db.tables.sales_orders).toHaveLength(1);
    expect(db.tables.sales_orders[0]).toMatchObject({ ref: "SO-0001", origin: "bpmsquare", total: 500, notes: "mine", status_label: "New", spine: "completed" });
    expect(db.tables.sales_order_lines).toEqual([expect.objectContaining({ id: "ln-1", description: "Mine" })]);
    expect(db.tables.connector_links.find((l) => l.id === "l-so")).toMatchObject({ external_key: "ORD-01000" });
  });

  it("counts a failing row, holds the watermark at it and says which order", async () => {
    let fail = true;
    const db = fakeDb(seedOrders(), { failInsert: (t, r) => (t === "sales_orders" && r.ref === "ORD-BAD" && fail ? { message: "constraint" } : null) });
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-OK"), dvOrder(ORDER_B, "ORD-BAD", { modifiedon: "2026-10-21T11:00:00Z" })] });
    const r = await pull(db);
    expect(r.counts).toMatchObject({ created: 1, failed: 1 });
    expect(r.issues[0]).toContain("Sales order ORD-BAD");
    const run = [...db.tables.connector_sync_runs].pop();
    expect(run?.status).toBe("partial");
    expect(run?.watermark).toBe("2026-10-21T11:00:00Z");
    fail = false;
    const again = await pull(db);
    expect(again.counts.created).toBe(1);
  });

  it("is reachable through runPull and respects the module flag", async () => {
    const off = fakeDb(seedOrders({ features: { sales_orders: false } }));
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")] });
    const r = await runPull(off.client, TENANT, "sales_orders", { trigger: "manual", userId: null });
    expect(r.error).toMatch(/isn't enabled/);
    expect(off.tables.sales_orders).toHaveLength(0);
    const on = fakeDb(seedOrders());
    const ok = await runPull(on.client, TENANT, "sales_orders", { trigger: "manual", userId: null });
    expect(ok.counts.created).toBe(1);
  });

  it("does nothing while its entity is switched off, and says so while the database update is pending", async () => {
    const off = fakeDb(seedOrders({ entity: { enabled: false } }));
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")] });
    expect((await pull(off)).error).toMatch(/switched off/);

    const db = fakeDb(seedOrders());
    const pending = { from: (t: string) => (t === "erp_documents" ? failing("42P01") : (db.client as { from: (t: string) => unknown }).from(t)) } as never;
    const r = await runPullSalesOrders(pending, TENANT, { trigger: "manual", userId: null });
    expect(r.error).toMatch(/database update is needed/);
    expect(db.tables.sales_orders).toHaveLength(0);
    expect(db.tables.connector_sync_runs ?? []).toHaveLength(0);
  });
});

/** A query builder that answers every call with a Postgres "relation does not exist" error. */
function failing(code: string) {
  const err = { data: null, error: { code, message: 'relation "x" does not exist' } };
  const q: unknown = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(err).then(res) : () => q) });
  return q;
}

async function pulledOrder(seed = seedOrders()) {
  const db = fakeDb(seed);
  const dv = stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")], invoices: [dvInvoice(INVOICE_1, ORDER_A)] });
  await pull(db);
  return { db, dv, orderId: db.tables.sales_orders[0].id as string };
}

describe("invoices: erp_documents for one order", () => {
  it("fetches the order's invoices into erp_documents with the ERP's wording and spine", async () => {
    const { db, orderId } = await pulledOrder();
    const r = await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual" });
    expect(r).toMatchObject({ kind: "ok", throttled: false, erpNumber: "ORD-01000" });
    expect(db.tables.erp_documents).toEqual([expect.objectContaining({
      tenant_id: TENANT, order_id: orderId, kind: "invoice", erp_number: "INV-01001", amount: 472, due_date: "2026-12-01", doc_date: "2026-11-02",
      status: "Billed", status_spine: "open", raw_ref: INVOICE_1, currency: "USD",
    })]);
    expect(db.tables.sales_orders[0].erp_docs_checked_at).toBeTruthy();
  });

  it("filters invoices by this order's ERP id only", async () => {
    const { db, dv, orderId } = await pulledOrder();
    await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual" });
    const call = dv.calls.find((u) => u.pathname.endsWith("/invoices"));
    expect(call?.searchParams.get("$filter")).toBe(`_salesorderid_value eq ${ORDER_A}`);
  });

  it("a paid invoice rolls the path to Paid", async () => {
    const { db, dv, orderId } = await pulledOrder();
    await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual" });
    const asDocs = () => db.tables.erp_documents.map((d) => readErpDocument(shapeErpDocument(d as unknown as ErpDocumentRow))!);
    const order = { status: "confirmed" as const, confirmed_at: "2026-10-20T08:00:00Z" };
    let steps = orderPath(order, asDocs()).steps;
    expect(steps.find((s) => s.key === "invoiced")?.state).toBe("current");
    expect(steps.find((s) => s.key === "paid")?.state).toBe("pending");

    dv.invoices = [dvInvoice(INVOICE_1, ORDER_A, { statecode: 2, statuscode: 100002, [`statuscode${"@OData.Community.Display.V1.FormattedValue"}`]: "Paid" })];
    const r = await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual", skipThrottle: true });
    expect(r.kind).toBe("ok");
    expect(db.tables.erp_documents).toHaveLength(1);
    expect(db.tables.erp_documents[0]).toMatchObject({ status: "Paid", status_spine: "paid" });
    steps = orderPath(order, asDocs()).steps;
    expect(steps.find((s) => s.key === "paid")?.state).toBe("current");
    expect(logged.some((l) => l.changes?.some((c) => c.field === "Invoice INV-01001" && c.to === "Paid"))).toBe(true);
  });

  it("a cancelled invoice does not light Invoiced", async () => {
    const { db, dv, orderId } = await pulledOrder();
    dv.invoices = [dvInvoice(INVOICE_1, ORDER_A, { statecode: 3 })];
    await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual" });
    const docs = db.tables.erp_documents.map((d) => readErpDocument(shapeErpDocument(d as unknown as ErpDocumentRow))!);
    expect(orderPath({ status: "confirmed", confirmed_at: "x" }, docs).steps.find((s) => s.key === "invoiced")?.state).toBe("pending");
  });

  it("removes an invoice the ERP no longer has and writes no delivery", async () => {
    const { db, dv, orderId } = await pulledOrder();
    await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual" });
    dv.invoices = [];
    await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual", skipThrottle: true });
    expect(db.tables.erp_documents).toHaveLength(0);
    expect(db.tables.erp_documents.filter((d) => d.kind === "delivery")).toHaveLength(0);
  });

  it("holds a second refresh of the same order for ten seconds", async () => {
    const { db, dv, orderId } = await pulledOrder();
    await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: true, trigger: "webhook" });
    const calls = dv.calls.length;
    const r = await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: true, trigger: "webhook" });
    expect(r).toMatchObject({ kind: "ok", throttled: true });
    expect(dv.calls.length).toBe(calls);
  });

  it("another tenant's order id finds nothing and asks the ERP nothing", async () => {
    const seed = seedOrders();
    seed.sales_orders = [{ id: "foreign", tenant_id: "t-2", ref: "SO-9", origin: "erp", status: "confirmed", spine: "in_progress" }];
    seed.connector_links.push({ id: "l-f", tenant_id: "t-2", connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "foreign", external_id: ORDER_B, direction: "pull" });
    const db = fakeDb(seed);
    const dv = stubDataverse({ orders: [dvOrder(ORDER_B, "ORD-F")], invoices: [dvInvoice(INVOICE_1, ORDER_B)] });
    const r = await refreshOrderDocuments(db.client, TENANT, "foreign", { withHeader: true, trigger: "manual" });
    expect(r).toEqual({ kind: "missing" });
    expect(dv.calls).toHaveLength(0);
    expect(db.tables.erp_documents).toHaveLength(0);
  });

  it("an order with no ERP link is not_linked", async () => {
    const seed = seedOrders();
    seed.sales_orders = [{ id: "so-1", tenant_id: TENANT, ref: "SO-0001", origin: "bpmsquare", status: "draft", spine: "open", currency: "USD" }];
    const db = fakeDb(seed);
    const dv = stubDataverse();
    expect(await refreshOrderDocuments(db.client, TENANT, "so-1", { withHeader: true, trigger: "manual" })).toEqual({ kind: "not_linked" });
    expect(dv.calls).toHaveLength(0);
  });

  it("degrades while migration 0216 is pending: pending, nothing written, nothing thrown", async () => {
    const { db } = await pulledOrder();
    const pendingDb = {
      from: (t: string) => {
        if (t === "erp_documents") return failing("42P01");
        const q = (db.client as { from: (t: string) => unknown }).from(t) as { select: (c?: string) => unknown };
        if (t === "sales_orders") {
          const select = q.select.bind(q);
          q.select = (c?: string) => (/erp_/.test(c ?? "") ? failing("42703") : select(c));
        }
        return q;
      },
    } as never;
    const r = await refreshOrderDocuments(pendingDb, TENANT, db.tables.sales_orders[0].id as string, { withHeader: true, trigger: "manual" });
    expect(r).toEqual({ kind: "pending" });
    expect(db.tables.erp_documents).toHaveLength(0);
  });

  it("reports an ERP that cannot be reached without losing what is stored", async () => {
    const { db, orderId } = await pulledOrder();
    await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }));
    const r = await refreshOrderDocuments(db.client, TENANT, orderId, { withHeader: false, trigger: "manual", skipThrottle: true });
    expect(r.kind === "ok" && r.documents?.error).toBeTruthy();
    expect(db.tables.erp_documents).toHaveLength(1);
  });
});

describe("follow-up job", () => {
  it("reads the invoices of open linked orders, oldest check first, and skips finished ones", async () => {
    const seed = seedOrders();
    const db = fakeDb(seed);
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-1"), dvOrder(ORDER_B, "ORD-2", { modifiedon: "2026-10-21T11:00:00Z" })], invoices: [dvInvoice(INVOICE_1, ORDER_A)] });
    await pull(db);
    const [a, b] = db.tables.sales_orders;
    // ORD-2 is done: completed with a paid invoice.
    Object.assign(b, { spine: "completed" });
    db.tables.erp_documents.push({ id: "d1", tenant_id: TENANT, order_id: b.id, kind: "invoice", raw_ref: "x", status_spine: "paid" });
    const r = await followUpOrders(db.client, TENANT, { deadline: Date.now() + 60_000 });
    expect(r).toMatchObject({ checked: 1, failed: 0, skipped: null });
    expect(db.tables.erp_documents.filter((d) => d.order_id === a.id)).toHaveLength(1);
  });

  it("with the Sales orders pull off, follows only orders made here: their status comes back, ERP-read orders are left alone", async () => {
    const seed = seedOrders({ entity: { schedule: "off" } });
    seed.sales_orders = [
      { id: "so-1", tenant_id: TENANT, ref: "SO-0001", origin: "bpmsquare", status: "confirmed", status_label: null, spine: "open", account_id: "acc-1", total: 500, currency: "USD" },
      { id: "so-2", tenant_id: TENANT, ref: "ORD-9", origin: "erp", status: "confirmed", status_label: "New", spine: "in_progress", account_id: "acc-1", total: 1, currency: "USD" },
    ];
    seed.connector_links.push(
      { id: "l-1", tenant_id: TENANT, connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "so-1", external_id: ORDER_A, external_key: "ORD-01000", direction: "push" },
      { id: "l-2", tenant_id: TENANT, connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "so-2", external_id: ORDER_B, external_key: "ORD-9", direction: "pull" },
    );
    const db = fakeDb(seed);
    const dv = stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000", { statecode: 3 }), dvOrder(ORDER_B, "ORD-9")], invoices: [dvInvoice(INVOICE_1, ORDER_A)] });
    const r = await followUpOrders(db.client, TENANT, { deadline: Date.now() + 60_000 });
    expect(r.checked).toBe(1);
    expect(db.tables.sales_orders.find((o) => o.id === "so-1")).toMatchObject({ spine: "completed", total: 500, status_label: "New" });
    expect(db.tables.erp_documents).toEqual([expect.objectContaining({ order_id: "so-1", raw_ref: INVOICE_1 })]);
    expect(dv.calls.some((u) => u.pathname.includes(ORDER_B))).toBe(false);
  });

  it("does nothing for a workspace without the module", async () => {
    const db = fakeDb(seedOrders({ features: { sales_orders: false } }));
    stubDataverse();
    expect(await followUpOrders(db.client, TENANT, { deadline: Date.now() + 1000 })).toMatchObject({ checked: 0, skipped: "module off" });
  });

  it("is bounded by its batch size", async () => {
    const db = fakeDb(seedOrders());
    const orders = ["1", "2", "3"].map((n) => dvOrder(`aaaaaaaa-0000-0000-0000-00000000010${n}`, `ORD-${n}`));
    const dv = stubDataverse({ orders });
    await pull(db);
    const r = await followUpOrders(db.client, TENANT, { deadline: Date.now() + 60_000, batch: 2 });
    expect(r.checked).toBe(2);
    expect(dv.calls.filter((u) => u.pathname.endsWith("/invoices"))).toHaveLength(2);
  });
});

