import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserted: [] as Row[],
  logs: [] as { objectType: string; action: string; changes?: unknown }[],
  owned: true,
  canCreate: true,
}));

function fake() {
  return {
    from(table: string) {
      const filters: { col: string; val: unknown }[] = [];
      let pendingInsert: Row | null = null;
      const b: Record<string, unknown> = {};
      const run = () => {
        if (pendingInsert) {
          const row = { id: `new-${state.inserted.length + 1}`, ...pendingInsert };
          state.inserted.push(row);
          (state.tables[table] ??= []).push(row);
          return [row];
        }
        let out = state.tables[table] ?? [];
        for (const f of filters) {
          out = out.filter((r) => (Array.isArray(f.val) ? (f.val as unknown[]).includes(r[f.col]) : r[f.col] === f.val));
        }
        return out;
      };
      Object.assign(b, {
        select: () => b,
        insert: (row: Row) => { pendingInsert = row; return b; },
        eq: (col: string, val: unknown) => { filters.push({ col, val }); return b; },
        in: (col: string, val: unknown) => { filters.push({ col, val }); return b; },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => { const r = run()[0]; return { data: r ?? null, error: r ? null : { message: "none" } }; },
        then: (resolve: (r: unknown) => void) => resolve({ data: run(), error: null }),
      });
      return b;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: fake(), tenantId: "t1", userId: "u1", role: "admin" }),
  getAuthUser: async () => ({ id: "u1", email: "u@x.com" }),
}));
vi.mock("@/lib/objectFeatures", () => ({
  assertObjectFeature: async () => (state.owned ? null : Response.json({ error: "Not found" }, { status: 404 })),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canCreateWorkcenter: () => state.canCreate,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_o: string, before: Row, patch: Row) =>
    Object.entries(patch).filter(([k, v]) => (before[k] ?? null) !== (v ?? null)).map(([field, to]) => ({ field, from: null, to })),
  logChange: async (_s: unknown, p: { objectType: string; action: string; changes?: unknown }) => { state.logs.push(p); },
}));
vi.mock("@/lib/workOrderRef", () => ({ generateNextWorkOrderRef: async () => "WO-2026-0001" }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/work-orders", { method: "POST", body: JSON.stringify(body) }) as never);

const baseCase: Row = {
  id: "case-1", tenant_id: "t1", ref: "CS-2026-0001", account_id: "acc-1", type: "adhoc", status: "quote_approved",
  asset_id: "ast-1", asset_ids: ["ast-1"], equipment_label: "Pump", complaint: "Noisy bearing",
  quote_id: "q-1", contract_id: null, assigned_to: null,
};

beforeEach(() => {
  state.inserted = [];
  state.logs = [];
  state.owned = true;
  state.canCreate = true;
  state.tables = {
    service_cases: [{ ...baseCase }],
    quotes: [{ id: "q-1", tenant_id: "t1" }, { id: "q-other", tenant_id: "t2" }],
    contracts: [{ id: "c-1", tenant_id: "t1" }],
    accounts: [{ id: "acc-1", tenant_id: "t1" }],
    assets: [{ id: "ast-1", tenant_id: "t1" }],
    technicians: [{ id: "tech-1", tenant_id: "t1" }, { id: "tech-other", tenant_id: "t2" }],
    work_orders: [],
  };
});

describe("POST /api/work-orders", () => {
  it("creates a scheduled work order from the case, authorised by its quote", async () => {
    const res = await post({ case_id: "case-1", scheduled_for: "2026-11-02", technician_id: "tech-1" });
    expect(res.status).toBe(201);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      tenant_id: "t1", account_id: "acc-1", case_id: "case-1", asset_id: "ast-1", technician_id: "tech-1",
      auth_kind: "quote", auth_id: "q-1", status: "scheduled", ref: "WO-2026-0001",
      scheduled_for: "2026-11-02T12:00:00.000Z", description: "Noisy bearing",
    });
    expect(state.logs.map((l) => `${l.objectType}:${l.action}`)).toEqual(["work_orders:create", "cases:update"]);
  });

  it("uses the contract for an AMC case", async () => {
    state.tables.service_cases = [{ ...baseCase, type: "amc", quote_id: null, contract_id: "c-1" }];
    const res = await post({ case_id: "case-1" });
    expect(res.status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ auth_kind: "contract", auth_id: "c-1" });
  });

  it("refuses with 422 when the case has neither quote nor contract (auth_id is NOT NULL)", async () => {
    state.tables.service_cases = [{ ...baseCase, quote_id: null, contract_id: null }];
    const res = await post({ case_id: "case-1" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("no_authorisation");
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses when the case's quote belongs to another tenant", async () => {
    state.tables.service_cases = [{ ...baseCase, quote_id: "q-other" }];
    const res = await post({ case_id: "case-1" });
    expect(res.status).toBe(422);
    expect(state.inserted).toHaveLength(0);
  });

  it("404s on a case that belongs to another tenant", async () => {
    state.tables.service_cases = [{ ...baseCase, tenant_id: "t2" }];
    const res = await post({ case_id: "case-1" });
    expect(res.status).toBe(404);
    expect(state.inserted).toHaveLength(0);
  });

  it("404s on a technician from another tenant", async () => {
    const res = await post({ case_id: "case-1", technician_id: "tech-other" });
    expect(res.status).toBe(404);
    expect(state.inserted).toHaveLength(0);
  });

  it("drops an asset that is not this tenant's instead of linking it", async () => {
    state.tables.assets = [{ id: "ast-1", tenant_id: "t2" }];
    const res = await post({ case_id: "case-1" });
    expect(res.status).toBe(201);
    expect(state.inserted[0].asset_id).toBeNull();
  });

  it("ignores any account or auth ids sent in the body", async () => {
    const res = await post({ case_id: "case-1", account_id: "evil", auth_kind: "contract", auth_id: "c-1", tenant_id: "t2" });
    expect(res.status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ tenant_id: "t1", account_id: "acc-1", auth_kind: "quote", auth_id: "q-1" });
  });

  it("answers 409 for a second open work order until the user confirms", async () => {
    state.tables.work_orders = [{ id: "wo-9", tenant_id: "t1", case_id: "case-1", ref: "WO-2026-0009", status: "scheduled" }];
    const first = await post({ case_id: "case-1" });
    expect(first.status).toBe(409);
    const body = await first.json();
    expect(body.code).toBe("open_work_order_exists");
    expect(body.existing[0].ref).toBe("WO-2026-0009");
    expect(state.inserted).toHaveLength(0);

    const confirmed = await post({ case_id: "case-1", confirm_another: true });
    expect(confirmed.status).toBe(201);
    expect(state.inserted).toHaveLength(1);
  });

  it("does not count a completed work order, or another tenant's, as open", async () => {
    state.tables.work_orders = [
      { id: "wo-1", tenant_id: "t1", case_id: "case-1", ref: "WO-A", status: "completed" },
      { id: "wo-2", tenant_id: "t2", case_id: "case-1", ref: "WO-B", status: "scheduled" },
    ];
    const res = await post({ case_id: "case-1" });
    expect(res.status).toBe(201);
  });

  it("refuses a closed case", async () => {
    state.tables.service_cases = [{ ...baseCase, status: "closed" }];
    const res = await post({ case_id: "case-1" });
    expect(res.status).toBe(409);
    expect(state.inserted).toHaveLength(0);
  });

  it("validates input", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ case_id: "case-1", scheduled_for: "2026-02-31" })).status).toBe(400);
  });

  it("is hidden from a workspace without the module and forbidden without the create grant", async () => {
    state.owned = false;
    expect((await post({ case_id: "case-1" })).status).toBe(404);
    state.owned = true;
    state.canCreate = false;
    expect((await post({ case_id: "case-1" })).status).toBe(403);
    expect(state.inserted).toHaveLength(0);
  });
});
