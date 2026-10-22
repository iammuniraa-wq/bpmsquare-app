import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pulls: string[] = [];
const rows = [{ tenant_id: "t-1", status: "connected", config: { auth_mode: "basic", schedule: "hourly", entities: {} } }];

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }),
}));
vi.mock("@/lib/connectors/sap_s4/server", () => ({
  runSapPull: async (_a: unknown, tenant: string, entity: string) => { pulls.push(`${tenant}:${entity}`); return { error: null, counts: {} }; },
}));

const req = (authorization?: string) => ({ headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? authorization ?? null : null) } }) as never;

beforeEach(() => { vi.stubEnv("CRON_SECRET", "cron-secret-1"); pulls.length = 0; });
afterEach(() => { vi.unstubAllEnvs(); });

describe("GET /api/connectors/cron/sap_s4", () => {
  it("refuses a missing, wrong or unset secret before touching anything", async () => {
    const { GET } = await import("./route");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect((await GET(req("cron-secret-1"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect(pulls).toHaveLength(0);
  });

  it("with the secret, pulls the scheduled workspaces", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("Bearer cron-secret-1"));
    expect(res.status).toBe(200);
    expect(pulls.length).toBeGreaterThan(0);
  });
});
