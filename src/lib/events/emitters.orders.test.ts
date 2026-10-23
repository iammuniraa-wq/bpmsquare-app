import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import { EVENTS, isKnownEvent } from "./catalog";

let current: ReturnType<typeof fakeDb>;
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => current.client }));

const e = await import("./emitters");
const events = () => current.tables.domain_event ?? [];

beforeEach(() => { current = fakeDb(); });

const UUID_CONTACT = "11111111-1111-4111-8111-111111111111";

describe("sales order events", () => {
  it("are in the catalogue under their order.* names", () => {
    expect([EVENTS.ORDER_CREATED, EVENTS.ORDER_CONFIRMED, EVENTS.ORDER_CANCELLED, EVENTS.ORDER_SENT]).toEqual(["order.created", "order.confirmed", "order.cancelled", "order.sent"]);
    for (const n of Object.values(EVENTS).filter((x) => x.startsWith("order."))) expect(isKnownEvent(n)).toBe(true);
  });

  it("order.created: one row, tenant-scoped, ids and labels only, and a retry does not double it", async () => {
    const p = { orderId: "o1", ref: "SO-0001", total: 1200, accountId: "a1", contactId: UUID_CONTACT, actorId: "u1", sourceType: "standard_quote", sourceId: "sq1", typeId: "ty1" };
    await e.emitOrderCreated("t1", p);
    await e.emitOrderCreated("t1", p);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ tenant_id: "t1", name: "order.created", object_type: "sales_order", object_id: "o1", account_id: "a1", contact_id: UUID_CONTACT });
    expect(events()[0].payload).toEqual({ ref: "SO-0001", total: 1200, source_type: "standard_quote", source_id: "sq1", type_id: "ty1" });
  });

  it("order.confirmed, order.cancelled and order.sent carry a reference and numbers, never a person's text", async () => {
    await e.emitOrderConfirmed("t1", { orderId: "o1", ref: "SO-0001", total: 10, accountId: "a1" });
    await e.emitOrderCancelled("t1", { orderId: "o1", ref: "SO-0001", total: 10, accountId: "a1", reason: "Customer wrote: call me on 555-1234" });
    await e.emitOrderSent("t1", { orderId: "o1", ref: "SO-0001", total: 10, accountId: "a1", redirected: true });
    expect(events().map((r) => r.name)).toEqual(["order.confirmed", "order.cancelled", "order.sent"]);
    expect(JSON.stringify(events().map((r) => r.payload))).not.toContain("555");
    expect(events()[2].payload).toEqual({ ref: "SO-0001", total: 10, redirected: true });
  });

  it("the same order id in two tenants records two events, never one shared one", async () => {
    await e.emitOrderCreated("t1", { orderId: "o1" });
    await e.emitOrderCreated("t2", { orderId: "o1" });
    expect(events().map((r) => r.tenant_id).sort()).toEqual(["t1", "t2"]);
  });
});
