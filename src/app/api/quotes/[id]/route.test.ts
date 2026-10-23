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

const quote = (over: Row = {}): Row => ({
  id: "q1", tenant_id: "t1", ref: "QT-1", account_id: "a1", contact_id: null, status: "sent", outcome: "open", total: 100, superseded_by: null, submitted_at: "2026-10-01T00:00:00Z", ...over,
});
const patch = (body: Row) => route.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: "q1" }) });
const names = () => (current.tables.domain_event ?? []).map((e) => e.name).sort();

beforeEach(() => { current = fakeDb({ tenants: [{ id: "t1", config: {} }], quotes: [quote()] }, { copyReads: true }); });

describe("PATCH /api/quotes/[id] -- quote.accepted on a won Quotation", () => {
  it("marking it won emits quote.outcome_changed and quote.accepted once each, tenant-scoped", async () => {
    const res = await patch({ outcome: "won" });
    expect(res.status).toBe(200);
    expect(names()).toEqual(["quote.accepted", "quote.outcome_changed"]);
    const accepted = (current.tables.domain_event ?? []).find((e) => e.name === "quote.accepted")!;
    expect(accepted).toMatchObject({ tenant_id: "t1", object_type: "quote", object_id: "q1", account_id: "a1" });
    expect(accepted.payload).toEqual({ ref: "QT-1", total: 100 });
  });

  it("saving it won a second time does not announce another win", async () => {
    await patch({ outcome: "won" });
    await patch({ outcome: "won", notes: "po received" });
    expect(names()).toEqual(["quote.accepted", "quote.outcome_changed"]);
  });

  it("lost emits only quote.outcome_changed; a note edit emits nothing", async () => {
    await patch({ outcome: "lost", loss_reason: "price" });
    expect(names()).toEqual(["quote.outcome_changed"]);
    current = fakeDb({ tenants: [{ id: "t1", config: {} }], quotes: [quote()] }, { copyReads: true });
    await patch({ notes: "hello" });
    expect(names()).toEqual([]);
  });

  it("another tenant's quotation is not found and emits nothing", async () => {
    current = fakeDb({ tenants: [{ id: "t1", config: {} }], quotes: [quote({ tenant_id: "t2" })] }, { copyReads: true });
    expect((await patch({ outcome: "won" })).status).toBe(404);
    expect(names()).toEqual([]);
  });
});
