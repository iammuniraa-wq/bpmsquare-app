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
  it("passes a cleaned selection to the run and keeps the tenant from the session", async () => {
    const res = await post({ entity: "customers", full: true, ids: [` {${G}} `, "C-0001", "C-0001"], since: "2026-10-01", text: "  AG  ", active_only: true, tenant_id: "other" });
    expect(res.status).toBe(200);
    const [, tenantId, , entity, opts] = resync.mock.calls[0];
    expect(tenantId).toBe("tenant-1");
    expect(entity).toBe("customers");
    expect(opts.select).toEqual({ ids: [G, "C-0001"], since: "2026-10-01T00:00:00Z", text: "AG", activeOnly: true });
  });

  it("with no filters passes none: the run is the ordinary one", async () => {
    await post({ entity: "vendors", full: true });
    expect(resync.mock.calls[0][4].select).toBeUndefined();
  });

  it("refuses an unknown entity, bad ids, a bad date, long text and more than 100 ids without running", async () => {
    for (const body of [
      { entity: "nope" },
      { entity: "customers", ids: ["x' or 1 eq 1"] },
      { entity: "customers", ids: Array.from({ length: 101 }, (_, i) => `C-${i}`) },
      { entity: "customers", since: "yesterday" },
      { entity: "customers", text: "a".repeat(81) },
      { entity: "customers", active_only: "yes" },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(422);
    }
    expect(resync).not.toHaveBeenCalled();
  });

  it("answers 400 with the unsupported list when the run refuses", async () => {
    resync.mockResolvedValue({ runId: null, counts: {}, issues: [], error: "Changed since is not available.", unsupported: ["Changed since is not available."] });
    const res = await post({ entity: "products", since: "2026-10-01" });
    expect(res.status).toBe(400);
    expect((await res.json()).unsupported).toHaveLength(1);
  });

  it("does not let filters near the fence-project push", async () => {
    expect((await post({ entity: "fence_projects", text: "x" })).status).toBe(422);
    expect(resync).not.toHaveBeenCalled();
    expect((await post({ entity: "fence_projects", ids: ["a"] })).status).toBe(200);
  });
});
