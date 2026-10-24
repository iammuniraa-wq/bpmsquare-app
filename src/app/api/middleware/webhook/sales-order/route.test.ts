import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v, unsealSecret: (v: string | null | undefined) => v ?? undefined }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
vi.mock("@/lib/changeLog", () => ({ logChange: async () => {}, logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: new Error("not used") }) }));

let current: ReturnType<typeof import("@/lib/connectors/d365/syncHarness").fakeDb>;
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => current.client }));

import { fakeDb, TENANT } from "@/lib/connectors/d365/syncHarness";
import { INVOICE_1, ORDER_A, ORDER_B, dvInvoice, dvOrder, seedOrders, stubDataverse } from "@/lib/connectors/d365/ordersHarness";
import { runPullSalesOrders } from "@/lib/connectors/d365/orders";
import { POST } from "./route";

const SECRET = "whsec-test-secret";
const HOST = "acme.example.com";

function setup(over: { secret?: string | null; features?: Record<string, boolean>; domain?: string } = {}) {
  const seed = seedOrders({ features: { integration_middleware: true, ...(over.features ?? {}) } });
  seed.tenants = [{
    id: TENANT, custom_domain: over.domain ?? HOST, features: { sales_orders: true, integration_middleware: true, ...(over.features ?? {}) },
    config: { currency: "USD", integration_push: over.secret === null ? {} : { webhook_secret: over.secret ?? SECRET } },
  }];
  seed.integration_messages = [];
  current = fakeDb(seed);
}

const sign = (raw: string, secret = SECRET) => createHmac("sha256", secret).update(raw).digest("hex");
function call(body: unknown, opts: { host?: string; sig?: string | null; secret?: string } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = { host: opts.host ?? HOST, "content-type": "application/json" };
  if (opts.sig !== null) headers["x-bpmsquare-signature"] = opts.sig ?? sign(raw, opts.secret);
  return POST(new Request(`https://${opts.host ?? HOST}/api/middleware/webhook/sales-order`, { method: "POST", headers, body: raw }) as never);
}

async function withPulledOrder() {
  setup();
  const dv = stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")], invoices: [dvInvoice(INVOICE_1, ORDER_A)] });
  await runPullSalesOrders(current.client, TENANT, { trigger: "manual", userId: null });
  return { dv, orderId: current.tables.sales_orders[0].id as string };
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("POST /api/middleware/webhook/sales-order", () => {
  it("refreshes the order and its invoices when the body is signed with the workspace secret", async () => {
    const { dv, orderId } = await withPulledOrder();
    const calls = dv.calls.length;
    const res = await call({ order_ref: "ORD-01000" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, throttled: false, invoices: 1 });
    expect(dv.calls.length).toBeGreaterThan(calls);
    expect(current.tables.erp_documents).toEqual([expect.objectContaining({ order_id: orderId, raw_ref: INVOICE_1 })]);
    expect(current.tables.integration_messages.at(-1)).toMatchObject({ entity: "sales_orders", object_type: "sales_orders", channel: "webhook", ref_label: "Sales order ORD-01000" });
  });

  it("finds the order by the ERP's record id too", async () => {
    await withPulledOrder();
    const res = await call({ erp_id: ORDER_A });
    expect(res.status).toBe(200);
  });

  it("answers one refresh per order per ten seconds", async () => {
    const { dv } = await withPulledOrder();
    await call({ order_ref: "ORD-01000" });
    const calls = dv.calls.length;
    const again = await call({ order_ref: "ORD-01000" });
    expect(await again.json()).toMatchObject({ ok: true, throttled: true });
    expect(dv.calls.length).toBe(calls);
  });

  it("a wrong secret is a bare 401 and reads nothing from the ERP", async () => {
    const { dv } = await withPulledOrder();
    const calls = dv.calls.length;
    const res = await call({ order_ref: "ORD-01000" }, { secret: "not-the-secret" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(dv.calls.length).toBe(calls);
    expect(current.tables.erp_documents).toHaveLength(0);
  });

  it("no signature, a malformed one, an unknown host, a workspace with no secret and a workspace without the module are all the same 401", async () => {
    await withPulledOrder();
    const bodies = await Promise.all([
      call({ order_ref: "ORD-01000" }, { sig: null }),
      call({ order_ref: "ORD-01000" }, { sig: "zz" }),
      call({ order_ref: "ORD-01000" }, { host: "unknown.example.com", secret: SECRET }),
    ]);
    for (const r of bodies) { expect(r.status).toBe(401); expect(await r.json()).toEqual({ error: "Unauthorized" }); }

    setup({ secret: null });
    const noSecret = await call({ order_ref: "ORD-01000" }, { sig: sign(JSON.stringify({ order_ref: "ORD-01000" }), "") });
    expect(noSecret.status).toBe(401);

    setup({ features: { sales_orders: false } });
    const moduleOff = await call({ order_ref: "ORD-01000" });
    expect(moduleOff.status).toBe(401);
  });

  it("a signed body older than ten minutes is refused as a replay", async () => {
    await withPulledOrder();
    const res = await call({ order_ref: "ORD-01000", sent_at: new Date(Date.now() - 3_600_000).toISOString() });
    expect(res.status).toBe(401);
  });

  it("never finds another workspace's order, by number or by ERP id", async () => {
    setup();
    const dv = stubDataverse({ orders: [dvOrder(ORDER_B, "ORD-F")], invoices: [dvInvoice(INVOICE_1, ORDER_B)] });
    current.tables.sales_orders.push({ id: "foreign", tenant_id: "t-2", ref: "ORD-F", origin: "erp", status: "confirmed", spine: "in_progress", currency: "USD" });
    current.tables.connector_links.push({ id: "l-f", tenant_id: "t-2", connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "foreign", external_id: ORDER_B, external_key: "ORD-F", direction: "pull" });
    const before = dv.calls.length;
    const byRef = await call({ order_ref: "ORD-F" });
    expect(byRef.status).toBe(404);
    expect(current.tables.erp_documents).toHaveLength(0);
    expect(current.tables.sales_orders.find((o) => o.id === "foreign")).not.toHaveProperty("erp_docs_checked_at");
    expect(dv.calls.length).toBe(before);
  });

  it("an order the ERP names that is new here is read in once, when the entity is on", async () => {
    setup();
    stubDataverse({ orders: [dvOrder(ORDER_A, "ORD-01000")], invoices: [dvInvoice(INVOICE_1, ORDER_A)] });
    const res = await call({ erp_id: ORDER_A });
    expect(res.status).toBe(200);
    expect(current.tables.sales_orders).toHaveLength(1);
    expect(current.tables.erp_documents).toHaveLength(1);
  });

  it("asks for an order_ref or an erp_id", async () => {
    setup();
    expect((await call({ something: 1 })).status).toBe(400);
    expect((await call("not json")).status).toBe(400);
  });
});
