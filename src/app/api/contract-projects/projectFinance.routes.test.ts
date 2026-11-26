import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Cost-to-complete and profitability (docs/design/pcbs-project-dashboards.md), against an in-memory database: who may read and write the
// forecast of a project (workspace setting finance_visibility), another workspace's rows, the flag off, a view-only person, the estimate to go
// being saved and logged without ever reaching the outbound change feed, and the migration still pending.

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const P1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const P2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const MGR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const R0 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee0";
const R1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const R2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: { contract_projects: true, project_dashboards: true } as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  user: { id: "u", email: "u@t1.test" },
  role: "member" as "admin" | "member",
  view: true,
  edit: true,
  perms: { unrestricted: true, grants: new Map<string, { canView: boolean }>() } as { unrestricted: boolean; grants: Map<string, { canView: boolean }> },
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
}));

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: state.config, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => state.perms,
  canViewWorkcenter: () => state.view,
  canEditWorkcenter: () => state.edit,
}));
vi.mock("@/lib/changeLog", () => ({ logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); } }));

import { NextRequest } from "next/server";
import { GET, PUT } from "./[id]/forecast/route";
import { stripInternalChangeFields } from "@/lib/api/changeFeedScope";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };

function seed() {
  return new MemoryDb({
    contract_projects: [
      { id: P1, tenant_id: T1, ref: "CPR-0001", name: "Riyadh Block A", status: "active", contract_value: 1_000_000, currency: "SAR", manager_id: MGR, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      { id: P2, tenant_id: T2, ref: "CPR-0001", name: "Other tenant project", status: "active", contract_value: 5_000_000, currency: "SAR", manager_id: OTHER, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
    ],
    project_budget_revisions: [
      { id: R0, tenant_id: T1, project_id: P1, rev_no: 0, status: "superseded", total: 700_000, approved_at: "2026-09-02T00:00:00Z" },
      { id: R1, tenant_id: T1, project_id: P1, rev_no: 1, status: "approved", total: 800_000, justification_code: "scope_change", approved_at: "2026-10-01T00:00:00Z" },
      { id: R2, tenant_id: T2, project_id: P2, rev_no: 0, status: "approved", total: 4_000_000, approved_at: "2026-09-02T00:00:00Z" },
    ],
    project_budget_lines: [
      { id: "l1", tenant_id: T1, revision_id: R1, line_key: "a", resource_code: "11", amount: 500_000, allocated: true, client_amount: 600_000 },
      { id: "l2", tenant_id: T1, revision_id: R1, line_key: "b", resource_code: "41", amount: 300_000, allocated: true, client_amount: 400_000 },
      { id: "l3", tenant_id: T2, revision_id: R2, line_key: "z", resource_code: "11", amount: 4_000_000, allocated: true, client_amount: 5_000_000 },
    ],
    project_forecast_etg: [
      { tenant_id: T2, project_id: P2, wbs_code: "", resource_code: "11", amount: 123_456, note: "other tenant", entered_by: OTHER, entered_at: "2026-11-01T00:00:00Z" },
    ],
    project_erp_state: [
      { tenant_id: T2, project_id: P2, kind: "cost_actual", linked: true, last_ok_at: "2026-11-23T00:00:00Z", last_status: "ok", row_count: 1 },
    ],
    project_erp_facts: [
      { tenant_id: T2, project_id: P2, kind: "cost_actual", wbs_code: "", resource_code: "11", amount: 999_999 },
    ],
    erp_masters: [{ tenant_id: T1, kind: "resource", code: "11", name: "Material" }, { tenant_id: T1, kind: "resource", code: "41", name: "Sub Contractor" }],
  });
}

beforeEach(() => {
  state.db = seed();
  state.features = { contract_projects: true, project_dashboards: true };
  state.config = {};
  state.view = true; state.edit = true;
  state.perms = { unrestricted: true, grants: new Map() };
  state.changes = [];
  as(OTHER);
});

describe("GET /api/contract-projects/[id]/forecast", () => {
  it("answers with this project's figures only: the planned half is real, the ERP half is Not connected, another workspace's rows never appear", async () => {
    const res = await GET(json("GET"), ctx(P1));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.finance.budget).toBe(800_000);
    expect(j.finance.planned.pct).toBe(20);
    expect(j.finance.cost.eac).toBeNull();
    expect(j.finance.costConnected).toBe(false);
    expect(j.finance.etg).toEqual([]);
    expect(j.finance.cost.cells.map((c: { budget: number }) => c.budget).sort()).toEqual([300_000, 500_000]);
    expect(JSON.stringify(j)).not.toContain("999999");
    expect(JSON.stringify(j)).not.toContain("123456");
    expect(j.labels.resource).toEqual({ "11": "Material", "41": "Sub Contractor" });
  });
  it("another workspace's project is the same 404 as one that does not exist", async () => {
    expect((await GET(json("GET"), ctx(P2))).status).toBe(404);
    expect((await GET(json("GET"), ctx("dddddddd-dddd-4ddd-8ddd-dddddddddd99"))).status).toBe(404);
  });
  it("a workspace without the module sees a 404", async () => {
    state.features = { contract_projects: true, project_dashboards: false };
    expect((await GET(json("GET"), ctx(P1))).status).toBe(404);
    state.features = { project_dashboards: true };
    expect((await GET(json("GET"), ctx(P1))).status).toBe(404);
  });
  it("a person who cannot open Contract projects sees a 404", async () => {
    state.view = false;
    expect((await GET(json("GET"), ctx(P1))).status).toBe(404);
  });
  it("granted mode: an unrestricted member is refused, an admin, a grant holder and the project's manager are not", async () => {
    state.config = { contract_projects: { finance_visibility: "granted" } };
    as(OTHER);
    expect((await GET(json("GET"), ctx(P1))).status).toBe(404);
    as(ADMIN, "admin");
    expect((await GET(json("GET"), ctx(P1))).status).toBe(200);
    as(OTHER);
    state.perms = { unrestricted: false, grants: new Map([["project_finance", { canView: true }]]) };
    expect((await GET(json("GET"), ctx(P1))).status).toBe(200);
    state.perms = { unrestricted: false, grants: new Map([["contract_projects", { canView: true }]]) };
    expect((await GET(json("GET"), ctx(P1))).status).toBe(404);
    as(MGR);
    expect((await GET(json("GET"), ctx(P1))).status).toBe(200);
  });
  it("everyone mode lets anyone who can open Contract projects read it", async () => {
    state.config = { contract_projects: { finance_visibility: "everyone" } };
    expect((await GET(json("GET"), ctx(P1))).status).toBe(200);
  });
  it("a closed project still reads, and Not connected is a state, never a zero, on every ERP figure", async () => {
    const j = await (await GET(json("GET"), ctx(P1))).json();
    for (const k of ["actual", "committed"]) expect(j.finance[k]).toEqual({ state: "not_connected", value: null, asOf: null });
    expect(j.finance.atRisk).toBeNull();
    expect(j.finance.forecast).toBeNull();
  });
});

describe("PUT /api/contract-projects/[id]/forecast", () => {
  const put = (id: string, body: unknown) => PUT(json("PUT", body), ctx(id));
  const etgRows = () => state.db.rows("project_forecast_etg");

  it("saves the typed estimate on this workspace's project, with who and when, and logs it on the project", async () => {
    as(OTHER);
    const res = await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 90_000, note: "Steel price risk" }] });
    expect(res.status).toBe(200);
    const mine = etgRows().filter((r) => r.tenant_id === T1);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ tenant_id: T1, project_id: P1, resource_code: "11", amount: 90_000, entered_by: OTHER, note: "Steel price risk" });
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0]).toMatchObject({ objectType: "contract_projects", objectId: P1, action: "update" });
    expect(state.changes[0].changes![0]).toMatchObject({ field: "Forecast estimate to go (Material)", from: null, to: 90_000 });
    // The other workspace's row is untouched.
    expect(etgRows().find((r) => r.tenant_id === T2)).toMatchObject({ amount: 123_456 });
    // And the page now shows it, typed.
    const j = await (await GET(json("GET"), ctx(P1))).json();
    expect(j.finance.etg).toHaveLength(1);
    expect(j.finance.cost.typedEtg).toBe(90_000);
  });
  it("an edit changes the row, not duplicates it; an empty box clears it", async () => {
    await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 90_000 }] });
    await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 95_000 }] });
    expect(etgRows().filter((r) => r.tenant_id === T1)).toHaveLength(1);
    expect(state.changes[1].changes![0]).toMatchObject({ from: 90_000, to: 95_000 });
    await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: null }] });
    expect(etgRows().filter((r) => r.tenant_id === T1)).toHaveLength(0);
    expect(etgRows().filter((r) => r.tenant_id === T2)).toHaveLength(1);
    expect(state.changes[2].changes![0]).toMatchObject({ from: 95_000, to: null });
  });
  it("saving the same value again changes and logs nothing", async () => {
    await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 90_000 }] });
    const again = await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 90_000 }] });
    expect((await again.json()).changed).toBe(0);
    expect(state.changes).toHaveLength(1);
  });
  it("refuses a row that is not part of the approved budget, a negative or junk amount, and an empty request", async () => {
    expect((await put(P1, { entries: [{ wbs_code: "9.9", resource_code: "11", amount: 5 }] })).status).toBe(422);
    expect((await put(P1, { entries: [{ wbs_code: "", resource_code: "99", amount: 5 }] })).status).toBe(422);
    expect((await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: -5 }] })).status).toBe(422);
    expect((await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: "lots" }] })).status).toBe(422);
    expect((await put(P1, { entries: [] })).status).toBe(422);
    expect((await put(P1, {})).status).toBe(422);
    expect(etgRows().filter((r) => r.tenant_id === T1)).toHaveLength(0);
  });
  it("another workspace's project id writes nothing there and nothing here", async () => {
    const res = await put(P2, { entries: [{ wbs_code: "", resource_code: "11", amount: 1 }] });
    expect(res.status).toBe(404);
    expect(etgRows()).toHaveLength(1);
    expect(etgRows()[0]).toMatchObject({ tenant_id: T2, amount: 123_456 });
    expect(state.changes).toHaveLength(0);
  });
  it("a view-only person cannot write, and a person who may not see cost cannot either", async () => {
    state.edit = false;
    expect((await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 1 }] })).status).toBe(403);
    state.edit = true;
    state.config = { contract_projects: { finance_visibility: "granted" } };
    as(OTHER);
    expect((await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 1 }] })).status).toBe(404);
    expect(etgRows().filter((r) => r.tenant_id === T1)).toHaveLength(0);
    as(MGR);
    expect((await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 1 }] })).status).toBe(200);
  });
  it("a closed project cannot be changed", async () => {
    state.db.rows("contract_projects").find((r) => r.id === P1)!.status = "closed";
    expect((await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 1 }] })).status).toBe(409);
  });
  it("while migration 0261 is pending it says so and breaks nothing", async () => {
    state.db.missing.add("project_forecast_etg");
    const res = await put(P1, { entries: [{ wbs_code: "", resource_code: "11", amount: 1 }] });
    expect(res.status).toBe(503);
    expect((await res.json()).needsDatabaseUpdate).toBe(true);
    const read = await GET(json("GET"), ctx(P1));
    expect(read.status).toBe(200);
    expect((await read.json()).etg_missing).toBe(true);
  });
  it("the read-back tables not being there yet reads as Not connected, not as an error", async () => {
    state.db.missing.add("project_erp_state");
    state.db.missing.add("project_erp_facts");
    const res = await GET(json("GET"), ctx(P1));
    expect(res.status).toBe(200);
    expect((await res.json()).finance.cost.eac).toBeNull();
  });
});

describe("the estimate to go never reaches the outbound change feed", () => {
  it("the logged field is internal by its name, so the feed strips it", async () => {
    await PUT(json("PUT", { entries: [{ wbs_code: "", resource_code: "11", amount: 90_000 }] }), ctx(P1));
    const logged = state.changes[0].changes!;
    expect(stripInternalChangeFields("contract_projects", logged)).toEqual([]);
    expect(stripInternalChangeFields("contract_projects", [...logged, { field: "Name", from: "a", to: "b" }])).toEqual([{ field: "Name", from: "a", to: "b" }]);
  });
});
