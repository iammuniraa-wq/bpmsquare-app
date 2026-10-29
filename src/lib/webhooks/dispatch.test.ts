import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ bodies: [] as string[] }));
vi.mock("@/lib/net/safeHost", () => ({
  fetchPublic: vi.fn(async (_url: string, init: { body: string }) => { sent.bodies.push(init.body); return { ok: true, status: 200 }; }),
}));

import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { deliverWebhook, type WebhookRow } from "./dispatch";
import type { createAdminSupabase } from "@/lib/supabase-server";

type Admin = ReturnType<typeof createAdminSupabase>;

const log = (n: number, object_type: string, over: Row = {}): Row => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, tenant_id: T1, object_type, object_id: `obj-${n}`, object_label: `Label ${n}`,
  action: "update", changes: [], actor_email: "a@b.c", created_at: `2026-10-21T10:00:${String(n).padStart(2, "0")}Z`, ...over,
});

const wh = (object_types: string[] | null): WebhookRow => ({
  id: "w1", tenant_id: T1, url: "https://hooks.example.com/in", secret: "plain", object_types, cursor_ts: null, cursor_id: null, failure_count: 0,
});

const world = () => fakeAdmin({
  change_log: [
    log(1, "accounts"),
    log(2, "employees", { changes: [{ field: "phone", from: "0501234567", to: "0507654321" }, { field: "name", from: "A", to: "B" }] }),
    log(3, "products", { changes: [{ field: "cost_price", from: 40, to: 55 }, { field: "name", from: "A", to: "B" }] }),
    log(4, "rfqs"),
    log(5, "contacts", { changes: [{ field: "email", from: "x@y.z", to: "q@y.z" }] }),
    log(6, "accounts", { tenant_id: T2 }),
  ],
  webhooks: [],
  webhook_deliveries: [],
}).client;

const batch = () => JSON.parse(sent.bodies[sent.bodies.length - 1]) as { events: { object_type: string; changes: { field: string; from?: unknown; to?: unknown }[] | null }[] };
const types = () => batch().events.map((e) => e.object_type);

beforeEach(() => { sent.bodies.length = 0; });

describe("event webhook batches follow the change feed's scope rule", () => {
  it("an all-objects webhook does not carry employee, contact or RFQ changes", async () => {
    const r = await deliverWebhook(world() as unknown as Admin, wh(["*"]));
    expect(r.ok).toBe(true);
    expect(types()).toEqual(["accounts", "products"]);
  });

  it("a webhook with nothing named behaves as all objects", async () => {
    await deliverWebhook(world() as unknown as Admin, wh(null));
    expect(types()).not.toContain("employees");
    await deliverWebhook(world() as unknown as Admin, wh([]));
    expect(types()).not.toContain("employees");
  });

  it("a webhook that names employees explicitly still receives them, and only the named types", async () => {
    await deliverWebhook(world() as unknown as Admin, wh(["employees"]));
    expect(types()).toEqual(["employees"]);
  });

  it("all objects plus a named explicit type delivers that type and still holds back the others", async () => {
    await deliverWebhook(world() as unknown as Admin, wh(["*", "employees"]));
    expect(types()).toEqual(["accounts", "employees", "products"]);
  });

  it("a product update never carries cost_price", async () => {
    await deliverWebhook(world() as unknown as Admin, wh(["*"]));
    const p = batch().events.find((e) => e.object_type === "products")!;
    expect(p.changes).toEqual([{ field: "name", from: "A", to: "B" }]);
    expect(sent.bodies[0]).not.toContain("cost_price");
  });

  it("personal fields are shown as [redacted], even on a row that was stored in the clear", async () => {
    await deliverWebhook(world() as unknown as Admin, wh(["employees", "contacts"]));
    expect(sent.bodies[0]).not.toContain("0501234567");
    expect(sent.bodies[0]).not.toContain("x@y.z");
    const e = batch().events.find((x) => x.object_type === "employees")!;
    expect(e.changes).toEqual([{ field: "phone", from: "[redacted]", to: "[redacted]", redacted: true }, { field: "name", from: "A", to: "B" }]);
  });

  it("never delivers another tenant's rows", async () => {
    await deliverWebhook(world() as unknown as Admin, wh(["*"]));
    expect(sent.bodies[0]).not.toContain("obj-6");
  });
});
