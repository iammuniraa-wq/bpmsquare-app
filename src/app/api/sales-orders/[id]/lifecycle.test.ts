import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

// Lines, confirm, cancel, reopen and availability of one sales order.

let current: ReturnType<typeof fakeDb>;
let features: Record<string, boolean> = { sales_orders: true };
const logged: { objectType: string; objectId: string; tenantId: string; action?: string; changes?: { field: string; from?: unknown; to: unknown }[] }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true,
  getTenant: async () => ({ id: "t1", config: {}, features }),
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});

const lines = await import("./lines/route");
const confirm = await import("./confirm/route");
const cancel = await import("./cancel/route");
const reopen = await import("./reopen/route");
const availability = await import("./availability/route");

const order = (over: Row = {}): Row => ({
  id: "so1", tenant_id: "t1", ref: "SO-0001", type_id: null, origin: "bpmsquare", status: "draft", spine: "open", account_id: "a1", contact_id: null,
  source_type: "direct", source_id: null, pricing_mode: "internal", currency: "QAR", subtotal: 2000, discount_total: 200, tax_total: 90, shipping_amount: 0, total: 1890,
  expected_date: null, created_at: "2026-01-01", updated_at: "2026-01-01", ...over,
});
const line = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t1", order_id: "so1", line_no: Number(id), product_id: null, description: `Item ${id}`, qty: 2, unit_price: 1000, discount_pct: 10, tax_pct: 5, line_total: 1800, requested_date: null, confirmed_qty: null, confirmed_date: null, availability_source: null, availability_at: null, ...over });
const erpLink = (): Row => ({ id: "l1", tenant_id: "t1", connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "so1", external_id: "X" });

function seed(o: Row = order(), ls: Row[] = [line("1")], extra: Record<string, Row[]> = {}) {
  current = fakeDb({
    accounts: [{ id: "a1", tenant_id: "t1", name: "Acme Ltd" }],
    contacts: [], sales_order_types: [], sales_orders: [o], sales_order_lines: ls, sales_order_attachments: [], connector_links: [],
    products: [], inventory_items: [],
    ...extra,
  }, { copyReads: true });
}

const ctx = { params: Promise.resolve({ id: "so1" }) };
const req = (body?: unknown) => new Request("http://x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }) as never;
const putLines = (body: unknown) => lines.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }) as never, ctx);
const stored = () => current.tables.sales_orders[0];
const names = () => (current.tables.domain_event ?? []).map((e) => e.name);

beforeEach(() => {
  logged.length = 0;
  features = { sales_orders: true };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-10T09:00:00Z"));
  seed();
});
afterEach(() => vi.useRealTimers());

describe("PUT /api/sales-orders/[id]/lines", () => {
  it("replaces the lines of a draft, keeps the id of a line it names, and works the totals out itself", async () => {
    const res = await putLines({ lines: [
      { id: "1", description: "Item 1 (renamed)", qty: 3, unit_price: 500, discount_pct: 0, tax_pct: 10, line_total: 99999 },
      { description: "New item", qty: 1, unit_price: 200, tax_pct: 0 },
      { description: "   " },
    ] });
    expect(res.status).toBe(200);
    const rows = current.tables.sales_order_lines;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "1", line_no: 1, description: "Item 1 (renamed)", line_total: 1500 });
    expect(rows[1]).toMatchObject({ line_no: 2, tenant_id: "t1", order_id: "so1", line_total: 200 });
    expect(stored()).toMatchObject({ subtotal: 1700, discount_total: 0, tax_total: 150, total: 1850 });
    expect(logged.length).toBe(1);
  });

  it("removes lines that are no longer sent, and an id from another order is just a new line", async () => {
    seed(order(), [line("1"), line("2"), { ...line("9"), order_id: "other", tenant_id: "t1" }]);
    await putLines({ lines: [{ id: "9", description: "Smuggled", qty: 1, unit_price: 10 }] });
    const mine = current.tables.sales_order_lines.filter((l) => l.order_id === "so1");
    expect(mine.map((l) => l.description)).toEqual(["Smuggled"]);
    expect(mine[0].id).not.toBe("9");
    expect(current.tables.sales_order_lines.find((l) => l.id === "9")).toMatchObject({ order_id: "other" });
  });

  it("marks availability stale: the earlier answer stays but availability_at is cleared", async () => {
    seed(order(), [line("1", { confirmed_qty: 2, confirmed_date: "2026-06-20", availability_source: "master", availability_at: "2026-06-01T00:00:00Z" })]);
    await putLines({ lines: [{ id: "1", description: "Item 1", qty: 5, unit_price: 1000 }] });
    expect(current.tables.sales_order_lines[0]).toMatchObject({ confirmed_qty: 2, confirmed_date: "2026-06-20", availability_source: "master", availability_at: null });
    expect(stored().expected_date).toBe("2026-06-20");
  });

  it("refuses a product of another tenant and changes nothing", async () => {
    seed(order(), [line("1")], { products: [{ id: "p2", tenant_id: "t2" }] });
    const res = await putLines({ lines: [{ description: "X", qty: 1, unit_price: 1, product_id: "p2" }] });
    expect(res.status).toBe(404);
    expect(current.tables.sales_order_lines).toHaveLength(1);
  });

  it.each([
    ["confirmed", order({ status: "confirmed" }), {}],
    ["cancelled", order({ status: "cancelled" }), {}],
    ["made by the ERP", order({ origin: "erp" }), {}],
    ["accepted by the ERP", order(), { connector_links: [erpLink()] }],
  ])("refuses to change the lines of an order that is %s", async (_n, o, extra) => {
    seed(o, [line("1")], extra as Record<string, Row[]>);
    const res = await putLines({ lines: [{ description: "X", qty: 1, unit_price: 1 }] });
    expect(res.status).toBe(409);
    expect(current.tables.sales_order_lines[0].description).toBe("Item 1");
  });

  it("another tenant's order is a 404", async () => {
    seed(order({ tenant_id: "t2" }));
    expect((await putLines({ lines: [] })).status).toBe(404);
  });
});

describe("POST confirm / cancel / reopen", () => {
  it("confirm turns a draft into a confirmed order, stamps it, checks availability and emits order.confirmed", async () => {
    const res = await confirm.POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ status: "confirmed", confirmed_at: "2026-06-10T09:00:00.000Z" });
    expect(current.tables.sales_order_lines[0]).toMatchObject({ availability_source: "master", availability_at: "2026-06-10T09:00:00.000Z" });
    expect(names()).toEqual(["order.confirmed"]);
    expect(logged[0].changes).toEqual([{ field: "status", from: "draft", to: "confirmed" }]);
    expect((await res.json()).editable).toBe(false);
  });

  it("confirm needs a line with a quantity, and only drafts confirm", async () => {
    seed(order(), []);
    expect((await confirm.POST(req(), ctx)).status).toBe(422);
    seed(order(), [line("1", { qty: 0 })]);
    expect((await confirm.POST(req(), ctx)).status).toBe(422);
    seed(order({ status: "confirmed" }));
    expect((await confirm.POST(req(), ctx)).status).toBe(409);
    seed(order({ status: "cancelled" }));
    expect((await confirm.POST(req(), ctx)).status).toBe(409);
    seed(order(), [line("1")], { connector_links: [erpLink()] });
    expect((await confirm.POST(req(), ctx)).status).toBe(409);
    expect(names()).toEqual([]);
  });

  it("cancel needs a reason, keeps it, and emits order.cancelled without putting the reason in the event", async () => {
    expect((await cancel.POST(req({}), ctx)).status).toBe(400);
    expect(stored().status).toBe("draft");
    const res = await cancel.POST(req({ reason: "Customer withdrew the PO" }), ctx);
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ status: "cancelled", spine: "cancelled", cancel_reason: "Customer withdrew the PO" });
    const ev = (current.tables.domain_event ?? []).find((e) => e.name === "order.cancelled")!;
    expect(JSON.stringify(ev.payload)).not.toContain("withdrew");
    expect(logged[0].changes?.map((c) => c.field)).toEqual(["status", "cancel_reason"]);
  });

  it("a confirmed order can be cancelled; an ERP-accepted, ERP-made or already cancelled one cannot", async () => {
    seed(order({ status: "confirmed" }));
    expect((await cancel.POST(req({ reason: "x" }), ctx)).status).toBe(200);
    seed(order({ status: "confirmed" }), [line("1")], { connector_links: [erpLink()] });
    expect((await cancel.POST(req({ reason: "x" }), ctx)).status).toBe(409);
    seed(order({ origin: "erp", status: "confirmed" }));
    expect((await cancel.POST(req({ reason: "x" }), ctx)).status).toBe(409);
    seed(order({ status: "cancelled" }));
    expect((await cancel.POST(req({ reason: "x" }), ctx)).status).toBe(409);
  });

  it("reopen takes a confirmed order back to draft only while no ERP link exists", async () => {
    seed(order({ status: "confirmed", confirmed_at: "2026-06-01T00:00:00Z" }));
    const res = await reopen.POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ status: "draft", confirmed_at: null });
    expect((await res.json()).editable).toBe(true);
    expect(logged[0]).toMatchObject({ action: "reopen" });

    seed(order({ status: "confirmed" }), [line("1")], { connector_links: [erpLink()] });
    expect((await reopen.POST(req(), ctx)).status).toBe(409);
    expect(stored().status).toBe("confirmed");
    seed(order({ status: "draft" }));
    expect((await reopen.POST(req(), ctx)).status).toBe(409);
    seed(order({ status: "cancelled" }));
    expect((await reopen.POST(req(), ctx)).status).toBe(409);
  });

  it("none of them reach another tenant's order", async () => {
    seed(order({ tenant_id: "t2" }));
    for (const r of [confirm, reopen]) expect((await r.POST(req(), ctx)).status).toBe(404);
    expect((await cancel.POST(req({ reason: "x" }), ctx)).status).toBe(404);
    expect(stored().status).toBe("draft");
  });
});

describe("availability from master data", () => {
  const prod = (id: string, sku: string, lead: number | null): Row => ({ id, tenant_id: "t1", sku, lead_time_days: lead });
  const stock = (id: string, sku: string, qty: number, tenant = "t1"): Row => ({ id, tenant_id: tenant, sku, qty_on_hand: qty });

  it("stock on hand covers the line: confirmed in full, today", async () => {
    seed(order(), [line("1", { product_id: "p1", qty: 4 })], { products: [prod("p1", "ELV-1", 30)], inventory_items: [stock("i1", "elv-1", 10)] });
    const j = await (await availability.POST(req(), ctx)).json();
    expect(current.tables.sales_order_lines[0]).toMatchObject({ confirmed_qty: 4, confirmed_date: "2026-06-10", availability_source: "master" });
    expect(j.lines[0]).toMatchObject({ state: "ok", source: "master", source_label: "Master data (estimate)" });
    expect(stored().expected_date).toBe("2026-06-10");
  });

  it("short stock falls back to today plus the product's lead time", async () => {
    seed(order(), [line("1", { product_id: "p1", qty: 4 })], { products: [prod("p1", "ELV-1", 30)], inventory_items: [stock("i1", "ELV-1", 1)] });
    await availability.POST(req(), ctx);
    expect(current.tables.sales_order_lines[0]).toMatchObject({ confirmed_qty: 4, confirmed_date: "2026-07-10" });
    expect(stored().expected_date).toBe("2026-07-10");
  });

  it("short stock with no lead time confirms what is on the shelf and no date", async () => {
    seed(order(), [line("1", { product_id: "p1", qty: 4 })], { products: [prod("p1", "ELV-1", null)], inventory_items: [stock("i1", "ELV-1", 1)] });
    const j = await (await availability.POST(req(), ctx)).json();
    expect(current.tables.sales_order_lines[0]).toMatchObject({ confirmed_qty: 1, confirmed_date: null });
    expect(j.lines[0].state).toBe("short");
    expect(j.needs_attention).toBe(true);
  });

  it("a product with no inventory item but a lead time uses the lead time; a line with neither is unknown", async () => {
    seed(order(), [line("1", { product_id: "p1" }), line("2", { product_id: null })], { products: [prod("p1", "NOSTOCK", 7)], inventory_items: [] });
    await availability.POST(req(), ctx);
    const [a, b] = current.tables.sales_order_lines;
    expect(a).toMatchObject({ confirmed_qty: 2, confirmed_date: "2026-06-17" });
    expect(b).toMatchObject({ confirmed_qty: null, confirmed_date: null, availability_source: "master" });
  });

  it("another tenant's stock with the same SKU is never counted", async () => {
    seed(order(), [line("1", { product_id: "p1", qty: 4 })], { products: [prod("p1", "ELV-1", 5)], inventory_items: [stock("i9", "ELV-1", 999, "t2")] });
    await availability.POST(req(), ctx);
    expect(current.tables.sales_order_lines[0].confirmed_date).toBe("2026-06-15");
  });

  it("ERP answers are never overwritten by the master-data refresh", async () => {
    seed(order(), [line("1", { product_id: "p1", confirmed_qty: 2, confirmed_date: "2026-09-01", availability_source: "erp", availability_at: "2026-06-09T00:00:00Z" })], { products: [prod("p1", "ELV-1", 1)] });
    await availability.POST(req(), ctx);
    expect(current.tables.sales_order_lines[0]).toMatchObject({ confirmed_date: "2026-09-01", availability_source: "erp", availability_at: "2026-06-09T00:00:00Z" });
    expect(stored().expected_date).toBe("2026-09-01");
  });

  it("GET reports a late line and a stale one; a cancelled order cannot be refreshed", async () => {
    seed(order(), [
      line("1", { requested_date: "2026-06-12", confirmed_qty: 2, confirmed_date: "2026-06-30", availability_source: "master", availability_at: "2026-06-10T00:00:00Z" }),
      line("2", { confirmed_qty: 2, confirmed_date: "2026-06-12", availability_source: "master", availability_at: null }),
      line("3"),
    ]);
    const j = await (await availability.GET(req(), ctx)).json();
    expect(j.lines.map((l: Row) => l.state)).toEqual(["late", "stale", "not_checked"]);
    expect(j).toMatchObject({ stale: true, needs_attention: true });
    seed(order({ status: "cancelled" }));
    expect((await availability.POST(req(), ctx)).status).toBe(409);
  });

  it("editing the lines makes the Availability tab stale until it is refreshed", async () => {
    seed(order(), [line("1", { confirmed_qty: 2, confirmed_date: "2026-06-12", availability_source: "master", availability_at: "2026-06-10T00:00:00Z" })]);
    await putLines({ lines: [{ id: "1", description: "Item 1", qty: 9, unit_price: 1000 }] });
    expect((await (await availability.GET(req(), ctx)).json()).stale).toBe(true);
    await availability.POST(req(), ctx);
    expect((await (await availability.GET(req(), ctx)).json()).stale).toBe(false);
  });

  it("works for another tenant's order only as a 404", async () => {
    seed(order({ tenant_id: "t2" }));
    expect((await availability.GET(req(), ctx)).status).toBe(404);
    expect((await availability.POST(req(), ctx)).status).toBe(404);
  });
});
