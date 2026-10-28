import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

// Settings > People writes through these routes: the Add flow, the role change, Remove and the Business Roles tick list.
// Pinned here: a login made with a password must change it at first sign-in, an account that already existed elsewhere is
// linked and never forced, and every access change reaches the change history with the signed-in admin as the actor.

let db: ReturnType<typeof fakeDb>;
let role: "admin" | "member" = "admin";
const state = { isNew: true, userId: "u-new" };
const emails: Record<string, string> = { "u-target": "asha@acme.com", "u-new": "new@acme.com" };
const logged: Record<string, unknown>[] = [];

const admin = () => ({
  from: (t: string) => db.client.from(t),
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: emails[id] ?? null } } }) } },
});

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: db.client, tenantId: "t1", userId: "u-admin", role }),
  createAdminSupabase: () => admin(),
  getAuthUser: async () => ({ id: "u-admin", email: "boss@acme.com" }),
  findOrCreateUserForInvite: async () => ({ userId: state.userId, isNew: state.isNew }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true }));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: Record<string, unknown>) => { logged.push(e); } };
});

const team = await import("./route");
const member = await import("./[id]/route");
const roles = await import("./[id]/roles/route");

const json = (body: unknown, method = "POST") => new Request("http://x", { method, body: JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const tu = () => db.tables.tenant_users;
const seed = (extra: Record<string, Row[]> = {}) => {
  db = fakeDb({
    tenant_users: [{ id: "m1", tenant_id: "t1", user_id: "u-target", role: "member" }, { id: "m2", tenant_id: "t2", user_id: "u-target", role: "admin" }],
    tenants: [{ id: "t1", name: "Acme", custom_domain: null }],
    ...extra,
  }, { copyReads: true });
};

beforeEach(() => { role = "admin"; state.isNew = true; state.userId = "u-new"; logged.length = 0; seed(); });

describe("POST /api/settings/team", () => {
  it("a new account made with a password must change it at first sign-in, and the role chosen is kept", async () => {
    const res = await team.POST(json({ email: "New@Acme.com", password: "fixture-pass-1", role: "admin" }));
    expect(await res.json()).toMatchObject({ ok: true, passwordSet: true });
    expect(tu().find((r) => r.user_id === "u-new")).toMatchObject({ tenant_id: "t1", role: "admin", must_change_password: true });
  });

  it("an invite without a password forces nothing (the link lands on the set-password screen)", async () => {
    const res = await team.POST(json({ email: "new@acme.com", role: "member" }));
    expect(await res.json()).toMatchObject({ passwordSet: false });
    expect(tu().find((r) => r.user_id === "u-new")).toMatchObject({ role: "member", must_change_password: false });
  });

  it("an account that already existed keeps its own password: linked, not forced", async () => {
    state.isNew = false;
    const res = await team.POST(json({ email: "new@acme.com", password: "fixture-pass-1" }));
    expect(await res.json()).toMatchObject({ passwordSet: false });
    expect(tu().find((r) => r.user_id === "u-new")).toMatchObject({ must_change_password: false });
  });

  it("is admin only, and refuses someone already in this workspace", async () => {
    role = "member";
    expect((await team.POST(json({ email: "a@b.co" }))).status).toBe(403);
    role = "admin"; state.isNew = false; state.userId = "u-target";
    expect((await team.POST(json({ email: "asha@acme.com" }))).status).toBe(409);
  });

  it("logs the login as created, with the actor, the role and how they sign in, never the password", async () => {
    await team.POST(json({ email: "new@acme.com", password: "fixture-pass-1", role: "admin" }));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ tenantId: "t1", objectType: "tenant_users", objectId: "u-new", objectLabel: "new@acme.com", action: "create", actorId: "u-admin", actorEmail: "boss@acme.com" });
    expect(logged[0].changes).toEqual([
      { field: "role", from: null, to: "admin" },
      { field: "sign-in", from: null, to: "initial password, changed at first sign-in" },
    ]);
    expect(JSON.stringify(logged)).not.toContain("fixture-pass-1");
  });
});

describe("PATCH and DELETE /api/settings/team/[id]", () => {
  it("a role change is logged with before and after", async () => {
    const res = await member.PATCH(json({ role: "admin" }, "PATCH"), params("u-target"));
    expect(res.status).toBe(200);
    expect(tu().find((r) => r.id === "m1")?.role).toBe("admin");
    expect(tu().find((r) => r.id === "m2")?.role).toBe("admin");
    expect(logged).toEqual([expect.objectContaining({ objectId: "u-target", objectLabel: "asha@acme.com", action: "update", actorId: "u-admin", changes: [{ field: "role", from: "member", to: "admin" }] })]);
  });

  it("saving the same role writes no history, and another workspace's member is a 404", async () => {
    await member.PATCH(json({ role: "member" }, "PATCH"), params("u-target"));
    expect(logged).toHaveLength(0);
    expect((await member.PATCH(json({ role: "admin" }, "PATCH"), params("u-stranger"))).status).toBe(404);
  });

  it("Remove deletes only this workspace's membership and logs it as a delete", async () => {
    const res = await member.DELETE(json({}, "DELETE"), params("u-target"));
    expect(res.status).toBe(200);
    expect(tu().map((r) => r.id)).toEqual(["m2"]);
    expect(logged).toEqual([expect.objectContaining({ objectId: "u-target", objectLabel: "asha@acme.com", action: "delete", actorId: "u-admin", changes: [{ field: "role", from: "member", to: null }] })]);
  });

  it("you cannot remove yourself", async () => {
    expect((await member.DELETE(json({}, "DELETE"), params("u-admin"))).status).toBe(400);
    expect(logged).toHaveLength(0);
  });
});

describe("PUT /api/settings/team/[id]/roles", () => {
  const withRoles = (held: string[]) => seed({
    business_roles: [{ id: "r1", tenant_id: "t1", name: "Sales rep" }, { id: "r2", tenant_id: "t1", name: "Technician" }],
    business_user_roles: held.map((role_id) => ({ tenant_id: "t1", user_id: "u-target", role_id })),
  });

  it("logs the Business Roles before and after by name", async () => {
    withRoles(["r1"]);
    const res = await roles.PUT(json({ role_ids: ["r1", "r2"] }, "PUT"), params("u-target"));
    expect(res.status).toBe(200);
    expect(logged).toEqual([expect.objectContaining({ objectId: "u-target", action: "update", actorId: "u-admin", changes: [{ field: "business roles", from: "Sales rep", to: "Sales rep, Technician" }] })]);
  });

  it("logs a full clear, and nothing when the same set is saved again", async () => {
    withRoles(["r1"]);
    await roles.PUT(json({ role_ids: ["r1"] }, "PUT"), params("u-target"));
    expect(logged).toHaveLength(0);
    await roles.PUT(json({ role_ids: [] }, "PUT"), params("u-target"));
    expect(logged[0].changes).toEqual([{ field: "business roles", from: "Sales rep", to: null }]);
  });
});
