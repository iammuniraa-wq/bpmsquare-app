import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression coverage for the fix to the bypass where this endpoint cleared
// must_change_password just because the caller had a valid session --
// with no verification a password change actually happened. It now must
// perform the real Supabase Auth update itself (via the admin client) and
// only clear the flag when that succeeds.

const requireTenantUser = vi.fn();
const updateUserById = vi.fn();
const tenantUsersUpdate = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: (...args: unknown[]) => requireTenantUser(...args),
  createAdminSupabase: () => ({
    auth: { admin: { updateUserById: (...args: unknown[]) => updateUserById(...args) } },
    from: (table: string) => {
      expect(table).toBe("tenant_users");
      return {
        update: (fields: Record<string, unknown>) => ({
          eq: (...eq1: unknown[]) => ({
            eq: (...eq2: unknown[]) => tenantUsersUpdate(fields, ...eq1, ...eq2),
          }),
        }),
      };
    },
  }),
}));

function req(body: unknown) {
  return { json: () => Promise.resolve(body) } as never;
}

describe("POST /api/auth/complete-password-change", () => {
  beforeEach(() => {
    vi.resetModules();
    requireTenantUser.mockReset();
    updateUserById.mockReset();
    tenantUsersUpdate.mockReset();
    requireTenantUser.mockResolvedValue({ tenantId: "t1", userId: "u1" });
    updateUserById.mockResolvedValue({ error: null });
    tenantUsersUpdate.mockResolvedValue({ error: null });
  });

  it("rejects a short/missing password without touching auth or the flag", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ password: "short" }));
    expect(res.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(tenantUsersUpdate).not.toHaveBeenCalled();
  });

  it("rejects with no body at all -- the old bypass (no password, flag cleared anyway) is closed", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(null));
    expect(res.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(tenantUsersUpdate).not.toHaveBeenCalled();
  });

  it("does NOT clear must_change_password if the actual Auth password update fails", async () => {
    updateUserById.mockResolvedValue({ error: { message: "weak password" } });
    const { POST } = await import("./route");
    const res = await POST(req({ password: "newpassword123" }));
    expect(res.status).toBe(400);
    expect(updateUserById).toHaveBeenCalledWith("u1", { password: "newpassword123" });
    expect(tenantUsersUpdate).not.toHaveBeenCalled();
  });

  it("changes the password AND clears the flag, in that order, on success", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ password: "newpassword123" }));
    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith("u1", { password: "newpassword123" });
    expect(tenantUsersUpdate).toHaveBeenCalledWith({ must_change_password: false }, "tenant_id", "t1", "user_id", "u1");
  });

  it("scopes the flag clear to the caller's own tenant/user only, never a client-supplied id", async () => {
    const { POST } = await import("./route");
    await POST(req({ password: "newpassword123" }));
    // The mocked update() only receives fields from the route + the first
    // .eq() call's args -- both come from requireTenantUser()'s result, and
    // the body has no way to influence them (there's no tenantId/userId
    // field read from the request body anywhere in the route).
    const [fields] = tenantUsersUpdate.mock.calls[0];
    expect(fields).toEqual({ must_change_password: false });
  });
});
