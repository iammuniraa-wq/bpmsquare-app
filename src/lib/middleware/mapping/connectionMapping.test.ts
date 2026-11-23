import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A connection a workspace added itself (integration_connections, 0250) is mapped by the EXISTING mapping engine, as `conn:<uuid>`.
// This file proves the engine resolves it with the tenant, reads and saves a mapping for it, and that a Dynamics mapping is untouched.
vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v, unsealSecret: (v: string) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async () => new Response("{}") }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {}, logChange: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));

import { fetchSchema, getView, saveEngine, tryOp, type OpsCtx } from "./engineOps";
import { resolveConnection, directionOf } from "./connection";
import { fakeAdmin, seedMiddleware, T1, T2 } from "../testHarness";

const CONN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THEIRS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const seed = () => fakeAdmin({
  ...seedMiddleware(),
  integration_connections: [
    { id: CONN, tenant_id: T1, name: "PCBS F&O", family: "odata", config: {}, secrets: {} },
    { id: THEIRS, tenant_id: T2, name: "Theirs", family: "odata", config: {}, secrets: {} },
  ],
});
const ctx = (db: ReturnType<typeof fakeAdmin>, tenantId = T1): OpsCtx => ({ supabase: db.client, admin: db.client, tenantId, userId: "u-1" });

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("resolving conn:<uuid>", () => {
  it("an own connection resolves to the connection kind with its name", async () => {
    const r = await resolveConnection(seed().client, T1, `conn:${CONN}`);
    expect(r).toMatchObject({ ok: true, conn: { id: `conn:${CONN}`, kind: "connection", label: "PCBS F&O", connectionId: CONN } });
  });

  it("another workspace's connection is 404, a malformed one is 422, and a missing table is 404, never a crash", async () => {
    expect(await resolveConnection(seed().client, T1, `conn:${THEIRS}`)).toMatchObject({ ok: false, status: 404 });
    expect(await resolveConnection(seed().client, T1, "conn:not-a-uuid")).toMatchObject({ ok: false, status: 422 });
    const pending = fakeAdmin({}, { missing: ["integration_connections"] });
    expect(await resolveConnection(pending.client, T1, `conn:${CONN}`)).toMatchObject({ ok: false, status: 404 });
  });

  it("the lookup names the tenant", async () => {
    const db = seed();
    await resolveConnection(db.client, T1, `conn:${CONN}`);
    const q = db.log.find((l) => l.table === "integration_connections")!;
    expect(q.filters).toContain(`tenant_id=${T1}`);
  });

  it("the existing connections resolve exactly as before", async () => {
    expect(await resolveConnection(seed().client, T1, undefined)).toMatchObject({ ok: true, conn: { id: "dynamics365", kind: "adapter" } });
    expect(await resolveConnection(seed().client, T1, "sap_s4")).toMatchObject({ ok: true, conn: { id: "sap_s4", kind: "adapter" } });
    expect(directionOf({ id: "dynamics365", kind: "adapter", label: "x" }, "quote")).toBe("out");
    expect(directionOf({ id: `conn:${CONN}`, kind: "connection", label: "x", connectionId: CONN }, "customers")).toBe("in");
  });
});

describe("the Mapping tab works for it", () => {
  it("shows the fields BPMSquare offers for an object, with no field list of the system yet", async () => {
    const db = seed();
    const out = await getView(ctx(db), `conn:${CONN}`, "customers");
    expect(out.status).toBe(200);
    const v = out.body as Body;
    expect(v.sourceFields.header.map((f: Body) => f.key)).toEqual(["name", "city", "phone", "email"]);
    expect(v.engine).toMatchObject({ active: false });
  });

  it("another workspace's connection is not found by any mapping call", async () => {
    const db = seed();
    expect((await getView(ctx(db), `conn:${THEIRS}`, "customers")).status).toBe(404);
    expect((await fetchSchema(ctx(db), { connection: `conn:${THEIRS}`, document: "customers", source: "manual", fields: [{ path: "a" }] })).status).toBe(404);
    expect((await saveEngine(ctx(db), { connection: `conn:${THEIRS}`, document: "customers", rows: { header: [], lines: [] } })).status).toBe(404);
  });

  it("fields typed by hand are saved as a mapping of this workspace, under the connection, as an inbound document", async () => {
    const db = seed();
    const c = ctx(db);
    const conn = `conn:${CONN}`;
    expect((await fetchSchema(c, { connection: conn, document: "customers", source: "manual", fields: [{ path: "AccountName", type: "text", required: true }, { path: "City", type: "text" }] })).status).toBe(200);
    const saved = await saveEngine(c, { connection: conn, document: "customers", rows: { header: [
      { id: "r1", target: "AccountName", source: "name", convert: null, ifEmpty: null, origin: "user", confidence: null },
      { id: "r2", target: "City", source: "city", convert: null, ifEmpty: null, origin: "user", confidence: null },
    ], lines: [] } });
    expect(saved.status).toBe(200);
    const row = (db.tables.integration_mappings ?? []).find((r) => r.status === "active");
    expect(row).toMatchObject({ tenant_id: T1, connection_id: conn, document: "customers", direction: "in", version: 1 });
  });

  it("a send preview says the connection has no sender yet (it is mapped, not sent)", async () => {
    const out = await tryOp(ctx(seed()), { connection: `conn:${CONN}`, document: "quote" });
    expect(out.status).toBe(422);
    expect((out.body as Body).error).toMatch(/no sender yet/);
  });
});
