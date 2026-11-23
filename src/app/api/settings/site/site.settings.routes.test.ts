import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Settings > Site entry: admin only in both directions, 404 without a module, people told about a problem must be members of THIS workspace, and a
// category is looked up by id AND workspace.

const state = vi.hoisted(() => ({ db: null as unknown as MemoryDb, role: "admin" as "admin" | "member" }));
const T1 = "t1";
const T2 = "t2";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "99999999-9999-4999-8999-999999999999";
const CAT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const CAT_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => state.db,
  getAuthUser: async () => ({ id: A, email: "a@t1.test" }),
  requireTenantUser: async () => ({ tenantId: T1, userId: A, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/changeLog", () => ({ diffForLog: () => [], logChange: async () => {} }));
vi.mock("@/lib/sales/opportunityServer", () => ({ listMembersForPicker: async () => [{ user_id: A, name: "A", email: "a@t1.test" }, { user_id: B, name: "B", email: "b@t1.test" }] }));

import { NextRequest } from "next/server";
import { GET, PUT } from "./route";
import { POST as addCat } from "./categories/route";
import { PATCH as editCat } from "./categories/[id]/route";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  const features = { contract_projects: true, site_expenses: true, site_receipts: true };
  state.db = new MemoryDb({
    tenants: [{ id: T1, features, config: {} }, { id: T2, features, config: {} }],
    tenant_users: [{ tenant_id: T1, user_id: A, role: "admin" }, { tenant_id: T1, user_id: B, role: "member" }, { tenant_id: T2, user_id: FOREIGN, role: "member" }],
    site_expense_categories: [{ id: CAT, tenant_id: T1, name: "Materials", active: true, sort_order: 0 }, { id: CAT_T2, tenant_id: T2, name: "Materials", active: true, sort_order: 0 }],
  });
  state.role = "admin";
});

describe("Settings > Site entry", () => {
  it("is admin only, both ways, and 404 without a site module", async () => {
    state.role = "member";
    expect((await GET()).status).toBe(403);
    expect((await PUT(json("PUT", { pm_limit: 100 }))).status).toBe(403);
    expect((await addCat(json("POST", { name: "Tools" }))).status).toBe(403);
    state.role = "admin";
    state.db.rows("tenants")[0].features = { contract_projects: true };
    expect((await GET()).status).toBe(404);
  });

  it("saves the limits next to the other config and refuses a person from another workspace", async () => {
    state.db.rows("tenants")[0].config = { tender: { approvers: [A] } };
    expect((await PUT(json("PUT", { pm_limit: 2500, monthly_cap: 10000, notify_receipts: [B] }))).status).toBe(200);
    expect(state.db.rows("tenants")[0].config).toEqual({ tender: { approvers: [A] }, site: { pm_limit: 2500, monthly_cap: 10000, notify_receipts: [B] } });
    expect((await PUT(json("PUT", { notify_receipts: [FOREIGN] }))).status).toBe(422);
    expect((await PUT(json("PUT", { pm_limit: -3 }))).status).toBe(422);
    const got = await (await GET()).json();
    expect(got).toMatchObject({ pm_limit: 2500, notify_receipts: [B] });
  });

  it("adds a category to this workspace and edits only this workspace's", async () => {
    expect((await addCat(json("POST", { name: "Tools", resource_code: "11" }))).status).toBe(201);
    expect(state.db.rows("site_expense_categories").find((c) => c.name === "Tools")?.tenant_id).toBe(T1);
    expect((await addCat(json("POST", { name: " " }))).status).toBe(422);
    expect((await editCat(json("PATCH", { active: false, tenant_id: T2 }), ctx(CAT))).status).toBe(200);
    expect(state.db.rows("site_expense_categories").find((c) => c.id === CAT)).toMatchObject({ active: false, tenant_id: T1 });
    expect((await editCat(json("PATCH", { active: false }), ctx(CAT_T2))).status).toBe(404);
    expect(state.db.rows("site_expense_categories").find((c) => c.id === CAT_T2)?.active).toBe(true);
  });
});
