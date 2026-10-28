import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

// The employee path of the Add flow (Settings > People with an employee, and the employee record's "Create business user")
// and the person panel's Lock / Reset password / Validity. Pinned: the role the admin picked is honoured, a new account made
// with a password must change it at first sign-in and an existing one is never forced, and each change is in the history.

let db: ReturnType<typeof fakeDb>;
const state = { isNew: true, userId: "u-new", passwords: [] as { id: string; password?: string }[] };
const logged: Record<string, unknown>[] = [];

const admin = () => ({
  from: (t: string) => {
    // The fake has no .or(); the link update only uses it to re-assert "still unlinked", which this test seeds directly.
    const q = db.client.from(t) as unknown as { or?: () => unknown };
    q.or ??= function (this: unknown) { return this; };
    return q;
  },
  auth: {
    admin: {
      getUserById: async (id: string) => ({ data: { user: { email: id === "u-target" ? "asha@acme.com" : "new@acme.com" } } }),
      updateUserById: async (id: string, attrs: { password?: string }) => { state.passwords.push({ id, password: attrs.password }); return { error: null }; },
    },
  },
});

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: db.client, tenantId: "t1", userId: "u-admin", role: "admin" }),
  createAdminSupabase: () => admin(),
  getAuthUser: async () => ({ id: "u-admin", email: "boss@acme.com" }),
  findOrCreateUserForInvite: async () => ({ userId: state.userId, isNew: state.isNew }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true }));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: Record<string, unknown>) => { logged.push(e); } };
});

const users = await import("./route");
const one = await import("./[userId]/route");

const req = (body: unknown, method = "POST") => new Request("http://x", { method, body: JSON.stringify(body) }) as never;
const tu = () => db.tables.tenant_users;
const employee = (over: Row = {}): Row => ({ id: "e1", tenant_id: "t1", first_name: "Asha", last_name: "Rao", email: "asha@acme.com", valid_from: "2026-01-05", valid_to: null, wfm_role: null, ...over });
const seed = (employees: Row[] = [employee()], members: Row[] = []) => {
  db = fakeDb({ employees, tenant_users: members, tenants: [{ id: "t1", name: "Acme", custom_domain: null }], business_roles: [] }, { copyReads: true });
};
const create = (body: Row = {}) => users.POST(req({ employee_id: "e1", email: "new@acme.com", password: "fixture-pass-1", ...body }));
const created = () => tu().find((r) => r.user_id === "u-new");

beforeEach(() => { state.isNew = true; state.userId = "u-new"; state.passwords = []; logged.length = 0; seed(); });

describe("POST /api/business-users: the role", () => {
  it("honours the role picked, Admin or Member", async () => {
    expect((await create({ role: "admin" })).status).toBe(201);
    expect(created()).toMatchObject({ role: "admin", tenant_id: "t1", employee_id: "e1" });
    seed();
    await create({ role: "member" });
    expect(created()?.role).toBe("member");
  });

  it("a picked Member stays a Member even for a Workforce supervisor", async () => {
    seed([employee({ wfm_role: "supervisor" })]);
    await create({ role: "member" });
    expect(created()?.role).toBe("member");
  });

  it("keeps the old default when no role is sent: Admin for a supervisor, Member otherwise", async () => {
    seed([employee({ wfm_role: "supervisor" })]);
    await create();
    expect(created()?.role).toBe("admin");
    seed();
    await create();
    expect(created()?.role).toBe("member");
  });

  it("ignores a role that is not on the allow-list", async () => {
    await create({ role: "owner" });
    expect(created()?.role).toBe("member");
  });
});

describe("POST /api/business-users: first sign-in", () => {
  it("a new account made with the password must change it", async () => {
    await create();
    expect(created()).toMatchObject({ must_change_password: true, display_name: "Asha Rao", valid_from: "2026-01-05" });
    expect((await (await create({ email: "x@acme.com" })).json()).error).toMatch(/already has a business user/);
  });

  it("an account that already existed elsewhere is linked and not forced", async () => {
    state.isNew = false;
    const res = await create();
    expect(await res.json()).toMatchObject({ ok: true, passwordSet: false });
    expect(created()).toMatchObject({ must_change_password: false });
  });

  it("linking an existing plain membership keeps the flag it already has", async () => {
    state.isNew = false; state.userId = "u-old";
    seed([employee()], [{ id: "m9", tenant_id: "t1", user_id: "u-old", role: "member", employee_id: null, must_change_password: true }]);
    const res = await create();
    expect(await res.json()).toMatchObject({ linkedExisting: true });
    expect(tu()[0]).toMatchObject({ employee_id: "e1", display_name: "Asha Rao", must_change_password: true });
  });

  it("needs the employee in this workspace and a password of 8 characters", async () => {
    seed([employee({ tenant_id: "t2" })]);
    expect((await create()).status).toBe(404);
    seed();
    expect((await create({ password: "short" })).status).toBe(400);
    expect(tu()).toHaveLength(0);
  });
});

describe("POST /api/business-users: history", () => {
  it("logs the login as created with the actor, role, employee and validity, never the password", async () => {
    await create({ role: "admin" });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ tenantId: "t1", objectType: "tenant_users", objectId: "u-new", objectLabel: "new@acme.com", action: "create", actorId: "u-admin", actorEmail: "boss@acme.com" });
    const fields = (logged[0].changes as { field: string; to: unknown }[]).map((c) => [c.field, c.to]);
    expect(fields).toEqual(expect.arrayContaining([["role", "admin"], ["employee", "Asha Rao"], ["valid from", "2026-01-05"], ["sign-in", "initial password, changed at first sign-in"]]));
    expect(JSON.stringify(logged)).not.toContain("fixture-pass-1");
  });
});

describe("PATCH /api/business-users/[userId]", () => {
  const login = (over: Row = {}): Row => ({ id: "m1", tenant_id: "t1", user_id: "u-target", role: "member", is_locked: false, valid_from: null, valid_to: null, employee_id: "e1", display_name: "Asha Rao", counted: true, ...over });
  const patch = (body: Row) => one.PATCH(req(body, "PATCH"), { params: Promise.resolve({ userId: "u-target" }) });
  beforeEach(() => { seed([employee()], [login()]); });

  it("Lock is logged as locked, and Unlock as unlocked, with the actor", async () => {
    await patch({ is_locked: true });
    expect(tu()[0].is_locked).toBe(true);
    expect(logged[0]).toMatchObject({ objectType: "tenant_users", objectId: "u-target", objectLabel: "asha@acme.com", action: "update", actorId: "u-admin", changes: [{ field: "locked", from: false, to: true }] });
    await patch({ is_locked: false });
    expect(logged[1].changes).toEqual([{ field: "locked", from: true, to: false }]);
  });

  it("a validity change is logged by field, and saving the same dates logs nothing", async () => {
    await patch({ valid_from: "2026-02-01", valid_to: "2026-12-31" });
    expect(logged[0].changes).toEqual([{ field: "valid from", from: null, to: "2026-02-01" }, { field: "valid to", from: null, to: "2026-12-31" }]);
    logged.length = 0;
    await patch({ valid_from: "2026-02-01", valid_to: "2026-12-31" });
    expect(logged).toHaveLength(0);
  });

  it("the seat and the display name are logged too", async () => {
    await patch({ counted: false, display_name: "A. Rao" });
    expect(logged[0].changes).toEqual(expect.arrayContaining([{ field: "counted user", from: true, to: false }, { field: "display name", from: "Asha Rao", to: "A. Rao" }]));
  });

  it("a password reset forces a change at next sign-in and is logged as an event, never the value", async () => {
    const res = await patch({ new_password: "fixture-pass-2" });
    expect(res.status).toBe(200);
    expect(state.passwords).toEqual([{ id: "u-target", password: "fixture-pass-2" }]);
    expect(tu()[0].must_change_password).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: "update", actorId: "u-admin", changes: [{ field: "password", from: null, to: "reset: changes at next sign-in" }] });
    expect(JSON.stringify(logged)).not.toContain("fixture-pass-2");
  });

  it("a short password is refused before anything is written or logged", async () => {
    expect((await patch({ new_password: "short" })).status).toBe(400);
    expect(state.passwords).toEqual([]);
    expect(logged).toHaveLength(0);
  });

  it("linking an employee logs the employee by name", async () => {
    seed([employee()], [login({ employee_id: null, display_name: null })]);
    await patch({ employee_id: "e1" });
    expect(logged[0].changes).toEqual(expect.arrayContaining([{ field: "employee", from: null, to: "Asha Rao" }]));
  });
});
