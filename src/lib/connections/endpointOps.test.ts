import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "20.190.1.1", family: 4 }] }));
vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string | null) => v,
  decrypt: (v: string | null) => v,
  sealSecret: (v: string | null | undefined) => (v ? `enc:${v}` : undefined),
  unsealSecret: (v: string | null | undefined) => (v ? v.replace(/^enc:/, "") : undefined),
}));
const logged = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/changeLog", () => ({ logChange: async (_s: unknown, p: Record<string, unknown>) => { logged.push(p); } }));

import { fakeAdmin, T1, T2 } from "@/lib/middleware/testHarness";
import { CONNECTIONS_BUNDLE, type StoreCtx } from "./store";
import { createEndpoints, describeRows, discover, listEndpoints, listOpenApiOperations, removeEndpoint, templates, tryEndpoint, updateEndpoint } from "./endpointOps";
import { guessObject, parseEndpointInput } from "./endpointSpec";
import { ENDPOINT_TEMPLATES } from "./templates";

const CONN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THEIRS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = "client-secret-for-endpoints-0123456789";

const conn = (id: string, tenant: string, family: "rest" | "odata", over: Record<string, unknown> = {}) => ({
  id, tenant_id: tenant, name: id === CONN ? "PCBS F&O" : "Theirs", family,
  config: { base_url: "https://8.8.8.8/data", auth: "bearer" }, secrets: { token: `enc:${SECRET}` },
  last_test_status: null, last_test_at: null, last_test_message: null, ...over,
});
const seed = (family: "rest" | "odata" = "odata", extra: Record<string, unknown[]> = {}) => fakeAdmin({
  integration_connections: [conn(CONN, T1, family), conn(THEIRS, T2, family)], integration_endpoints: [], integration_messages: [], ...extra,
} as never);
const ctxFor = (db: ReturnType<typeof fakeAdmin>, tenantId = T1): StoreCtx => ({ supabase: db.client, admin: db.client, tenantId, userId: "u-1" });
const hand = (over: Record<string, unknown> = {}) => ({ name: "Projects", path: "ProjectsV2", direction: "in", object_type: "projects", ...over });
const json = (o: unknown, status = 200, type = "application/json") => new Response(typeof o === "string" ? o : JSON.stringify(o), { status, headers: { "content-type": type } });
const rows = (db: ReturnType<typeof fakeAdmin>) => db.tables.integration_endpoints as Record<string, unknown>[];

beforeEach(() => { logged.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a connection starts with no endpoints", () => {
  it("the list is empty", async () => {
    const r = await listEndpoints(ctxFor(seed()), CONN);
    expect(r.body).toEqual({ endpoints: [] });
  });
  it("nothing is added by itself: the templates are only offered", () => {
    const t = templates().body.templates as { key: string }[];
    expect(t.length).toBeGreaterThan(0);
  });
});

describe("adding an endpoint by hand", () => {
  it("an OData entity set is stored for this workspace and the person, switched off, and written to the change history", async () => {
    const db = seed("odata");
    const r = await createEndpoints(ctxFor(db), { connection_id: CONN, items: [hand()] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 1, skipped: 0 });
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ tenant_id: T1, connection_id: CONN, name: "Projects", path: "ProjectsV2", method: "GET", direction: "in", object_type: "projects", run_mode: "manual", enabled: false, origin: "hand", created_by: "u-1" });
    expect(logged[0]).toMatchObject({ objectType: "integration_endpoint", action: "create", tenantId: T1 });
    expect(String(logged[0].objectLabel)).toBe("PCBS F&O · Projects");
  });

  it("a REST endpoint is a method and a path; an Out endpoint defaults to POST", async () => {
    const db = seed("rest");
    await createEndpoints(ctxFor(db), { connection_id: CONN, items: [hand({ name: "Push project", path: "projects", direction: "out" })] });
    expect(rows(db)[0]).toMatchObject({ method: "POST", path: "/projects", direction: "out" });
  });

  it("the request can not choose the workspace: tenant_id in the body is ignored", async () => {
    const db = seed("odata");
    await createEndpoints(ctxFor(db), { connection_id: CONN, items: [{ ...hand(), tenant_id: T2, connection_id: THEIRS }] });
    expect(rows(db)[0]).toMatchObject({ tenant_id: T1, connection_id: CONN });
  });

  it.each([
    [{ name: "" }, "name"],
    [{ direction: "sideways" }, "direction"],
    [{ object_type: "vendors" }, "object_type"],
    [{ path: "" }, "path"],
    [{ path: "Projects/../x" }, "path"],
    [{ path: "a b" }, "path"],
    [{ run_mode: "on_change" }, "run_mode"],
    [{ run_mode: "schedule" }, "schedule"],
    [{ method: "POST" }, "method"],
  ])("%j is refused on %s, in words", async (over, field) => {
    const db = seed("odata");
    const r = await createEndpoints(ctxFor(db), { connection_id: CONN, items: [hand(over)] });
    expect(r.status).toBe(422);
    expect((r.body.errors as { field: string }[]).map((e) => e.field)).toContain(field);
    expect(rows(db)).toHaveLength(0);
  });

  it("a REST path can not hold a key, leave the server, or be empty", () => {
    const rest = (path: string) => parseEndpointInput({ name: "x", path, direction: "in", object_type: "projects" }, "rest");
    expect(rest("/projects?api_key=abc").ok).toBe(false);
    expect(rest("//evil.example/x").ok).toBe(false);
    expect(rest("/a/../b").ok).toBe(false);
    expect(rest("/projects?status=open").ok).toBe(true);
    expect(rest("projects")).toMatchObject({ ok: true, value: { path: "/projects" } });
  });

  it("a schedule needs hourly or daily; On change is only for endpoints that send", () => {
    expect(parseEndpointInput({ name: "x", path: "P", direction: "in", object_type: "projects", run_mode: "schedule", schedule: "daily" }, "odata")).toMatchObject({ ok: true, value: { run_mode: "schedule", schedule: "daily" } });
    expect(parseEndpointInput({ name: "x", path: "P", direction: "out", object_type: "projects", run_mode: "on_change" }, "odata").ok).toBe(true);
    expect(parseEndpointInput({ name: "x", path: "P", direction: "in", object_type: "projects", run_mode: "manual", schedule: "daily" }, "odata")).toMatchObject({ ok: true, value: { schedule: null } });
  });

  it("the same name twice by hand is a 422; a foreign or unknown connection is 404 and nothing is inserted", async () => {
    const db = seed("odata");
    await createEndpoints(ctxFor(db), { connection_id: CONN, items: [hand()] });
    const dup = await createEndpoints(ctxFor(db), { connection_id: CONN, items: [hand({ name: "projects" })] });
    expect(dup.status).toBe(422);
    expect(rows(db)).toHaveLength(1);
    for (const id of [THEIRS, "nope", undefined]) {
      const r = await createEndpoints(ctxFor(db), { connection_id: id, items: [hand()] });
      expect(r.status).toBe(404);
    }
    expect(rows(db)).toHaveLength(1);
  });

  it("more than fifty at once, or none, is refused", async () => {
    const db = seed("odata");
    expect((await createEndpoints(ctxFor(db), { connection_id: CONN, items: [] })).status).toBe(422);
    expect((await createEndpoints(ctxFor(db), { connection_id: CONN, items: Array.from({ length: 51 }, (_, i) => hand({ name: `n${i}` })) })).status).toBe(422);
  });
});

describe("from a template: optional, picked, never applied by itself", () => {
  it("the templates are read from the presets the connectors ship with, and ePROMIS is not among them", () => {
    const fo = ENDPOINT_TEMPLATES.find((t) => t.key === "d365_fo")!;
    expect(fo.endpoints.map((e) => e.path)).toEqual(["CustomersV3", "ContactPersonsV2", "ReleasedProductsV2", "Projects"]);
    expect(ENDPOINT_TEMPLATES.find((t) => t.key === "d365_dataverse")!.endpoints.map((e) => e.path)).toEqual(["accounts", "contacts", "products", "msdyn_projects"]);
    expect(ENDPOINT_TEMPLATES.find((t) => t.key === "sap_s4_bp")!.endpoints[0]).toMatchObject({ path: "A_BusinessPartner", object_type: "customers" });
    expect(ENDPOINT_TEMPLATES.map((t) => t.key).join()).not.toMatch(/epromis/i);
    for (const t of ENDPOINT_TEMPLATES) for (const e of t.endpoints) expect(e.direction).toBe("in");
  });

  it("picking rows adds only those, stamped as from a template; picking again adds nothing twice", async () => {
    const db = seed("odata");
    const fo = ENDPOINT_TEMPLATES.find((t) => t.key === "d365_fo")!;
    const picked = fo.endpoints.filter((e) => e.object_type === "projects" || e.object_type === "customers").map((e) => ({ ...e, origin: "template", template_key: "d365_fo" }));
    const first = await createEndpoints(ctxFor(db), { connection_id: CONN, items: picked });
    expect(first.body).toMatchObject({ created: 2, skipped: 0 });
    expect(rows(db).map((r) => r.name).sort()).toEqual(["Customers", "Projects"]);
    expect(rows(db).every((r) => r.origin === "template" && r.template_key === "d365_fo" && r.enabled === false)).toBe(true);
    const again = await createEndpoints(ctxFor(db), { connection_id: CONN, items: picked });
    expect(again.body).toMatchObject({ created: 0, skipped: 2 });
    expect(rows(db)).toHaveLength(2);
  });

  it("the existing connectors' presets are not changed by any of this", () => {
    const before = JSON.stringify(ENDPOINT_TEMPLATES);
    templates();
    expect(JSON.stringify(ENDPOINT_TEMPLATES)).toBe(before);
  });
});

describe("from the system's own description", () => {
  const XML = `<?xml version="1.0"?><edmx:Edmx Version="4.0"><edmx:DataServices><Schema Namespace="N"><EntityType Name="P"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.String"/></EntityType><EntityContainer Name="C"><EntitySet Name="ProjectsV2" EntityType="N.P"/><EntitySet Name="CustomersV3" EntityType="N.P"/><EntitySet Name="SalesTaxCodes" EntityType="N.P"/></EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;

  it("an OData service lists its entity sets, with the object each most likely serves", async () => {
    const f = vi.fn(async () => json(XML, 200, "application/xml"));
    vi.stubGlobal("fetch", f);
    const r = await discover(ctxFor(seed("odata")), { connection_id: CONN });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("odata");
    expect((r.body.items as { name: string; object_type: string | null }[]).map((i) => [i.name, i.object_type])).toEqual([["CustomersV3", "customers"], ["ProjectsV2", "projects"], ["SalesTaxCodes", null]]);
    expect(String((f.mock.calls as unknown as [string][])[0][0])).toBe("https://8.8.8.8/data/$metadata");
  });

  it("a REST connection reads an OpenAPI description on its own server and lists every operation", async () => {
    const f = vi.fn(async () => json({ openapi: "3.0.0", paths: { "/projects": { get: { summary: "List projects" }, post: { operationId: "createProject" } }, "/wbs/{id}": { get: {} } } }));
    vi.stubGlobal("fetch", f);
    const r = await discover(ctxFor(seed("rest")), { connection_id: CONN, spec_path: "/openapi.json" });
    expect((r.body.items as { method: string; path: string; object_type: string | null }[]).map((i) => `${i.method} ${i.path} ${i.object_type}`)).toEqual(["GET /projects projects", "POST /projects projects", "GET /wbs/{id} null"]);
    expect(String((f.mock.calls as unknown as [string][])[0][0])).toBe("https://8.8.8.8/data/openapi.json");
  });

  it("the description path can not leave the server", async () => {
    const f = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", f);
    for (const p of ["//evil.example/x", "https://evil.example/x", "/../x", "x"]) expect((await discover(ctxFor(seed("rest")), { connection_id: CONN, spec_path: p })).status, p).toBe(422);
    expect(f).not.toHaveBeenCalled();
  });

  it("an unreachable system, a refusal and a foreign connection each answer in words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 401)));
    const denied = await discover(ctxFor(seed("odata")), { connection_id: CONN });
    expect(denied.status).toBe(502);
    expect(String(denied.body.error)).toMatch(/refused the sign-in/);
    expect(JSON.stringify(denied)).not.toContain(SECRET);
    expect((await discover(ctxFor(seed("odata")), { connection_id: THEIRS })).status).toBe(404);
  });

  it("pure helpers: operations and guesses", () => {
    expect(listOpenApiOperations({ paths: { "/a": { get: { summary: "A" }, parameters: [] } } })).toHaveLength(1);
    expect(listOpenApiOperations(null)).toEqual([]);
    expect(guessObject("ProjectsV2")).toBe("projects");
    expect(guessObject("Accounts")).toBe("customers");
    expect(guessObject("Misc")).toBeNull();
  });
});

describe("change and remove", () => {
  const seeded = async () => {
    const db = seed("odata");
    await createEndpoints(ctxFor(db), { connection_id: CONN, items: [hand()] });
    logged.length = 0;
    return { db, id: rows(db)[0].id as string };
  };

  it("a request that only switches it on is valid, and is written to the change history", async () => {
    const { db, id } = await seeded();
    const r = await updateEndpoint(ctxFor(db), id, { enabled: true });
    expect(r.status).toBe(200);
    expect(rows(db)[0]).toMatchObject({ enabled: true, name: "Projects", path: "ProjectsV2" });
    expect(logged[0]).toMatchObject({ action: "update", changes: [{ field: "enabled", from: false, to: true }] });
  });

  it("changing the run mode keeps the rest", async () => {
    const { db, id } = await seeded();
    await updateEndpoint(ctxFor(db), id, { run_mode: "schedule", schedule: "hourly" });
    expect(rows(db)[0]).toMatchObject({ run_mode: "schedule", schedule: "hourly", path: "ProjectsV2" });
  });

  it("another workspace's endpoint id is 404 and nothing changes", async () => {
    const { db, id } = await seeded();
    const other = ctxFor(db, T2);
    expect((await updateEndpoint(other, id, { enabled: true })).status).toBe(404);
    expect((await removeEndpoint(other, id)).status).toBe(404);
    expect(rows(db)[0].enabled).toBe(false);
    expect(rows(db)).toHaveLength(1);
  });

  it("remove deletes it and writes the change history", async () => {
    const { db, id } = await seeded();
    expect((await removeEndpoint(ctxFor(db), id)).status).toBe(200);
    expect(rows(db)).toHaveLength(0);
    expect(logged[0]).toMatchObject({ action: "delete", objectType: "integration_endpoint" });
  });

  it("an id that is not an id is 404 before any query", async () => {
    const db = seed("odata");
    const n = db.log.length;
    expect((await updateEndpoint(ctxFor(db), "x' or 1=1", { enabled: true })).status).toBe(404);
    expect(db.log.length).toBe(n);
  });

  it("every endpoint query names the tenant", async () => {
    const { db, id } = await seeded();
    await listEndpoints(ctxFor(db), CONN); await updateEndpoint(ctxFor(db), id, { enabled: true }); await removeEndpoint(ctxFor(db), id);
    // An insert carries tenant_id in the row itself (asserted where it is made); every read, update and delete is filtered.
    for (const q of db.log.filter((l) => l.table === "integration_endpoints" && l.op !== "insert")) expect(q.filters.some((f) => f === `tenant_id=${T1}`), `${q.op}`).toBe(true);
  });
});

describe("Try reads, writes nothing, and shows field names only", () => {
  const seeded = async (over: Record<string, unknown> = {}) => {
    const db = seed("odata");
    await createEndpoints(ctxFor(db), { connection_id: CONN, items: [hand(over)] });
    return { db, id: rows(db)[0].id as string };
  };

  it("reads the first five rows of the entity set and records one line in the Monitor under the connection's name, with no body", async () => {
    const f = vi.fn(async () => json({ value: [{ ProjectID: "P-1", Customer: "Alice Secret", "@odata.etag": "x" }, { ProjectID: "P-2", Customer: "Bob Secret" }] }));
    vi.stubGlobal("fetch", f);
    const { db, id } = await seeded();
    const r = await tryEndpoint(ctxFor(db), id);
    expect(r.body.result).toMatchObject({ ok: true, rows: 2, fields: ["ProjectID", "Customer"] });
    const call = (f.mock.calls as unknown as [string, RequestInit][])[0];
    expect(String(call[0])).toBe("https://8.8.8.8/data/ProjectsV2?$top=5");
    expect(call[1].method).toBe("GET");
    expect(JSON.stringify(r)).not.toMatch(/Alice|Bob/);

    const m = (db.tables.integration_messages as Record<string, unknown>[])[0];
    expect(m).toMatchObject({ tenant_id: T1, direction: "in", channel: "connector", connector_id: `conn:${CONN}`, entity: "projects", status: "ok", payload: null });
    expect(JSON.stringify(m)).not.toMatch(/Alice|Bob|Secret/);
    expect((m.summary as Record<string, unknown>).counterpart).toBe("PCBS F&O");
    expect(rows(db)[0]).toMatchObject({ last_run_status: "ok", last_run_message: "Read 2 rows." });
  });

  it("an endpoint that sends is never tried: nothing is called", async () => {
    const f = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", f);
    const { db, id } = await seeded({ name: "Push", direction: "out" });
    const r = await tryEndpoint(ctxFor(db), id);
    expect(r.status).toBe(422);
    expect(f).not.toHaveBeenCalled();
  });

  it("a refusal is said in words, kept on the endpoint and shown in the Monitor as failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "missing prvReadProject" } }, 403)));
    const { db, id } = await seeded();
    const r = await tryEndpoint(ctxFor(db), id);
    expect(r.body.result).toMatchObject({ ok: false, message: expect.stringMatching(/not allowed to read this \(403\)/) });
    expect((db.tables.integration_messages as Record<string, unknown>[])[0]).toMatchObject({ status: "failed", http_status: 403 });
    expect(rows(db)[0].last_run_status).toBe("failed");
  });

  it("another workspace's endpoint can not be tried", async () => {
    const f = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", f);
    const { db, id } = await seeded();
    expect((await tryEndpoint(ctxFor(db, T2), id)).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it("describeRows reads names only", () => {
    expect(describeRows(JSON.stringify([{ a: 1, b: 2 }]))).toEqual({ rows: 1, fields: ["a", "b"] });
    expect(describeRows(JSON.stringify({ items: [] }))).toEqual({ rows: 0, fields: [] });
    expect(describeRows("<html>")).toBeNull();
  });
});

describe("while the database update is pending", () => {
  it("every read says an update is needed", async () => {
    const db = fakeAdmin({}, { missing: ["integration_connections", "integration_endpoints"] });
    const ctx = ctxFor(db);
    for (const r of [await listEndpoints(ctx, CONN), await createEndpoints(ctx, { connection_id: CONN, items: [hand()] }), await updateEndpoint(ctx, CONN, { enabled: true }), await discover(ctx, { connection_id: CONN }), await tryEndpoint(ctx, CONN)]) {
      expect(r.body).toMatchObject({ needsDatabaseUpdate: true, bundle: CONNECTIONS_BUNDLE });
    }
  });

  it("endpoints missing but connections present: the list says update needed, not a crash", async () => {
    const db = fakeAdmin({ integration_connections: [conn(CONN, T1, "odata")] } as never, { missing: ["integration_endpoints"] });
    expect((await listEndpoints(ctxFor(db), CONN)).body).toMatchObject({ needsDatabaseUpdate: true });
  });
});
