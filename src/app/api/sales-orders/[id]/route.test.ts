import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

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

const route = await import("./route");

const order = (over: Row = {}): Row => ({
  id: "so1", tenant_id: "t1", ref: "SO-0001", type_id: "ty1", origin: "bpmsquare", status: "draft", spine: "open", account_id: "a1", contact_id: null,
  source_type: "direct", source_id: null, pricing_mode: "internal", currency: "QAR", subtotal: 2000, discount_total: 200, tax_total: 90, shipping_amount: 0, total: 1890,
  notes: null, customer_po: null, terms: null, custom_data: null, created_at: "2026-01-01", updated_at: "2026-01-01", ...over,
});
const line = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t1", order_id: "so1", line_no: Number(id), description: `Item ${id}`, qty: 2, unit_price: 1000, discount_pct: 10, tax_pct: 5, line_total: 1800, requested_date: null, confirmed_qty: null, confirmed_date: null, availability_source: null, availability_at: null, ...over });
const type = (over: Row = {}): Row => ({ id: "ty1", tenant_id: "t1", name: "Standard order", prefix: "SO", pricing_mode: "internal", template: {}, rules: [], is_default: true, active: true, sort_order: 0, ...over });

function seed(o: Row = order(), extra: Record<string, Row[]> = {}) {
  current = fakeDb({
    accounts: [{ id: "a1", tenant_id: "t1", name: "Acme Ltd" }, { id: "a2", tenant_id: "t2", name: "Foreign" }],
    contacts: [{ id: "c1", tenant_id: "t1", name: "Sam" }, { id: "c2", tenant_id: "t2", name: "Foreign" }],
    opportunities: [],
    sales_order_types: [type(), type({ id: "ty2", name: "External order", prefix: "XO", pricing_mode: "external", is_default: false }), type({ id: "ty-foreign", tenant_id: "t2", name: "Foreign" })],
    sales_orders: [o],
    sales_order_lines: [line("1")],
    sales_order_attachments: [],
    connector_links: [],
    ...extra,
  }, { copyReads: true });
}

const ctx = { params: Promise.resolve({ id: "so1" }) };
const get = () => route.GET(new Request("http://x") as never, ctx);
const patch = (body: unknown) => route.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }) as never, ctx);
const del = () => route.DELETE(new Request("http://x", { method: "DELETE" }) as never, ctx);
const stored = () => current.tables.sales_orders[0];
const erpLink = (): Row => ({ id: "l1", tenant_id: "t1", connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "so1", external_id: "SO-ERP-1" });

beforeEach(() => {
  logged.length = 0;
  features = { sales_orders: true };
  seed();
});

describe("GET /api/sales-orders/[id]", () => {
  it("returns the order view: lines, customer, type and what may be done", async () => {
    const j = await (await get()).json();
    expect(j).toMatchObject({ id: "so1", ref: "SO-0001", account: { id: "a1", name: "Acme Ltd" }, type: { id: "ty1", name: "Standard order" }, editable: true, annotatable: true, deletable: true, erp_linked: false, lock_reason: null, pricing_label: "Internal pricing", attachment_count: 0 });
    expect(j.lines).toHaveLength(1);
  });

  it("another tenant's order is a 404, and the module flag is required", async () => {
    seed(order({ tenant_id: "t2" }));
    expect((await get()).status).toBe(404);
    seed();
    features = {};
    expect((await get()).status).toBe(403);
  });

  it("says why an order is locked: confirmed, cancelled, ERP-accepted and ERP-made each have their own words", async () => {
    seed(order({ status: "confirmed" }));
    expect((await (await get()).json()).lock_reason).toMatch(/Reopen/);
    seed(order({ status: "cancelled" }));
    expect((await (await get()).json()).lock_reason).toMatch(/Cancelled/);
    seed(order(), { connector_links: [erpLink()] });
    const linked = await (await get()).json();
    expect(linked).toMatchObject({ erp_linked: true, editable: false, annotatable: true, deletable: false });
    expect(linked.lock_reason).toMatch(/ERP has accepted/);
    seed(order({ origin: "erp", status: "confirmed" }));
    const fromErp = await (await get()).json();
    expect(fromErp).toMatchObject({ editable: false, annotatable: false });
    expect(fromErp.lock_reason).toMatch(/comes from the ERP/);
  });

  it("an ERP link of another tenant for the same order id does not lock this order", async () => {
    seed(order(), { connector_links: [{ ...erpLink(), tenant_id: "t2" }] });
    expect((await (await get()).json()).erp_linked).toBe(false);
  });

  it("shows the pricing line with the quote it was made from", async () => {
    seed(order({ source_type: "standard_quote", source_id: "sq1" }), { standard_quotes: [{ id: "sq1", tenant_id: "t1", ref: "SQ-2026-0001" }] });
    expect((await (await get()).json()).pricing_label).toBe("Internal pricing, as quote SQ-2026-0001");
  });

  it("flags a late or short line for the Overview banner", async () => {
    seed(order(), { sales_order_lines: [line("1", { requested_date: "2026-02-01", confirmed_date: "2026-03-01", confirmed_qty: 2, availability_source: "master", availability_at: "2026-01-01" })] });
    expect((await (await get()).json()).needs_attention).toBe(true);
  });
});

describe("PATCH /api/sales-orders/[id]", () => {
  it("edits the header of a draft: customer, contact, addresses, dates, terms and currency, with history", async () => {
    const res = await patch({ account_id: "a1", contact_id: "c1", ship_to: { name: "Site 4", address: "Industrial Area" }, requested_date: "2026-03-01", terms: "Net 45", currency: "AED", customer_po: "PO-9" });
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ contact_id: "c1", requested_date: "2026-03-01", terms: "Net 45", currency: "AED", customer_po: "PO-9" });
    expect(stored().ship_to).toMatchObject({ name: "Site 4", address: "Industrial Area" });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ objectType: "sales_orders", objectId: "so1", action: "update", tenantId: "t1" });
  });

  it.each([
    ["an account of another tenant", { account_id: "a2" }, "Account not found"],
    ["a contact of another tenant", { contact_id: "c2" }, "Contact not found"],
    ["an order type of another tenant", { type_id: "ty-foreign" }, "Order type not found"],
  ])("refuses %s", async (_n, body, error) => {
    const res = await patch(body);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(error);
    expect(stored().account_id).toBe("a1");
  });

  it("a type change follows the type's pricing mode on a direct order, but never overrides the mode a quote gave", async () => {
    await patch({ type_id: "ty2" });
    expect(stored()).toMatchObject({ type_id: "ty2", pricing_mode: "external" });
    seed(order({ source_type: "standard_quote", source_id: "sq1" }));
    await patch({ type_id: "ty2" });
    expect(stored()).toMatchObject({ type_id: "ty2", pricing_mode: "internal" });
  });

  it("a confirmed order keeps notes, customer PO and tenant fields open, and refuses everything else with the reason", async () => {
    seed(order({ status: "confirmed" }));
    const ok = await patch({ notes: "Call before delivery", customer_po: "PO-1", custom_data: { cf_site: "North", sneaky: "x" } });
    expect(ok.status).toBe(200);
    expect(stored()).toMatchObject({ notes: "Call before delivery", customer_po: "PO-1", custom_data: { cf_site: "North" } });
    const locked = await patch({ terms: "Net 5" });
    expect(locked.status).toBe(409);
    const j = await locked.json();
    expect(j.lock_reason).toMatch(/Reopen/);
    expect(stored().terms).toBeNull();
    // one request mixing an open and a locked field is refused as a whole
    expect((await patch({ notes: "x", terms: "y" })).status).toBe(409);
    expect(stored().notes).toBe("Call before delivery");
  });

  it("a cancelled order or an order made by the ERP accepts no change at all", async () => {
    seed(order({ status: "cancelled" }));
    expect((await patch({ notes: "x" })).status).toBe(409);
    seed(order({ origin: "erp", status: "confirmed" }));
    expect((await patch({ notes: "x" })).status).toBe(409);
    expect((await patch({ terms: "x" })).status).toBe(409);
  });

  it("once the ERP has accepted a draft its header is locked but notes stay open", async () => {
    seed(order(), { connector_links: [erpLink()] });
    expect((await patch({ terms: "x" })).status).toBe(409);
    expect((await patch({ notes: "still open" })).status).toBe(200);
  });

  it("the status cannot be set here, and a request with nothing editable is a 400", async () => {
    expect((await patch({ status: "confirmed" })).status).toBe(400);
    expect((await patch({ total: 1, ref: "SO-9" })).status).toBe(400);
    expect(stored()).toMatchObject({ status: "draft", total: 1890, ref: "SO-0001" });
  });

  it("changing the shipping recomputes the totals from the stored lines", async () => {
    await patch({ shipping_amount: 100 });
    // 2 x 1000 less 10% = 1800, tax 5% = 90, shipping 100
    expect(stored()).toMatchObject({ subtotal: 2000, discount_total: 200, tax_total: 90, shipping_amount: 100, total: 1990 });
  });

  it("another tenant's order is a 404 and is not touched", async () => {
    seed(order({ tenant_id: "t2" }));
    expect((await patch({ notes: "x" })).status).toBe(404);
    expect(stored().notes).toBeNull();
  });
});

describe("DELETE /api/sales-orders/[id]", () => {
  it("deletes a draft made here and writes history", async () => {
    const res = await del();
    expect(res.status).toBe(204);
    expect(current.tables.sales_orders).toHaveLength(0);
    expect(logged).toMatchObject([{ objectType: "sales_orders", objectId: "so1", action: "delete" }]);
  });

  it.each([
    ["a confirmed order", order({ status: "confirmed" }), {}],
    ["a cancelled order", order({ status: "cancelled" }), {}],
    ["an order made by the ERP", order({ origin: "erp" }), {}],
    ["a draft the ERP has accepted", order(), { connector_links: [erpLink()] }],
  ])("refuses to delete %s (409)", async (_n, o, extra) => {
    seed(o, extra as Record<string, Row[]>);
    expect((await del()).status).toBe(409);
    expect(current.tables.sales_orders).toHaveLength(1);
    expect(logged).toHaveLength(0);
  });

  it("another tenant's order is a 404 and survives", async () => {
    seed(order({ tenant_id: "t2" }));
    expect((await del()).status).toBe(404);
    expect(current.tables.sales_orders).toHaveLength(1);
  });
});
