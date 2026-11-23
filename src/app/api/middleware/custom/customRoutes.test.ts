import { beforeEach, describe, expect, it, vi } from "vitest";

// The routes of custom connections and endpoints, through the real guard: a member is refused, a workspace without the module
// is 404, and an admin reaches the operations with the session's tenant. The operations themselves are tested beside their code.

const state = vi.hoisted(() => ({
  user: { role: "admin", tenantId: "tenant-1" } as { role: string; tenantId: string; error?: { status: number; message: string } },
  flag: true,
  calls: [] as string[],
}));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => {
    if (state.user.error) throw state.user.error;
    return { role: state.user.role, tenantId: state.user.tenantId, userId: "u-1", supabase: {} };
  },
  createAdminSupabase: () => ({ tag: "admin" }),
}));
vi.mock("@/lib/middleware/ops", () => ({ flagOn: async () => state.flag }));
vi.mock("@/lib/connections/ops", () => {
  const record = (name: string) => async (ctx: { tenantId: string }) => { state.calls.push(`${name}:${ctx.tenantId}`); return { status: 200, body: { ok: true } }; };
  return { list: record("list"), create: record("create"), get: record("get"), update: record("update"), remove: record("remove"), testSaved: record("testSaved"), testDraft: record("testDraft") };
});

vi.mock("@/lib/connections/endpointOps", () => {
  const record = (name: string) => async (ctx: { tenantId: string }) => { state.calls.push(`${name}:${ctx.tenantId}`); return { status: 200, body: { ok: true } }; };
  return {
    listEndpoints: record("listEndpoints"), createEndpoints: record("createEndpoints"), updateEndpoint: record("updateEndpoint"), removeEndpoint: record("removeEndpoint"),
    discover: record("discover"), tryEndpoint: record("tryEndpoint"), templates: () => { state.calls.push("templates:tenant-1"); return { status: 200, body: { templates: [] } }; },
  };
});

import { NextRequest } from "next/server";
import * as connections from "./connections/route";
import * as connection from "./connections/[id]/route";
import * as connectionTest from "./connections/[id]/test/route";
import * as draftTest from "./connections/test/route";
import * as endpoints from "./endpoints/route";
import * as endpoint from "./endpoints/[id]/route";
import * as endpointTry from "./endpoints/[id]/try/route";
import * as discover from "./endpoints/discover/route";
import * as templates from "./endpoints/templates/route";

const id = { params: Promise.resolve({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }) };
const req = (method = "POST") => new Request("https://acme.example.com/api/x", { method, headers: { "content-type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });

const handlers: [string, () => Promise<Response>][] = [
  ["GET connections", () => connections.GET()],
  ["POST connections", () => connections.POST(req() as never)],
  ["GET connection", () => connection.GET(req("GET"), id)],
  ["PUT connection", () => connection.PUT(req("PUT") as never, id)],
  ["DELETE connection", () => connection.DELETE(req("DELETE"), id)],
  ["POST connection test", () => connectionTest.POST(req(), id)],
  ["POST draft test", () => draftTest.POST(req() as never)],
  ["GET endpoints", () => endpoints.GET(new NextRequest("https://acme.example.com/api/x?connection_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))],
  ["POST endpoints", () => endpoints.POST(req() as never)],
  ["PUT endpoint", () => endpoint.PUT(req("PUT") as never, id)],
  ["DELETE endpoint", () => endpoint.DELETE(req("DELETE"), id)],
  ["POST endpoint try", () => endpointTry.POST(req(), id)],
  ["POST discover", () => discover.POST(req() as never)],
  ["GET templates", () => templates.GET(req("GET"))],
];

beforeEach(() => { state.user = { role: "admin", tenantId: "tenant-1" }; state.flag = true; state.calls.length = 0; });

describe("every custom connection and endpoint route starts with the guard", () => {
  it.each(handlers)("%s: a member is refused (403) before anything runs", async (_n, run) => {
    state.user = { role: "member", tenantId: "tenant-1" };
    expect((await run()).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it.each(handlers)("%s: signed out is the session's own refusal", async (_n, run) => {
    state.user = { role: "admin", tenantId: "t", error: { status: 401, message: "Unauthorized" } };
    expect((await run()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it.each(handlers)("%s: a workspace without the middleware module is 404", async (_n, run) => {
    state.flag = false;
    expect((await run()).status).toBe(404);
    expect(state.calls).toEqual([]);
  });

  it.each(handlers)("%s: an admin reaches the operation with the SESSION's tenant", async (_n, run) => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].endsWith(":tenant-1")).toBe(true);
  });
});
