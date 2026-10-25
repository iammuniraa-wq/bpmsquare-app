import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async () => new Response("{}") }));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("not available in this test"); } }));
const logged: { objectType: string; objectId: string; actorId?: string | null; changes?: { field: string; from: unknown; to: unknown }[] }[] = [];
vi.mock("@/lib/changeLog", () => ({
  logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); },
  logChangeBatch: async () => {},
}));
const refresh = vi.fn(async () => ({ kind: "ok" }));
vi.mock("@/lib/connectors/d365/orders", () => ({ refreshOrderDocuments: (...a: unknown[]) => (refresh as unknown as (...x: unknown[]) => unknown)(...a) }));
const confirmedEvents: unknown[] = [];
vi.mock("@/lib/events/emitters", () => ({ emitOrderConfirmed: async (_t: string, p: unknown) => { confirmedEvents.push(p); } }));

import { D365Error } from "@/lib/connectors/d365/odata";
import { FakeDataverse } from "@/lib/middleware/fakeDataverse";
import { fakeAdmin, seedMiddleware, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { runOrderChecks } from "./erpChecksServer";
import { sendOrderToErp, outLines } from "./erpSend";
import { hashOf, loadChecks, loadTransfers } from "./erpState";
import { orderEditable } from "./types";

const ACC = "00000000-aaaa-4aaa-8aaa-000000000001";
const PROD = "00000000-bbbb-4bbb-8bbb-000000000001";
const PL = "00000000-cccc-4ccc-8ccc-000000000001";

beforeEach(() => { logged.length = 0; confirmedEvents.length = 0; refresh.mockClear(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

function seed(over: { noCustomerLink?: boolean; noProductLink?: boolean } = {}): Record<string, Row[]> {
  const s = seedMiddleware({ features: { sales_orders: true } });
  if (over.noCustomerLink) s.connector_links = [];
  s.sales_orders = [{
    id: "so-1", tenant_id: T1, ref: "SO-0001", origin: "bpmsquare", status: "draft", spine: "open", account_id: "acc-1", contact_id: null, currency: "USD",
    subtotal: 1000, discount_total: 0, tax_total: 180, shipping_amount: 0, total: 1180, customer_po: "PO-7", requested_date: "2026-11-20", notes: null, terms: null, confirmed_at: null,
  }];
  s.sales_order_lines = [
    { id: "ln-1", tenant_id: T1, order_id: "so-1", line_no: 1, product_id: "prod-1", description: "Pump", uom: "Nos", qty: 4, unit_price: 100, discount_pct: 0, tax_pct: 18, line_total: 400 },
    { id: "ln-2", tenant_id: T1, order_id: "so-1", line_no: 2, product_id: null, description: "Installation", uom: null, qty: 1, unit_price: 600, discount_pct: 0, tax_pct: 18, line_total: 600 },
  ];
  if (!over.noProductLink) {
    s.connector_links.push({ tenant_id: T1, connector_id: "dynamics365", entity: "products", object_type: "products", object_id: "prod-1", external_id: PROD, external_key: "PRD-1", direction: "pull", created_at: "2026-10-01T00:00:00.000Z" });
  }
  s.sales_order_checks = [];
  s.sales_order_transfers = [];
  return s;
}

function erp(over: { onHand?: number | null; price?: number; hold?: boolean; limit?: number | null; open?: number } = {}): FakeDataverse {
  const dv = new FakeDataverse();
  dv.accountRows[ACC] = { creditonhold: over.hold ?? false, creditlimit: over.limit === undefined ? 10000 : over.limit };
  dv.accountPriceLists[ACC] = PL;
  dv.productRows[PROD] = { price: over.price ?? 100, quantityonhand: over.onHand === undefined ? 10 : over.onHand };
  dv.data.productpricelevels = [{ _pricelevelid_value: PL, _productid_value: PROD, amount: over.price ?? 100 }];
  if (over.open) dv.existingOrders = [{ _customerid_value: ACC, totalamount: over.open, statecode: 0 }];
  return dv;
}

const writes = (dv: FakeDataverse) => dv.calls.filter((c) => c.method !== "GET");
const checksOf = (db: { tables: Record<string, Row[]> }) => Object.fromEntries((db.tables.sales_order_checks ?? []).map((c) => [c.kind as string, c]));

describe("Check with ERP", () => {
  it("passes all three, stores them with the order's fingerprint, and writes nothing to the ERP", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    const r = await runOrderChecks(db.client, T1, "so-1", { userId: "u-1", http: dv });
    expect(r.kind).toBe("ok");
    const rows = checksOf(db);
    expect(Object.keys(rows).sort()).toEqual(["credit", "price", "stock"]);
    expect(rows.credit).toMatchObject({ status: "passed", tenant_id: T1, order_id: "so-1" });
    expect(rows.price).toMatchObject({ status: "passed" });
    expect(rows.stock).toMatchObject({ status: "passed" });
    expect(rows.stock.quantity_hash).toBe(hashOf(db.tables.sales_orders[0] as never, db.tables.sales_order_lines as never));
    expect(writes(dv)).toEqual([]);
    expect(logged[0]).toMatchObject({ objectType: "sales_orders", objectId: "so-1", actorId: "u-1" });
    expect(logged[0].changes?.[0].field).toBe("checked with ERP");
    // A second run replaces the rows instead of adding more.
    await runOrderChecks(db.client, T1, "so-1", { http: dv });
    expect(db.tables.sales_order_checks).toHaveLength(3);
  });

  it("credit fails on hold, price warns on a difference, stock fails when short", async () => {
    const db = fakeAdmin(seed());
    const dv = erp({ hold: true, price: 120, onHand: 2 });
    await runOrderChecks(db.client, T1, "so-1", { http: dv });
    const rows = checksOf(db);
    expect(rows.credit).toMatchObject({ status: "failed" });
    expect(rows.price).toMatchObject({ status: "warning" });
    expect(String(rows.price.message)).toContain("priced differently");
    expect(rows.stock).toMatchObject({ status: "failed" });
    expect((rows.stock.detail as { lines: { line_id: string; on_hand: number }[] }).lines[0]).toMatchObject({ line_id: "ln-1", on_hand: 2 });
  });

  it("adds the customer's open ERP orders to this order for the credit limit", async () => {
    const db = fakeAdmin(seed());
    await runOrderChecks(db.client, T1, "so-1", { http: erp({ open: 9000 }) });
    expect(checksOf(db).credit).toMatchObject({ status: "failed" });
  });

  it("a customer or product not linked to the ERP is a warning, never a crash", async () => {
    const db = fakeAdmin(seed({ noCustomerLink: true, noProductLink: true }));
    const dv = erp();
    const r = await runOrderChecks(db.client, T1, "so-1", { http: dv });
    expect(r.kind).toBe("ok");
    const rows = checksOf(db);
    expect(rows.credit).toMatchObject({ status: "warning" });
    expect(String(rows.credit.message)).toContain("not in the ERP yet");
    expect(rows.price).toMatchObject({ status: "warning" });
    expect(rows.stock).toMatchObject({ status: "warning" });
    expect(dv.calls.some((c) => c.path.startsWith("products("))).toBe(false);
  });

  it("an ERP that cannot be read is not_run with the reason, not a failure", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    dv.get = async () => { throw new D365Error("The service is unavailable", 503); };
    const r = await runOrderChecks(db.client, T1, "so-1", { http: dv });
    expect(r.kind).toBe("ok");
    const rows = checksOf(db);
    for (const k of ["credit", "price", "stock"]) expect(rows[k], k).toMatchObject({ status: "not_run" });
    expect(String(rows.credit.message)).toContain("unavailable");
  });

  it("a result is out of date once a quantity changes", async () => {
    const db = fakeAdmin(seed());
    await runOrderChecks(db.client, T1, "so-1", { http: erp() });
    const order = db.tables.sales_orders[0] as never;
    const fresh = await loadChecks(db.client, T1, order, db.tables.sales_order_lines as never);
    expect(fresh.checks.every((c) => !c.stale)).toBe(true);
    db.tables.sales_order_lines[0].qty = 9;
    const after = await loadChecks(db.client, T1, order, db.tables.sales_order_lines as never);
    expect(after.checks).toHaveLength(3);
    expect(after.checks.every((c) => c.stale)).toBe(true);
  });

  it("another workspace's order id finds nothing, and the ERP is never asked", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    expect(await runOrderChecks(db.client, T2, "so-1", { http: dv })).toEqual({ kind: "missing" });
    expect(dv.calls).toHaveLength(0);
    expect(db.tables.sales_order_checks).toHaveLength(0);
  });

  it("while migration 0217 is pending it says so and writes nothing", async () => {
    const db = fakeAdmin(seed(), { missing: ["sales_order_checks"] });
    const dv = erp();
    const r = await runOrderChecks(db.client, T1, "so-1", { http: dv });
    expect(r).toMatchObject({ kind: "pending", bundle: "scripts/run-bundle-28-sales-order-checks-2026-10-24.sql" });
    expect(dv.calls).toHaveLength(0);
  });

  it("is refused for an order that is cancelled, already in the ERP, or has no lines, and with no connector says so", async () => {
    const s = seed();
    s.sales_orders[0].status = "cancelled";
    expect(await runOrderChecks(fakeAdmin(s).client, T1, "so-1", { http: erp() })).toMatchObject({ kind: "not_ready" });
    const linked = seed();
    linked.connector_links.push({ tenant_id: T1, connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "so-1", external_id: "x", direction: "push" });
    expect(await runOrderChecks(fakeAdmin(linked).client, T1, "so-1", { http: erp() })).toMatchObject({ kind: "not_ready" });
    const none = seed();
    none.sales_order_lines = [];
    expect(await runOrderChecks(fakeAdmin(none).client, T1, "so-1", { http: erp() })).toMatchObject({ kind: "not_ready" });
    const noConn = seed();
    noConn.tenant_connectors = [];
    expect(await runOrderChecks(fakeAdmin(noConn).client, T1, "so-1", { http: erp() })).toMatchObject({ kind: "no_connector" });
  });
});

const passAll = (db: ReturnType<typeof fakeAdmin>) => {
  const h = hashOf(db.tables.sales_orders[0] as never, db.tables.sales_order_lines as never);
  for (const kind of ["credit", "price", "stock"]) db.tables.sales_order_checks.push({ tenant_id: T1, order_id: "so-1", kind, status: "passed", message: "ok", detail: null, checked_at: "2026-10-24T10:00:00Z", quantity_hash: h });
};

describe("Send to ERP", () => {
  it("asks for confirmation when a check is not a current pass, and sends nothing until it is given", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    const r = await sendOrderToErp(db.client, T1, "so-1", { userId: "u-1", http: dv });
    expect(r.state).toBe("needs_confirmation");
    if (r.state === "needs_confirmation") expect(r.items).toHaveLength(3);
    expect(dv.calls).toHaveLength(0);
    expect(dv.orders).toHaveLength(0);
    expect(db.tables.sales_order_transfers).toHaveLength(0);
  });

  it("needs no confirmation when all three are current passes", async () => {
    const db = fakeAdmin(seed());
    passAll(db);
    const r = await sendOrderToErp(db.client, T1, "so-1", { userId: "u-1", http: erp() });
    expect(r.state).toBe("sent");
  });

  it("creates the ERP order with its lines, links it, locks the order, logs the transfer and the Monitor message", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    const r = await sendOrderToErp(db.client, T1, "so-1", { userId: "u-1", confirm: true, http: dv });
    expect(r).toMatchObject({ state: "sent" });
    expect(dv.orders).toHaveLength(1);
    const o = dv.orders[0];
    expect(o.lines).toHaveLength(2);
    expect(o.lines[0]).toMatchObject({ productdescription: "Pump", quantity: 4, priceperunit: 100, isproductoverridden: true });
    expect(o.lines[1]).toMatchObject({ productdescription: "Installation", quantity: 1, priceperunit: 600 });
    expect(String(o.body.name).startsWith("SO-0001")).toBe(true);
    expect(String(o.body.description)).toContain("Customer PO: PO-7");
    expect(String(o.body.description)).toContain(`[bpmsquare:so-1]`);
    expect(o.body["customerid_account@odata.bind"]).toBe(`/accounts(${ACC})`);

    const link = db.tables.connector_links.find((l) => l.entity === "sales_orders")!;
    expect(link).toMatchObject({ object_type: "sales_orders", object_id: "so-1", external_id: o.salesorderid, external_key: o.ordernumber, direction: "push" });
    const row = db.tables.sales_orders[0];
    expect(row).toMatchObject({ status: "confirmed", spine: "in_progress", status_label: "Submitted" });
    expect(orderEditable({ origin: "bpmsquare", status: row.status as "confirmed" }, true)).toBe(false);
    expect(db.tables.sales_order_transfers[0]).toMatchObject({ tenant_id: T1, order_id: "so-1", user_id: "u-1", result: "sent", erp_number: o.ordernumber, step: null });
    expect(db.tables.integration_messages[0]).toMatchObject({ status: "ok", direction: "out", object_type: "sales_orders", object_id: "so-1", ref_label: `Sales order ${o.ordernumber}` });
    expect(logged.some((l) => l.changes?.some((c) => c.field === "sent to Dynamics 365 Sales" && c.to === o.ordernumber))).toBe(true);
    expect(confirmedEvents).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a second press is already_sent with the ERP number, makes no twin, and is logged", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    await sendOrderToErp(db.client, T1, "so-1", { confirm: true, http: dv });
    const callsBefore = writes(dv).length;
    const again = await sendOrderToErp(db.client, T1, "so-1", { userId: "u-1", confirm: true, http: dv });
    expect(again).toMatchObject({ state: "already_sent", erpNumber: dv.orders[0].ordernumber });
    expect(dv.orders).toHaveLength(1);
    expect(writes(dv)).toHaveLength(callsBefore);
    expect(db.tables.sales_order_transfers.map((t) => t.result)).toEqual(["sent", "already_sent"]);
  });

  it("two overlapping presses make one ERP order", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    dv.createDelayMs = 20;
    const [a, b] = await Promise.all([sendOrderToErp(db.client, T1, "so-1", { confirm: true, http: dv }), sendOrderToErp(db.client, T1, "so-1", { confirm: true, http: dv })]);
    expect(dv.orders).toHaveLength(1);
    expect([a.state, b.state].sort()).toEqual(["in_progress", "sent"]);
  });

  it("a failed send leaves the order editable, records the failing step, and Retry then succeeds with one order", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    dv.failOnce.createOrder = { status: 400, message: "Dynamics rejected the order" };
    const first = await sendOrderToErp(db.client, T1, "so-1", { userId: "u-1", confirm: true, http: dv });
    expect(first).toMatchObject({ state: "failed", step: "create" });
    expect(db.tables.sales_orders[0]).toMatchObject({ status: "draft" });
    expect(db.tables.connector_links.some((l) => l.entity === "sales_orders")).toBe(false);
    expect(orderEditable({ origin: "bpmsquare", status: "draft" }, false)).toBe(true);
    expect(db.tables.sales_order_transfers[0]).toMatchObject({ result: "failed", step: "create", user_id: "u-1" });
    expect(String(db.tables.sales_order_transfers[0].message).length).toBeGreaterThan(5);
    expect(db.tables.integration_messages[0]).toMatchObject({ status: "failed", object_type: "sales_orders" });
    expect(dv.orders).toHaveLength(0);

    const retry = await sendOrderToErp(db.client, T1, "so-1", { userId: "u-1", confirm: true, http: dv });
    expect(retry.state).toBe("sent");
    expect(dv.orders).toHaveLength(1);
    expect(db.tables.sales_order_transfers.map((t) => t.result)).toEqual(["failed", "sent"]);
  });

  it("an ERP order whose link was lost is found again by the marker, not made twice", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    await sendOrderToErp(db.client, T1, "so-1", { confirm: true, http: dv });
    db.tables.connector_links = db.tables.connector_links.filter((l) => l.entity !== "sales_orders");
    db.tables.sales_orders[0].status = "draft";
    const r = await sendOrderToErp(db.client, T1, "so-1", { confirm: true, http: dv });
    expect(r.state).toBe("already_sent");
    expect(dv.orders).toHaveLength(1);
    expect(db.tables.connector_links.find((l) => l.entity === "sales_orders")).toMatchObject({ external_id: dv.orders[0].salesorderid });
  });

  it("is not ready without a linked customer, lines, or a connector, and sends nothing", async () => {
    const dv = erp();
    expect(await sendOrderToErp(fakeAdmin(seed({ noCustomerLink: true })).client, T1, "so-1", { confirm: true, http: dv })).toMatchObject({ state: "not_ready" });
    const none = seed();
    none.sales_order_lines = [];
    expect(await sendOrderToErp(fakeAdmin(none).client, T1, "so-1", { confirm: true, http: dv })).toMatchObject({ state: "not_ready" });
    const noConn = seed();
    noConn.tenant_connectors = [];
    expect(await sendOrderToErp(fakeAdmin(noConn).client, T1, "so-1", { confirm: true, http: dv })).toMatchObject({ state: "no_connector" });
    expect(dv.orders).toHaveLength(0);
  });

  it("another workspace's order id finds nothing and nothing is sent", async () => {
    const db = fakeAdmin(seed());
    const dv = erp();
    expect(await sendOrderToErp(db.client, T2, "so-1", { confirm: true, http: dv })).toEqual({ state: "missing" });
    expect(dv.calls).toHaveLength(0);
    expect(db.tables.sales_order_transfers).toHaveLength(0);
  });

  it("while migration 0217 is pending it says so and sends nothing", async () => {
    const db = fakeAdmin(seed(), { missing: ["sales_order_transfers"] });
    const dv = erp();
    expect(await sendOrderToErp(db.client, T1, "so-1", { confirm: true, http: dv })).toMatchObject({ state: "pending" });
    expect(dv.calls).toHaveLength(0);
  });

  it("reads the transfer log back with the person's name", async () => {
    const s = seed();
    s.tenant_users = [{ tenant_id: T1, user_id: "u-1", display_name: "Asha" }];
    const db = fakeAdmin(s);
    await sendOrderToErp(db.client, T1, "so-1", { userId: "u-1", confirm: true, http: erp() });
    const t = await loadTransfers(db.client, T1, "so-1");
    expect(t.pending).toBe(false);
    expect(t.transfers).toHaveLength(1);
    expect(t.transfers[0]).toMatchObject({ result: "sent" });
  });
});

describe("the document sent", () => {
  it("folds a line discount into the net unit price, as quotes do", () => {
    const out = outLines([{ line_no: 1, description: "Pump", uom: null, qty: 4, unit_price: 100, discount_pct: 10, line_total: 360 }]);
    expect(out[0]).toMatchObject({ qty: 4, rate: 100, discount_pct: 10, amount: 360 });
  });
});
