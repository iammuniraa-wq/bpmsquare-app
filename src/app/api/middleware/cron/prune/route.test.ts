import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeAdmin, T1, T2 } from "@/lib/middleware/testHarness";

const OLD = "2026-01-01T00:00:00.000Z";
const FRESH = new Date().toISOString();
let db: ReturnType<typeof fakeAdmin>;

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => db.client }));

const req = (authorization?: string) => ({ headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? authorization ?? null : null) } }) as never;

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret-1");
  db = fakeAdmin({
    // T2 had the flag and switched it off; its captured payload must still be pruned
    tenants: [{ id: T1, features: { integration_middleware: true } }, { id: T2, features: { integration_middleware: false } }],
    integration_messages: [
      { id: "a", tenant_id: T1, created_at: OLD }, { id: "b", tenant_id: T1, created_at: FRESH },
      { id: "c", tenant_id: T2, created_at: OLD, payload: { request: { x: 1 } } },
    ],
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("retention schedule", () => {
  it("runs at least hourly, so a payload kept for 48 hours does not live to 72", async () => {
    const { readFileSync } = await import("node:fs");
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    const prune = cfg.crons.find((c) => c.path === "/api/middleware/cron/prune");
    expect(prune).toBeTruthy();
    const [minute, hour, dom, month, dow] = prune!.schedule.split(" ");
    expect(/^\d+$/.test(minute)).toBe(true);
    expect([hour, dom, month, dow]).toEqual(["*", "*", "*", "*"]);
  });
});

describe("GET /api/middleware/cron/prune", () => {
  it("refuses a missing, wrong or unset secret and deletes nothing", async () => {
    const { GET } = await import("./route");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect((await GET(req("cron-secret-1"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect(db.tables.integration_messages).toHaveLength(3);
  });

  it("with the secret, prunes old rows of every workspace, flag on or off", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("Bearer cron-secret-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tenants: 2 });
    expect(db.tables.integration_messages.map((r) => r.id)).toEqual(["b"]);
  });
});
