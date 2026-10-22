import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Every SAP-aware route starts at guard(): a workspace admin, in a workspace with the integration_middleware flag, the
// tenant from the session. A refused guard must reach neither the SAP code nor the database.

const sap = vi.hoisted(() => ({
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/lib/connectors/sap_s4/server", async (orig) => {
  const real = await orig<typeof import("@/lib/connectors/sap_s4/server")>();
  const spy = (name: string, impl: (...a: unknown[]) => unknown) => (sap.fns[name] = vi.fn(impl));
  return {
    ...real,
    loadSap: spy("loadSap", async () => null),
    publicState: spy("publicState", () => ({ config: null })),
    saveSapConnection: spy("saveSapConnection", async () => ({})),
    disconnectSap: spy("disconnectSap", async () => {}),
    testSap: spy("testSap", async () => ({ ok: true, line: "x", failures: [], status: 200 })),
    sapHealth: spy("sapHealth", async () => ({ problems: [] })),
    sapSyncOverview: spy("sapSyncOverview", async () => ({ connected: false, entities: [] })),
    runSapPull: spy("runSapPull", async () => ({ runId: null, counts: {}, issues: [], error: null })),
    setSapSchedule: spy("setSapSchedule", async () => ({ ok: true, schedule: "daily" })),
    getSapFields: spy("getSapFields", async () => ({ ok: false, state: "not_connected", message: "x" })),
    getSapMapping: spy("getSapMapping", async () => ({ connected: false })),
    saveSapMapping: spy("saveSapMapping", async () => ({ ok: false, status: 400, error: "x" })),
    resetSapMapping: spy("resetSapMapping", async () => ({ ok: false, status: 400, error: "x" })),
    getSapScope: spy("getSapScope", async () => ({ error: "x", status: 400 })),
    saveSapScope: spy("saveSapScope", async () => ({ error: "x", status: 400 })),
    getSapScopeValues: spy("getSapScopeValues", async () => ({ error: "x", status: 400 })),
    previewSapEntity: spy("previewSapEntity", async () => ({ error: "x", status: 400 })),
  };
});

const guardState = vi.hoisted(() => ({ ok: false as boolean }));
vi.mock("./_guard", () => ({
  guard: async () => (guardState.ok
    ? { ok: true, ctx: { supabase: {}, admin: { tag: "admin" }, tenantId: "tenant-from-session", userId: "u-1" } }
    : { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }),
  jsonBody: async (r: Request) => ((await r.json().catch(() => ({}))) ?? {}),
  fail: (status: number, error: string) => NextResponse.json({ error }, { status }),
}));
vi.mock("@/lib/middleware/ops", () => ({ connectionList: async () => [], syncOverview: async () => ({}), health: async () => ({}), getDocuments: async () => ({}), resync: vi.fn(), setEntitySchedule: vi.fn(), SYNC_SCHEDULES: ["off", "hourly", "daily"] }));
vi.mock("@/lib/connectors/d365/server", () => ({ CONNECTOR_ID: "dynamics365", loadD365: async () => null, publicState: () => ({}) }));

const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/middleware/${path}${path.includes("?") ? "&" : "?"}connector=sap_s4`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
const ctx = (id = "sap_s4") => ({ params: Promise.resolve({ id }) });

type Call = [string, () => Promise<Response>];
const calls = (): Call[] => [
  ["GET connections", async () => (await import("./connections/route")).GET()],
  ["GET connections/sap_s4", async () => (await import("./connections/[id]/route")).GET(req("connections/sap_s4", "GET"), ctx())],
  ["PUT connections/sap_s4", async () => (await import("./connections/[id]/route")).PUT(req("connections/sap_s4", "PUT", { config: { auth_mode: "basic" } }), ctx())],
  ["DELETE connections/sap_s4", async () => (await import("./connections/[id]/route")).DELETE(req("connections/sap_s4", "DELETE"), ctx())],
  ["POST connections/sap_s4/test", async () => (await import("./connections/[id]/test/route")).POST(req("connections/sap_s4/test", "POST", {}), ctx())],
  ["GET health", async () => (await import("./health/route")).GET(req("health", "GET"))],
  ["GET sync", async () => (await import("./sync/route")).GET(req("sync", "GET"))],
  ["GET documents", async () => (await import("./documents/route")).GET(req("documents", "GET"))],
  ["POST resync", async () => (await import("./resync/route")).POST(req("resync", "POST", { entity: "customers" }))],
  ["PUT schedule", async () => (await import("./schedule/route")).PUT(req("schedule", "PUT", { entity: "customers", schedule: "daily" }))],
  ["GET metadata", async () => (await import("./metadata/route")).GET(req("metadata?entity=customers", "GET"))],
  ["POST preview-entity", async () => (await import("./preview-entity/route")).POST(req("preview-entity", "POST", { entity: "customers" }))],
  ["GET scope", async () => (await import("./scope/route")).GET(req("scope?entity=customers", "GET"))],
  ["PUT scope", async () => (await import("./scope/route")).PUT(req("scope", "PUT", { entity: "customers", conditions: [] }))],
  ["GET scope/values", async () => (await import("./scope/values/route")).GET(req("scope/values?entity=customers&attribute=Industry", "GET"))],
  ["GET mapping", async () => (await import("./mapping/route")).GET(req("mapping?document=customers", "GET"))],
  ["PUT mapping", async () => (await import("./mapping/route")).PUT(req("mapping", "PUT", { document: "customers", section: "header", rows: [] }))],
  ["POST mapping/reset", async () => (await import("./mapping/reset/route")).POST(req("mapping/reset", "POST", { document: "customers" }))],
];

beforeEach(() => { for (const f of Object.values(sap.fns)) f.mockClear(); guardState.ok = false; });

describe("SAP routes: the guard comes first", () => {
  it("a refused guard answers its own response and reaches no SAP code", async () => {
    // import once so the spies exist
    await import("@/lib/connectors/sap_s4/server");
    for (const [name, run] of calls()) {
      const res = await run();
      expect(res.status, name).toBe(403);
    }
    for (const [name, f] of Object.entries(sap.fns)) expect(f, name).not.toHaveBeenCalled();
  });

  it("an admin of a flagged workspace gets the SAP answer, for the tenant of the session only", async () => {
    guardState.ok = true;
    const res = await (await import("./resync/route")).POST(req("resync", "POST", { entity: "customers", full: true, ids: ["1000"], tenant_id: "other-tenant" }));
    expect(res.status).toBe(200);
    const [admin, tenantId, entity, opts] = sap.fns.runSapPull.mock.calls[0] as [{ tag: string }, string, string, { full: boolean; ids: string[]; userId: string }];
    expect(admin.tag).toBe("admin");
    expect(tenantId).toBe("tenant-from-session");
    expect(entity).toBe("customers");
    expect(opts).toMatchObject({ full: true, ids: ["1000"], userId: "u-1" });

    const sync = await (await import("./sync/route")).GET(req("sync", "GET"));
    expect(sync.status).toBe(200);
    expect(sap.fns.sapSyncOverview.mock.calls[0][1]).toBe("tenant-from-session");
  });

  it("refuses an entity SAP does not have, and a connector query for another connector is the first connector's", async () => {
    guardState.ok = true;
    expect((await (await import("./resync/route")).POST(req("resync", "POST", { entity: "projects" }))).status).toBe(422);
    expect((await (await import("./schedule/route")).PUT(req("schedule", "PUT", { entity: "fence_projects", schedule: "daily" }))).status).toBe(422);
    expect((await (await import("./scope/route")).GET(req("scope?entity=contacts", "GET"))).status).toBe(422);
    expect((await (await import("./mapping/route")).GET(req("mapping?document=quote", "GET"))).status).toBe(422);
    expect((await (await import("./metadata/route")).GET(req("metadata?entity=quote", "GET"))).status).toBe(422);
    expect(sap.fns.runSapPull).not.toHaveBeenCalled();
    const other = await (await import("./documents/route")).GET(new NextRequest("http://localhost/api/middleware/documents?connector=nope"));
    expect(other.status).toBe(200);
    expect(sap.fns.sapSyncOverview).not.toHaveBeenCalled();
  });

  it("SAP has no outbound document: the Links tab gets an empty list", async () => {
    guardState.ok = true;
    expect(await (await (await import("./documents/route")).GET(req("documents", "GET"))).json()).toEqual({ documents: [], webhooks: [] });
  });
});
