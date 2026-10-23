import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  viewable: "all" as "all" | string[],
}));

function table(name: string) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, eq: chain, contains: chain, order: chain, limit: chain,
    maybeSingle: async () => ({ data: (state.tables[name] ?? [])[0] ?? null, error: null }),
    in: (_k: string, ids: string[]) => { (b as Record<string, unknown>).__ids = ids; return b; },
    then: (resolve: (r: unknown) => void) => {
      const ids = (b as { __ids?: string[] }).__ids;
      const rows = (state.tables[name] ?? []).filter((r) => !ids || ids.includes(r.id as string));
      return resolve({ data: rows, error: null });
    },
  });
  return b;
}

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (n: string) => table(n) }),
  getAuthUser: async () => ({ id: "u1", email: "me@x.com" }),
  requireTenantUser: async () => ({ tenantId: "t1", userId: "u1", role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasNovaSurfaces: async () => true }));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: state.viewable === "all", grants: new Map() }),
  canViewWorkcenter: (perms: { unrestricted: boolean }, w: string) =>
    perms.unrestricted || (Array.isArray(state.viewable) && state.viewable.includes(w)),
}));

import { GET } from "./route";

beforeEach(() => {
  state.viewable = "all";
  state.tables = {
    tenants: [{ id: "t1", features: { accounts: true, pipeline: true } }],
    record_comments: [
      { id: "c1", object_type: "accounts", object_id: "a1", author_email: "boss@x.com", body: "look", created_at: "2026-10-23" },
      { id: "c2", object_type: "opportunities", object_id: "o1", author_email: "boss@x.com", body: "deal secret", created_at: "2026-10-23" },
    ],
    nova_inbox_reads: [],
    accounts: [{ id: "a1", name: "Acme", ref: "ACC-1" }],
    opportunities: [{ id: "o1", title: "Big deal", ref: "OPP-1" }],
  };
});

describe("GET /api/nova/inbox", () => {
  it("lists mentions on every object the caller can see", async () => {
    const body = await (await GET()).json();
    expect(body.items.map((i: { id: string }) => i.id).sort()).toEqual(["c1", "c2"]);
  });

  it("hides a mention on an object whose workcenter the caller was not granted", async () => {
    state.viewable = ["accounts"];
    const body = await (await GET()).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["c1"]);
    expect(JSON.stringify(body)).not.toContain("deal secret");
  });

  it("hides a mention on an object whose module the workspace does not own", async () => {
    state.tables.tenants = [{ id: "t1", features: { accounts: true } }];
    const body = await (await GET()).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["c1"]);
  });
});
