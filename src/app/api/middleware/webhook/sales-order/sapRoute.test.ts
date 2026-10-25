import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v, unsealSecret: (v: string | null | undefined) => v ?? undefined }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async (u: string, init: RequestInit) => fetch(u, init) }));
vi.mock("@/lib/changeLog", () => ({ logChange: async () => {}, logChangeBatch: async () => {} }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: () => {} }));

let current: ReturnType<typeof import("@/lib/connectors/d365/syncHarness").fakeDb>;
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => current.client }));

import { fakeDb } from "@/lib/connectors/d365/syncHarness";
import { FakeS4 } from "@/lib/connectors/sap_s4/fakeS4";
import { POST } from "./route";

const T = "t-1";
const SECRET = "whsec-test-secret";
const HOST = "acme.example.com";
const SAP_HOST = "my426318-api.s4hana.cloud.sap";

function setup(over: { entityOn?: boolean } = {}) {
  current = fakeDb({
    tenants: [{ id: T, custom_domain: HOST, features: { sales_orders: true, integration_middleware: true, accounts: true, products: true }, config: { currency: "EUR", integration_push: { webhook_secret: SECRET } } }],
    tenant_connectors: [{
      tenant_id: T, connector_id: "sap_s4", status: "connected", last_error: null,
      config: { auth_mode: "basic", api_host: SAP_HOST, username: "BPM_USER", schedule: "off", entities: over.entityOn === false ? {} : { sales_orders: { enabled: true, field_map: {} } } }, credentials: { password: "pw" },
    }],
    accounts: [{ id: "acc-1", tenant_id: T, name: "Alpha GmbH" }],
    connector_links: [{ tenant_id: T, connector_id: "sap_s4", entity: "customers", object_type: "accounts", object_id: "acc-1", external_id: "0000001000", external_key: "0000001000", direction: "pull" }],
    sales_orders: [], sales_order_lines: [], erp_documents: [], integration_messages: [], connector_sync_runs: [],
  });
  const f = new FakeS4({ user: "BPM_USER", password: "pw" })
    .addOrders({ number: "0000000069", soldTo: "0000001000", changed: "2026-10-20" })
    .addBilling({ number: "90000001", order: "0000000069", net: 20 })
    .addDelivery({ number: "80000001", order: "0000000069", issued: "2026-11-12" });
  vi.stubGlobal("fetch", f.fetch);
  return f;
}

const sign = (raw: string) => createHmac("sha256", SECRET).update(raw).digest("hex");
const call = (body: unknown) => {
  const raw = JSON.stringify(body);
  return POST(new Request(`https://${HOST}/api/middleware/webhook/sales-order`, { method: "POST", headers: { host: HOST, "content-type": "application/json", "x-bpmsquare-signature": sign(raw) }, body: raw }) as never);
};

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("POST /api/middleware/webhook/sales-order for a SAP workspace", () => {
  it("reads a new order in by its SAP number (also without leading zeros), then its deliveries and invoices", async () => {
    setup();
    const res = await call({ erp_id: "69" });
    expect(res.status).toBe(200);
    expect(current.tables.sales_orders.map((o) => o.ref)).toEqual(["0000000069"]);
    expect(current.tables.erp_documents.map((d) => [d.kind, d.erp_number]).sort()).toEqual([["delivery", "80000001"], ["invoice", "90000001"]]);
    expect(current.tables.integration_messages.some((m) => m.channel === "webhook" && m.connector_id === "sap_s4" && m.ref_label === "Sales order 0000000069")).toBe(true);
  });

  it("finds an order it already holds by the ERP's number and refreshes it", async () => {
    setup();
    await call({ erp_id: "0000000069" });
    const again = await call({ order_ref: "0000000069" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true });
  });

  it("answers 404 for an order SAP does not have, and does not read it in when the entity is off", async () => {
    setup();
    expect((await call({ erp_id: "424242" })).status).toBe(404);
    setup({ entityOn: false });
    const res = await call({ erp_id: "69" });
    expect(res.status).toBe(404);
    expect(current.tables.sales_orders).toHaveLength(0);
  });
});
