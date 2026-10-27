import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Contract buy-out (docs/design/contract-buyout.md), against the real routes and an in-memory database: a package of budget lines, a round of
// quotes per package (each its own RFQ, all kept), the award of the WHOLE package through the RFQ module's own award code, the reason rule, the
// un-award until the handover is sent, the Excel handover, the client's approved supplier list, another workspace's rows, the flags, a pending
// migration, and the promise that cost stays internal.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "11111111-1111-4111-8111-111111111111", email: "me@t1.test" },
  view: true,
  edit: true,
  rfqEdit: true,
  sent: [] as { supplier_id: string; rfq: string }[],
  seq: 0,
}));

const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const ACC = id(1), ACC_T2 = id(2);
const OPP = id(3), OPP_STD = id(4);
const PRJ = id(10), PRJ_MANUAL = id(11), PRJ_T2 = id(12);
const REV0 = id(20), REV1 = id(21), REV_T2 = id(22);
// Revision 1 (approved) lines, revision 0 (the bid's baseline) lines, and their stable keys.
const L1A = id(101), L1B = id(102), L1C = id(103), L1D = id(104), L1E = id(105), L1_T2 = id(106);
const L0A = id(111), L0B = id(112), L0C = id(113), L0D = id(114);
const KA = id(121), KB = id(122), KC = id(123), KD = id(124), KE = id(125);
const S1 = id(201), S2 = id(202), S3 = id(203), S4 = id(204), S5 = id(205), S9 = id(209);
const PKG_T2 = id(301);

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: "member", supabase: { from: (t: string) => state.db.from(t) } }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ id: "t1", slug: "kamco", name: "KAMCO", custom_domain: null, config: {}, features: state.features, company_info: null }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: () => state.view,
  canEditWorkcenter: (_p: unknown, wc: string) => (wc === "rfqs" ? state.rfqEdit : state.edit),
  canCreateWorkcenter: () => true,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/events/emitters", () => ({ emitRfqSent: async () => {}, emitRfqReplied: async () => {}, emitRfqAwarded: async () => {} }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-28", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: Record<string, unknown>) => { select: (s: string) => { single: () => Promise<unknown> } } } }, table: string, _tid: string, record: Record<string, unknown>, select: string) => {
    state.seq += 1;
    const ref = `PKG-${String(state.seq).padStart(4, "0")}`;
    const now = new Date().toISOString();
    return admin.from(table).insert({ ...record, ref, created_at: now, updated_at: now }).select(select).single();
  },
}));
// The RFQ module's own sending (mail, PDF) is its business; what matters here is who it was sent to and that the rest of the create code ran.
vi.mock("@/lib/rfq/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/rfq/server")>()),
  renderRfqPdf: async () => null,
  sendToSupplier: async (_a: unknown, args: { bundle: { rfq: { ref: string } }; rs: { supplier_id: string } }) => {
    state.sent.push({ supplier_id: args.rs.supplier_id, rfq: args.bundle.rfq.ref });
    // What the real send does to the header: a draft RFQ becomes "sent".
    for (const r of state.db.rows("rfqs")) if (r.ref === args.bundle.rfq.ref && r.status === "draft") r.status = "sent";
    return { ok: true, to: ["x@x.test"], redirected: false, via: "platform" };
  },
}));

import { NextRequest } from "next/server";
import { GET as summaryGet } from "./[id]/buyout/route";
import { POST as packagesPost } from "./[id]/buyout/packages/route";
import { GET as packageGet, PATCH as packagePatch, DELETE as packageDelete } from "./[id]/buyout/packages/[pid]/route";
import { GET as suppliersGet } from "./[id]/buyout/packages/[pid]/suppliers/route";
import { POST as roundsPost } from "./[id]/buyout/packages/[pid]/rounds/route";
import { POST as awardPost } from "./[id]/buyout/packages/[pid]/award/route";
import { POST as unawardPost } from "./[id]/buyout/packages/[pid]/unaward/route";
import { GET as handoverGet, POST as handoverPost } from "./[id]/buyout/packages/[pid]/handover/route";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = () => new NextRequest(new URL("http://internal.invalid/x"));
const ctx = (project: string, pid = "") => ({ params: Promise.resolve({ id: project, pid }) });
const rows = (t: string) => state.db.rows(t);
const body = async (res: Response) => (await res.json()) as Record<string, any>;

const summary = async (project = PRJ) => { const r = await summaryGet(get(), ctx(project)); return { status: r.status, json: await body(r) }; };
const detail = async (pid: string, project = PRJ) => { const r = await packageGet(get(), ctx(project, pid)); return { status: r.status, json: await body(r) }; };
const newPackage = async (lines: string[] = [L1A, L1B], over: Record<string, unknown> = {}, project = PRJ) => {
  const r = await packagesPost(json("POST", { name: "Pipes and valves", kind: "supplier", budget_line_ids: lines, ...over }), ctx(project));
  return { status: r.status, json: await body(r) };
};
const round = async (pid: string, supplier_ids: string[], extra: Record<string, unknown> = {}, project = PRJ) => {
  const r = await roundsPost(json("POST", { supplier_ids, ...extra }), ctx(project, pid));
  return { status: r.status, json: await body(r) };
};
const award = async (pid: string, b: Record<string, unknown>, project = PRJ) => { const r = await awardPost(json("POST", b), ctx(project, pid)); return { status: r.status, json: await body(r) }; };
const unaward = async (pid: string, b: Record<string, unknown>, project = PRJ) => { const r = await unawardPost(json("POST", b), ctx(project, pid)); return { status: r.status, json: await body(r) }; };
const markSent = async (pid: string, b: Record<string, unknown> = { action: "mark_sent" }, project = PRJ) => { const r = await handoverPost(json("POST", b), ctx(project, pid)); return { status: r.status, json: await body(r) }; };

/** The supplier answers a round: one price per line, in the order of the package. */
function reply(rfqId: string, supplierId: string, prices: (number | null)[], over: Record<string, unknown> = {}) {
  const rs = rows("rfq_suppliers").find((r) => r.rfq_id === rfqId && r.supplier_id === supplierId)!;
  const lines = rows("rfq_lines").filter((l) => l.rfq_id === rfqId).sort((a, b) => Number(a.sl_no) - Number(b.sl_no));
  prices.forEach((p, i) => {
    if (p === null) return;
    rows("rfq_responses").push({
      id: id(5000 + rows("rfq_responses").length), tenant_id: T1, rfq_supplier_id: rs.id, rfq_line_id: lines[i].id, status: "quoted", unit_price: p, currency: "SAR", fx_rate: null,
      lead_time_days: 14, moq: null, valid_until: "2026-12-31", note: null, source: "buyer", is_awarded: false, submitted_at: "2026-10-27T08:00:00Z", updated_at: "2026-10-27T08:00:00Z", ...over,
    });
  });
  rs.status = "replied";
  rs.replied_at = "2026-10-27T08:00:00Z";
}
const rfqsOf = (pid: string) => rows("rfqs").filter((r) => r.package_id === pid).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const currentAwards = () => rows("rfq_line_awards").filter((a) => !a.superseded_at);
const logged = () => state.changes.flatMap((c) => (c.changes ?? []).map((x) => `${c.objectType}: ${x.field}`));

const line = (lid: string, rev: string, key: string, n: number, over: Record<string, unknown>) => ({
  id: lid, tenant_id: T1, project_id: PRJ, revision_id: rev, line_no: n, line_key: key, resource_code: "11", cost_code: null, wbs: null, description: "x", qty: 1, unit: "no",
  unit_cost: 0, amount: 0, cost_known: true, source_ref: null, reserve: false, committed: null, actual: null, ...over,
});

function seed() {
  return new MemoryDb({
    tenants: [{ id: T1, config: {}, features: state.features }, { id: T2, config: {}, features: { gcc_tender: true, contract_projects: true } }],
    accounts: [{ id: ACC, tenant_id: T1, name: "Aramco" }, { id: ACC_T2, tenant_id: T2, name: "Other client" }],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "ARB-1 Fence", account_id: ACC },
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard deal", account_id: ACC },
    ],
    opportunity_tenders: [{ opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1" }],
    contract_projects: [
      { id: PRJ, tenant_id: T1, ref: "CPR-0001", name: "Plant 4 fence", account_id: ACC, source_opportunity_id: OPP, status: "active", contract_value: 100000, currency: "SAR", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { id: PRJ_MANUAL, tenant_id: T1, ref: "CPR-0002", name: "Started by hand", account_id: ACC, source_opportunity_id: null, status: "active", contract_value: 1, currency: "SAR", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { id: PRJ_T2, tenant_id: T2, ref: "CPR-9001", name: "Theirs", account_id: ACC_T2, source_opportunity_id: OPP_STD, status: "active", contract_value: 1, currency: "SAR", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ],
    project_budget_revisions: [
      { id: REV0, tenant_id: T1, project_id: PRJ, rev_no: 0, status: "superseded", total: 14700, created_at: "2026-10-01T00:00:00Z" },
      { id: REV1, tenant_id: T1, project_id: PRJ, rev_no: 1, status: "approved", total: 23000, created_at: "2026-10-10T00:00:00Z" },
      { id: REV_T2, tenant_id: T2, project_id: PRJ_T2, rev_no: 0, status: "approved", total: 5, created_at: "2026-10-01T00:00:00Z" },
    ],
    project_budget_lines: [
      line(L0A, REV0, KA, 1, { wbs: "1.1", description: "HDPE pipe 110mm", qty: 100, unit: "m", unit_cost: 90, amount: 9000, cost_code: "22 11 13" }),
      line(L0B, REV0, KB, 2, { wbs: "1.2", description: "Gate valve DN100", qty: 4, unit: "no", unit_cost: 425, amount: 1700 }),
      line(L0C, REV0, KC, 3, { wbs: "1.3", description: "Site labour", resource_code: "31", qty: 40, unit: "day", unit_cost: 125, amount: 5000 }),
      line(L0D, REV0, KD, 4, { description: "Contingency", amount: 1000, reserve: true }),
      line(L1A, REV1, KA, 1, { wbs: "1.1", description: "HDPE pipe 110mm", qty: 100, unit: "m", unit_cost: 100, amount: 10000, cost_code: "22 11 13" }),
      line(L1B, REV1, KB, 2, { wbs: "1.2", description: "Gate valve DN100", qty: 4, unit: "no", unit_cost: 500, amount: 2000 }),
      line(L1C, REV1, KC, 3, { wbs: "1.3", description: "Site labour", resource_code: "31", qty: 40, unit: "day", unit_cost: 125, amount: 5000 }),
      line(L1D, REV1, KD, 4, { description: "Contingency", amount: 1000, reserve: true }),
      line(L1E, REV1, KE, 5, { wbs: "2.1", description: "Extra gate (variation)", qty: 1, unit: "no", unit_cost: 3000, amount: 3000 }),
      { ...line(L1_T2, REV_T2, id(126), 1, { description: "Their line", amount: 5 }), tenant_id: T2, project_id: PRJ_T2 },
    ],
    erp_masters: [{ id: id(400), tenant_id: T1, kind: "cost_code", code: "22 11 13", name: "Facility Water Distribution Piping", active: true }],
    suppliers: [
      { id: S1, tenant_id: T1, ref: "SUP-0001", name: "Gulf Pipes", email: "sales@gulfpipes.test", phone: null, city: "Dammam", status: "active", type: "vendor" },
      { id: S2, tenant_id: T1, ref: "SUP-0002", name: "Desert Supply", email: "bids@desert.test", phone: null, city: "Riyadh", status: "active", type: "vendor" },
      { id: S3, tenant_id: T1, ref: "SUP-0003", name: "Outside Co", email: "x@outside.test", phone: null, city: null, status: "active", type: "both" },
      { id: S4, tenant_id: T1, ref: "SUP-0004", name: "No Email Ltd", email: null, phone: null, city: null, status: "active", type: "vendor" },
      { id: S5, tenant_id: T1, ref: "SUP-0005", name: "Retired Co", email: "r@retired.test", phone: null, city: null, status: "inactive", type: "vendor" },
      { id: S9, tenant_id: T2, ref: "SUP-0001", name: "Their supplier", email: "t@t.test", phone: null, city: null, status: "active", type: "vendor" },
    ],
    project_buyout_packages: [
      { id: PKG_T2, tenant_id: T2, project_id: PRJ_T2, ref: "PKG-9001", name: "Theirs", kind: "supplier", status: "draft", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ],
  });
}

beforeEach(() => {
  state.features = { gcc_tender: true, contract_projects: true, rfq: true, suppliers: true };
  state.db = seed();
  state.db.unique("project_buyout_package_lines", (a, b) => a.project_id === b.project_id && a.line_key === b.line_key);
  state.db.unique("rfq_line_awards", (e, n) => e.rfq_line_id === n.rfq_line_id && !e.superseded_at && !n.superseded_at);
  state.touched = []; state.changes = []; state.sent = []; state.seq = 0;
  state.view = true; state.edit = true; state.rfqEdit = true;
  state.user = { id: ME, email: "me@t1.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the gate", () => {
  it("a workspace without the tender edition or the module meets a 404 and no buy-out table is read", async () => {
    state.features.gcc_tender = false;
    expect((await summary()).status).toBe(404);
    state.features.gcc_tender = true; state.features.contract_projects = false;
    expect((await summary()).status).toBe(404);
    expect((await newPackage()).status).toBe(404);
    expect(state.touched).not.toContain("project_buyout_packages");
  });

  it("a person who may not open Contract Projects, a project started by hand, and another workspace's project are all the same 404", async () => {
    state.view = false;
    expect((await summary()).status).toBe(404);
    state.view = true;
    expect((await summary(PRJ_MANUAL)).status).toBe(404);
    expect((await summary(PRJ_T2)).status).toBe(404);
    expect((await summary("not-an-id")).status).toBe(404);
  });

  it("someone who can only view cannot change anything; a package of another workspace is a 404 even through this project's URL", async () => {
    state.edit = false;
    expect((await summary()).status).toBe(200);
    expect((await newPackage()).status).toBe(403);
    state.edit = true;
    expect((await detail(PKG_T2)).status).toBe(404);
    expect((await packagePatch(json("PATCH", { name: "Taken over" }), ctx(PRJ, PKG_T2))).status).toBe(404);
    expect((await packageDelete(json("DELETE"), ctx(PRJ, PKG_T2))).status).toBe(404);
    expect(rows("project_buyout_packages").find((p) => p.id === PKG_T2)!.name).toBe("Theirs");
  });

  it("while migration 0234 is pending the tab is told so and nothing crashes", async () => {
    state.db.missing.add("project_buyout_packages");
    const r = await summary();
    expect(r.status).toBe(503);
    expect(r.json.needsDatabaseUpdate).toBe(true);
    expect((await newPackage()).status).toBe(503);
  });
});

describe("packages", () => {
  it("the summary offers the approved budget's lines, leaves out reserve, and shows nothing else yet", async () => {
    const r = await summary();
    expect(r.status).toBe(200);
    expect(r.json.baseline).toEqual({ revision_id: REV1, rev_no: 1 });
    expect(r.json.restricted).toBe(false);
    expect(r.json.group).toBeNull();
    expect(r.json.packages).toEqual([]);
    expect(r.json.unassigned_lines.map((l: any) => l.id)).toEqual([L1A, L1B, L1C, L1E]);
    expect(r.json.unassigned_lines[0]).toMatchObject({ id: L1A, line_key: KA, wbs: "1.1", description: "HDPE pipe 110mm", qty: 100, unit: "m", amount: 10000, cost_code: "22 11 13" });
    expect(r.json.tiles).toMatchObject({ budget: 0, committed: 0, needs_decision: 0, packages: 0, project_budget: 20000, unassigned_budget: 20000 });
    expect(r.json.can_edit).toBe(true);
    expect(r.json.can_send_rounds).toBe(true);
  });

  it("makes a package: PKG ref, budget from the approved lines, the cost the bid started from, and the lines leave the unassigned list", async () => {
    const made = await newPackage();
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({
      ref: "PKG-0001", name: "Pipes and valves", kind: "supplier", status: "draft", line_count: 2, budget: 12000, bid_cost: 10700, best_quote: null, committed: null,
      against_budget: null, current_round: null, rounds: 0, handover: { state: "not_ready", sent_at: null },
    });
    const s = await summary();
    expect(s.json.unassigned_lines.map((l: any) => l.id)).toEqual([L1C, L1E]);
    expect(s.json.tiles).toMatchObject({ budget: 12000, packages: 1, unassigned_budget: 8000 });
    expect(logged()).toContain("contract_projects: Package PKG-0001 added");
    // The tenant and the project are the server's: a body cannot choose them.
    const stored = rows("project_buyout_packages").find((p) => p.ref === "PKG-0001")!;
    expect(stored).toMatchObject({ tenant_id: T1, project_id: PRJ, created_by: ME, status: "draft" });
    expect(rows("project_buyout_package_lines").map((l) => [l.line_key, l.tenant_id, l.project_id])).toEqual([[KA, T1, PRJ], [KB, T1, PRJ]]);
  });

  it("refuses a reserve line, a line that is not in this project's approved budget (another workspace's included), a line already in a package, and a missing baseline", async () => {
    expect((await newPackage([L1D])).status).toBe(422);
    expect((await newPackage([L1_T2])).status).toBe(422);
    expect((await newPackage([L0A])).status).toBe(422); // a line of the superseded revision is not the approved budget
    expect((await newPackage([id(999)])).status).toBe(422);
    expect((await newPackage([])).status).toBe(422);
    expect((await newPackage([L1A], { name: "" })).status).toBe(422);
    expect((await newPackage([L1A], { kind: "purchase" })).status).toBe(422);
    expect((await newPackage([L1A])).status).toBe(201);
    const again = await newPackage([L1A, L1C]);
    expect(again.status).toBe(409);
    expect(again.json.error).toContain("HDPE pipe 110mm");
    expect(rows("project_buyout_packages").filter((p) => p.tenant_id === T1)).toHaveLength(1);
    rows("project_budget_revisions").find((r) => r.id === REV1)!.status = "superseded";
    const none = await newPackage([L1C]);
    expect(none.status).toBe(409);
    expect(none.json.code).toBe("no_baseline");
  });

  it("a package follows the budget revision: after a new revision is approved the same lines (by line_key) are still its lines, at the new amounts", async () => {
    const made = await newPackage([L1A, L1B]);
    rows("project_budget_revisions").find((r) => r.id === REV1)!.status = "superseded";
    rows("project_budget_revisions").push({ id: id(23), tenant_id: T1, project_id: PRJ, rev_no: 2, status: "approved", total: 0, created_at: "2026-10-20T00:00:00Z" });
    rows("project_budget_lines").push(line(id(131), id(23), KA, 1, { wbs: "1.1", description: "HDPE pipe 110mm", qty: 100, unit: "m", amount: 11000 }), line(id(132), id(23), KB, 2, { wbs: "1.2", description: "Gate valve DN100", qty: 4, amount: 2000 }));
    const s = await summary();
    expect(s.json.baseline).toEqual({ revision_id: id(23), rev_no: 2 });
    expect(s.json.packages[0]).toMatchObject({ id: made.json.id, budget: 13000, bid_cost: 10700, line_count: 2 });
  });

  it("edits the name, kind and lines; the lines are fixed once a round was sent", async () => {
    const made = await newPackage([L1A]);
    const pid = made.json.id as string;
    const renamed = await packagePatch(json("PATCH", { name: "Pipes", kind: "subcontract", note: "ex-works" }), ctx(PRJ, pid));
    expect(renamed.status).toBe(200);
    expect(await body(renamed)).toMatchObject({ name: "Pipes", kind: "subcontract", note: "ex-works" });
    const lines = await packagePatch(json("PATCH", { budget_line_ids: [L1B, L1C] }), ctx(PRJ, pid));
    expect(lines.status).toBe(200);
    expect(await body(lines)).toMatchObject({ line_count: 2, budget: 7000 });
    expect((await packagePatch(json("PATCH", { budget_line_ids: [] }), ctx(PRJ, pid))).status).toBe(422);
    const other = await newPackage([L1E], { name: "Gate" });
    expect((await packagePatch(json("PATCH", { budget_line_ids: [L1B, L1E] }), ctx(PRJ, pid))).status).toBe(409); // L1E is in another package
    expect(other.status).toBe(201);
    expect((await round(pid, [S1])).status).toBe(201);
    const locked = await packagePatch(json("PATCH", { budget_line_ids: [L1B] }), ctx(PRJ, pid));
    expect(locked.status).toBe(409);
    expect((await body(locked)).code).toBe("lines_locked");
    expect((await packagePatch(json("PATCH", { name: "Still renamable" }), ctx(PRJ, pid))).status).toBe(200);
  });

  it("deletes a package that was never sent; one with a round is kept", async () => {
    const a = await newPackage([L1A], { name: "A" });
    const del = await packageDelete(json("DELETE"), ctx(PRJ, a.json.id));
    expect(del.status).toBe(200);
    expect(rows("project_buyout_packages").filter((p) => p.tenant_id === T1)).toHaveLength(0);
    expect((await summary()).json.unassigned_lines.map((l: any) => l.id)).toContain(L1A);
    const b = await newPackage([L1A], { name: "B" });
    expect((await round(b.json.id, [S1])).status).toBe(201);
    const refused = await packageDelete(json("DELETE"), ctx(PRJ, b.json.id));
    expect(refused.status).toBe(409);
    expect((await body(refused)).code).toBe("has_rounds");
  });
});

describe("rounds and the client's approved supplier list", () => {
  const group = (supplierIds: string[], over: Record<string, unknown> = {}) => {
    rows("supplier_groups").push({ id: id(600), tenant_id: T1, name: "Aramco approved vendors", account_id: ACC, active: true, ...over });
    for (const s of supplierIds) rows("supplier_group_members").push({ group_id: id(600), supplier_id: s, tenant_id: T1 });
  };

  it("with no list for the client every active supplier is offered and anyone may be asked", async () => {
    const pkg = (await newPackage()).json.id as string;
    const list = await suppliersGet(get(), ctx(PRJ, pkg));
    const j = await body(list);
    expect(j).toMatchObject({ restricted: false, group: null });
    expect(j.suppliers.map((s: any) => s.name)).toEqual(["Desert Supply", "Gulf Pipes", "No Email Ltd", "Outside Co"]);
    expect(j.suppliers.some((s: any) => s.id === S5 || s.id === S9)).toBe(false); // inactive, and another workspace's
    expect((await round(pkg, [S3])).status).toBe(201);
  });

  it("with an approved list ONLY its members are offered, and the server refuses anyone else naming them", async () => {
    group([S1, S2]);
    const pkg = (await newPackage()).json.id as string;
    const j = await body(await suppliersGet(get(), ctx(PRJ, pkg)));
    expect(j).toMatchObject({ restricted: true, group: { id: id(600), name: "Aramco approved vendors" } });
    expect(j.suppliers.map((s: any) => s.name)).toEqual(["Desert Supply", "Gulf Pipes"]);
    expect((await summary()).json).toMatchObject({ restricted: true, group: { name: "Aramco approved vendors" } });

    const refused = await round(pkg, [S1, S3, S4]);
    expect(refused.status).toBe(422);
    expect(refused.json.error).toContain("Outside Co");
    expect(refused.json.error).toContain("No Email Ltd");
    expect(refused.json.error).toContain("Aramco approved vendors");
    expect(refused.json.not_allowed.map((n: any) => n.name).sort()).toEqual(["No Email Ltd", "Outside Co"]);
    expect(rfqsOf(pkg)).toHaveLength(0);
    expect(state.sent).toHaveLength(0);

    const ok = await round(pkg, [S1, S2]);
    expect(ok.status).toBe(201);
    expect(rfqsOf(pkg)).toHaveLength(1);
  });

  it("an inactive list, an empty list, or a list of another client leaves all suppliers open", async () => {
    group([S1], { active: false });
    const pkg = (await newPackage()).json.id as string;
    expect((await body(await suppliersGet(get(), ctx(PRJ, pkg)))).restricted).toBe(false);
    rows("supplier_groups")[0].active = true;
    rows("supplier_group_members").length = 0;
    expect((await body(await suppliersGet(get(), ctx(PRJ, pkg)))).restricted).toBe(false);
    rows("supplier_groups")[0].account_id = id(77);
    rows("supplier_group_members").push({ group_id: id(600), supplier_id: S1, tenant_id: T1 });
    expect((await body(await suppliersGet(get(), ctx(PRJ, pkg)))).restricted).toBe(false);
  });

  it("a group of another workspace never restricts this one", async () => {
    rows("supplier_groups").push({ id: id(601), tenant_id: T2, name: "Theirs", account_id: ACC, active: true });
    rows("supplier_group_members").push({ group_id: id(601), supplier_id: S9, tenant_id: T2 });
    const pkg = (await newPackage()).json.id as string;
    expect((await body(await suppliersGet(get(), ctx(PRJ, pkg)))).restricted).toBe(false);
    expect((await round(pkg, [S1])).status).toBe(201);
  });

  it("sends the round through the RFQ module: one RFQ with every line, tied to the package, to each supplier, with nothing of the budget in it", async () => {
    const pkg = (await newPackage()).json.id as string;
    const r = await round(pkg, [S1, S2], { reply_by: "2026-11-05", note: "Please quote delivered to site" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ round: 1, sent: [{ ok: true }, { ok: true }] });
    expect(r.json.ref).toBe("RFQ-0001");
    expect(state.sent.map((s) => s.supplier_id).sort()).toEqual([S1, S2].sort());
    const rfq = rows("rfqs").find((x) => x.id === r.json.rfq_id)!;
    expect(rfq).toMatchObject({ tenant_id: T1, package_id: pkg, origin_type: "manual", respond_by: "2026-11-05", notes_to_supplier: "Please quote delivered to site", currency: "SAR" });
    expect(String(rfq.title)).toContain("PKG-0001");
    expect(String(rfq.origin_label)).toContain("CPR-0001");
    const lines = rows("rfq_lines").filter((l) => l.rfq_id === rfq.id).sort((a, b) => Number(a.sl_no) - Number(b.sl_no));
    expect(lines.map((l) => [l.description, l.uom, Number(l.qty)])).toEqual([["HDPE pipe 110mm", "m", 100], ["Gate valve DN100", "no", 4]]);
    const pkgLines = rows("project_buyout_package_lines").sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    expect(lines.map((l) => l.package_line_id)).toEqual(pkgLines.map((p) => p.id));
    expect(rows("rfq_suppliers").filter((s) => s.rfq_id === rfq.id).map((s) => s.supplier_id).sort()).toEqual([S1, S2].sort());
    // Cost stays inside: the supplier-facing records carry no budget amount, unit cost or bid cost.
    const blob = JSON.stringify([rfq, lines]);
    for (const secret of ["10000", "2000", "10700", "\"unit_cost\":", "amount", "budget", "bid_cost"]) expect(blob).not.toContain(secret);
    expect(rows("project_buyout_packages").find((p) => p.id === pkg)).toMatchObject({ status: "out", current_rfq_id: rfq.id });
    expect(logged().some((l) => l.includes("round 1 sent"))).toBe(true);
  });

  it("refuses an inactive supplier, another workspace's supplier, a supplier nobody can reach, and a person without the RFQ grant", async () => {
    const pkg = (await newPackage()).json.id as string;
    expect((await round(pkg, [S5])).status).toBe(422);
    expect((await round(pkg, [S9])).status).toBe(404);
    expect((await round(pkg, [id(998)])).status).toBe(404);
    const unreachable = await round(pkg, [S4]);
    expect(unreachable.status).toBe(422);
    expect(unreachable.json.unreachable).toEqual([{ supplier_id: S4, supplier: "No Email Ltd", has_phone: false }]);
    expect((await round(pkg, [])).status).toBe(422);
    expect((await round(pkg, [S1], { reply_by: "tomorrow" })).status).toBe(422);
    expect(rows("rfqs")).toHaveLength(0);
    state.rfqEdit = false;
    expect((await round(pkg, [S1])).status).toBe(403);
    expect((await summary()).json.can_send_rounds).toBe(false);
  });

  it("every round is its own RFQ and all are kept: round 2 never touches round 1", async () => {
    const pkg = (await newPackage()).json.id as string;
    const r1 = await round(pkg, [S1, S2]);
    reply(r1.json.rfq_id, S1, [105, 500]);
    const r2 = await round(pkg, [S1, S2], { note: "Final round" });
    expect(r2.json.round).toBe(2);
    expect(rfqsOf(pkg).map((r) => r.id)).toEqual([r1.json.rfq_id, r2.json.rfq_id]);
    expect(rows("rfq_responses").filter((r) => rows("rfq_suppliers").find((s) => s.id === r.rfq_supplier_id)!.rfq_id === r1.json.rfq_id)).toHaveLength(2);
    const d = (await detail(pkg)).json;
    expect(d.rounds.map((r: any) => [r.round, r.rfq_id, r.is_current])).toEqual([[2, r2.json.rfq_id, true], [1, r1.json.rfq_id, false]]);
    expect(d.rounds[1].quotes.find((q: any) => q.supplier_id === S1)).toMatchObject({ total: 12500, valid: true });
    expect(d.package).toMatchObject({ rounds: 2, current_round: 2, current_rfq_id: r2.json.rfq_id });
  });
});

describe("award, un-award and the handover", () => {
  // Prices (per unit, line A 100 m, line B 4 no): S1 105/500 = 12500 (over the 12000 budget), S2 91/450 = 10900 (cheapest complete), S3 quotes line A only.
  async function quoted() {
    const pkg = (await newPackage()).json.id as string;
    const r = await round(pkg, [S1, S2, S3]);
    const rfq = r.json.rfq_id as string;
    reply(rfq, S1, [105, 500]);
    reply(rfq, S2, [91, 450]);
    reply(rfq, S3, [85, null]);
    return { pkg, rfq };
  }

  it("shows the quotes side by side: a total only for a complete quote, the lowest valid one marked, and the package ready to award", async () => {
    const { pkg } = await quoted();
    const d = (await detail(pkg)).json;
    const quotes = Object.fromEntries(d.rounds[0].quotes.map((q: any) => [q.supplier_id, q]));
    expect(quotes[S1]).toMatchObject({ total: 12500, lines_quoted: 2, lines_total: 2, valid: true, lowest_valid: false, lead_days: 14, awarded: false });
    expect(quotes[S2]).toMatchObject({ total: 10900, valid: true, lowest_valid: true });
    expect(quotes[S3]).toMatchObject({ total: null, lines_quoted: 1, lines_total: 2, valid: false, lowest_valid: false });
    expect(d.package).toMatchObject({ status: "ready", best_quote: 10900, against_budget: 1100, committed: null });
    expect(d.budget_bars).toMatchObject({ budget: 12000, bid_cost: 10700, best_quote: 10900, committed: null, max: 12000 });
    expect(d.lines).toEqual([
      expect.objectContaining({ item_no: "1.1", description: "HDPE pipe 110mm", qty: 100, uom: "m", cost_code: "22 11 13", cost_in_bid: 9000, budget: 10000 }),
      expect.objectContaining({ item_no: "1.2", description: "Gate valve DN100", qty: 4, uom: "no", cost_in_bid: 1700, budget: 2000 }),
    ]);
    const s = await summary();
    expect(s.json.tiles).toMatchObject({ needs_decision: 1, best_vs_budget: 1100 });
    expect(s.json.packages[0]).toMatchObject({ status: "ready", best_quote: 10900, current_round: 1, rounds: 1 });
  });

  it("awards the WHOLE package to the lowest valid supplier without a reason: every line gets an award, the package records who, what and when", async () => {
    const { pkg, rfq } = await quoted();
    const r = await award(pkg, { rfq_id: rfq, supplier_id: S2 });
    expect(r.status).toBe(200);
    expect(r.json.row).toMatchObject({ status: "awarded", committed: 10900, against_budget: 1100, awarded_supplier_id: S2, awarded_supplier_name: "Desert Supply", handover: { state: "ready", sent_at: null } });
    const cur = currentAwards();
    expect(cur).toHaveLength(2);
    expect(cur.every((a) => a.rfq_id === rfq && a.supplier_id === S2 && a.chosen_by === ME && a.tenant_id === T1)).toBe(true);
    expect(rows("rfq_lines").filter((l) => l.rfq_id === rfq).map((l) => [l.status, Number(l.awarded_unit_cost)])).toEqual([["awarded", 91], ["awarded", 450]]);
    // S3's 85 on line A is lower than S2's 91: the per-line rule of the existing award still asks, and the package answers for it.
    expect(cur.find((a) => a.landed_unit === 91)).toMatchObject({ not_lowest: true, reason: "Package award on the lowest package total" });
    expect(rows("project_buyout_packages").find((p) => p.id === pkg)).toMatchObject({
      status: "awarded", awarded_rfq_id: rfq, awarded_supplier_id: S2, committed_amount: 10900, awarded_by: ME, award_reason: null, currency: "SAR",
    });
    expect(rows("project_buyout_packages").find((p) => p.id === pkg)!.awarded_at).toBeTruthy();
    const after = (await summary()).json;
    expect(after.tiles).toMatchObject({ committed: 10900, needs_decision: 0 });
    expect(after.committed_by_line).toEqual({ [KA]: 9100, [KB]: 1800 }); // for the Budget tab's Committed column
    await unaward(pkg, { reason: "checking the column" });
    expect((await summary()).json.committed_by_line).toEqual({});
    expect(logged().some((l) => l.includes("Package PKG-0001 awarded"))).toBe(true);
  });

  it("a supplier that is not the lowest valid total needs a reason; with one the award stands and an overspend only warns", async () => {
    const { pkg, rfq } = await quoted();
    const noReason = await award(pkg, { rfq_id: rfq, supplier_id: S1 });
    expect(noReason.status).toBe(422);
    expect(noReason.json).toMatchObject({ code: "reason_required", why: "higher", lowest_valid: 10900, chosen_total: 12500 });
    expect(currentAwards()).toHaveLength(0);
    expect((await award(pkg, { rfq_id: rfq, supplier_id: S1, reason: "ok" })).status).toBe(422); // under 3 characters
    const done = await award(pkg, { rfq_id: rfq, supplier_id: S1, reason: "Only one with local stock" });
    expect(done.status).toBe(200);
    expect(done.json.row).toMatchObject({ status: "awarded", committed: 12500, against_budget: -500 });
    expect(rows("project_buyout_packages").find((p) => p.id === pkg)).toMatchObject({ award_reason: "Only one with local stock", committed_amount: 12500 });
    expect(currentAwards().every((a) => a.reason === "Only one with local stock")).toBe(true);
    expect(logged().some((l) => l.includes("award reason"))).toBe(true);
  });

  it("refuses a supplier that did not quote every line, a round or supplier that is not this package's, a second award, and a person without the RFQ grant", async () => {
    const { pkg, rfq } = await quoted();
    const incomplete = await award(pkg, { rfq_id: rfq, supplier_id: S3, reason: "cheapest on pipes" });
    expect(incomplete.status).toBe(422);
    expect(incomplete.json.code).toBe("incomplete_quote");
    expect((await award(pkg, { rfq_id: id(997), supplier_id: S2 })).status).toBe(404);
    expect((await award(pkg, { rfq_id: rfq, supplier_id: S4 })).status).toBe(404); // not on the round
    expect((await award(pkg, { rfq_id: "nope", supplier_id: S2 })).status).toBe(422);
    // A round of ANOTHER package cannot be awarded through this one.
    const other = (await newPackage([L1C], { name: "Labour" })).json.id as string;
    const otherRound = await round(other, [S1]);
    reply(otherRound.json.rfq_id, S1, [125]);
    expect((await award(pkg, { rfq_id: otherRound.json.rfq_id, supplier_id: S1, reason: "wrong package" })).status).toBe(404);
    state.rfqEdit = false;
    expect((await award(pkg, { rfq_id: rfq, supplier_id: S2 })).status).toBe(403);
    state.rfqEdit = true;
    expect((await award(pkg, { rfq_id: rfq, supplier_id: S2 })).status).toBe(200);
    const twice = await award(pkg, { rfq_id: rfq, supplier_id: S1, reason: "changed my mind" });
    expect(twice.status).toBe(409);
    expect(twice.json.code).toBe("already_awarded");
    expect(currentAwards()).toHaveLength(2);
  });

  it("an expired answer is not the lowest valid one: cheaper but out of date needs a reason", async () => {
    const pkg = (await newPackage()).json.id as string;
    const r = await round(pkg, [S1, S2]);
    reply(r.json.rfq_id, S1, [105, 500]);
    reply(r.json.rfq_id, S2, [50, 50], { valid_until: "2026-10-01" });
    const d = (await detail(pkg)).json;
    expect(d.rounds[0].quotes.find((q: any) => q.supplier_id === S2)).toMatchObject({ total: 5200, valid: false, lowest_valid: false });
    expect(d.package.best_quote).toBe(12500);
    const refused = await award(pkg, { rfq_id: r.json.rfq_id, supplier_id: S2 });
    expect(refused.status).toBe(422);
    expect(refused.json.why).toBe("expired");
  });

  it("un-awards with a reason: the RFQ module's awards are superseded (history kept), the package is open again, and it can be awarded again", async () => {
    const { pkg, rfq } = await quoted();
    expect((await unaward(pkg, { reason: "no longer awarded" })).status).toBe(409); // not awarded yet
    await award(pkg, { rfq_id: rfq, supplier_id: S2 });
    expect((await unaward(pkg, {})).status).toBe(422);
    const undone = await unaward(pkg, { reason: "Supplier withdrew the price" });
    expect(undone.status).toBe(200);
    expect(undone.json.row).toMatchObject({ status: "ready", committed: null, awarded_supplier_id: null, best_quote: 10900 });
    expect(currentAwards()).toHaveLength(0);
    expect(rows("rfq_line_awards")).toHaveLength(2); // the decision stays in the record
    expect(rows("rfq_line_awards").every((a) => a.superseded_at)).toBe(true);
    expect(rows("rfq_lines").filter((l) => l.rfq_id === rfq).every((l) => l.status === "no_award" && l.awarded_unit_cost === null)).toBe(true);
    expect(rows("project_buyout_packages").find((p) => p.id === pkg)).toMatchObject({ status: "out", awarded_rfq_id: null, awarded_supplier_id: null, committed_amount: null, award_reason: null });
    expect(logged().some((l) => l.includes("award undone"))).toBe(true);
    const again = await award(pkg, { rfq_id: rfq, supplier_id: S1, reason: "Client prefers them" });
    expect(again.status).toBe(200);
    expect(again.json.row).toMatchObject({ status: "awarded", committed: 12500, awarded_supplier_id: S1 });
    expect(currentAwards()).toHaveLength(2);
    expect(rows("rfq_line_awards")).toHaveLength(4);
  });

  it("a new round after an un-award: awarding an older round is held against the CURRENT round's lowest valid total", async () => {
    const { pkg, rfq } = await quoted();
    await award(pkg, { rfq_id: rfq, supplier_id: S2 });
    await unaward(pkg, { reason: "Re-quote to improve price" });
    const r2 = await round(pkg, [S1, S2]);
    reply(r2.json.rfq_id, S1, [80, 400]); // 9600
    reply(r2.json.rfq_id, S2, [95, 480]); // 11420
    const d = (await detail(pkg)).json;
    expect(d.package).toMatchObject({ current_round: 2, best_quote: 9600, rounds: 2 });
    expect(d.rounds).toHaveLength(2);
    const old = await award(pkg, { rfq_id: rfq, supplier_id: S2 });
    expect(old.status).toBe(422);
    expect(old.json).toMatchObject({ code: "reason_required", why: "higher", lowest_valid: 9600, chosen_total: 10900 });
    const okOld = await award(pkg, { rfq_id: rfq, supplier_id: S2, reason: "Round 1 terms include free delivery" });
    expect(okOld.status).toBe(200);
    expect(okOld.json.row).toMatchObject({ committed: 10900, status: "awarded" });
    expect(rows("project_buyout_packages").find((p) => p.id === pkg)!.awarded_rfq_id).toBe(rfq);
    // The newer round's lines were never touched.
    expect(rows("rfq_lines").filter((l) => l.rfq_id === r2.json.rfq_id).every((l) => l.status !== "awarded" && !l.awarded_unit_cost)).toBe(true);
    const d2 = (await detail(pkg)).json;
    expect(d2.rounds.find((r: any) => r.rfq_id === rfq).quotes.find((q: any) => q.supplier_id === S2).awarded).toBe(true);
    expect(d2.rounds.find((r: any) => r.rfq_id === r2.json.rfq_id).quotes.some((q: any) => q.awarded)).toBe(false);
  });

  it("the handover Excel holds the supplier, the lines, the awarded rates and the round, and none of the budget, the bid cost or a markup", async () => {
    const { pkg, rfq } = await quoted();
    expect((await handoverGet(get(), ctx(PRJ, pkg))).status).toBe(409); // before the award
    await award(pkg, { rfq_id: rfq, supplier_id: S2 });
    const res = await handoverGet(get(), ctx(PRJ, pkg));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("PKG-0001-handover.xlsx");
    const { default: Excel } = await import("exceljs");
    const wb = new Excel.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const cells: unknown[] = [];
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => cells.push(c.value))));
    const text = cells.map(String).join("|");
    for (const needed of ["Desert Supply", "SUP-0002", "RFQ-0001", "Round 1", "HDPE pipe 110mm", "Gate valve DN100", "22 11 13", "Facility Water Distribution Piping", "Plant 4 fence", "Aramco"]) expect(text).toContain(needed);
    const numbers = new Set(cells.filter((c): c is number => typeof c === "number"));
    for (const wanted of [91, 450, 9100, 1800, 10900, 100, 4]) expect(numbers.has(wanted), String(wanted)).toBe(true);
    for (const secret of [10000, 2000, 12000, 9000, 1700, 10700, 100000, 5000]) expect(numbers.has(secret), `leaked ${secret}`).toBe(false);
    for (const word of ["Budget", "Bid cost", "Markup", "margin", "Margin", "Award reason"]) expect(text).not.toContain(word);
  }, 120_000);

  it("marking the handover as sent records when, who and the ERP's reference, and from then on the award cannot be undone or changed", async () => {
    const { pkg, rfq } = await quoted();
    expect((await markSent(pkg)).status).toBe(409); // not awarded
    expect((await markSent(pkg, { action: "other" })).status).toBe(422);
    await award(pkg, { rfq_id: rfq, supplier_id: S2 });
    const sent = await markSent(pkg, { action: "mark_sent", erp_ref: "  PO-4500012345  " });
    expect(sent.status).toBe(200);
    expect(sent.json.row).toMatchObject({ status: "handed_over", handover: { state: "sent" } });
    expect(sent.json.row.handover.sent_at).toBeTruthy();
    expect(rows("project_buyout_packages").find((p) => p.id === pkg)).toMatchObject({ status: "handed_over", handover_sent_by: ME, erp_ref: "PO-4500012345" });
    const d = (await detail(pkg)).json;
    expect(d.handover).toMatchObject({ state: "sent", erp_ref: "PO-4500012345" });
    expect(d.lines_locked).toBe(true);
    const blocked = await unaward(pkg, { reason: "too late to undo" });
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("handed_over");
    expect(currentAwards()).toHaveLength(2);
    expect((await markSent(pkg)).status).toBe(409);
    expect((await award(pkg, { rfq_id: rfq, supplier_id: S1, reason: "again" })).status).toBe(409);
    expect((await round(pkg, [S1])).status).toBe(409);
    expect((await packagePatch(json("PATCH", { budget_line_ids: [L1A] }), ctx(PRJ, pkg))).status).toBe(409);
    expect((await handoverGet(get(), ctx(PRJ, pkg))).status).toBe(200); // the file can still be downloaded
    expect(logged().some((l) => l.includes("handed over"))).toBe(true);
  }, 60_000);

  it("a package of another workspace cannot be awarded, un-awarded or handed over through this project", async () => {
    expect((await award(PKG_T2, { rfq_id: id(1), supplier_id: S9 })).status).toBe(404);
    expect((await unaward(PKG_T2, { reason: "stealing" })).status).toBe(404);
    expect((await markSent(PKG_T2)).status).toBe(404);
    expect((await handoverGet(get(), ctx(PRJ, PKG_T2))).status).toBe(404);
    expect((await round(PKG_T2, [S1])).status).toBe(404);
    expect(rows("project_buyout_packages").find((p) => p.id === PKG_T2)).toMatchObject({ status: "draft", name: "Theirs" });
  });

  it("every write it makes is on this workspace's rows", async () => {
    const { pkg, rfq } = await quoted();
    await award(pkg, { rfq_id: rfq, supplier_id: S2 });
    await unaward(pkg, { reason: "testing the tenant" });
    for (const t of ["project_buyout_packages", "project_buyout_package_lines", "rfqs", "rfq_lines", "rfq_suppliers", "rfq_line_awards"]) {
      expect(rows(t).filter((r) => r.tenant_id !== T1 && r.id !== PKG_T2), t).toEqual([]);
    }
  });
});
