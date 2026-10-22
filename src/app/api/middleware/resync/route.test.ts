import { describe, it, expect, vi, beforeEach } from "vitest";

const resync = vi.fn();
vi.mock("../_guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    guard: async () => ({ ok: true, ctx: { admin: {}, tenantId: "tenant-1", userId: "user-1" } }),
    jsonBody: async (r: { json: () => Promise<unknown> }) => (await r.json()) ?? {},
    fail: (status: number, error: string) => NextResponse.json({ error }, { status }),
  };
});
vi.mock("@/lib/middleware/ops", () => ({ resync: (...a: unknown[]) => resync(...a) }));

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST({ json: async () => body } as never);
};
const G = "11111111-2222-3333-4444-555555555555";

beforeEach(() => { resync.mockReset(); resync.mockResolvedValue({ runId: "r1", counts: {}, issues: [], error: null }); });

describe("POST /api/middleware/resync", () => {
  it("passes cleaned ids to the run and keeps the tenant from the session", async () => {
    const res = await post({ entity: "customers", full: true, ids: [` {${G}} `, "C-0001", "C-0001"], tenant_id: "other" });
    expect(res.status).toBe(200);
    const [, tenantId, , entity, opts] = resync.mock.calls[0];
    expect(tenantId).toBe("tenant-1");
    expect(entity).toBe("customers");
    expect(opts.select).toEqual({ ids: [G, "C-0001"] });
  });

  it("without ids passes no selection: the run is the ordinary one, under the saved scope", async () => {
    await post({ entity: "vendors", full: true });
    expect(resync.mock.calls[0][4].select).toBeUndefined();
  });

  it("ignores the old name, date and active filters instead of applying a broader read", async () => {
    await post({ entity: "customers", full: true, text: "AG", since: "2026-10-01", active_only: true });
    expect(resync.mock.calls[0][4].select).toBeUndefined();
  });

  it("refuses an unknown entity, bad ids and more than 100 ids without running", async () => {
    for (const body of [
      { entity: "nope" },
      { entity: "customers", ids: ["x' or 1 eq 1"] },
      { entity: "customers", ids: Array.from({ length: 101 }, (_, i) => `C-${i}`) },
      { entity: "customers", ids: "C-1" },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(422);
    }
    expect(resync).not.toHaveBeenCalled();
  });

  it("answers 400 with the unsupported list when the run refuses", async () => {
    resync.mockResolvedValue({ runId: null, counts: {}, issues: [], error: "Numbers cannot be looked up for this entity.", unsupported: ["Numbers cannot be looked up for this entity."] });
    const res = await post({ entity: "contacts", ids: ["K-1"] });
    expect(res.status).toBe(400);
    expect((await res.json()).unsupported).toHaveLength(1);
  });

  it("sends fence projects their own ids", async () => {
    expect((await post({ entity: "fence_projects", ids: ["a"] })).status).toBe(200);
    expect(resync.mock.calls[0][4]).toEqual({ full: false, ids: ["a"] });
  });
});
