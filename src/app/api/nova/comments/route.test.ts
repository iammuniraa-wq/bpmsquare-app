import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserted: [] as Row[],
  caller: { tenantId: "t1", userId: "u1", role: "member" as "admin" | "member", email: "me@x.com" },
  viewable: "all" as "all" | string[],
  users: [] as { id: string; email: string }[],
}));

function table(name: string) {
  const filters: [string, unknown][] = [];
  let pendingInsert: Row | null = null;
  const b: Record<string, unknown> = {};
  const rows = () => (state.tables[name] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
  Object.assign(b, {
    select: () => b,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    order: () => b, limit: () => b,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: (row: Row) => { pendingInsert = row; state.inserted.push({ __table: name, ...row }); return b; },
    single: async () => ({ data: pendingInsert ? { id: "c1", ...pendingInsert } : rows()[0] ?? null, error: null }),
    then: (resolve: (r: unknown) => void) => resolve({ data: rows(), error: null }),
  });
  return b;
}
const admin = {
  from: (name: string) => table(name),
  auth: { admin: { listUsers: async () => ({ data: { users: state.users }, error: null }) } },
};

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => admin,
  getAuthUser: async () => ({ id: state.caller.userId, email: state.caller.email }),
  requireTenantUser: async () => ({
    tenantId: state.caller.tenantId, userId: state.caller.userId, role: state.caller.role,
    // The session client must never be used to write comments.
    supabase: { from: () => { throw new Error("session client used"); } },
  }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasNovaSurfaces: async () => true }));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: state.viewable === "all", grants: new Map() }),
  canViewWorkcenter: (perms: { unrestricted: boolean }, w: string) =>
    perms.unrestricted || (Array.isArray(state.viewable) && state.viewable.includes(w)),
}));

import { GET, POST } from "./route";

const A1 = "11111111-1111-1111-1111-111111111111";
const B1 = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  state.inserted = [];
  state.caller = { tenantId: "t1", userId: "u1", role: "member", email: "me@x.com" };
  state.viewable = "all";
  state.users = [
    { id: "u1", email: "me@x.com" }, { id: "u2", email: "colleague@x.com" }, { id: "u9", email: "stranger@other.com" },
  ];
  state.tables = {
    tenants: [{ id: "t1", features: { accounts: true, pipeline: true, quotations: false } }],
    accounts: [{ id: A1, tenant_id: "t1" }, { id: B1, tenant_id: "t2" }],
    opportunities: [{ id: A1, tenant_id: "t1" }],
    quotes: [{ id: A1, tenant_id: "t1" }],
    tenant_users: [{ tenant_id: "t1", user_id: "u1" }, { tenant_id: "t1", user_id: "u2" }, { tenant_id: "t2", user_id: "u9" }],
    record_comments: [{ id: "k1", tenant_id: "t1", object_type: "accounts", object_id: A1, author_email: "u@x.com", body: "hi", mentions: [], created_at: "2026-10-23" }],
  };
});

const get = (type: string, id: string) =>
  GET(new Request(`http://x/api/nova/comments?object_type=${type}&object_id=${id}`) as never);
const post = (payload: Record<string, unknown>) =>
  POST(new Request("http://x/api/nova/comments", { method: "POST", body: JSON.stringify(payload) }) as never);

describe("GET /api/nova/comments", () => {
  it("returns comments for a record in the caller's tenant", async () => {
    const res = await get("accounts", A1);
    expect(res.status).toBe(200);
    expect((await res.json()).comments).toHaveLength(1);
  });

  it("404s a record id that belongs to another tenant", async () => {
    expect((await get("accounts", B1)).status).toBe(404);
  });

  it("404s when the workspace does not own the object's module", async () => {
    expect((await get("quotes", A1)).status).toBe(404);
  });

  it("404s when the caller's Business Roles do not grant the object's workcenter", async () => {
    state.viewable = ["accounts"];
    expect((await get("opportunities", A1)).status).toBe(404);
    expect((await get("accounts", A1)).status).toBe(200);
  });

  it("lets a role with the pipeline grant read deal comments", async () => {
    state.viewable = ["pipeline"];
    expect((await get("opportunities", A1)).status).toBe(200);
  });
});

describe("POST /api/nova/comments", () => {
  it("ignores a forged author, forged mentions and a forged tenant in the body", async () => {
    const res = await post({
      object_type: "accounts", object_id: A1, body: "plain note",
      author_email: "boss@x.com", author_id: "u2", mentions: ["stranger@other.com"], tenant_id: "t2",
    });
    expect(res.status).toBe(201);
    const row = state.inserted[0];
    expect(row).toMatchObject({ __table: "record_comments", tenant_id: "t1", author_id: "u1", author_email: "me@x.com", mentions: [] });
  });

  it("keeps only @mentions that are members of this workspace", async () => {
    const res = await post({ object_type: "accounts", object_id: A1, body: "ping @colleague@x.com and @stranger@other.com and @nobody@x.com" });
    expect(res.status).toBe(201);
    expect(state.inserted[0].mentions).toEqual(["colleague@x.com"]);
  });

  it("404s and writes nothing for another tenant's record", async () => {
    expect((await post({ object_type: "accounts", object_id: B1, body: "x" })).status).toBe(404);
    expect(state.inserted).toHaveLength(0);
  });

  it("404s and writes nothing when the workcenter is denied or the module is not owned", async () => {
    state.viewable = ["accounts"];
    expect((await post({ object_type: "opportunities", object_id: A1, body: "x" })).status).toBe(404);
    state.viewable = "all";
    expect((await post({ object_type: "quotes", object_id: A1, body: "x" })).status).toBe(404);
    expect(state.inserted).toHaveLength(0);
  });
});
