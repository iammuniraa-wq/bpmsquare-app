import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ user: null as null | { role: string; tenantId: string; error?: { status: number; message: string } }, flag: true }));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => {
    if (state.user?.error) throw state.user.error;
    return { role: state.user!.role, tenantId: state.user!.tenantId, userId: "u-1", supabase: {} };
  },
  createAdminSupabase: () => ({ tag: "admin" }),
}));
vi.mock("@/lib/middleware/ops", () => ({ flagOn: async () => state.flag }));

import { guard } from "./_guard";

beforeEach(() => { state.user = { role: "admin", tenantId: "tenant-1" }; state.flag = true; });

describe("guard(): what every /api/middleware route (SAP included) starts with", () => {
  it("not signed in is the session's own refusal", async () => {
    state.user = { role: "admin", tenantId: "t", error: { status: 401, message: "Unauthorized" } };
    const g = await guard();
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.res.status).toBe(401);
  });

  it("a member who is not an admin is 403", async () => {
    state.user = { role: "member", tenantId: "tenant-1" };
    const g = await guard();
    if (g.ok) throw new Error("should refuse");
    expect(g.res.status).toBe(403);
  });

  it("a workspace without the flag is 404, as if the module did not exist", async () => {
    state.flag = false;
    const g = await guard();
    if (g.ok) throw new Error("should refuse");
    expect(g.res.status).toBe(404);
  });

  it("an admin of a flagged workspace gets the tenant of the session", async () => {
    const g = await guard();
    if (!g.ok) throw new Error("should pass");
    expect(g.ctx.tenantId).toBe("tenant-1");
  });
});
