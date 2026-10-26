import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 3c-1, "Budget after award": a contract project made from a won tender takes the cost lines of the estimates
// that priced the BOQ (by resource, with the BOQ's cost code and the estimate's real costs, scaled to the share), and keeps the old
// "rate less margin" rule for every BOQ line without an estimate. A project that already exists is not touched.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  seq: 0,
}));

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const U = "11111111-1111-4111-8111-111111111111";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const EST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const EST_OTHER_DEAL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const EST_T2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth }),
  getAuthUser: async () => ({ id: U, email: "me@t1.test" }),
  requireTenantUser: async () => ({ tenantId: T1, userId: U, role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({}), canViewWorkcenter: () => true, canEditWorkcenter: () => true }));
vi.mock("@/lib/changeLog", () => ({ diffForLog: () => [], logChange: async () => {} }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: Record<string, unknown>) => { select: (s: string) => { single: () => Promise<unknown> } } } }, table: string, _tid: string, record: Record<string, unknown>, select: string) => {
    const ref = `CPR-${String(++state.seq).padStart(4, "0")}`;
    const now = new Date().toISOString();
    return admin.from(table).insert({ ...record, ref, created_at: now, updated_at: now }).select(select).single();
  },
}));

import { NextRequest } from "next/server";
import { POST as createPost } from "./route";

const json = (body: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const rows = (t: string) => state.db.rows(t).filter((r) => r.tenant_id === T1);
const budget = () => rows("project_budget_lines").sort((a, b) => Number(a.line_no) - Number(b.line_no));
const create = async () => { const res = await createPost(json({ opportunity_id: OPP })); return { status: res.status, body: (await res.json()) as Record<string, unknown> & { from_estimate?: number; estimated?: number; estimate_warnings?: string[]; unmapped_codes?: string[] } }; };

const line = (id: string, eid: string, n: number, o: Record<string, unknown>) => ({
  id, tenant_id: T1, estimate_id: eid, sort_order: n, code: `c${n}`, description: "x", uom: "m", qty: 1, waste_pct: 0, unit_cost: 1, cost_total: 1, component: "materials", product_id: null, source: "rule",
  wbs_code: `1.${n}`, custom_data: { group: "Supply" }, updated_at: "2026-10-20T08:00:00.000Z", ...o,
});
const est = (eid: string, over: Record<string, unknown> = {}) => ({ id: eid, tenant_id: T1, ref: "EST-0007", name: "Fence package", status: "draft", opportunity_id: OPP, standard_quote_id: null, totals: { cost_total: 12000 }, created_at: "2026-10-20T08:00:00.000Z", updated_at: "2026-10-20T08:00:00.000Z", ...over });
const link = (over: Record<string, unknown> = {}) => ({ id: "99999999-9999-4999-8999-999999999991", tenant_id: T1, opportunity_id: OPP, boq_line_id: "b1", estimate_id: EST, output: "total", basis: "total", share_pct: 100, applied_cost: 120, applied_at: "2026-10-20T09:00:00.000Z", estimate_updated_at: "2026-10-20T08:00:00.000Z", ...over });

beforeEach(() => {
  state.seq = 0;
  state.features = { pipeline: true, gcc_tender: true, contract_projects: true };
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }, { id: T2, config: {} }],
    accounts: [{ id: ACC, tenant_id: T1, name: "Aramco" }],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-1", title: "ARB-1 Fence for Plant 4", account_id: ACC, stage: "awarded", outcome: "won", amount: 100000, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
      { id: OPP_OTHER, tenant_id: T1, ref: "OPP-2", title: "Another tender", account_id: ACC, stage: "estimating", outcome: "open", amount: 1, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", issuer_name: "Aramco", portal: "ariba", bond_status: "held", reminders_sent: [], addenda_count: 0 },
      { opportunity_id: OPP_OTHER, tenant_id: T1, tender_no: "ARB-2", issuer_name: "Aramco", portal: "ariba", bond_status: "held", reminders_sent: [], addenda_count: 0 },
    ],
    opportunity_lines: [
      { id: "l1", tenant_id: T1, opportunity_id: OPP, sl_no: "1.1", description: "Chain link fence 2.4m", uom: "m", qty: 100, rate: 200, discount_pct: 0, amount: 20000, is_selected: true, break_of: null },
      { id: "l2", tenant_id: T1, opportunity_id: OPP, sl_no: "1.2", description: "Excavation", uom: "m3", qty: 50, rate: 40, discount_pct: 0, amount: 2000, is_selected: true, break_of: null },
    ],
    tender_boq_lines: [
      { id: "b1", tenant_id: T1, opportunity_id: OPP, line_id: "l1", item_no: "1.1", cost_code: "32 31 13", unit_cost: 120, price_source: "estimate", price_source_ref: "EST-0007" },
      { id: "b2", tenant_id: T1, opportunity_id: OPP, line_id: "l2", item_no: "1.2", cost_code: "31 23 16", unit_cost: null, price_source: null, price_source_ref: null },
    ],
    // The fence package: 100 m of fabric and posts at 80 (8,000), 20 crew days at 150 (3,000) and one haulage trip (1,000). Total 12,000 = 120 a metre.
    estimates: [est(EST), est(EST_OTHER_DEAL, { opportunity_id: OPP_OTHER, ref: "EST-0009" }), { ...est(EST_T2, { ref: "EST-0001" }), tenant_id: T2 }],
    estimate_lines: [
      line("ffffffff-ffff-4fff-8fff-ffffffffff01", EST, 1, { description: "Chain link fabric and posts", qty: 100, unit_cost: 80, cost_total: 8000, component: "materials" }),
      line("ffffffff-ffff-4fff-8fff-ffffffffff02", EST, 2, { description: "Erection crew", uom: "day", qty: 20, unit_cost: 150, cost_total: 3000, component: "labour", wbs_code: "2.1", custom_data: { group: "Installation" } }),
      line("ffffffff-ffff-4fff-8fff-ffffffffff03", EST, 3, { description: "Haulage", uom: "trip", qty: 1, unit_cost: 1000, cost_total: 1000, component: "transport", wbs_code: "2.2", custom_data: { group: "Installation" } }),
      line("ffffffff-ffff-4fff-8fff-ffffffffff04", EST_OTHER_DEAL, 1, { description: "Another deal's line", qty: 1, unit_cost: 777, cost_total: 777 }),
    ],
    tender_boq_estimate_links: [link()],
  });
  state.db.unique("contract_projects", (a, b) => a.tenant_id === b.tenant_id && !!a.source_opportunity_id && a.source_opportunity_id === b.source_opportunity_id);
  state.db.unique("erp_masters", (a, b) => a.tenant_id === b.tenant_id && a.kind === b.kind && a.code === b.code);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the budget a project starts from", () => {
  it("takes the estimate's cost lines for a BOQ line it priced, by resource, with the BOQ cost code and the real costs", async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.body.from_estimate).toBe(1);
    const lines = budget();
    expect(lines).toHaveLength(4);
    const fromEstimate = lines.slice(0, 3);
    expect(fromEstimate.map((l) => l.resource_code)).toEqual(["11", "31", "51"]);
    expect(fromEstimate.every((l) => l.cost_known === true && l.cost_code === "32 31 13" && l.wbs === "1.1")).toBe(true);
    expect(fromEstimate.map((l) => l.amount)).toEqual([8000, 3000, 1000]);
    expect(fromEstimate.map((l) => l.description)).toEqual(["1.1 · Chain link fabric and posts", "1.1 · Erection crew", "1.1 · Haulage"]);
    expect(String(fromEstimate[0].source_ref)).toContain("EST-0007");
    // The estimate wins over the BOQ row's own recorded cost (120 a metre): together they say the same 12,000, but from the lines.
    expect(fromEstimate.reduce((s, l) => s + Number(l.amount), 0)).toBe(12000);
  });

  it("a BOQ line without an estimate keeps the old rule: the rate less the default margin, marked estimated", async () => {
    const r = await create();
    const dig = budget().find((l) => l.description === "Excavation")!;
    expect(dig).toMatchObject({ resource_code: "11", unit_cost: 34, cost_known: false, amount: 1700, cost_code: "31 23 16" });
    expect(r.body.estimated).toBe(1);
  });

  it("the project's baseline total is the sum of those lines", async () => {
    await create();
    const rev = rows("project_budget_revisions")[0];
    expect(Number(rev.total)).toBe(13700);
  });

  it("a share takes only that part of the estimate", async () => {
    state.db.rows("tender_boq_estimate_links")[0].share_pct = 40;
    await create();
    expect(budget().slice(0, 3).reduce((s, l) => s + Number(l.amount), 0)).toBe(4800);
  });

  it("a cost per unit from one estimate line becomes one line of the BOQ quantity", async () => {
    Object.assign(state.db.rows("tender_boq_estimate_links")[0], { output: "line:ffffffff-ffff-4fff-8fff-ffffffffff02", basis: "per_unit" });
    await create();
    const first = budget()[0];
    // 150 a day, the BOQ line is 100 m.
    expect(first).toMatchObject({ resource_code: "31", qty: 100, unit_cost: 150, amount: 15000, description: "1.1 · Erection crew" });
    expect(budget()).toHaveLength(2);
  });

  it("says when the estimate changed since it priced the line, and still uses its lines", async () => {
    state.db.rows("estimates")[0].updated_at = "2026-10-25T08:00:00.000Z";
    await create();
    expect(String(budget()[0].source_ref)).toContain("estimate changed since");
  });

  it("an estimate line with no cost yet is kept as unknown, not as zero cost known", async () => {
    Object.assign(state.db.rows("estimate_lines").find((l) => l.id === "ffffffff-ffff-4fff-8fff-ffffffffff03")!, { unit_cost: null, cost_total: null });
    await create();
    expect(budget()[2]).toMatchObject({ cost_known: false, unit_cost: 0, amount: 0 });
    expect(String(budget()[2].source_ref)).toContain("no cost in the estimate yet");
  });
});

describe("what is never taken", () => {
  it("an estimate of another deal, another workspace or one that is gone falls back to the old rule and says why", async () => {
    for (const estimate_id of [EST_OTHER_DEAL, EST_T2, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee77"]) {
      state.db.tables.tender_boq_estimate_links = [link({ estimate_id })];
      state.db.tables.contract_projects = [];
      state.db.tables.project_budget_revisions = [];
      state.db.tables.project_budget_lines = [];
      const r = await create();
      expect(r.status, estimate_id).toBe(201);
      expect(r.body.from_estimate, estimate_id).toBe(0);
      expect(budget().map((l) => l.description), estimate_id).not.toContain("1.1 · Another deal's line");
      // The BOQ row's own recorded cost (120) is what the old rule uses.
      expect(budget()[0]).toMatchObject({ unit_cost: 120, cost_known: true });
      expect(r.body.estimate_warnings!.length, estimate_id).toBeGreaterThan(0);
    }
  });

  it("a link to a part of the estimate that no longer exists falls back too", async () => {
    state.db.rows("tender_boq_estimate_links")[0].output = "wbs:9";
    const r = await create();
    expect(r.body.from_estimate).toBe(0);
    expect(budget()[0]).toMatchObject({ unit_cost: 120 });
  });

  it("while migration 0227 is pending the budget is exactly what it was before", async () => {
    state.db.missing.add("tender_boq_estimate_links");
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.body.from_estimate).toBe(0);
    expect(budget()).toHaveLength(2);
    expect(budget()[0]).toMatchObject({ unit_cost: 120, cost_known: true, resource_code: "11" });
  });

  it("a workspace that never linked an estimate gets the old budget", async () => {
    state.db.tables.tender_boq_estimate_links = [];
    const r = await create();
    expect(r.body.from_estimate).toBe(0);
    expect(budget()).toHaveLength(2);
  });

  it("a project that already exists is not touched when links appear later", async () => {
    state.db.tables.tender_boq_estimate_links = [];
    expect((await create()).status).toBe(201);
    const before = JSON.stringify(budget());
    state.db.tables.tender_boq_estimate_links = [link()];
    const again = await create();
    expect(again.status).toBe(409);
    expect(JSON.stringify(budget())).toBe(before);
  });

  it("a tender that is not awarded still cannot become a project", async () => {
    const res = await createPost(json({ opportunity_id: OPP_OTHER }));
    expect(res.status).toBe(409);
  });
});
