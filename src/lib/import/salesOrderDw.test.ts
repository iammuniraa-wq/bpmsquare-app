import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { FIELD_REGISTRY, isPilotObjectType, type EffectiveField } from "@/lib/fieldRegistry";
import type { FieldConfigResult, SalesConfig } from "@/lib/fieldConfig";

let current: ReturnType<typeof fakeDb>;
let features: Record<string, boolean> = { sales_orders: true };
let canEdit = true;
const logged: { objectType: string; objectId: string; tenantId: string; changes?: { field: string; to: unknown }[] }[] = [];

function registryConfig(): FieldConfigResult {
  const def = FIELD_REGISTRY.sales_order;
  const fields: EffectiveField[] = def.fields.map((f, i) => ({
    field_key: f.key, label: f.defaultLabel, widget: f.widget, section: f.defaultSection, position: i,
    hidden: false, required: false, locked: f.locked ?? false, editable: f.editable ?? true, exportOnly: f.exportOnly,
    kind: "standard", enumOptions: f.enumOptions,
  }));
  return { sections: def.sections.map((label) => ({ label, fields: fields.filter((f) => f.section === label) })), rules: [] };
}

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true,
  getTenant: async () => ({ id: "t1", config: { currency: "QAR" }, features }),
}));
vi.mock("@/lib/objectFeatures", () => ({
  assertObjectFeature: async () => (features.sales_orders ? null : NextResponse.json({ error: "Not enabled" }, { status: 404 })),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => "all",
  canViewWorkcenter: () => true,
  canEditWorkcenter: () => canEdit,
}));
vi.mock("@/lib/fieldConfig", () => ({
  getEffectiveFieldConfig: async () => registryConfig(),
  getSalesConfig: async () => ({ product_categories: [] }) as unknown as SalesConfig,
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return {
    ...real,
    logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); },
    logChangeBatch: async (_s: unknown, es: (typeof logged)[number][]) => { logged.push(...es); },
  };
});

const exportHeaders = await import("@/app/api/export/sales_orders/route");
const exportLines = await import("@/app/api/export/sales_order_lines/route");
const importHeaders = await import("@/app/api/import/sales_orders/route");
const importLines = await import("@/app/api/import/sales_order_lines/route");
const updateHeaders = await import("@/app/api/update/sales_orders/route");
const updateLines = await import("@/app/api/update/sales_order_lines/route");
const { REGISTRY_OBJECT_TYPE, buildObjectSpec } = await import("./registrySchema");
const { SALES_ORDER_LINES_SPEC, SALES_ORDER_LINE_NUMBER_KEYS, SALES_ORDER_LINE_TEXT_KEYS } = await import("./salesOrderLinesSchema");

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const sales = { product_categories: [] } as unknown as SalesConfig;

const order = (over: Row = {}): Row => ({
  id: "so1", tenant_id: "t1", ref: "SO-0001", type_id: "ty1", origin: "bpmsquare", status: "draft", account_id: "a1", contact_id: null, customer_po: null, notes: null,
  terms: null, requested_date: null, currency: "QAR", pricing_mode: "internal", source_type: "direct", subtotal: 2000, discount_total: 200, tax_total: 90, shipping_amount: 0, total: 1890, custom_data: null, ...over,
});
const line = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t1", order_id: "so1", line_no: Number(id), description: `Item ${id}`, qty: 2, unit_price: 1000, discount_pct: 10, tax_pct: 5, line_total: 1800, confirmed_date: null, availability_at: "2026-06-01T00:00:00Z", ...over });
const type = (over: Row = {}): Row => ({ id: "ty1", tenant_id: "t1", name: "Standard order", prefix: "SO", pricing_mode: "internal", template: {}, rules: [], is_default: true, active: true, sort_order: 0, ...over });
const erpLink = (orderId = "so1"): Row => ({ id: "l1", tenant_id: "t1", object_type: "sales_orders", object_id: orderId, external_id: "X" });

function seed(extra: Record<string, Row[]> = {}) {
  current = fakeDb({
    accounts: [
      { id: "a1", tenant_id: "t1", name: "Acme Ltd", type: "end_customer", state: "Doha", country: "Qatar", custom_data: null },
      { id: "a9", tenant_id: "t2", name: "Foreign Co", type: "end_customer" },
    ],
    contacts: [{ id: "c1", tenant_id: "t1", name: "Sam", account_id: "a1" }],
    sales_order_types: [type(), type({ id: "ty2", name: "Export order", prefix: "EX", is_default: false })],
    sales_orders: [order()], sales_order_lines: [line("1")], connector_links: [],
    ...extra,
  }, { copyReads: true });
}
const call = (handler: (r: never) => Promise<Response>, body: unknown) => handler(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never);
const rowsOf = (...values: Record<string, string>[]) => ({ rows: values.map((v, i) => ({ rowNum: i + 2, values: v })) });
const stored = (id = "so1") => current.tables.sales_orders.find((o) => o.id === id)!;

beforeEach(() => {
  logged.length = 0;
  features = { sales_orders: true };
  canEdit = true;
  seed();
});

describe("Sales Orders on the field registry and Data Workbench specs", () => {
  it("is a pilot object type, and the lines are a static spec", () => {
    expect(isPilotObjectType("sales_order")).toBe(true);
    expect(REGISTRY_OBJECT_TYPE.sales_orders).toBe("sales_order");
    expect(REGISTRY_OBJECT_TYPE.sales_order_lines).toBeNull();
  });

  it("marks every system-generated field export-only and locked, and offers no pointer or party as a field", () => {
    const keys = FIELD_REGISTRY.sales_order.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["ref", "status", "subtotal", "discount_total", "tax_total", "total", "expected_date", "confirmed_at", "pricing_mode"]) {
      const f = FIELD_REGISTRY.sales_order.fields.find((x) => x.key === k)!;
      expect(f.exportOnly, k).toBe(true);
      expect(f.editable, k).toBe(false);
    }
    for (const k of ["account_id", "contact_id", "type_id", "bill_to", "ship_to", "created_by", "cancel_reason", "owner_user_id"]) expect(keys).not.toContain(k);
  });

  it("the header spec resolves customer, contact and order type by name; only the customer is required", () => {
    const spec = buildObjectSpec("sales_orders", registryConfig(), sales);
    expect(spec.fields.find((f) => f.key === "account_name")).toMatchObject({ type: "ref", required: true });
    expect(spec.fields.find((f) => f.key === "contact_name")?.required).toBeFalsy();
    expect(spec.fields.find((f) => f.key === "type_name")?.required).toBeFalsy();
  });

  it("the lines spec keeps availability and totals export-only and offers the order id as the create-time key", () => {
    const byKey = new Map(SALES_ORDER_LINES_SPEC.fields.map((f) => [f.key, f]));
    expect(byKey.get("sales_order_ref")).toMatchObject({ type: "ref", required: true });
    for (const k of ["line_total", "confirmed_qty", "confirmed_date", "availability_source", "line_no"]) expect(byKey.get(k)?.exportOnly, k).toBe(true);
    for (const k of [...SALES_ORDER_LINE_TEXT_KEYS, ...SALES_ORDER_LINE_NUMBER_KEYS]) expect(byKey.get(k)?.exportOnly, k).toBeFalsy();
  });
});

describe("Data Workbench routes keep the proven shape", () => {
  const routes = ["export/sales_orders", "export/sales_order_lines", "import/sales_orders", "import/sales_order_lines", "update/sales_orders", "update/sales_order_lines"];

  it.each(routes)("%s resolves its tenant from the session, gates on the module and never uses the service role", (r) => {
    const src = read(`src/app/api/${r}/route.ts`);
    expect(src).toContain("requireTenantUser()");
    expect(src).toContain(`assertObjectFeature(tenantId, "${r.split("/")[1]}")`);
    expect(src).not.toContain("createAdminSupabase");
    expect(src).not.toMatch(/tenantId\s*=\s*(body|values|rows)/);
    expect(src.indexOf("requireTenantUser()")).toBeLessThan(src.indexOf("assertObjectFeature("));
  });

  it("both updates match on the real id only, never the order id", () => {
    for (const r of ["update/sales_orders", "update/sales_order_lines"]) {
      const src = read(`src/app/api/${r}/route.ts`);
      expect(src).toContain("values.id?.trim()");
      expect(src).not.toMatch(/ref\)|nameKey/);
    }
  });
});

describe("export", () => {
  it("exports this tenant's headers with the real id and the readable names, never another tenant's", async () => {
    seed({ sales_orders: [order(), order({ id: "so9", tenant_id: "t2", ref: "SO-0009", account_id: "a9" })] });
    const j = await (await call(exportHeaders.POST, {})).json();
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0]).toMatchObject({ id: "so1", account_name: "Acme Ltd", type_name: "Standard order", ref: "SO-0001" });
  });

  it("exports lines with their own id and their order's Order ID, availability included", async () => {
    seed({ sales_order_lines: [line("1", { confirmed_qty: 2, confirmed_date: "2026-07-01", availability_source: "master", printed_text: "Prints" }), line("9", { tenant_id: "t2", order_id: "so9" })] });
    const j = await (await call(exportLines.POST, {})).json();
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0]).toMatchObject({ id: "1", sales_order_ref: "SO-0001", unit_price: "1000", confirmed_date: "2026-07-01", availability_source: "master", printed_text: "Prints" });
  });

  it("a workspace without the module is refused", async () => {
    features = {};
    expect((await call(exportHeaders.POST, {})).status).toBe(404);
    expect((await call(importHeaders.POST, rowsOf({ account_name: "Acme Ltd" }))).status).toBe(404);
    expect((await call(updateLines.POST, rowsOf({ id: "1", qty: "9" }))).status).toBe(404);
  });
});

describe("import of headers", () => {
  it("creates DRAFT orders by account and contact name with the type's prefix, tenant currency and computed fields", async () => {
    const j = await (await call(importHeaders.POST, rowsOf(
      { account_name: "acme ltd", contact_name: "Sam", customer_po: "PO-5", requested_date: "2026-08-01", shipping_amount: "25", status: "confirmed", total: "999", cf_site: "North" },
      { account_name: "Acme Ltd", type_name: "Export order" },
    ))).json();
    expect(j).toMatchObject({ inserted: 2, failed: 0 });
    const [, a, b] = current.tables.sales_orders;
    expect(a).toMatchObject({ tenant_id: "t1", ref: "SO-0002", account_id: "a1", contact_id: "c1", status: "draft", customer_po: "PO-5", currency: "QAR", total: 25, shipping_amount: 25, custom_data: { cf_site: "North" }, created_by: "u1" });
    expect(b).toMatchObject({ ref: "EX-0001", type_id: "ty2" });
    expect(logged.filter((l) => l.objectType === "sales_orders")).toHaveLength(2);
  });

  it("fails clearly for another tenant's account, an unknown contact or type, and creates nothing for those rows", async () => {
    const j = await (await call(importHeaders.POST, rowsOf({ account_name: "Foreign Co" }, { account_name: "Acme Ltd", contact_name: "Nobody" }, { account_name: "Acme Ltd", type_name: "Imaginary" }))).json();
    expect(j).toMatchObject({ inserted: 0, failed: 3 });
    expect(current.tables.sales_orders).toHaveLength(1);
  });

  it("needs the edit grant", async () => {
    canEdit = false;
    expect((await call(importHeaders.POST, rowsOf({ account_name: "Acme Ltd" }))).status).toBe(403);
  });
});

describe("import of lines", () => {
  it("adds lines to a draft order by Order ID and re-derives its totals", async () => {
    const j = await (await call(importLines.POST, rowsOf({ sales_order_ref: "so-0001", description: "Extra", qty: "2", unit_price: "100", tax_pct: "10", printed_text: "Prints" }))).json();
    expect(j).toMatchObject({ inserted: 1, failed: 0 });
    expect(current.tables.sales_order_lines[1]).toMatchObject({ tenant_id: "t1", order_id: "so1", line_no: 2, line_total: 200, tax_pct: 10, printed_text: "Prints" });
    // 1800 + 200 net, tax 90 + 20
    expect(stored()).toMatchObject({ subtotal: 2200, discount_total: 200, tax_total: 110, total: 2110 });
    expect(current.tables.sales_order_lines.every((l) => l.availability_at === null)).toBe(true);
    expect(logged.find((l) => l.objectType === "sales_orders")?.changes?.[0]).toMatchObject({ field: "Line added" });
  });

  it.each([
    ["a confirmed order", order({ status: "confirmed" }), {}],
    ["a cancelled order", order({ status: "cancelled" }), {}],
    ["an order made by the ERP", order({ origin: "erp" }), {}],
    ["a draft the ERP has accepted", order(), { connector_links: [erpLink()] }],
    ["an order of another tenant", order({ tenant_id: "t2" }), {}],
  ])("refuses lines for %s", async (_n, o, extra) => {
    seed({ sales_orders: [o], ...(extra as Record<string, Row[]>) });
    const j = await (await call(importLines.POST, rowsOf({ sales_order_ref: "SO-0001", description: "Extra" }))).json();
    expect(j.failed).toBe(1);
    expect(current.tables.sales_order_lines).toHaveLength(1);
  });

  it("needs a description and a real date", async () => {
    const j = await (await call(importLines.POST, rowsOf({ sales_order_ref: "SO-0001" }, { sales_order_ref: "SO-0001", description: "x", requested_date: "31/12/2026" }))).json();
    expect(j.failed).toBe(2);
  });
});

describe("update of headers (by id only)", () => {
  it("changes the open fields of a draft and recomputes the total when shipping moves", async () => {
    const j = await (await call(updateHeaders.POST, rowsOf({ id: "so1", customer_po: "PO-8", terms: "Net 15", shipping_amount: "100", requested_date: "2026-09-01", cf_site: "South" }))).json();
    expect(j).toMatchObject({ updated: 1, failed: 0 });
    expect(stored()).toMatchObject({ customer_po: "PO-8", terms: "Net 15", requested_date: "2026-09-01", shipping_amount: 100, total: 1990, custom_data: { cf_site: "South" } });
  });

  it("a confirmed order takes notes, customer PO and custom fields but refuses terms, dates and shipping", async () => {
    seed({ sales_orders: [order({ status: "confirmed" })] });
    const ok = await (await call(updateHeaders.POST, rowsOf({ id: "so1", notes: "Call first", customer_po: "PO-1", cf_site: "N" }))).json();
    expect(ok.updated).toBe(1);
    expect(stored()).toMatchObject({ notes: "Call first", customer_po: "PO-1" });
    const locked = await (await call(updateHeaders.POST, rowsOf({ id: "so1", terms: "x" }, { id: "so1", shipping_amount: "5" }))).json();
    expect(locked.failed).toBe(2);
    expect(stored().terms).toBeNull();
  });

  it("a cancelled order and an ERP-made order accept nothing", async () => {
    seed({ sales_orders: [order({ status: "cancelled" })] });
    expect((await (await call(updateHeaders.POST, rowsOf({ id: "so1", notes: "x" }))).json()).failed).toBe(1);
    seed({ sales_orders: [order({ origin: "erp", status: "confirmed" })] });
    expect((await (await call(updateHeaders.POST, rowsOf({ id: "so1", notes: "x" }))).json()).failed).toBe(1);
  });

  it("matches on id only: a missing id, an Order ID in place of an id and another tenant's id all fail", async () => {
    seed({ sales_orders: [order(), order({ id: "so9", tenant_id: "t2", ref: "SO-0009" })] });
    const j = await (await call(updateHeaders.POST, rowsOf({ notes: "x" }, { id: "SO-0001", notes: "x" }, { id: "so9", notes: "hacked" }))).json();
    expect(j).toMatchObject({ updated: 0, failed: 3 });
    expect(stored("so9").notes).not.toBe("hacked");
    expect(stored().notes).toBeNull();
  });

  it("refuses a bad date, a bad currency and a negative shipping", async () => {
    const j = await (await call(updateHeaders.POST, rowsOf({ id: "so1", requested_date: "soon" }, { id: "so1", currency: "XYZ" }, { id: "so1", shipping_amount: "-5" }))).json();
    expect(j.failed).toBe(3);
  });
});

describe("update of lines (by id only)", () => {
  it("edits a line of a draft, re-derives the line total and the order total, and marks availability stale", async () => {
    const j = await (await call(updateLines.POST, rowsOf({ id: "1", qty: "4", unit_price: "500", discount_pct: "0", description: "Renamed", printed_text: "Text" }))).json();
    expect(j).toMatchObject({ updated: 1, failed: 0 });
    expect(current.tables.sales_order_lines[0]).toMatchObject({ qty: 4, unit_price: 500, line_total: 2000, description: "Renamed", printed_text: "Text", availability_at: null });
    expect(stored()).toMatchObject({ subtotal: 2000, discount_total: 0, tax_total: 100, total: 2100 });
    expect(logged.find((l) => l.objectType === "sales_orders")?.changes?.[0]).toMatchObject({ field: "Line: Item 1" });
  });

  it.each([
    ["confirmed", order({ status: "confirmed" }), {}],
    ["made by the ERP", order({ origin: "erp" }), {}],
    ["accepted by the ERP", order(), { connector_links: [erpLink()] }],
  ])("refuses to change a line of an order that is %s", async (_n, o, extra) => {
    seed({ sales_orders: [o], ...(extra as Record<string, Row[]>) });
    const j = await (await call(updateLines.POST, rowsOf({ id: "1", qty: "9" }))).json();
    expect(j.failed).toBe(1);
    expect(current.tables.sales_order_lines[0].qty).toBe(2);
  });

  it("a line id of another tenant, a missing id and a negative number all fail", async () => {
    seed({ sales_order_lines: [line("1"), line("9", { tenant_id: "t2", order_id: "so9" })] });
    const j = await (await call(updateLines.POST, rowsOf({ id: "9", qty: "1" }, { qty: "1" }, { id: "1", qty: "-3" }, { id: "1", description: " " }))).json();
    expect(j).toMatchObject({ updated: 0, failed: 4 });
    expect(current.tables.sales_order_lines.find((l) => l.id === "9")!.qty).toBe(2);
  });
});
