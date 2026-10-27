import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Call = { op: string; table: string; filters: [string, unknown][]; payload?: unknown };

const state = {
  employee: { first_name: "Asha", last_name: "Rao", status: "active", valid_to: null as string | null } as Record<string, unknown> | null,
  counts: {} as Record<string, number>,
  calls: [] as Call[],
  logged: [] as unknown[],
};

function builder(op: string, table: string, resolve: (c: Call) => unknown) {
  const call: Call = { op, table, filters: [] };
  state.calls.push(call);
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) call.op = "count"; return b; },
    eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve(resolve(call)),
    single: () => Promise.resolve(resolve(call)),
    then: (res: (v: unknown) => unknown) => Promise.resolve(resolve(call)).then(res),
  };
  return b;
}

const session = {
  from: (table: string) => ({
    select: () => builder("select", table, () => ({ data: state.employee, error: null })),
    delete: () => builder("delete", table, () => ({ error: null })),
    update: (payload: unknown) => {
      const b = builder("update", table, (c) => { c.payload = payload; return { data: { ...state.employee, ...(payload as object), first_name: "Asha", last_name: "Rao" }, error: null }; });
      return b;
    },
  }),
};

const admin = {
  from: (table: string) => ({
    select: (_c?: string, o?: { head?: boolean }) => builder(o?.head ? "count" : "select", table, (c) => (c.op === "count" ? { count: state.counts[table] ?? 0, error: null } : { data: [{ ts: "2026-05-01T00:00:00Z" }], error: null })),
  }),
};

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: session, tenantId: "t1", role: "admin" }),
  getAuthUser: async () => ({ id: "u1", email: "a@x.com" }),
  createAdminSupabase: () => admin,
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, before: Record<string, unknown>, patch: Record<string, unknown>) =>
    Object.entries(patch).filter(([k, v]) => k !== "updated_at" && (before[k] ?? null) !== (v ?? null)).map(([field, to]) => ({ field, from: before[field] ?? null, to })),
  logChange: async (_c: unknown, entry: unknown) => { state.logged.push(entry); },
}));
vi.mock("@/lib/wfm/tenantToday", () => ({ tenantToday: async () => "2026-10-23" }));

const route = await import("./route");
const impactRoute = await import("./impact/route");

const ctx = { params: Promise.resolve({ id: "emp1" }) };
const req = (body?: unknown) => new Request("http://x/api/employees/emp1", { method: "DELETE", body: body ? JSON.stringify(body) : undefined }) as never;

beforeEach(() => {
  state.employee = { first_name: "Asha", last_name: "Rao", status: "active", valid_to: null };
  state.counts = {};
  state.calls = [];
  state.logged = [];
});

describe("DELETE /api/employees/[id]", () => {
  it("refuses with 409 and the counts when the employee has punches", async () => {
    state.counts = { wfm_presence_events: 120, wfm_leave_records: 2 };
    const res = await route.DELETE(req(), ctx);
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.code).toBe("has_work_data");
    expect(j.impact).toMatchObject({ punches: 120, leave_records: 2, total: 122 });
    expect(j.error).toMatch(/120 recorded punches/);
    expect(j.error).toMatch(/obsolete/);
    expect(state.calls.some((c) => c.op === "delete")).toBe(false);
    expect(state.logged).toHaveLength(0);
  });

  it("refuses for a single leave record too: any work data blocks", async () => {
    state.counts = { wfm_leave_records: 1 };
    expect((await route.DELETE(req(), ctx)).status).toBe(409);
  });

  it("deletes with 204 when nothing is recorded, scoped to id and tenant, and logs it", async () => {
    const res = await route.DELETE(req(), ctx);
    expect(res.status).toBe(204);
    const del = state.calls.find((c) => c.op === "delete");
    expect(del?.table).toBe("employees");
    expect(del?.filters).toEqual(expect.arrayContaining([["id", "emp1"], ["tenant_id", "t1"]]));
    expect(state.logged).toMatchObject([{ action: "delete", objectId: "emp1" }]);
  });

  it("checks the counts against the caller's tenant, never a client-supplied one", async () => {
    await route.DELETE(req(), ctx);
    const counted = state.calls.filter((c) => c.op === "count");
    expect(counted.length).toBeGreaterThan(5);
    for (const c of counted) expect(c.filters).toContainEqual(["tenant_id", "t1"]);
  });

  it("404s an employee that is not in this tenant without touching anything", async () => {
    state.employee = null;
    const res = await route.DELETE(req(), ctx);
    expect(res.status).toBe(404);
    expect(state.calls.some((c) => c.op === "delete")).toBe(false);
  });
});

describe("GET /api/employees/[id]/impact", () => {
  it("returns the counts the dialog shows", async () => {
    state.counts = { wfm_presence_events: 5, wfm_ot_sessions: 1 };
    const res = await impactRoute.GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ punches: 5, overtime_sessions: 1, total: 6 });
  });
});

describe("PATCH /api/employees/[id]: make obsolete / make active again", () => {
  const patch = (body: unknown) => route.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }) as never, ctx);

  it("make obsolete stamps today's date and logs the status and valid_to diff as an update", async () => {
    const res = await patch({ status: "inactive" });
    expect(res.status).toBe(200);
    const upd = state.calls.find((c) => c.op === "update");
    expect(upd?.payload).toMatchObject({ status: "inactive", valid_to: "2026-10-23" });
    expect(upd?.filters).toEqual(expect.arrayContaining([["id", "emp1"], ["tenant_id", "t1"]]));
    const entry = state.logged[0] as { action: string; changes: { field: string; to: unknown }[] };
    expect(entry.action).toBe("update");
    expect(entry.changes).toEqual(expect.arrayContaining([
      { field: "status", from: "active", to: "inactive" },
      { field: "valid_to", from: null, to: "2026-10-23" },
    ]));
  });

  it("make obsolete leaves an earlier valid_to alone", async () => {
    state.employee = { ...state.employee, valid_to: "2026-09-30" };
    await patch({ status: "inactive" });
    const upd = state.calls.find((c) => c.op === "update");
    expect(upd?.payload).toMatchObject({ status: "inactive" });
    expect((upd?.payload as Record<string, unknown>).valid_to).toBeUndefined();
  });

  it("make active again clears a past valid_to", async () => {
    state.employee = { ...state.employee, status: "inactive", valid_to: "2026-10-01" };
    await patch({ status: "active" });
    const upd = state.calls.find((c) => c.op === "update");
    expect(upd?.payload).toMatchObject({ status: "active", valid_to: null });
  });

  it("make active again leaves a future valid_to in place", async () => {
    state.employee = { ...state.employee, status: "inactive", valid_to: "2026-12-31" };
    await patch({ status: "active" });
    const upd = state.calls.find((c) => c.op === "update");
    expect((upd?.payload as Record<string, unknown>).valid_to).toBeUndefined();
  });
});
