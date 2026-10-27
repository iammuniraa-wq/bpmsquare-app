import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async () => new Response("{}") }));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("not available in this test"); } }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: () => {} }));
const logged: { objectType: string; objectId: string; via?: string; actorId?: string | null; changes?: { field: string; from: unknown; to: unknown }[] }[] = [];
vi.mock("@/lib/changeLog", () => ({
  logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); },
  logChangeBatch: async () => {},
}));
const confirmedEvents: unknown[] = [];
vi.mock("@/lib/events/emitters", () => ({ emitOrderConfirmed: async (_t: string, p: unknown) => { confirmedEvents.push(p); } }));
// SO4a's value-mapped organisation is a stub until it merges: the resolver is scripted here and the real splitter is kept.
const resolve = vi.fn(async (..._a: unknown[]): Promise<{ ok: true; code: string; via: "coverage"; key: string } | { ok: false; reason: string }> => ({ ok: true, code: "1010/10/00", via: "coverage", key: "North" }));
vi.mock("@/lib/middleware/erpOrg", async (orig) => ({ ...(await orig<typeof import("@/lib/middleware/erpOrg")>()), resolveErpOrg: (...a: unknown[]) => resolve(...a) }));

import { FakeS4 } from "@/lib/connectors/sap_s4/fakeS4";
import { SALES_ORDER_METADATA } from "@/lib/connectors/sap_s4/metadataFixtures";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { runOrderChecks } from "./erpChecksServer";
import { sendOrderToErp } from "./erpSend";
import { loadChecks, loadTransfers } from "./erpState";
import { orderEditable } from "./types";
import { buildOrderView } from "./view";
import { loadLines, loadOrder } from "./server";

const HOST = "my426318-api.s4hana.cloud.sap";
const SECRET = "pw-secret-9f3";
const NO_AREA = "No sales area is mapped for this customer's coverage.";

beforeEach(() => {
  logged.length = 0; confirmedEvents.length = 0;
  resolve.mockClear();
  resolve.mockImplementation(async () => ({ ok: true, code: "1010/10/00", via: "coverage", key: "North" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const server = (o: ConstructorParameters<typeof FakeS4>[0] = {}) => new FakeS4({ user: "BPM_USER", password: SECRET, ...o });
const deps = (f: FakeS4) => ({ sap: { fetch: f.fetch } });

function seed(over: { noCustomerLink?: boolean; freeText?: boolean; customerPo?: string | null; onlyFreeText?: boolean } = {}): Record<string, Row[]> {
  const s: Record<string, Row[]> = {
    tenants: [
      { id: T1, features: { sales_orders: true, integration_middleware: true, accounts: true, products: true }, config: { currency: "EUR" } },
      { id: T2, features: { sales_orders: true }, config: {} },
    ],
    tenant_connectors: [{
      tenant_id: T1, connector_id: "sap_s4", status: "connected", last_error: null,
      config: { auth_mode: "basic", api_host: HOST, username: "BPM_USER", schedule: "off", entities: {} }, credentials: { password: SECRET },
    }],
    accounts: [{ id: "acc-1", tenant_id: T1, name: "Alpha GmbH" }],
    connector_links: [
      { tenant_id: T1, connector_id: "sap_s4", entity: "products", object_type: "products", object_id: "prod-1", external_id: "TG11", external_key: "TG11", direction: "pull", created_at: "2026-10-01T00:00:00.000Z" },
      { tenant_id: T1, connector_id: "sap_s4", entity: "products", object_type: "products", object_id: "prod-2", external_id: "TG12", external_key: "TG12", direction: "pull", created_at: "2026-10-01T00:00:00.000Z" },
    ],
    sales_orders: [{
      id: "so-1", tenant_id: T1, ref: "SO-0001", origin: "bpmsquare", status: "draft", spine: "open", account_id: "acc-1", contact_id: null, type_id: null, currency: "EUR",
      subtotal: 100, discount_total: 0, tax_total: 0, shipping_amount: 0, total: 100, customer_po: over.customerPo === undefined ? "PO-7" : over.customerPo,
      requested_date: "2026-11-20", notes: null, terms: null, confirmed_at: null,
    }],
    sales_order_lines: [
      { id: "ln-1", tenant_id: T1, order_id: "so-1", line_no: 1, product_id: "prod-1", description: "Pump", uom: "PC", qty: 2, unit_price: 10, discount_pct: 0, tax_pct: 0, line_total: 20 },
      { id: "ln-2", tenant_id: T1, order_id: "so-1", line_no: 2, product_id: "prod-2", description: "Valve", uom: "PC", qty: 4, unit_price: 20, discount_pct: 0, tax_pct: 0, line_total: 80 },
    ],
    sales_order_checks: [], sales_order_transfers: [], integration_messages: [], erp_documents: [],
  };
  if (!over.noCustomerLink) {
    s.connector_links.push({ tenant_id: T1, connector_id: "sap_s4", entity: "customers", object_type: "accounts", object_id: "acc-1", external_id: "0000001000", external_key: "0000001000", direction: "pull", created_at: "2026-10-01T00:00:00.000Z" });
  }
  if (over.freeText) s.sales_order_lines.push({ id: "ln-3", tenant_id: T1, order_id: "so-1", line_no: 3, product_id: null, description: "Installation", uom: null, qty: 1, unit_price: 50, discount_pct: 0, tax_pct: 0, line_total: 50 });
  if (over.onlyFreeText) s.sales_order_lines = [{ id: "ln-3", tenant_id: T1, order_id: "so-1", line_no: 1, product_id: null, description: "Installation", uom: null, qty: 1, unit_price: 50, discount_pct: 0, tax_pct: 0, line_total: 50 }];
  return s;
}

const sapLinks = (db: { tables: Record<string, Row[]> }) => db.tables.connector_links.filter((l) => l.entity === "sales_orders");

// ── Check with ERP ──────────────────────────────────────────────────────────

describe("Check with ERP through SAP's order simulation", () => {
  it("passes when price, confirmed quantity and credit agree; saves nothing in SAP; writes SAP's confirmation onto the lines", async () => {
    const db = fakeAdmin(seed());
    const f = server({ sim: { prices: { TG11: 10, TG12: 20 }, credit: "A", confirmDate: "2026-11-18" } });
    const r = await runOrderChecks(db.client, T1, "so-1", { userId: "u-1", deps: deps(f) });
    if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
    expect(r.checks.map((c) => [c.kind, c.status])).toEqual([["credit", "passed"], ["price", "passed"], ["stock", "passed"]]);

    // Nothing was saved in SAP: one simulation, no order.
    expect(f.orders).toHaveLength(0);
    expect(f.created).toHaveLength(0);
    expect(f.simulated).toHaveLength(1);
    expect(f.simulated[0]).toMatchObject({
      SalesOrderType: "OR", SalesOrganization: "1010", DistributionChannel: "10", OrganizationDivision: "00", SoldToParty: "0000001000", TransactionCurrency: "EUR",
      to_Item: [{ SalesOrderItem: "10", Material: "TG11", RequestedQuantity: "2" }, { SalesOrderItem: "20", Material: "TG12", RequestedQuantity: "4" }],
    });
    // SAP's CSRF token is fetched once and sent back with its cookies.
    expect(f.csrfFetches).toBe(1);
    const post = f.calls.find((c) => c.method === "POST")!;
    expect(post.headers.get("x-csrf-token")).toBe("tok-1");
    expect(post.headers.get("cookie")).toContain("sap-XSRF_S4=tok-1");

    // The results are stored on the order for this tenant, and what SAP confirms is the line's ERP availability.
    expect(db.tables.sales_order_checks).toHaveLength(3);
    expect(db.tables.sales_order_checks.every((c) => c.tenant_id === T1 && c.order_id === "so-1")).toBe(true);
    const l1 = db.tables.sales_order_lines.find((l) => l.id === "ln-1")!;
    expect(l1).toMatchObject({ confirmed_date: "2026-11-18", availability_source: "erp" });
    expect(Number(l1.confirmed_qty)).toBe(2);
    expect(logged.some((e) => e.changes?.[0]?.field === "checked with ERP")).toBe(true);
  });

  it("warns when SAP prices a line differently, fails when SAP confirms less than asked, fails a blocked credit check", async () => {
    const db = fakeAdmin(seed());
    const f = server({ sim: { prices: { TG11: 12, TG12: 20 }, stock: { TG12: 3 }, credit: "B" } });
    const r = await runOrderChecks(db.client, T1, "so-1", { deps: deps(f) });
    if (r.kind !== "ok") throw new Error("expected ok");
    const by = Object.fromEntries(r.checks.map((c) => [c.kind, c]));
    expect(by.price.status).toBe("warning");
    expect(by.price.message).toMatch(/1 line is priced differently from the ERP \(Pump: .*10.* here, .*12.* in the ERP\)/);
    expect(by.stock.status).toBe("failed");
    expect(by.stock.message).toMatch(/Valve: 4 asked, 3 confirmed/);
    expect(by.credit.status).toBe("failed");
    expect(db.tables.sales_order_lines.find((l) => l.id === "ln-2")).toMatchObject({ availability_source: "erp" });
  });

  it("says credit is Not run, with the reason, when the simulation returns no credit result", async () => {
    const db = fakeAdmin(seed());
    const r = await runOrderChecks(db.client, T1, "so-1", { deps: deps(server({ sim: { prices: { TG11: 10, TG12: 20 } } })) });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.checks.find((c) => c.kind === "credit")).toMatchObject({ status: "not_run", message: "SAP credit exposure is not read yet." });
    expect(r.checks.find((c) => c.kind === "price")!.status).toBe("passed");
  });

  it("gives every row the Warning when the customer's coverage has no sales area, and calls SAP for nothing", async () => {
    resolve.mockImplementation(async () => ({ ok: false, reason: "No sales area for coverage North" }));
    const db = fakeAdmin(seed());
    const f = server();
    const r = await runOrderChecks(db.client, T1, "so-1", { deps: deps(f) });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.checks.map((c) => [c.kind, c.status, c.message])).toEqual([["credit", "warning", NO_AREA], ["price", "warning", NO_AREA], ["stock", "warning", NO_AREA]]);
    expect(f.calls).toHaveLength(0);
    expect(resolve).toHaveBeenCalledWith(expect.anything(), T1, { connectorId: "sap_s4", kind: "sales_area", accountId: "acc-1", orderTypeId: null });
  });

  it("a mapped code that is not a sales area is a Warning that says so", async () => {
    resolve.mockImplementation(async () => ({ ok: true, code: "not-an-area", via: "coverage", key: "North" }));
    const r = await runOrderChecks(fakeAdmin(seed()).client, T1, "so-1", { deps: deps(server()) });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.checks[0].message).toMatch(/not a valid code/);
  });

  it("a customer that is not in SAP yet is a Warning, not a crash", async () => {
    const f = server();
    const r = await runOrderChecks(fakeAdmin(seed({ noCustomerLink: true })).client, T1, "so-1", { deps: deps(f) });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.checks.every((c) => c.status === "warning" && /not in the ERP yet/.test(c.message ?? ""))).toBe(true);
    expect(f.calls).toHaveLength(0);
  });

  it("is Not run, with SAP's own words, when the simulation is refused", async () => {
    const f = server({ sim: { fail: { status: 400, message: "Material TG12 is not defined in sales area 1010/10/00" } } });
    const r = await runOrderChecks(fakeAdmin(seed()).client, T1, "so-1", { deps: deps(f) });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.checks.every((c) => c.status === "not_run" && /Material TG12 is not defined/.test(c.message ?? ""))).toBe(true);
  });

  it("skips a free-text line and is Not run for price and stock when no line is a catalogue product", async () => {
    const f = server({ sim: { prices: {} } });
    const r = await runOrderChecks(fakeAdmin(seed({ onlyFreeText: true })).client, T1, "so-1", { deps: deps(f) });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.checks.map((c) => c.status)).toEqual(["not_run", "not_run", "not_run"]);
    expect(f.simulated).toHaveLength(0);
  });

  it("refuses with the missing property named when the release lacks a field the simulation needs", async () => {
    const f = server({ metadata: { API_SALES_ORDER_SIMULATION_SRV: "<Schema><EntityType Name=\"A_SalesOrderSimulationType\"><Key><PropertyRef Name=\"SalesOrder\"/></Key><Property Name=\"SalesOrder\" Type=\"Edm.String\"/></EntityType><EntityContainer><EntitySet Name=\"A_SalesOrderSimulation\" EntityType=\"X.A_SalesOrderSimulationType\"/></EntityContainer></Schema>" } });
    const r = await runOrderChecks(fakeAdmin(seed()).client, T1, "so-1", { deps: deps(f) });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.checks[0].status).toBe("not_run");
    expect(r.checks[0].message).toMatch(/A_SalesOrderSimulation has no SalesOrderType in API_SALES_ORDER_SIMULATION_SRV.*\(and 3 more\)\. Nothing was simulated/);
    expect(f.simulated).toHaveLength(0);
  });

  it("another tenant's order id finds nothing, and a pending database update is named", async () => {
    const db = fakeAdmin(seed());
    expect(await runOrderChecks(db.client, T2, "so-1", { deps: deps(server()) })).toEqual({ kind: "missing" });
    const pending = fakeAdmin(seed(), { missing: ["sales_order_checks"] });
    expect(await runOrderChecks(pending.client, T1, "so-1", { deps: deps(server()) })).toMatchObject({ kind: "pending" });
  });
});

// ── Send to ERP ─────────────────────────────────────────────────────────────

const send = (db: ReturnType<typeof fakeAdmin>, f: FakeS4, o: Partial<Parameters<typeof sendOrderToErp>[3]> = {}, tenant = T1) =>
  sendOrderToErp(db.client, tenant, "so-1", { userId: "u-1", confirm: true, deps: deps(f), ...o });

describe("Send to ERP through POST A_SalesOrder", () => {
  it("posts the order with the sales area, the sold-to party, the PO and the materials; writes the link, the transfer and the Monitor line; and locks the order", async () => {
    resolve.mockImplementation(async () => ({ ok: true, code: "1010/10/00/G01/O01", via: "coverage", key: "North" }));
    const db = fakeAdmin(seed());
    const f = server({ sim: { prices: { TG11: 10, TG12: 20 } } });
    const r = await send(db, f);
    expect(r).toEqual({ state: "sent", erpNumber: "0000000100", link: null });

    expect(f.created).toHaveLength(1);
    expect(f.created[0]).toMatchObject({
      SalesOrderType: "OR", SalesOrganization: "1010", DistributionChannel: "10", OrganizationDivision: "00", SalesGroup: "G01", SalesOffice: "O01",
      SoldToParty: "0000001000", PurchaseOrderByCustomer: "PO-7", TransactionCurrency: "EUR", RequestedDeliveryDate: "2026-11-20T00:00:00",
      to_Item: [{ SalesOrderItem: "10", Material: "TG11", RequestedQuantity: "2" }, { SalesOrderItem: "20", Material: "TG12", RequestedQuantity: "4" }],
    });
    // The write was authorised by SAP's token and the cookies that came with it.
    expect(f.csrfFetches).toBe(1);
    const post = f.calls.find((c) => c.method === "POST")!;
    expect(post.headers.get("x-csrf-token")).toBe("tok-1");
    expect(post.headers.get("cookie")).toContain("SAP_SESSIONID_S4=abc123");

    expect(sapLinks(db)).toEqual([expect.objectContaining({ connector_id: "sap_s4", external_id: "0000000100", external_key: "0000000100", direction: "push", tenant_id: T1, object_id: "so-1" })]);
    const order = db.tables.sales_orders.find((o) => o.id === "so-1")!;
    expect(order.status).toBe("confirmed");
    expect(orderEditable({ origin: "bpmsquare", status: order.status as "confirmed" }, true)).toBe(false);
    // SAP's own wording replaced the interim "Submitted" in the first refresh.
    expect(order.status_label).toBe("Open · Delivery open");

    expect(db.tables.sales_order_transfers).toEqual([expect.objectContaining({ tenant_id: T1, order_id: "so-1", result: "sent", erp_number: "0000000100", user_id: "u-1" })]);
    const msg = db.tables.integration_messages.find((m) => m.direction === "out")!;
    expect(msg).toMatchObject({ connector_id: "sap_s4", entity: "sales_orders", status: "ok", ref_label: "Sales order 0000000100" });
    expect((msg.payload as { request: { method: string; url: string } }).request).toMatchObject({ method: "POST", url: "/A_SalesOrder" });
    expect(logged.some((e) => e.changes?.some((c) => c.field === "sent to SAP S/4HANA" && c.to === "0000000100"))).toBe(true);
    expect(confirmedEvents).toHaveLength(1);
  });

  it("a second press is a clear no-op: already sent, one order in SAP, one more row in the log", async () => {
    const db = fakeAdmin(seed());
    const f = server();
    await send(db, f);
    const again = await send(db, f);
    expect(again).toEqual({ state: "already_sent", erpNumber: "0000000100" });
    expect(f.created).toHaveLength(1);
    expect(f.orders).toHaveLength(1);
    expect(db.tables.sales_order_transfers.map((t) => t.result)).toEqual(["sent", "already_sent"]);
  });

  it("two overlapping presses make one order", async () => {
    const db = fakeAdmin(seed());
    const f = server();
    const [a, b] = await Promise.all([send(db, f), send(db, f)]);
    expect([a.state, b.state].sort()).toContain("sent");
    expect(f.orders).toHaveLength(1);
    expect(sapLinks(db)).toHaveLength(1);
  });

  it("refuses a free-text line, naming it, before SAP is called", async () => {
    const db = fakeAdmin(seed({ freeText: true }));
    const f = server();
    const r = await send(db, f);
    expect(r).toMatchObject({ state: "not_ready" });
    expect((r as { message: string }).message).toBe('Line 3 ("Installation") has no catalogue product. SAP orders need a material: pick the product on that line.');
    expect(f.calls).toHaveLength(0);
    expect(sapLinks(db)).toHaveLength(0);
  });

  it("refuses a product SAP does not know yet, naming the line", async () => {
    const s = seed();
    s.connector_links = s.connector_links.filter((l) => l.external_id !== "TG12");
    const r = await send(fakeAdmin(s), server());
    expect((r as { message: string }).message).toMatch(/Line 2 \("Valve"\) is not in SAP yet/);
  });

  it("refuses when the customer's coverage has no sales area mapped, with that reason, and leaves the order editable", async () => {
    resolve.mockImplementation(async () => ({ ok: false, reason: "nothing" }));
    const db = fakeAdmin(seed());
    const f = server();
    const r = await send(db, f);
    expect(r).toEqual({ state: "not_ready", message: NO_AREA });
    expect(f.calls).toHaveLength(0);
    expect(db.tables.sales_orders[0].status).toBe("draft");
  });

  it("asks for confirmation when no check is a current pass, exactly as for Dynamics", async () => {
    const r = await sendOrderToErp(fakeAdmin(seed()).client, T1, "so-1", { userId: "u-1", deps: deps(server()) });
    expect(r.state).toBe("needs_confirmation");
  });

  it("a failed send leaves the order editable, names the step, and Retry then makes exactly one order", async () => {
    const db = fakeAdmin(seed());
    const f = server({ create: { fail: { status: 400, message: "Sales organization 1010 is not defined" } } });
    const r = await send(db, f);
    expect(r).toMatchObject({ state: "failed", step: "create", headline: "SAP did not accept the order." });
    expect(sapLinks(db)).toHaveLength(0);
    expect(db.tables.sales_orders[0].status).toBe("draft");
    expect(orderEditable({ origin: "bpmsquare", status: "draft" }, false)).toBe(true);
    expect(db.tables.sales_order_transfers).toEqual([expect.objectContaining({ result: "failed", step: "create" })]);
    expect(String(db.tables.sales_order_transfers[0].message)).toContain("SAP did not accept the order.");
    const msg = db.tables.integration_messages.find((m) => m.status === "failed")!;
    expect(String(msg.error)).toContain("Sales organization 1010 is not defined");

    (f.opts as { create?: unknown }).create = {};
    expect((await send(db, f)).state).toBe("sent");
    expect(f.orders).toHaveLength(1);
  });

  it("a user that may not create orders gets the 403 sentence, not a raw error", async () => {
    const f = server({ create: { fail: { status: 403, message: "No authorization" } } });
    const r = await send(fakeAdmin(seed()), f);
    expect(r).toMatchObject({ state: "failed", headline: "The Communication user may not create sales orders." });
  });

  it("a create that timed out after SAP made the order is found again by its marker, not made twice (order ref as the PO)", async () => {
    const db = fakeAdmin(seed({ customerPo: null }));
    const f = server({ create: { timeoutAfterWrite: true } });
    const r = await send(db, f);
    expect(r).toEqual({ state: "sent", erpNumber: "0000000100", link: null });
    expect(f.created).toHaveLength(1);
    expect(f.orders).toHaveLength(1);
    expect(f.created[0].PurchaseOrderByCustomer).toBe("SO-0001");
    expect(sapLinks(db)).toHaveLength(1);
  });

  it("with a customer PO and no writable marker, the lookup after a timeout matches on the customer and the PO", async () => {
    const db = fakeAdmin(seed());
    const f = server({ create: { timeoutAfterWrite: true } });
    const r = await send(db, f);
    expect(r.state).toBe("sent");
    expect(f.orders).toHaveLength(1);
    const lookups = f.calls.filter((c) => c.method === "GET" && c.url.pathname.endsWith("/A_SalesOrder"));
    expect(lookups.at(-1)!.url.searchParams.get("$filter")).toContain("PurchaseOrderByCustomer eq 'PO-7'");
  });

  it("a create that timed out before SAP made anything fails cleanly: no link, still editable, Retry works", async () => {
    const db = fakeAdmin(seed());
    const f = server({ create: { timeoutWithoutWrite: true } });
    const r = await send(db, f);
    expect(r).toMatchObject({ state: "failed", step: "create", headline: "SAP did not answer properly." });
    expect(f.orders).toHaveLength(0);
    expect(sapLinks(db)).toHaveLength(0);
    expect(db.tables.sales_orders[0].status).toBe("draft");
    (f.opts as { create?: unknown }).create = {};
    expect((await send(db, f)).state).toBe("sent");
  });

  it("finds an order whose link was lost by the ref in a writable header property, before creating another", async () => {
    const carrier = SALES_ORDER_METADATA.replace("</EntityType>", '<Property Name="AccountingDocExternalReference" Type="Edm.String"/></EntityType>');
    const db = fakeAdmin(seed());
    const f = server({ metadata: { API_SALES_ORDER_SRV: carrier } }).addOrders({ number: "0000000077", soldTo: "0000001000", changed: "2026-10-24", created: "2026-10-24", ref: "SO-0001" });
    const r = await send(db, f);
    expect(r).toEqual({ state: "already_sent", erpNumber: "0000000077" });
    expect(f.created).toHaveLength(0);
    expect(sapLinks(db)[0]).toMatchObject({ external_id: "0000000077" });
    expect(db.tables.sales_orders[0].status).toBe("confirmed");
  });

  it("writes the ref into that property when the system lets us, and sends no property the system does not list", async () => {
    const carrier = SALES_ORDER_METADATA.replace("</EntityType>", '<Property Name="AccountingDocExternalReference" Type="Edm.String"/></EntityType>');
    const f = server({ metadata: { API_SALES_ORDER_SRV: carrier } });
    await send(fakeAdmin(seed()), f);
    expect(f.created[0].AccountingDocExternalReference).toBe("SO-0001");
    const f2 = server();
    await send(fakeAdmin(seed()), f2);
    expect("AccountingDocExternalReference" in f2.created[0]).toBe(false);
  });

  it("will not guess when two SAP orders match the marker", async () => {
    const carrier = SALES_ORDER_METADATA.replace("</EntityType>", '<Property Name="AccountingDocExternalReference" Type="Edm.String"/></EntityType>');
    const f = server({ metadata: { API_SALES_ORDER_SRV: carrier } }).addOrders(
      { number: "0000000077", soldTo: "0000001000", changed: "2026-10-24", created: "2026-10-24", ref: "SO-0001" },
      { number: "0000000078", soldTo: "0000001000", changed: "2026-10-24", created: "2026-10-24", ref: "SO-0001" },
    );
    const r = await send(fakeAdmin(seed()), f);
    expect(r).toMatchObject({ state: "failed", step: "find", headline: "More than one SAP order matches this one." });
    expect(f.created).toHaveLength(0);
  });

  it("refuses with the property named when the release lacks a field the order needs", async () => {
    const noMaterial = SALES_ORDER_METADATA.replace('<Property Name="Material" Type="Edm.String"/>', "");
    const f = server({ metadata: { API_SALES_ORDER_SRV: noMaterial } });
    const db = fakeAdmin(seed());
    const r = await send(db, f);
    expect(r).toMatchObject({ state: "failed", step: "prepare" });
    expect((r as { headline: string }).headline).toMatch(/A_SalesOrderItemType has no Material in API_SALES_ORDER_SRV.*Nothing was sent/);
    expect(f.created).toHaveLength(0);
    expect(sapLinks(db)).toHaveLength(0);
  });

  it("refuses when the customer is not in SAP, when the module's table is missing, and for another tenant's order", async () => {
    expect(await send(fakeAdmin(seed({ noCustomerLink: true })), server())).toMatchObject({ state: "not_ready", message: expect.stringMatching(/customer is not in the ERP yet/) });
    expect(await send(fakeAdmin(seed(), { missing: ["sales_order_transfers"] }), server())).toMatchObject({ state: "pending" });
    const db = fakeAdmin(seed());
    expect(await send(db, server(), {}, T2)).toEqual({ state: "missing" });
    expect(db.tables.connector_links.filter((l) => l.entity === "sales_orders")).toHaveLength(0);
  });

  it("says no ERP is connected when neither a Dataverse nor a SAP connection exists", async () => {
    const s = seed();
    s.tenant_connectors = [];
    s.connector_links = s.connector_links.map((l) => ({ ...l, connector_id: "dynamics365" }));
    expect(await send(fakeAdmin(s), server())).toMatchObject({ state: "no_connector" });
  });
});

// ── The order screen's view of it ───────────────────────────────────────────

describe("the order view for a SAP workspace", () => {
  it("offers Check and Send, and names a free-text line before the button is pressed", async () => {
    const db = fakeAdmin(seed({ freeText: true }));
    const loaded = await loadOrder(db.client, T1, "so-1");
    if (loaded.kind !== "ok") throw new Error("expected ok");
    const view = await buildOrderView(db.client, T1, loaded.value.order, loaded.value.erpLinked);
    expect(view.erp_available).toBe(true);
    expect(view.erp_send_blocker).toBe('Line 3 ("Installation") has no catalogue product. SAP orders need a material: pick the product on that line.');
    const clean = fakeAdmin(seed());
    const l2 = await loadOrder(clean.client, T1, "so-1");
    if (l2.kind !== "ok") throw new Error("expected ok");
    expect((await buildOrderView(clean.client, T1, l2.value.order, false)).erp_send_blocker).toBeNull();
  });

  it("shows the checks and the transfer log the flow stored", async () => {
    const db = fakeAdmin(seed());
    const f = server({ sim: { prices: { TG11: 10, TG12: 20 }, credit: "A" } });
    await runOrderChecks(db.client, T1, "so-1", { deps: deps(f) });
    await send(db, f);
    const order = db.tables.sales_orders[0] as never;
    const lines = await loadLines(db.client, T1, "so-1");
    expect((await loadChecks(db.client, T1, order, lines)).checks).toHaveLength(3);
    expect((await loadTransfers(db.client, T1, "so-1")).transfers[0]).toMatchObject({ result: "sent", erp_number: "0000000100" });
  });
});
