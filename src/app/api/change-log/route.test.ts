import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ viaColumn: true, selects: [] as string[] }));

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({}),
  requireTenantUser: async () => ({
    tenantId: "t1", role: "admin",
    supabase: {
      from: () => {
        const b: Record<string, unknown> = {};
        const chain = () => b;
        Object.assign(b, {
          select: (cols: string) => { state.selects.push(cols); return b; },
          eq: chain, order: chain, limit: chain,
          then: (resolve: (r: unknown) => void) => {
            const asked = state.selects[state.selects.length - 1];
            if (!state.viaColumn && /\bvia\b/.test(asked)) {
              return resolve({ data: null, error: { code: "42703", message: 'column "via" does not exist' } });
            }
            const row = { id: "c1", object_type: "accounts", object_id: "a1", object_label: "Acme", action: "create", changes: [], actor_id: "u1", actor_email: "u@x.com", created_at: "2026-10-22T10:00:00Z" };
            return resolve({ data: [/\bvia\b/.test(asked) ? { ...row, via: "assistant" } : row], error: null });
          },
        });
        return b;
      },
    },
  }),
}));
vi.mock("@/lib/actorNames", () => ({ loadActorNames: async () => new Map([["u1", "Asha Rao"]]) }));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true }));

import { GET } from "./route";

const call = () => GET(new Request("http://x/api/change-log?object_type=accounts") as never);

describe("GET /api/change-log and the via column", () => {
  it("returns via when the column exists", async () => {
    state.viaColumn = true; state.selects = [];
    const body = await (await call()).json();
    expect(body.rows[0].via).toBe("assistant");
    expect(body.rows[0].actor_name).toBe("Asha Rao");
  });
  it("still answers when the column is missing (migration 0205 pending), without via", async () => {
    state.viaColumn = false; state.selects = [];
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].via).toBeUndefined();
    expect(state.selects).toHaveLength(2);
  });
});
