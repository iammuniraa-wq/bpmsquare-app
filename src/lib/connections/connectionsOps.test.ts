import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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
import { create, get, list, remove, testDraft, testSaved, update } from "./ops";
import type { StoreCtx } from "./store";
import { CONNECTIONS_BUNDLE } from "./store";

const SECRET = "very-secret-client-secret-9876543210";
const ctxFor = (client: ReturnType<typeof fakeAdmin>["client"], tenantId = T1): StoreCtx => ({ supabase: client, admin: client, tenantId, userId: "u-1" });
const body = (over: Record<string, unknown> = {}) => ({
  name: "PCBS F&O", family: "odata",
  config: { base_url: "https://8.8.8.8/data", auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://8.8.8.8/token", client_id: "cid", scope: "https://x/.default" },
  secrets: { client_secret: SECRET }, ...over,
});
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { logged.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("connections: secrets stay on the server", () => {
  it("create seals the secret, and nothing that goes back to the screen holds it", async () => {
    const db = fakeAdmin({ integration_connections: [], integration_endpoints: [] });
    const created = await create(ctxFor(db.client), body());
    expect(created.status).toBe(200);
    const row = db.tables.integration_connections[0];
    expect((row.secrets as Record<string, string>).client_secret).toBe(`enc:${SECRET}`);
    expect(row.tenant_id).toBe(T1);

    const all = [created, await list(ctxFor(db.client)), await get(ctxFor(db.client), row.id as string)];
    for (const o of all) {
      const text = JSON.stringify(o);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("enc:");
      expect(text).not.toContain("token_cache");
    }
    const c = (all[1].body.connections as { secretsSet: Record<string, boolean>; status: string }[])[0];
    expect(c.secretsSet).toEqual({ client_secret: true });
    expect(c.status).toBe("untested");
  });

  it("the change history records what changed and never the secret", async () => {
    const db = fakeAdmin({ integration_connections: [] });
    await create(ctxFor(db.client), body());
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ objectType: "integration_connection", action: "create", tenantId: T1, actorId: "u-1" });
    expect(JSON.stringify(logged)).not.toContain(SECRET);
    expect(JSON.stringify(logged)).not.toContain("enc:");
    const entries = logged[0].changes as { field: string; to: unknown; redacted?: boolean }[];
    expect(entries.find((e) => e.field === "secret")).toMatchObject({ to: "replaced", redacted: true });
  });

  it("a blank secret on save means unchanged; a new one replaces it", async () => {
    const db = fakeAdmin({ integration_connections: [] });
    await create(ctxFor(db.client), body());
    const id = db.tables.integration_connections[0].id as string;
    const keep = await update(ctxFor(db.client), id, body({ name: "Renamed", secrets: {} }));
    expect(keep.status).toBe(200);
    expect((db.tables.integration_connections[0].secrets as Record<string, string>).client_secret).toBe(`enc:${SECRET}`);
    expect(db.tables.integration_connections[0].name).toBe("Renamed");
    await update(ctxFor(db.client), id, body({ secrets: { client_secret: "another-one" } }));
    expect((db.tables.integration_connections[0].secrets as Record<string, string>).client_secret).toBe("enc:another-one");
    expect(JSON.stringify(logged)).not.toContain("another-one");
  });

  it("editing clears the old token and the old test, so the chip does not claim what is no longer true", async () => {
    const db = fakeAdmin({ integration_connections: [] });
    await create(ctxFor(db.client), body());
    const id = db.tables.integration_connections[0].id as string;
    Object.assign(db.tables.integration_connections[0], { token_cache: "enc:{}", last_test_status: "ok", last_test_at: "2026-11-22T00:00:00Z", last_test_message: "Connected." });
    await update(ctxFor(db.client), id, body({ secrets: {} }));
    expect(db.tables.integration_connections[0]).toMatchObject({ token_cache: null, last_test_status: null, last_test_message: null });
  });

  it("a second connection with the same name is a 422 on the name", async () => {
    const db = fakeAdmin({ integration_connections: [] }, { failInsert: () => ({ message: "duplicate key", code: "23505" }) });
    const r = await create(ctxFor(db.client), body());
    expect(r.status).toBe(422);
    expect(r.body.errors).toEqual([{ field: "name", message: "A connection with that name already exists." }]);
  });

  it("an address on a private network is refused on save, with the reason, and nothing is stored", async () => {
    const db = fakeAdmin({ integration_connections: [] });
    const r = await create(ctxFor(db.client), body({ config: { base_url: "https://10.1.2.3/data", auth: "none" }, secrets: {} }));
    expect(r.status).toBe(422);
    expect(String(r.body.error)).toMatch(/private or internal network/);
    expect(db.tables.integration_connections).toHaveLength(0);
  });
});

describe("connections: one workspace never reaches another's", () => {
  const seed = () => fakeAdmin({
    integration_connections: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tenant_id: T2, name: "Theirs", family: "rest", config: { base_url: "https://8.8.8.8/x", auth: "bearer" }, secrets: { token: "enc:THEIR-TOKEN" }, last_test_status: null, last_test_at: null, last_test_message: null },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tenant_id: T1, name: "Mine", family: "rest", config: { base_url: "https://8.8.8.8/x", auth: "none" }, secrets: {}, last_test_status: null, last_test_at: null, last_test_message: null },
    ],
  });
  const THEIRS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("the list is only this workspace's", async () => {
    const db = seed();
    const r = await list(ctxFor(db.client));
    expect((r.body.connections as { name: string }[]).map((c) => c.name)).toEqual(["Mine"]);
  });

  it("get, update, delete and test of another workspace's id are all 404, and nothing is sent or changed", async () => {
    const f = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", f);
    const db = seed();
    const ctx = ctxFor(db.client);
    for (const r of [await get(ctx, THEIRS), await update(ctx, THEIRS, body()), await remove(ctx, THEIRS), await testSaved(ctx, THEIRS), await testDraft(ctx, { ...body(), id: THEIRS })]) {
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain("THEIR-TOKEN");
    }
    expect(f).not.toHaveBeenCalled();
    expect(db.tables.integration_connections).toHaveLength(2);
    expect(db.tables.integration_connections.find((c) => c.id === THEIRS)?.name).toBe("Theirs");
  });

  it("an id that is not an id is 404 before any query", async () => {
    const db = seed();
    const before = db.log.length;
    expect((await get(ctxFor(db.client), "not-an-id")).status).toBe(404);
    expect((await get(ctxFor(db.client), "x' or tenant_id is not null --")).status).toBe(404);
    expect(db.log.length).toBe(before);
  });

  it("every query this module makes names the tenant", async () => {
    const db = seed();
    const ctx = ctxFor(db.client);
    await list(ctx); await get(ctx, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); await update(ctx, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", body({ config: { base_url: "https://8.8.8.8/x", auth: "none" }, secrets: {}, family: "rest" })); await remove(ctx, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    for (const q of db.log.filter((l) => l.table.startsWith("integration_"))) expect(q.filters.some((f) => f === `tenant_id=${T1}`), `${q.table} ${q.op}`).toBe(true);
  });

  it("a foreign connection is not touched by a test that names it in a draft", async () => {
    const db = seed();
    const r = await testDraft(ctxFor(db.client), { ...body({ secrets: {} }), id: THEIRS });
    expect(r.status).toBe(404);
  });
});

describe("connections: the saved test, and the draft test", () => {
  it("a draft test uses the stored secret when the field is blank and stores nothing", async () => {
    const f = vi.fn(async (url: string | URL) => (String(url).endsWith("/token") ? json({ access_token: "A", expires_in: 3600 }) : json({ ok: 1 })));
    vi.stubGlobal("fetch", f);
    const db = fakeAdmin({ integration_connections: [] });
    await create(ctxFor(db.client), body({ family: "rest", config: { base_url: "https://8.8.8.8/data", auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://8.8.8.8/token", client_id: "cid" } }));
    const id = db.tables.integration_connections[0].id as string;
    const r = await testDraft(ctxFor(db.client), { ...body({ family: "rest", secrets: {}, config: { base_url: "https://8.8.8.8/data", auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://8.8.8.8/token", client_id: "cid" } }), id });
    expect((r.body.result as { ok: boolean }).ok).toBe(true);
    const tokenCall = (f.mock.calls as unknown as [string, RequestInit][]).find((c) => String(c[0]).endsWith("/token"))!;
    expect(String(tokenCall[1].body)).toContain(`client_secret=${SECRET}`);
    expect(db.tables.integration_connections[0].last_test_status ?? null).toBeNull();
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("a saved test keeps its result on the row, and the OAuth token is stored sealed", async () => {
    const f = vi.fn(async (url: string | URL) => (String(url).endsWith("/token") ? json({ access_token: "ACCESS-1", expires_in: 3600 }) : json({ ok: 1 })));
    vi.stubGlobal("fetch", f);
    const db = fakeAdmin({ integration_connections: [] });
    await create(ctxFor(db.client), body({ family: "rest", config: { base_url: "https://8.8.8.8/data", auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://8.8.8.8/token", client_id: "cid" } }));
    const id = db.tables.integration_connections[0].id as string;
    const r = await testSaved(ctxFor(db.client), id);
    expect((r.body.connection as { status: string }).status).toBe("ok");
    expect(db.tables.integration_connections[0]).toMatchObject({ last_test_status: "ok", last_test_message: "Connected." });
    expect(String(db.tables.integration_connections[0].token_cache)).toMatch(/^enc:/);
    expect(JSON.stringify(r)).not.toContain("ACCESS-1");
    await testSaved(ctxFor(db.client), id);
    expect((f.mock.calls as unknown as [string][]).filter((c) => String(c[0]).endsWith("/token"))).toHaveLength(1);
  });

  it("a failed saved test is kept in words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "x" }, 401)));
    const db = fakeAdmin({ integration_connections: [] });
    await create(ctxFor(db.client), body({ family: "rest", name: "Bearer one", config: { base_url: "https://8.8.8.8/data", auth: "bearer" }, secrets: { token: "T" } }));
    const id = db.tables.integration_connections[0].id as string;
    const r = await testSaved(ctxFor(db.client), id);
    expect((r.body.result as { ok: boolean; message: string }).ok).toBe(false);
    expect(db.tables.integration_connections[0]).toMatchObject({ last_test_status: "failed" });
    expect(String(db.tables.integration_connections[0].last_test_message)).toMatch(/refused the sign-in/);
  });
});

describe("connections: while the database update is pending", () => {
  it("every read says an update is needed instead of failing, and a save says so in words", async () => {
    const db = fakeAdmin({}, { missing: ["integration_connections", "integration_endpoints"] });
    const ctx = ctxFor(db.client);
    expect(await list(ctx)).toMatchObject({ status: 200, body: { needsDatabaseUpdate: true, bundle: CONNECTIONS_BUNDLE } });
    expect(await get(ctx, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toMatchObject({ body: { needsDatabaseUpdate: true } });
    expect(await testSaved(ctx, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toMatchObject({ body: { needsDatabaseUpdate: true } });
    const c = await create(ctx, body());
    expect(c.status).toBe(503);
    expect(String(c.body.error)).toMatch(/update is needed/);
  });
});

describe("connections: the existing connectors are untouched", () => {
  it("no query of this module reads or writes tenant_connectors, and an existing row stays exactly as it was", async () => {
    const existing = { tenant_id: T1, connector_id: "dynamics365", status: "connected", last_error: null, config: { product: "fo", environment_url: "https://x.operations.dynamics.com" }, credentials: { client_secret: "enc:x" } };
    const db = fakeAdmin({ tenant_connectors: [existing], integration_connections: [] });
    const ctx = ctxFor(db.client);
    await create(ctx, body());
    await list(ctx);
    const id = db.tables.integration_connections[0].id as string;
    await update(ctx, id, body({ secrets: {} }));
    await remove(ctx, id);
    expect(db.log.filter((l) => l.table === "tenant_connectors")).toEqual([]);
    expect(db.tables.tenant_connectors).toEqual([existing]);
  });
});
