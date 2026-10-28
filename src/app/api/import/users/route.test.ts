import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";

// Data Workbench > Users creates logins with a generated temporary password. Each new account must change it at first sign-in;
// an account that already existed elsewhere is linked and keeps its own password.

let db: ReturnType<typeof fakeDb>;
const state = { existing: new Map<string, string>(), made: [] as { email: string; password: string }[] };
const batches: Record<string, unknown>[][] = [];

const admin = () => ({
  from: (t: string) => db.client.from(t),
  auth: {
    admin: {
      listUsers: async () => ({ data: { users: [...state.existing].map(([email, id]) => ({ id, email })) }, error: null }),
      createUser: async (a: { email: string; password: string }) => {
        state.made.push({ email: a.email, password: a.password });
        return { data: { user: { id: `new-${state.made.length}` } }, error: null };
      },
    },
  },
});

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ tenantId: "t1", role: "admin" }),
  createAdminSupabase: () => admin(),
  getAuthUser: async () => ({ id: "u-admin", email: "boss@acme.com" }),
}));
vi.mock("@/lib/objectFeatures", () => ({ assertObjectFeature: async () => null }));
vi.mock("@/lib/standardRolesServer", () => ({ provisionStandardRoles: async () => undefined }));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChangeBatch: async (_s: unknown, rows: Record<string, unknown>[]) => { batches.push(rows); } };
});

const { POST } = await import("./route");

const post = (rows: { name: string; email: string; role: string }[]) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify({ rows: rows.map((values, i) => ({ rowNum: i + 2, values })) }) }) as never);

beforeEach(() => {
  state.existing = new Map(); state.made = []; batches.length = 0;
  db = fakeDb({ tenant_users: [], business_roles: [], employees: [] });
});

describe("POST /api/import/users", () => {
  it("a new account created with the temporary password must change it at first sign-in", async () => {
    const res = await post([{ name: "Asha Rao", email: "asha@acme.com", role: "member" }]);
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.credentials).toHaveLength(1);
    expect(db.tables.tenant_users[0]).toMatchObject({ tenant_id: "t1", user_id: "new-1", role: "member", must_change_password: true });
  });

  it("an account that already existed elsewhere is linked and not forced", async () => {
    state.existing.set("ben@acme.com", "u-ben");
    const res = await post([{ name: "Ben", email: "ben@acme.com", role: "admin" }]);
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.credentials).toEqual([]);
    expect(state.made).toEqual([]);
    expect(db.tables.tenant_users[0]).toMatchObject({ user_id: "u-ben", role: "admin", must_change_password: false });
  });

  it("forces only the rows it created when a file mixes both", async () => {
    state.existing.set("ben@acme.com", "u-ben");
    await post([{ name: "Asha", email: "asha@acme.com", role: "member" }, { name: "Ben", email: "ben@acme.com", role: "member" }]);
    expect(db.tables.tenant_users.map((r) => [r.user_id, r.must_change_password])).toEqual([["new-1", true], ["u-ben", false]]);
  });

  it("logs each login as created with the actor, never the temporary password", async () => {
    await post([{ name: "Asha", email: "asha@acme.com", role: "member" }]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([expect.objectContaining({ tenantId: "t1", objectType: "tenant_users", objectId: "new-1", objectLabel: "asha@acme.com", action: "create", actorId: "u-admin", actorEmail: "boss@acme.com" })]);
    expect(JSON.stringify(batches)).not.toContain(state.made[0].password);
  });
});
