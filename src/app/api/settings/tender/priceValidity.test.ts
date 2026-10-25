import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Slice 3a: the price validity limit lives on the Settings > Tenders route, next to the approvers, and nowhere else.

const state = vi.hoisted(() => ({ db: null as unknown as MemoryDb, role: "admin" as "admin" | "member", gcc: true }));
const T1 = "t1";
const BOSS = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth }),
  getAuthUser: async () => ({ id: BOSS, email: "boss@t1.test" }),
  requireTenantUser: async () => ({ tenantId: T1, userId: BOSS, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => state.gcc }));
vi.mock("@/lib/changeLog", () => ({ logChange: async () => {} }));

import { NextRequest } from "next/server";
import { GET, PUT } from "./route";

const put = (body: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const config = () => state.db.rows("tenants").find((t) => t.id === T1)!.config as Record<string, unknown>;

beforeEach(() => {
  state.db = new MemoryDb({ tenants: [{ id: T1, config: { keep: "me" } }], tenant_users: [{ tenant_id: T1, user_id: BOSS, role: "admin" }] });
  state.db.users.set(BOSS, { email: "boss@t1.test", name: "Boss" });
  state.role = "admin"; state.gcc = true;
});

describe("price validity (Settings > Tenders)", () => {
  it("defaults to 180 days", async () => {
    expect((await (await GET()).json()).price_validity_days).toBe(180);
  });

  it("is stored beside the approvers, merged into the workspace config, and read back", async () => {
    const res = await PUT(put({ approvers: [BOSS], allow_self_approval: false, price_validity_days: 90 }));
    expect(res.status).toBe(200);
    expect(config()).toEqual({ keep: "me", tender: { approvers: [BOSS], allow_self_approval: false, price_validity_days: 90 } });
    expect((await (await GET()).json()).price_validity_days).toBe(90);
  });

  it("a save that does not mention it leaves the stored value alone", async () => {
    await PUT(put({ approvers: [], price_validity_days: 60 }));
    await PUT(put({ approvers: [BOSS], allow_self_approval: true }));
    expect((config().tender as { price_validity_days: number }).price_validity_days).toBe(60);
  });

  it("refuses a value that is not a whole number of days from 1 to 3650", async () => {
    for (const bad of [0, -1, 1.5, 4000, "abc", null]) {
      const res = await PUT(put({ approvers: [], price_validity_days: bad }));
      expect(res.status, String(bad)).toBe(422);
    }
    expect(config()).toEqual({ keep: "me" });
  });

  it("is admin-only and needs the tender edition", async () => {
    state.role = "member";
    expect((await PUT(put({ approvers: [], price_validity_days: 30 }))).status).toBe(403);
    state.role = "admin"; state.gcc = false;
    expect((await PUT(put({ approvers: [], price_validity_days: 30 }))).status).toBe(404);
    expect(config()).toEqual({ keep: "me" });
  });
});
