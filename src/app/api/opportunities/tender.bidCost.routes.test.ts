import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// After award: submitting a bid also keeps its INTERNAL cost, apart from the version. Against an in-memory database: the cost is stored
// with the version number, the version itself still carries no cost, a later version does not touch an earlier one, a pending migration
// (0230) does not stop the bid from going in, and no read of the versions returns the cost.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  user: { id: "u1", email: "me@t1.test" },
}));

const T1 = "t1";
const ME = "11111111-1111-4111-8111-111111111111";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const uid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
  canViewWorkcenter: () => true,
  canEditWorkcenter: () => true,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [],
  logChange: async () => {},
}));
vi.mock("@/lib/events/emitters", () => ({
  emitOpportunityStageChanged: async () => {}, emitOpportunityClosed: async () => {}, emitOpportunityUpdated: async () => {}, emitOpportunityCreated: async () => {},
}));

import { NextRequest } from "next/server";
import { PATCH as stdPatch } from "./[id]/route";
import { GET as bidsGet, POST as bidsPost } from "./[id]/tender/bids/route";
import { GET as compareGet } from "./[id]/tender/bids/compare/route";

const req = (method: string, body?: unknown, url = "http://internal.invalid/x") => new NextRequest(new URL(url), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const costs = () => state.db.rows("tender_bid_version_costs");
const lineRow = (id: string, sl_no: string, description: string, qty: number, rate: number) => ({
  id, tenant_id: T1, opportunity_id: OPP, sl_no, description, uom: "Nos", qty, rate, discount_pct: 0, amount: qty * rate, product_id: null, group_id: null, group_type: null, break_of: null, is_selected: true, show_on_pdf: true,
});
const L1 = uid(11), L2 = uid(12), L3 = uid(13);

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "kamco.example.com" }],
    tenant_users: [{ tenant_id: T1, user_id: ME, role: "member" }],
    opportunities: [{
      id: OPP, tenant_id: T1, ref: "OPP-2", title: "Valves for Plant 4", account_id: "acc", stage: "estimating", outcome: "open", probability: 25, owner_id: ME, team: [], amount: 0, currency: "SAR",
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    }],
    opportunity_tenders: [{
      opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-2", issuer_name: "Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z", addenda_count: 0, decision: "go", reminders_sent: [],
      bond_status: "held", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    }],
    opportunity_lines: [lineRow(L1, "1", "Gate valve 100mm", 4, 100), lineRow(L2, "2", "Pipe 110mm", 100, 12), lineRow(L3, "3", "Mobilisation", 1, 5000)],
    tender_boq_lines: [
      { id: uid(21), tenant_id: T1, opportunity_id: OPP, line_id: L3, item_no: "3", cost_code: null, row_no: 5, price_source: null, unit_cost: null, markup_pct: null },
      { id: uid(22), tenant_id: T1, opportunity_id: OPP, line_id: L2, item_no: "2", cost_code: "22 11 00", row_no: 8, price_source: "supplier", unit_cost: 7.5, markup_pct: 60 },
      { id: uid(23), tenant_id: T1, opportunity_id: OPP, line_id: L1, item_no: "1", cost_code: null, row_no: 9, price_source: "bom", unit_cost: 60, markup_pct: 66.66 },
    ],
  });
  state.db.unique("tender_bid_versions", (e, n) => e.opportunity_id === n.opportunity_id && e.version_no === n.version_no);
  state.db.unique("tender_bid_version_costs", (e, n) => e.opportunity_id === n.opportunity_id && e.version_no === n.version_no);
  state.features = { pipeline: true, gcc_tender: true };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const submit = (body: unknown = {}) => bidsPost(req("POST", body), ctx(OPP));
const revise = () => stdPatch(req("PATCH", { stage: "estimating", outcome: "open" }), ctx(OPP));

describe("submitting a bid keeps its cost", () => {
  it("stores one cost row for the version: per bid line the recorded cost, the markup and the budget lines, in the bid's order", async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ version_no: 1, cost_snapshot: "saved" });
    expect(costs()).toHaveLength(1);
    const row = costs()[0] as { tenant_id: string; opportunity_id: string; version_no: number; total_cost: number; line_count: number; snapshot: { v: number; lines: { item_no: string; unit_cost: number | null; markup_pct: number | null; cost_total: number; estimated: boolean; lines: { unit_cost: number; qty: number }[] }[] } };
    expect(row).toMatchObject({ tenant_id: T1, opportunity_id: OPP, version_no: 1, line_count: 3 });
    expect(row.snapshot.v).toBe(1);
    expect(row.snapshot).not.toHaveProperty("margin_pct"); // the cost is never guessed, so there is no default margin to keep
    // The client's file order: Mobilisation, Pipe, Gate.
    expect(row.snapshot.lines.map((l) => l.item_no)).toEqual(["3", "2", "1"]);
    const [mob, pipe, gate] = row.snapshot.lines;
    expect(mob).toMatchObject({ unit_cost: null, markup_pct: null, estimated: true, cost_total: 0, lines: [] }); // no recorded cost: nothing kept
    expect(pipe).toMatchObject({ unit_cost: 7.5, markup_pct: 60, estimated: false, cost_total: 750 });
    expect(gate).toMatchObject({ unit_cost: 60, markup_pct: 66.66, estimated: false, cost_total: 240 });
    expect(row.total_cost).toBe(990);
  });

  it("the version row and the answers about versions carry no cost, markup or margin", async () => {
    await submit();
    const v = JSON.stringify(state.db.rows("tender_bid_versions")[0]);
    for (const leak of ["unit_cost", "markup", "margin", "cost_total", "snapshot", "66.66"]) expect(v, leak).not.toContain(leak);
    const list = JSON.stringify(await (await bidsGet(req("GET"), ctx(OPP))).json());
    for (const leak of ["unit_cost", "markup", "margin", "cost_total", "snapshot", "cost"]) expect(list, leak).not.toContain(leak);
    await revise();
    state.db.rows("opportunity_lines")[1].rate = 11;
    await submit({ revision_reason: "Price update" });
    const cmp = JSON.stringify(await (await compareGet(req("GET", undefined, "http://internal.invalid/x?from=1&to=2"), ctx(OPP))).json());
    for (const leak of ["unit_cost", "markup", "margin", "cost_total", "snapshot"]) expect(cmp, leak).not.toContain(leak);
  });

  it("a later version stores its own cost and never touches an earlier one", async () => {
    await submit();
    const first = JSON.stringify(costs()[0]);
    await revise();
    state.db.rows("tender_boq_lines").find((r) => r.line_id === L1)!.unit_cost = 75;
    expect((await submit({ revision_reason: "Gate valve price up" })).status).toBe(201);
    expect(costs().map((c) => c.version_no)).toEqual([1, 2]);
    expect(JSON.stringify(costs()[0])).toBe(first);
    const v2 = costs()[1] as { snapshot: { lines: { item_no: string; unit_cost: number | null }[] } };
    expect(v2.snapshot.lines.find((l) => l.item_no === "1")?.unit_cost).toBe(75);
  });

  it("is kept in this workspace's name, whatever the request says", async () => {
    await submit({ tenant_id: "t2", cost: 1 });
    expect(costs()[0].tenant_id).toBe(T1);
  });

  it("while migration 0230 is pending the bid still goes in, the deal still moves, and the answer says the cost was not stored", async () => {
    state.db.missing.add("tender_bid_version_costs");
    const res = await submit();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ version_no: 1, stage_moved: true, cost_snapshot: "pending" });
    expect(state.db.rows("tender_bid_versions")).toHaveLength(1);
    expect(state.db.rows("opportunities")[0].stage).toBe("submitted");
  });
});
