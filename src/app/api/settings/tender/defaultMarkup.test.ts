import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// The Costing tab's "Award and price" adds a markup to the supplier's cost. Its workspace default (15 until changed) lives on the
// Settings > Tenders route, next to the price validity, and nowhere else.

const state = vi.hoisted(() => ({ db: null as unknown as MemoryDb, role: "admin" as "admin" | "member", gcc: true, changes: [] as { changes?: { field: string; from: unknown; to: unknown }[] }[] }));
const T1 = "t1";
const BOSS = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth }),
  getAuthUser: async () => ({ id: BOSS, email: "boss@t1.test" }),
  requireTenantUser: async () => ({ tenantId: T1, userId: BOSS, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => state.gcc }));
vi.mock("@/lib/changeLog", () => ({ logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); } }));

import { NextRequest } from "next/server";
import { GET, PUT } from "./route";

const put = (body: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const config = () => state.db.rows("tenants").find((t) => t.id === T1)!.config as Record<string, unknown>;

beforeEach(() => {
  state.db = new MemoryDb({ tenants: [{ id: T1, config: { keep: "me" } }], tenant_users: [{ tenant_id: T1, user_id: BOSS, role: "admin" }] });
  state.db.users.set(BOSS, { email: "boss@t1.test", name: "Boss" });
  state.role = "admin"; state.gcc = true; state.changes = [];
});

describe("default markup (Settings > Tenders)", () => {
  it("defaults to 15 percent", async () => {
    expect((await (await GET()).json()).default_markup_pct).toBe(15);
  });

  it("is stored beside the approvers, merged into the workspace config, read back, and logged", async () => {
    const res = await PUT(put({ approvers: [BOSS], allow_self_approval: false, default_markup_pct: 22.5 }));
    expect(res.status).toBe(200);
    expect(config()).toEqual({ keep: "me", tender: { approvers: [BOSS], allow_self_approval: false, default_markup_pct: 22.5 } });
    expect((await (await GET()).json()).default_markup_pct).toBe(22.5);
    expect(state.changes.flatMap((c) => c.changes ?? [])).toContainEqual({ field: "Default markup (%)", from: 15, to: 22.5 });
  });

  it("0 is a real choice (sell at cost)", async () => {
    await PUT(put({ approvers: [], default_markup_pct: 0 }));
    expect((await (await GET()).json()).default_markup_pct).toBe(0);
  });

  it("a save that does not mention it leaves the stored value alone", async () => {
    await PUT(put({ approvers: [], default_markup_pct: 30 }));
    await PUT(put({ approvers: [BOSS], allow_self_approval: true, price_validity_days: 60 }));
    expect((config().tender as { default_markup_pct: number }).default_markup_pct).toBe(30);
  });

  it("refuses anything that is not a number from 0 to 1000, and changes nothing", async () => {
    for (const bad of [-1, 1001, "abc", null, "", {}]) {
      expect((await PUT(put({ approvers: [], default_markup_pct: bad }))).status, String(bad)).toBe(422);
    }
    expect(config()).toEqual({ keep: "me" });
  });

  it("is admin-only and needs the tender edition", async () => {
    state.role = "member";
    expect((await PUT(put({ approvers: [], default_markup_pct: 10 }))).status).toBe(403);
    state.role = "admin"; state.gcc = false;
    expect((await PUT(put({ approvers: [], default_markup_pct: 10 }))).status).toBe(404);
    expect(config()).toEqual({ keep: "me" });
  });
});
