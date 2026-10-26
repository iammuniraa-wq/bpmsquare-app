import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 3c-1: the ordinary estimate route, with a tender deal. An estimate made for a tender is the same estimate
// (same template, same maths, same lines); the deal is one extra column. Without the id, and without the tender edition, the route is
// exactly what it was.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  canViewPipeline: true,
  changes: [] as { objectType: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  seq: 0,
}));

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const U = "11111111-1111-4111-8111-111111111111";
const TPL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

vi.mock("@/lib/supabase-server", () => {
  const client = () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth });
  return {
    createAdminSupabase: client,
    getAuthUser: async () => ({ id: U, email: "me@t1.test" }),
    requireTenantUser: async () => ({ tenantId: T1, userId: U, role: "member", supabase: client() }),
  };
});
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: (_p: unknown, wc: string) => (wc === "pipeline" ? state.canViewPipeline : true),
  canEditWorkcenter: () => true, canCreateWorkcenter: () => true, canDeleteWorkcenter: () => true,
}));
vi.mock("@/lib/objectFeatures", async (orig) => ({ ...(await orig<typeof import("@/lib/objectFeatures")>()), tenantOwnsObject: async () => true }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [], diffLineItems: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: Record<string, unknown>) => { select: (s: string) => { single: () => Promise<unknown> } } } }, table: string, _tid: string, record: Record<string, unknown>, select: string) => {
    const ref = `EST-${String(++state.seq).padStart(4, "0")}`;
    const now = new Date().toISOString();
    return admin.from(table).insert({ ...record, ref, created_at: now, updated_at: now }).select(select).single();
  },
}));
vi.mock("@/lib/inbox/estimateLink", () => ({ linkEstimateToEmail: async () => {}, loadEstimatePrefill: async () => null }));

import { NextRequest } from "next/server";
import { POST } from "./route";

const create = async (body: Record<string, unknown>) => {
  const res = await POST(new NextRequest(new URL("http://internal.invalid/api/estimates"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { id?: string; error?: string } };
};
const ask = (over: Record<string, unknown> = {}) => ({ name: "Pipe run, route 4", template_id: TPL, params: { x: 3 }, margin_pct: 10, ...over });
const estimates = () => state.db.rows("estimates");
const snapshot = () => JSON.stringify([estimates(), state.db.rows("estimate_lines")]);

beforeEach(() => {
  state.seq = 0; state.changes = [];
  state.features = { pipeline: true, gcc_tender: true };
  state.canViewPipeline = true;
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: { tax: { rate: 15 }, currency: "SAR" } }, { id: T2, config: {} }],
    estimate_templates: [{
      id: TPL, tenant_id: T1, name: "Pipe run", description: "x", version: 1, is_active: true, quote_granularity: "group",
      inputs: [{ key: "x", label: "Length", type: "number", default: 2 }], rates: [{ key: "r", label: "Rate", unit: "per m", value: 10 }],
      rules: [{ code: "a", group: "Supply", description: "Pipe", uom: "m", qty: "x * 2", component: "materials", cost: { kind: "rate", rate: "r" } }],
    }],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-1", title: "Tender", account_id: "acc", stage: "estimating", outcome: "open" },
      { id: OPP_STD, tenant_id: T1, ref: "OPP-2", title: "Standard deal", account_id: "acc", stage: "qualify", outcome: "open" },
      { id: OPP_T2, tenant_id: T2, ref: "OPP-9", title: "Theirs", account_id: "acc2", stage: "estimating", outcome: "open" },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0 },
      { opportunity_id: OPP_T2, tenant_id: T2, tender_no: "ZZ-1", reminders_sent: [], addenda_count: 0 },
    ],
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("an estimate made for a tender deal", () => {
  it("is the ordinary estimate, computed and saved, with the deal attached", async () => {
    const r = await create(ask({ opportunity_id: OPP }));
    expect(r.status).toBe(201);
    const row = estimates().find((e) => e.id === r.body.id)!;
    expect(row).toMatchObject({ tenant_id: T1, opportunity_id: OPP, name: "Pipe run, route 4", template_id: TPL, margin_pct: 10 });
    // 3 * 2 = 6 metres at 10: the same maths as any estimate.
    expect(state.db.rows("estimate_lines").filter((l) => l.estimate_id === r.body.id).map((l) => l.cost_total)).toEqual([60]);
    expect((r.body.totals as { cost_total: number }).cost_total).toBe(60);
    expect(state.changes.some((c) => c.objectType === "estimates" && c.changes?.some((x) => x.field === "Tender deal" && x.to === OPP))).toBe(true);
  });

  it("without a deal the estimate has none, and nothing about the tender edition is read", async () => {
    const touched: string[] = [];
    const orig = state.db.from.bind(state.db);
    vi.spyOn(state.db, "from").mockImplementation((t: string) => { touched.push(t); return orig(t); });
    const r = await create(ask());
    expect(r.status).toBe(201);
    expect(estimates().find((e) => e.id === r.body.id)).not.toHaveProperty("opportunity_id");
    expect(touched).not.toContain("opportunities");
    expect(touched).not.toContain("opportunity_tenders");
  });

  it("a standard deal, another workspace's deal, a deal that does not exist, or a bad id is refused and nothing is made", async () => {
    const before = snapshot();
    for (const [opportunity_id, status] of [[OPP_STD, 404], [OPP_T2, 404], ["cccccccc-cccc-4ccc-8ccc-cccccccccc99", 404], ["nope", 422]] as const) {
      const r = await create(ask({ opportunity_id }));
      expect(r.status, opportunity_id).toBe(status);
    }
    expect(snapshot()).toBe(before);
  });

  it("without the tender edition, or without the Pipeline view, the deal is not found", async () => {
    const before = snapshot();
    state.features.gcc_tender = false;
    expect((await create(ask({ opportunity_id: OPP }))).status).toBe(404);
    state.features.gcc_tender = true; state.canViewPipeline = false;
    expect((await create(ask({ opportunity_id: OPP }))).status).toBe(404);
    expect(snapshot()).toBe(before);
  });

  it("an empty or null deal id is the same as none", async () => {
    for (const opportunity_id of [null, ""]) {
      const r = await create(ask({ opportunity_id }));
      expect(r.status).toBe(201);
      expect(estimates().find((e) => e.id === r.body.id)).not.toHaveProperty("opportunity_id");
    }
  });

  it("while migration 0227 is pending a tender estimate is told so and nothing is left behind", async () => {
    state.db.missingColumns.estimates = new Set(["opportunity_id"]);
    const r = await create(ask({ opportunity_id: OPP }));
    expect(r.status).toBe(503);
    expect(r.body.pending_migration).toBe(true);
    expect(estimates()).toHaveLength(0);
    // A standard estimate still works while the column is missing.
    expect((await create(ask())).status).toBe(201);
  });

  it("a template that is not this workspace's is still refused when a deal is given", async () => {
    const r = await create(ask({ opportunity_id: OPP, template_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb99" }));
    expect(r.status).toBe(404);
    expect(estimates()).toHaveLength(0);
  });
});
