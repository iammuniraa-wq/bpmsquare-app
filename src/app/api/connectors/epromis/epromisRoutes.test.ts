import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";

// The ePROMIS routes start at epromisGuard(): a signed-in ADMIN of this host's workspace, in a workspace with the tender
// module, the tenant from the session only. A refused guard must reach neither the connector code nor the database.

vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string | null) => v,
  decrypt: (v: string | null) => v,
  sealSecret: (v: string | null | undefined) => (v ? `enc:${v}` : undefined),
  unsealSecret: (v: string | null | undefined) => (v ? v.replace(/^enc:/, "") : undefined),
}));

const auth = vi.hoisted(() => ({
  user: { role: "admin" as string, tenantId: "t-1", userId: "u-1", throws: null as null | { status: number; message: string } },
  feature: true,
  db: null as unknown,
  handle: null as null | { tables: Record<string, Record<string, unknown>[]> },
  adminCalls: 0,
}));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => {
    if (auth.user.throws) throw auth.user.throws;
    return { supabase: auth.db, tenantId: auth.user.tenantId, userId: auth.user.userId, role: auth.user.role };
  },
  createAdminSupabase: () => { auth.adminCalls++; return auth.db; },
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => auth.feature }));

import { fakeAdmin } from "@/lib/middleware/testHarness";
import { FAKE_ENDPOINTS } from "@/lib/connectors/epromis/fakeEpromis";

const SECRET = "sk-live-route-0123456789";
const row = (tenant = "t-1") => ({
  tenant_id: tenant, connector_id: "epromis", status: "connected", last_error: null,
  config: { base_url: "https://8.8.8.8/api", auth_type: "api_key", key_header: "X-Api-Key", username: "", company_name: "", company_value: "", company_in: "header", endpoints: FAKE_ENDPOINTS },
  credentials: { secret: `enc:${SECRET}` }, connected_at: "2026-10-25T00:00:00Z",
});
// Makes the in-memory database the routes see and keeps its handle, so a test can read the stored rows directly.
const seedDb = (rows: unknown[] = [row()], features: Record<string, boolean> = { gcc_tender: true }) => {
  const h = fakeAdmin({ tenant_connectors: rows as Record<string, unknown>[], tenants: [{ id: "t-1", features }] });
  auth.db = h.client;
  auth.handle = h;
  return h;
};

const body = { config: { base_url: "https://8.8.8.8/api", auth_type: "api_key", key_header: "X-Api-Key" }, secrets: { secret: "k-new-123456" } };
const req = (method: string, json?: unknown) => new NextRequest("http://localhost/api/connectors/epromis", { method, ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { "content-type": "application/json" } }) });

const calls = (): [string, () => Promise<Response>][] => [
  ["GET", async () => (await import("./route")).GET()],
  ["PUT", async () => (await import("./route")).PUT(req("PUT", body))],
  ["DELETE", async () => (await import("./route")).DELETE()],
  ["POST test", async () => (await import("./test/route")).POST()],
];

beforeEach(() => {
  auth.user = { role: "admin", tenantId: "t-1", userId: "u-1", throws: null };
  auth.feature = true;
  auth.adminCalls = 0;
  seedDb();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("only a workspace admin, in a workspace with the tender module, reaches the connector", () => {
  it.each(["member", "viewer", "manager"])("a %s is refused 403 on every route and nothing is read or written", async (role) => {
    auth.user.role = role;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const db = seedDb();
    for (const [name, call] of calls()) {
      const res = await call();
      expect(res.status, name).toBe(403);
      expect(JSON.stringify(await res.json()), name).not.toContain(SECRET);
    }
    expect(auth.adminCalls).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(db.tables.tenant_connectors).toEqual([expect.objectContaining({ credentials: { secret: `enc:${SECRET}` } })]);
  });

  it("someone not signed in is refused with the auth status", async () => {
    auth.user.throws = { status: 401, message: "Unauthorized" };
    for (const [name, call] of calls()) expect((await call()).status, name).toBe(401);
  });

  it("a workspace without the tender module gets 404, as if the connector did not exist", async () => {
    auth.feature = false;
    for (const [name, call] of calls()) expect((await call()).status, name).toBe(404);
  });

  it("has no POST: the generic connect route can not create an unconfigured ePROMIS row through it", async () => {
    const mod = await import("./route");
    expect(Object.keys(mod).sort()).toEqual(["DELETE", "GET", "PUT"]);
  });
});

describe("what the admin gets back", () => {
  it("GET says a credential is stored and never what it is", async () => {
    const res = await (await import("./route")).GET();
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"secret_stored":true');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("enc:");
    expect(text).not.toContain("credentials");
  });

  it("PUT saves for the session's tenant whatever the body claims, seals the credential and returns no secret", async () => {
    const db = seedDb([]);
    const res = await (await import("./route")).PUT(req("PUT", { ...body, tenant_id: "t-evil", config: { ...body.config, tenant_id: "t-evil" } }));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("k-new-123456");
    const rows = db.tables.tenant_connectors as { tenant_id: string; credentials: { secret: string } }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe("t-1");
    expect(rows[0].credentials.secret).toBe("enc:k-new-123456");
  });

  it("PUT answers a bad address with 422 and the reason", async () => {
    const res = await (await import("./route")).PUT(req("PUT", { ...body, config: { ...body.config, base_url: "https://10.0.0.5" } }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/private or internal network/);
  });

  it("DELETE removes this workspace's connection", async () => {
    const db = seedDb([row(), row("t-2")]);
    expect((await (await import("./route")).DELETE()).status).toBe(200);
    const rows = db.tables.tenant_connectors as { tenant_id: string }[];
    expect(rows.map((r) => r.tenant_id)).toEqual(["t-2"]);
  });

  it("the test route answers in words and a failing page that echoes the credential does not reach the response", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: `bad key ${SECRET}` }), { status: 401 }));
    vi.stubGlobal("fetch", f);
    const res = await (await import("./test/route")).POST();
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/refused the sign-in \(401\)/);
    expect(text).not.toContain(SECRET);
    const stored = auth.handle!.tables.tenant_connectors.find((r) => r.tenant_id === "t-1") as { status: string; last_error: string };
    expect(stored.status).toBe("error");
    expect(stored.last_error).not.toContain(SECRET);
  });
});

describe("the generic connectors list", () => {
  const list = async () => (await import("../route")).GET();

  it("an admin of a workspace with the tender module sees the ePROMIS tile and its configuration", async () => {
    const json = await (await list()).json();
    expect(json.catalog.map((d: { id: string }) => d.id)).toContain("epromis");
    expect(json.connected.find((c: { connector_id: string }) => c.connector_id === "epromis").config.base_url).toBe("https://8.8.8.8/api");
    // The in-memory client ignores column lists, so the guarantee is checked where it lives: the select never names credentials.
    expect(readFileSync(resolve(__dirname, "../../../../lib/connectors/server.ts"), "utf8").match(/export async function listTenantConnectors[\s\S]*?\.eq\(/)?.[0]).not.toContain("credentials");
  });

  it("a member sees that it is connected but not what it points at", async () => {
    auth.user.role = "member";
    const json = await (await list()).json();
    const c = json.connected.find((x: { connector_id: string }) => x.connector_id === "epromis");
    expect(c.status).toBe("connected");
    expect(c.config).toEqual({});
    expect(JSON.stringify(json)).not.toContain("8.8.8.8");
    expect(JSON.stringify(json)).not.toContain("endpoints");
  });

  it("a workspace without the tender module sees no ePROMIS tile and no ePROMIS row, and every other tile as before", async () => {
    seedDb([row()], { accounts: true });
    const json = await (await list()).json();
    expect(json.catalog.map((d: { id: string }) => d.id)).toEqual(["slack", "google_calendar", "gmail", "mail_server", "dynamics365"]);
    expect(json.connected).toEqual([]);
  });
});
