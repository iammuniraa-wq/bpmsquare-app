import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
vi.mock("@/lib/changeLog", () => ({ logChange: async () => {}, logChangeBatch: async () => {} }));

let current: ReturnType<typeof import("@/lib/connectors/d365/syncHarness").fakeDb>;
let pendingDocs = false;
const failing = () => {
  const err = { data: null, error: { code: "42P01", message: 'relation "erp_documents" does not exist' } };
  const q: unknown = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(err).then(res) : () => q) });
  return q;
};
const client = () => ({ from: (t: string) => (pendingDocs && t === "erp_documents" ? failing() : (current.client as { from: (t: string) => unknown }).from(t)) }) as never;

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: client(), tenantId: "t-1", userId: "u1", role: "member" }),
  createAdminSupabase: () => client(),
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true, getTenant: async () => ({}) }));

import { fakeDb } from "@/lib/connectors/d365/syncHarness";
import { INVOICE_1, ORDER_A, dvInvoice, dvOrder, seedOrders, stubDataverse } from "@/lib/connectors/d365/ordersHarness";
import { POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://acme.example.com/api/sales-orders/x/erp-refresh", { method: "POST" }) as never;

beforeEach(() => {
  pendingDocs = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const seed = seedOrders();
  seed.sales_orders = [
    { id: "so-1", tenant_id: "t-1", ref: "ORD-01000", origin: "erp", status: "confirmed", status_label: "New", spine: "in_progress", account_id: "acc-1", total: 472, currency: "USD" },
    { id: "so-2", tenant_id: "t-1", ref: "SO-0002", origin: "bpmsquare", status: "draft", spine: "open", account_id: "acc-1", total: 5, currency: "USD" },
    { id: "foreign", tenant_id: "t-2", ref: "ORD-F", origin: "erp", status: "confirmed", spine: "in_progress", currency: "USD" },
  ];
  seed.connector_links.push(
    { id: "l-1", tenant_id: "t-1", connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "so-1", external_id: ORDER_A, external_key: "ORD-01000", direction: "pull" },
    { id: "l-f", tenant_id: "t-2", connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "foreign", external_id: "aaaaaaaa-0000-0000-0000-0000000000ff", direction: "pull" },
  );
  current = fakeDb(seed);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("POST /api/sales-orders/[id]/erp-refresh", () => {
  it("reads the order and its invoices from the ERP for an order of the session's workspace", async () => {
    const dv = stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000", { statecode: 3 })], invoices: [dvInvoice(INVOICE_1, ORDER_A)] });
    const res = await POST(req(), ctx("so-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, throttled: false, invoices: 1, erp_number: "ORD-01000" });
    expect(current.tables.erp_documents).toHaveLength(1);
    expect(current.tables.sales_orders.find((o) => o.id === "so-1")).toMatchObject({ spine: "completed" });
    const again = await POST(req(), ctx("so-1"));
    expect(await again.json()).toMatchObject({ ok: true, throttled: true });
    expect(dv.calls.filter((u) => u.pathname.endsWith("/invoices"))).toHaveLength(1);
  });

  it("another workspace's order id is a 404 and the ERP is never asked", async () => {
    const dv = stubDataverse({ invoices: [dvInvoice(INVOICE_1, "aaaaaaaa-0000-0000-0000-0000000000ff")] });
    const res = await POST(req(), ctx("foreign"));
    expect(res.status).toBe(404);
    expect(dv.calls).toHaveLength(0);
    expect(current.tables.erp_documents).toHaveLength(0);
  });

  it("an order that no ERP holds is a 409", async () => {
    stubDataverse();
    const res = await POST(req(), ctx("so-2"));
    expect(res.status).toBe(409);
  });

  it("while migration 0216 is pending it answers 503 with the bundle to run, and writes nothing", async () => {
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")], invoices: [dvInvoice(INVOICE_1, ORDER_A)] });
    pendingDocs = true;
    const res = await POST(req(), ctx("so-1"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ needsDatabaseUpdate: true, bundle: "scripts/run-bundle-27-erp-documents-2026-10-24.sql" });
    expect(current.tables.erp_documents).toHaveLength(0);
  });
});
