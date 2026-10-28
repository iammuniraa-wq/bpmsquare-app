import { beforeEach, describe, expect, it, vi } from "vitest";

// The provisioning flow (owner decision 2026-10-28): a platform admin creates the account with an initial password and hands it over; the
// first login forces the person to choose their own. The tenant_users row is what carries that (must_change_password), so this pins it.

const state = vi.hoisted(() => ({
  platformAdmin: true,
  isNew: true,
  alreadyMember: false,
  inserted: [] as Record<string, unknown>[],
  invited: [] as { email: string; password?: string }[],
}));

vi.mock("@/lib/tenant", () => ({ isPlatformAdmin: async () => state.platformAdmin }));
vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "tenants") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "KAMCO", custom_domain: "kamco.example" } }) }) }) };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.alreadyMember ? { id: "m1" } : null }) }) }) }),
        insert: async (row: Record<string, unknown>) => { state.inserted.push(row); return { error: null }; },
      };
    },
  }),
  findOrCreateUserForInvite: async (_admin: unknown, email: string, opts: { password?: string }) => {
    state.invited.push({ email, password: opts.password });
    return { userId: "u-new", isNew: state.isNew };
  },
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const post = (body: unknown) => POST(
  new NextRequest(new URL("http://internal.invalid/api/admin/tenants/t1/invite"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: "t1" }) },
);

beforeEach(() => { state.platformAdmin = true; state.isNew = true; state.alreadyMember = false; state.inserted = []; state.invited = []; });

describe("POST /api/admin/tenants/[id]/invite", () => {
  it("is for platform admins only", async () => {
    state.platformAdmin = false;
    const res = await post({ email: "a@example.com", password: "starter-pass-1" });
    expect(res.status).toBe(403);
    expect(state.inserted).toEqual([]);
  });

  it("a new account made with an initial password must change it at first login", async () => {
    const res = await post({ email: "A@Example.com", password: "starter-pass-1", role: "admin" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, passwordSet: true });
    expect(state.invited).toEqual([{ email: "a@example.com", password: "starter-pass-1" }]);
    expect(state.inserted).toEqual([{ tenant_id: "t1", user_id: "u-new", role: "admin", must_change_password: true }]);
  });

  it("an invite without a password sends the e-mail and forces nothing (the link lands on the set-password screen)", async () => {
    const res = await post({ email: "a@example.com", role: "member" });
    expect(await res.json()).toEqual({ ok: true, passwordSet: false });
    expect(state.inserted).toEqual([{ tenant_id: "t1", user_id: "u-new", role: "member", must_change_password: false }]);
  });

  it("an account that already exists elsewhere keeps its own password: linked, not forced", async () => {
    state.isNew = false;
    const res = await post({ email: "a@example.com", password: "starter-pass-1" });
    expect(await res.json()).toEqual({ ok: true, passwordSet: false });
    expect(state.inserted[0]).toMatchObject({ must_change_password: false, role: "admin" });
  });

  it("refuses to add someone who is already a member", async () => {
    state.isNew = false; state.alreadyMember = true;
    const res = await post({ email: "a@example.com" });
    expect(res.status).toBe(409);
    expect(state.inserted).toEqual([]);
  });
});
