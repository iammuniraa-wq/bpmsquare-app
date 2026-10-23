import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

let current: ReturnType<typeof fakeDb>;

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async () => {} };
});

const route = await import("./route");

const wo = (over: Row = {}): Row => ({ id: "w1", tenant_id: "t1", ref: "WO-0001", account_id: "a1", case_id: "c1", status: "in_progress", ...over });
const patch = (body: Row, id = "w1") => route.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) });
const events = () => (current.tables.domain_event ?? []).filter((e) => e.name === "work_order.completed");

beforeEach(() => { current = fakeDb({ work_orders: [wo()] }, { copyReads: true }); });

describe("PATCH /api/work-orders/[id] -- work_order.completed", () => {
  it("fires once when the status becomes completed, tenant-scoped, ids and labels only", async () => {
    const res = await patch({ status: "completed" });
    expect(res.status).toBe(200);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ tenant_id: "t1", object_type: "work_order", object_id: "w1", account_id: "a1" });
    expect(events()[0].payload).toEqual({ ref: "WO-0001", from: "in_progress", case_id: "c1" });
  });

  it("saving the completed work order again does not fire it again", async () => {
    await patch({ status: "completed" });
    await patch({ status: "completed", notes: "done" });
    expect(events()).toHaveLength(1);
  });

  it("other status changes and note edits fire nothing", async () => {
    await patch({ status: "invoiced" });
    await patch({ notes: "x" });
    expect(events()).toHaveLength(0);
  });

  it("a work order of another tenant is not completed and emits nothing", async () => {
    current = fakeDb({ work_orders: [wo({ tenant_id: "t2" })] }, { copyReads: true });
    await patch({ status: "completed" });
    expect(current.tables.work_orders[0].status).toBe("in_progress");
    expect(events()).toHaveLength(0);
  });
});
