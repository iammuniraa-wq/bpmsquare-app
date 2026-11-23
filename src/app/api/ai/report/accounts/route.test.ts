import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { fakeAdmin, T1, T2 } from "@/lib/middleware/testHarness";

// GET /api/ai/report/accounts: the picker under "Save to an account". This workspace's accounts only, by name, at most eight, and only
// for a person who could save the brief to an account.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const state = vi.hoisted(() => ({ access: null as unknown, denied: false }));

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("no database in this test"); }, getAuthUser: async () => null, requireTenantUser: vi.fn() }));
vi.mock("@/lib/analysis/access", () => ({ resolveAnalysisAccess: async () => (state.denied ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : state.access) }));

import { GET } from "./route";

const NOVA = { ai_assistant: true, ai_assistant_web: true, accounts: true, next_experience: true };
const get = (q: string) => GET(new NextRequest(`http://localhost/api/ai/report/accounts?q=${encodeURIComponent(q)}`));

function seed(o: { features?: Record<string, boolean>; unrestricted?: boolean; extra?: { id: string; tenant_id: string; name: string }[] } = {}) {
  const db = fakeAdmin({
    accounts: [
      { id: "a1", tenant_id: T1, name: "Halcyon Gulf (Dammam)", city: "Dammam", country: "Saudi Arabia" },
      { id: "a2", tenant_id: T1, name: "Halcyon Group Trading", city: null, country: null },
      { id: "a3", tenant_id: T2, name: "Halcyon Secret Customer", city: null, country: null },
      ...(o.extra ?? []),
    ],
  });
  state.denied = false;
  state.access = {
    supabase: db.client, admin: db.client, tenantId: T1, userId: "u1", features: o.features ?? NOVA, config: {}, budget: 1,
    perms: o.unrestricted === false ? { unrestricted: false, grants: new Map([["accounts", { workcenter: "accounts", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) } : { unrestricted: true, grants: new Map() },
  };
}

beforeEach(() => seed());

describe("the account picker", () => {
  it("finds this workspace's accounts by the words typed, and never another workspace's", async () => {
    const j = await (await get("halcyon")).json();
    expect(j.accounts.map((a: { id: string }) => a.id).sort()).toEqual(["a1", "a2"]);
    expect(JSON.stringify(j)).not.toContain("Secret");
    expect(j.accounts.find((a: { id: string }) => a.id === "a1")).toMatchObject({ name: "Halcyon Gulf (Dammam)", place: "Dammam, Saudi Arabia", href: "/accounts/a1" });
  });
  it("shows at most eight", async () => {
    seed({ extra: Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, tenant_id: T1, name: `Halcyon branch ${i}` })) });
    expect((await (await get("halcyon")).json()).accounts).toHaveLength(8);
  });
  it("a search that is too short, or only pattern characters, finds nothing", async () => {
    for (const q of ["h", "", "%%", "__", ","]) expect((await (await get(q)).json()).accounts, q).toEqual([]);
  });
  it("without web research, or without the right to save to an account, it is refused or empty", async () => {
    seed({ features: { accounts: true } });
    expect((await get("halcyon")).status).toBe(403);
    seed({ features: { ...NOVA, next_experience: false } });
    expect((await (await get("halcyon")).json()).accounts).toEqual([]);
  });
  it("a signed-out request is the session's own refusal", async () => {
    state.denied = true;
    expect((await get("halcyon")).status).toBe(401);
  });
});
