import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";

let current: ReturnType<typeof fakeDb>;
let features: Record<string, boolean> = { sales_orders: true };
const logged: { objectType: string; objectId: string; tenantId: string; action?: string; changes?: { field: string; to: unknown }[] }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true,
  getTenant: async () => ({ id: "t1", config: { currency: "QAR" }, features }),
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});

const route = await import("./route");

const account = (over: Row = {}): Row => ({ id: "a1", tenant_id: "t1", name: "Acme Ltd", type: "end_customer", state: "Doha", country: "Qatar", custom_data: null, ...over });
const type = (over: Row = {}): Row => ({ id: "ty1", tenant_id: "t1", name: "Standard order", prefix: "SO", pricing_mode: "internal", template: {}, rules: [], is_default: true, active: true, sort_order: 0, ...over });
const quote = (over: Row = {}): Row => ({
  id: "sq1", tenant_id: "t1", ref: "SQ-2026-0001", status: "accepted", account_id: "a1", contact_id: null, opportunity_id: null,
  notes: "From the quote", terms: "Net 30", header_discount_pct: 10, tax_pct: 18, shipping_amount: 50, subtotal: 1040, total: 1154.48, ...over,
});
const qline = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t1", standard_quote_id: "sq1", sl_no: id, description: `Item ${id}`, uom: "ea", qty: 2, rate: 250, discount_pct: 0, amount: 500, is_selected: true, ...over });

function seed(extra: Record<string, Row[]> = {}) {
  current = fakeDb({
    accounts: [account(), account({ id: "a2", tenant_id: "t2", name: "Other tenant's customer" })],
    contacts: [{ id: "c1", tenant_id: "t1", name: "Sam" }, { id: "c2", tenant_id: "t2", name: "Foreign" }],
    products: [{ id: "p1", tenant_id: "t1", name: "Elevator" }, { id: "p2", tenant_id: "t2", name: "Foreign product" }],
    opportunities: [{ id: "o1", tenant_id: "t1", ref: "OPP-1", outcome: "won", account_id: "a1", contact_id: null }, { id: "o2", tenant_id: "t2", outcome: "won", account_id: "a2" }],
    sales_order_types: [type(), type({ id: "ty-foreign", tenant_id: "t2", name: "Foreign type" })],
    sales_orders: [],
    sales_order_lines: [],
    standard_quotes: [quote()],
    standard_quote_lines: [qline("1"), qline("2", { qty: 2, rate: 300, discount_pct: 10, amount: 540 })],
    ...extra,
  }, { copyReads: true });
}

const post = (body: unknown) => route.POST(new Request("http://x/api/sales-orders", { method: "POST", body: JSON.stringify(body) }) as never);
const get = (qs = "") => route.GET(new Request(`http://x/api/sales-orders${qs}`) as never);
const names = () => (current.tables.domain_event ?? []).map((e) => e.name);

beforeEach(() => {
  logged.length = 0;
  features = { sales_orders: true };
  seed();
});

const lineBody = (over: Row = {}) => ({ description: "Elevator 8P", qty: 2, unit_price: 1000, discount_pct: 10, tax_pct: 5, ...over });

describe("POST /api/sales-orders -- a direct order", () => {
  it("creates a draft with the type's prefix, totals worked out server-side, and writes history and the order.created event", async () => {
    const res = await post({ account_id: "a1", customer_po: "PO-77", lines: [lineBody()], shipping_amount: 25, line_total: 1 });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.ref).toBe("SO-0001");
    const order = current.tables.sales_orders[0];
    expect(order).toMatchObject({ tenant_id: "t1", account_id: "a1", type_id: "ty1", status: "draft", origin: "bpmsquare", source_type: "direct", customer_po: "PO-77", currency: "QAR", pricing_mode: "internal", created_by: "u1" });
    // 2 x 1000 less 10% = 1800, tax 5% = 90, shipping 25 untaxed.
    expect(order).toMatchObject({ subtotal: 2000, discount_total: 200, tax_total: 90, shipping_amount: 25, total: 1915 });
    expect(current.tables.sales_order_lines).toHaveLength(1);
    expect(current.tables.sales_order_lines[0]).toMatchObject({ tenant_id: "t1", order_id: j.id, line_no: 1, line_total: 1800 });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ objectType: "sales_orders", objectId: j.id, tenantId: "t1", action: "create" });
    expect(names()).toEqual(["order.created"]);
  });

  it("numbers refs per prefix from the highest existing number, not from a count", async () => {
    seed({
      sales_order_types: [type(), type({ id: "ty-b", name: "Export order", prefix: "EX", is_default: false })],
      sales_orders: [
        { id: "x1", tenant_id: "t1", ref: "SO-0001", created_at: "2026-01-01" },
        { id: "x3", tenant_id: "t1", ref: "SO-0007", created_at: "2026-01-02" },
        { id: "y1", tenant_id: "t2", ref: "SO-0099", created_at: "2026-01-03" },
      ],
    });
    expect((await (await post({ account_id: "a1" })).json()).ref).toBe("SO-0008");
    expect((await (await post({ account_id: "a1", type_id: "ty-b" })).json()).ref).toBe("EX-0001");
    expect((await (await post({ account_id: "a1", type_id: "ty-b" })).json()).ref).toBe("EX-0002");
  });

  it("a workspace with no order type gets a default 'Standard order' type made for it", async () => {
    seed({ sales_order_types: [] });
    const res = await post({ account_id: "a1" });
    expect(res.status).toBe(201);
    expect(current.tables.sales_order_types).toHaveLength(1);
    expect(current.tables.sales_order_types[0]).toMatchObject({ tenant_id: "t1", prefix: "SO", is_default: true, pricing_mode: "internal" });
    expect(current.tables.sales_orders[0].ref).toBe("SO-0001");
  });

  it("is refused when the module is off for the workspace", async () => {
    features = {};
    const res = await post({ account_id: "a1" });
    expect(res.status).toBe(403);
    expect(current.tables.sales_orders).toHaveLength(0);
  });
});

describe("POST /api/sales-orders -- foreign ids", () => {
  it.each([
    ["an account of another tenant", { account_id: "a2" }, "Account not found"],
    ["a contact of another tenant", { account_id: "a1", contact_id: "c2" }, "Contact not found"],
    ["a deal of another tenant", { account_id: "a1", opportunity_id: "o2" }, "Deal not found"],
    ["an order type of another tenant", { account_id: "a1", type_id: "ty-foreign" }, "Order type not found"],
    ["a product of another tenant on a line", { account_id: "a1", lines: [lineBody({ product_id: "p2" })] }, "Product not found"],
  ])("refuses %s and creates nothing", async (_n, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(error);
    expect(current.tables.sales_orders).toHaveLength(0);
    expect(current.tables.sales_order_lines).toHaveLength(0);
  });

  it("accepts this tenant's own contact, deal and product", async () => {
    const res = await post({ account_id: "a1", contact_id: "c1", opportunity_id: "o1", lines: [lineBody({ product_id: "p1" })] });
    expect(res.status).toBe(201);
    expect(current.tables.sales_orders[0]).toMatchObject({ contact_id: "c1", opportunity_id: "o1" });
    expect(current.tables.sales_order_lines[0].product_id).toBe("p1");
  });

  it("a request cannot choose the tenant: a tenant_id in the body is ignored", async () => {
    await post({ account_id: "a1", tenant_id: "t2" });
    expect(current.tables.sales_orders[0].tenant_id).toBe("t1");
  });
});

describe("POST /api/sales-orders -- the order type", () => {
  const types = () => [
    type({ id: "ty-def", name: "Standard order", prefix: "SO", is_default: true, sort_order: 5 }),
    type({ id: "ty-gulf", name: "Gulf order", prefix: "GO", is_default: false, sort_order: 1, pricing_mode: "external", rules: [{ field: "region", equals: "qatar" }] }),
    type({ id: "ty-vip", name: "Key account", prefix: "KA", is_default: false, sort_order: 0, rules: [{ field: "customer_group", equals: "vip" }] }),
    type({ id: "ty-off", name: "Retired", prefix: "RT", is_default: false, sort_order: 0, active: false, rules: [{ field: "customer_group", equals: "end_customer" }] }),
  ];

  it("the first type whose rule matches wins; inactive types are never auto-picked", async () => {
    seed({ sales_order_types: types() });
    await post({ account_id: "a1" }); // country Qatar -> Gulf order
    expect(current.tables.sales_orders[0]).toMatchObject({ type_id: "ty-gulf", pricing_mode: "external" });
    expect(current.tables.sales_orders[0].ref).toBe("GO-0001");
  });

  it("customer group is the account's cf_customer_group custom field, and sort order decides between two matches", async () => {
    seed({ sales_order_types: types(), accounts: [account({ custom_data: { cf_customer_group: "VIP" } })] });
    await post({ account_id: "a1" });
    expect(current.tables.sales_orders[0].type_id).toBe("ty-vip");
  });

  it("falls back to the default type when no rule matches", async () => {
    seed({ sales_order_types: types(), accounts: [account({ country: "India", state: "Kerala" })] });
    await post({ account_id: "a1" });
    expect(current.tables.sales_orders[0].type_id).toBe("ty-def");
  });

  it("an explicit type_id wins over the rules, and a switched-off type is refused", async () => {
    seed({ sales_order_types: types() });
    await post({ account_id: "a1", type_id: "ty-def" });
    expect(current.tables.sales_orders[0].type_id).toBe("ty-def");
    const res = await post({ account_id: "a1", type_id: "ty-off" });
    expect(res.status).toBe(422);
    expect(current.tables.sales_orders).toHaveLength(1);
  });

  it("the source type is a rule field: orders from a standard quote can get their own type", async () => {
    seed({ sales_order_types: [type(), type({ id: "ty-sq", name: "From quote", prefix: "QO", is_default: false, rules: [{ field: "source_type", equals: "standard_quote" }] })] });
    await post({ source: { type: "standard_quote", id: "sq1" } });
    expect(current.tables.sales_orders[0].type_id).toBe("ty-sq");
  });
});

describe("POST /api/sales-orders -- from a source", () => {
  it("copies an accepted standard quote's lines, prices, discount, tax, shipping, customer, terms and notes; the total matches the quote", async () => {
    const res = await post({ source: { type: "standard_quote", id: "sq1" } });
    expect(res.status).toBe(201);
    const order = current.tables.sales_orders[0];
    expect(order).toMatchObject({ account_id: "a1", source_type: "standard_quote", source_id: "sq1", notes: "From the quote", terms: "Net 30", shipping_amount: 50, pricing_mode: "internal" });
    expect(current.tables.sales_order_lines.map((l) => [l.description, l.qty, l.unit_price, l.tax_pct])).toEqual([["Item 1", 2, 250, 18], ["Item 2", 2, 300, 18]]);
    // The quote's 10% header discount is folded into each line, so the order total is the quote's total.
    expect(Number(order.total)).toBeCloseTo(computeStandardQuoteTotals(1040, 10, 18, 50).total, 2);
    expect(Number(order.total)).toBe(1154.48);
    expect(logged[0].changes?.[0]).toEqual({ field: "Created from standard quote", from: null, to: "SQ-2026-0001" });
  });

  it("the source decides the account: the body cannot point the order at another customer", async () => {
    const res = await post({ account_id: "a2", source: { type: "standard_quote", id: "sq1" } });
    expect(res.status).toBe(201);
    expect(current.tables.sales_orders[0].account_id).toBe("a1");
  });

  it("inherits the quote's pricing mode, whatever the order type says", async () => {
    seed({ sales_order_types: [type({ pricing_mode: "internal" })], standard_quotes: [quote({ pricing_mode: "external" })] });
    await post({ source: { type: "standard_quote", id: "sq1" } });
    expect(current.tables.sales_orders[0].pricing_mode).toBe("external");
    seed({ sales_order_types: [type({ pricing_mode: "external" })] });
    await post({ source: { type: "standard_quote", id: "sq1" } });
    expect(current.tables.sales_orders[0].pricing_mode).toBe("internal");
  });

  it("only an accepted quote becomes an order (422), and a quote of another tenant is not found (404)", async () => {
    for (const status of ["draft", "sent", "rejected", "expired"]) {
      seed({ standard_quotes: [quote({ status })] });
      expect((await post({ source: { type: "standard_quote", id: "sq1" } })).status).toBe(422);
      expect(current.tables.sales_orders).toHaveLength(0);
    }
    seed({ standard_quotes: [quote({ tenant_id: "t2" })] });
    expect((await post({ source: { type: "standard_quote", id: "sq1" } })).status).toBe(404);
  });

  it("one order per source: a second attempt is a 409 naming the first, confirm_another allows it, a cancelled order does not block", async () => {
    const first = await (await post({ source: { type: "standard_quote", id: "sq1" } })).json();
    const again = await post({ source: { type: "standard_quote", id: "sq1" } });
    expect(again.status).toBe(409);
    const j = await again.json();
    expect(j.existing).toMatchObject([{ id: first.id, ref: first.ref, status: "draft" }]);
    expect(j.needs_confirmation).toBe(true);
    expect(current.tables.sales_orders).toHaveLength(1);
    expect((await post({ source: { type: "standard_quote", id: "sq1" }, confirm_another: true })).status).toBe(201);
    expect(current.tables.sales_orders).toHaveLength(2);

    seed();
    const a = await (await post({ source: { type: "standard_quote", id: "sq1" } })).json();
    current.tables.sales_orders.find((o) => o.id === a.id)!.status = "cancelled";
    expect((await post({ source: { type: "standard_quote", id: "sq1" } })).status).toBe(201);
  });

  it("another tenant's order from the same source id does not count", async () => {
    seed({ sales_orders: [{ id: "z", tenant_id: "t2", ref: "SO-0001", status: "draft", source_type: "standard_quote", source_id: "sq1" }] });
    expect((await post({ source: { type: "standard_quote", id: "sq1" } })).status).toBe(201);
  });

  it("a won quotation (outcome won or approved) becomes an order with its option, discount and gst; a superseded or open one does not", async () => {
    const q = { id: "q1", tenant_id: "t1", ref: "QT-1", account_id: "a1", contact_id: null, status: "sent", outcome: "won", discount_type: "pct", discount_pct: 10, gst_rate: 5, po_number: "CUST-PO-1", notes: "n", terms: "t", selected_option_id: null, superseded_by: null };
    const ql = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t1", quote_id: "q1", sl_no: id, description: `Q${id}`, uom: "ea", qty: 1, rate: 1000, discount_pct: 0, amount: 1000, ...over });
    seed({ quotes: [q], quote_lines: [ql("1"), ql("2", { group_id: "g-b", group_type: "alternative", amount: 5000 }), ql("3", { group_id: "g-a", group_type: "alternative", amount: 2000, rate: 2000 })], standard_quotes: [], standard_quote_lines: [] });
    const res = await post({ source: { type: "quotation", id: "q1" } });
    expect(res.status).toBe(201);
    const order = current.tables.sales_orders[0];
    expect(order).toMatchObject({ source_type: "quotation", customer_po: "CUST-PO-1" });
    // The first alternative group is the chosen one: lines 1 and 2 (g-b is first seen on line 2).
    expect(current.tables.sales_order_lines.map((l) => l.description)).toEqual(["Q1", "Q2"]);

    seed({ quotes: [{ ...q, outcome: "open", status: "sent" }], quote_lines: [], standard_quotes: [], standard_quote_lines: [] });
    expect((await post({ source: { type: "quotation", id: "q1" } })).status).toBe(422);
    seed({ quotes: [{ ...q, superseded_by: "q2" }], quote_lines: [], standard_quotes: [], standard_quote_lines: [] });
    expect((await post({ source: { type: "quotation", id: "q1" } })).status).toBe(409);
  });

  it("a won deal becomes an order linked back to the deal; an open one does not", async () => {
    seed({
      opportunity_lines: [{ id: "ol1", tenant_id: "t1", opportunity_id: "o1", sl_no: "1", description: "Pump set", qty: 3, rate: 400, discount_pct: 0, amount: 1200, is_selected: true }],
    });
    const res = await post({ source: { type: "opportunity", id: "o1" } });
    expect(res.status).toBe(201);
    expect(current.tables.sales_orders[0]).toMatchObject({ source_type: "opportunity", opportunity_id: "o1", total: 1200 });
    seed({ opportunities: [{ id: "o1", tenant_id: "t1", outcome: "open", account_id: "a1" }] });
    expect((await post({ source: { type: "opportunity", id: "o1" } })).status).toBe(422);
  });

  it("an unknown source type is a 400", async () => {
    expect((await post({ source: { type: "invoice", id: "x" } })).status).toBe(400);
  });
});

describe("GET /api/sales-orders", () => {
  const order = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t1", ref: `SO-000${id}`, type_id: "ty1", origin: "bpmsquare", status: "draft", spine: "open", account_id: "a1", pricing_mode: "internal", total: 100, currency: "QAR", source_type: "direct", created_at: `2026-01-0${id}`, updated_at: `2026-01-0${id}`, ...over });

  it("lists only this tenant's orders, with the customer and type names, filtered by status", async () => {
    seed({ sales_orders: [order("1"), order("2", { status: "confirmed" }), order("3", { tenant_id: "t2", account_id: "a2" })] });
    const all = await (await get()).json();
    expect(all.rows.map((r: Row) => r.id).sort()).toEqual(["1", "2"]);
    expect(all.total).toBe(2);
    expect(all.rows[0]).toMatchObject({ account_name: "Acme Ltd", type_name: "Standard order" });
    const confirmed = await (await get("?status=confirmed")).json();
    expect(confirmed.rows.map((r: Row) => r.id)).toEqual(["2"]);
  });

  it("filters by account and never returns another tenant's order even when asked by account", async () => {
    seed({ sales_orders: [order("1"), order("3", { tenant_id: "t2", account_id: "a2" })] });
    expect((await (await get("?account_id=a2")).json()).rows).toEqual([]);
  });

  it("answers an empty list with needsDatabaseUpdate while migration 0212 is pending", async () => {
    current = fakeDb({}, { missingTables: ["sales_orders"] });
    const j = await (await get()).json();
    expect(j).toMatchObject({ rows: [], total: 0, needsDatabaseUpdate: true });
    expect(j.bundle).toMatch(/run-bundle-21/);
  });

  it("creating while the tables are missing is a plain 503, not a crash", async () => {
    current = fakeDb({ accounts: [account()] }, { missingTables: ["sales_order_types", "sales_orders"] });
    const res = await post({ account_id: "a1" });
    expect(res.status).toBe(503);
    expect((await res.json()).needsDatabaseUpdate).toBe(true);
  });
});
