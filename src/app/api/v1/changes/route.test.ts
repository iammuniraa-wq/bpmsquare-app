import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: null as unknown, db: null as unknown }));
vi.mock("../_auth", async (orig) => ({ ...(await orig<typeof import("../_auth")>()), resolveApiAuth: async () => state.auth }));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => state.db }));

import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { GET } from "./route";

const log = (n: number, object_type: string, changes: unknown, tenant_id = T1): Row => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, tenant_id, object_type, object_id: `obj-${n}`, object_label: `L${n}`,
  action: "update", changes, actor_email: "a@b.c", created_at: `2026-10-21T10:00:${String(n).padStart(2, "0")}Z`,
});

beforeEach(() => {
  state.db = fakeAdmin({
    change_log: [
      log(1, "accounts", [{ field: "name", from: "A", to: "B" }]),
      log(2, "employees", [{ field: "name", from: "A", to: "B" }]),
      log(3, "products", [{ field: "cost_price", from: 40, to: 55 }, { field: "name", from: "A", to: "B" }]),
      log(4, "contacts", [{ field: "email", from: "x@y.z", to: "q@y.z" }]),
      log(5, "accounts", [{ field: "name", from: "A", to: "B" }], T2),
    ],
  }).client;
});

const get = async () => (await (await GET(new Request("https://x.test/api/v1/changes"))).json()) as { data: { object_type: string; changes: unknown }[] };

describe("GET /api/v1/changes", () => {
  it("a wildcard key gets ordinary objects, not explicit-only ones, never another tenant, and no cost_price", async () => {
    state.auth = { tenantId: T1, scopes: { read: true, write: false, objects: ["*"] }, keyId: null };
    const body = await get();
    expect(body.data.map((e) => e.object_type)).toEqual(["accounts", "products"]);
    expect(body.data[1].changes).toEqual([{ field: "name", from: "A", to: "B" }]);
  });

  it("a key that names employees and contacts gets them, with personal fields redacted", async () => {
    state.auth = { tenantId: T1, scopes: { read: true, write: false, objects: ["employees", "contacts"] }, keyId: null };
    const body = await get();
    expect(body.data.map((e) => e.object_type)).toEqual(["employees", "contacts"]);
    expect(body.data[1].changes).toEqual([{ field: "email", from: "[redacted]", to: "[redacted]", redacted: true }]);
  });
});
