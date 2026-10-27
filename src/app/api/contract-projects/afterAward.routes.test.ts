import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23), against an in-memory database: the project's budget starting
// from the winning bid's recorded cost, where it came from, variations (priced, approved, moving the contract value and opening a budget
// revision) and the invoicing milestones with the invoice made from one. The questions asked are the design's: another workspace's rows,
// the flag off, a view-only person, who may approve, a double click, the source of the budget, and the migrations still pending.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
  view: true,
  edit: true,
  sent: [] as { from: string; to: string[]; subject: string; text: string }[],
  seq: {} as Record<string, number>,
  invoicePosts: [] as Record<string, unknown>[],
  invoiceFails: false,
}));

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const ASKER = "11111111-1111-4111-8111-111111111111";
const BOSS = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_USER = "99999999-9999-4999-8999-999999999999";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const T2_PROJECT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const T2_VARIATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const T2_MILESTONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: state.config, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: () => state.view,
  canEditWorkcenter: () => state.edit,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) =>
    Object.entries(a).filter(([k, v]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: b[field] ?? null, to })),
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: Record<string, unknown>) => { select: (s: string) => { single: () => Promise<unknown> } } } }, table: string, _tid: string, record: Record<string, unknown>, select: string) => {
    const prefix = table === "contract_project_variations" ? "VAR" : "CPR";
    state.seq[table] = (state.seq[table] ?? 0) + 1;
    const ref = `${prefix}-${String(state.seq[table]).padStart(4, "0")}`;
    const now = new Date().toISOString();
    return admin.from(table).insert({ ...record, ref, created_at: now, updated_at: now }).select(select).single();
  },
}));
vi.mock("@/app/api/invoices/route", () => ({
  POST: async (req: Request) => {
    const { NextResponse } = await import("next/server");
    const body = (await req.json()) as Record<string, unknown>;
    state.invoicePosts.push(body);
    if (state.invoiceFails) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    const n = state.db.rows("invoices").length + 1;
    const inv = { id: `99999999-9999-4999-8999-${String(n).padStart(12, "0")}`, ref: `INV-${String(n).padStart(4, "0")}`, tenant_id: T1, account_id: body.account_id, status: "draft", total: 0, custom_data: null };
    state.db.rows("invoices").push(inv);
    return NextResponse.json({ id: inv.id, ref: inv.ref }, { status: 201 });
  },
}));
vi.mock("resend", () => ({
  Resend: class { emails = { send: async (p: { from: string; to: string[]; subject: string; text: string }) => { state.sent.push(p); return { error: null }; } }; },
}));

import { NextRequest } from "next/server";
import { POST as createPost } from "./route";
import { GET as oneGet } from "./[id]/route";
import { GET as budgetGet, PUT as budgetPut } from "./[id]/budget/route";
import { GET as revisionsGet } from "./[id]/revisions/route";
import { POST as askPost } from "./[id]/approval/route";
import { PATCH as decide } from "./[id]/approval/[requestId]/route";
import { GET as variationsGet, POST as variationsPost } from "./[id]/variations/route";
import { PATCH as variationPatch, DELETE as variationDelete } from "./[id]/variations/[variationId]/route";
import { GET as milestonesGet, POST as milestonesPost } from "./[id]/milestones/route";
import { PATCH as milestonePatch, DELETE as milestoneDelete } from "./[id]/milestones/[milestoneId]/route";
import { POST as milestoneInvoice } from "./[id]/milestones/[milestoneId]/invoice/route";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (qs = "") => new NextRequest(new URL(`http://internal.invalid/x${qs}`));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const vctx = (id: string, variationId: string) => ({ params: Promise.resolve({ id, variationId }) });
const mctx = (id: string, milestoneId: string) => ({ params: Promise.resolve({ id, milestoneId }) });
const dctx = (id: string, requestId: string) => ({ params: Promise.resolve({ id, requestId }) });
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };
const rows = (t: string) => state.db.rows(t);
const mine = (t: string) => rows(t).filter((r) => r.tenant_id === T1);
const varRequests = () => mine("approval_requests").filter((r) => r.kind === "project_variation");
const NEW_TABLES = ["contract_project_variations", "contract_project_milestones", "tender_bid_version_costs"];

const WINNING_COST = {
  v: 1, margin_pct: 15, warnings: [],
  lines: [
    {
      key: "no:1.1", item_no: "1.1", unit_cost: 130, markup_pct: 50, cost_code: "32 31 13", estimated: false, from_estimate: false, cost_total: 13000,
      lines: [{ resource_code: "11", cost_code: "32 31 13", wbs: "1.1", description: "Chain link fence 2.4m", qty: 100, unit: "m", unit_cost: 130, cost_known: true, source_ref: "Cost from RFQ-0004", reserve: false }],
    },
    {
      key: "no:1.2", item_no: "1.2", unit_cost: null, markup_pct: null, cost_code: "99 99 99", estimated: true, from_estimate: false, cost_total: 1800,
      lines: [{ resource_code: "11", cost_code: "99 99 99", wbs: "1.2", description: "Excavation", qty: 50, unit: "m3", unit_cost: 36, cost_known: false, source_ref: "Estimated: rate less 15% margin", reserve: false }],
    },
  ],
};

function seed() {
  return new MemoryDb({
    tenants: [
      { id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "kamco.example.com" },
      { id: T2, slug: "other", name: "Other", is_demo: false, config: {}, custom_domain: null },
    ],
    tenant_users: [
      { tenant_id: T1, user_id: ASKER, role: "member" }, { tenant_id: T1, user_id: BOSS, role: "admin" }, { tenant_id: T2, user_id: OTHER_TENANT_USER, role: "admin" },
    ],
    accounts: [{ id: ACC, tenant_id: T1, name: "Aramco" }, { id: ACC_T2, tenant_id: T2, name: "Other client" }],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-1", title: "ARB-1 Fence for Plant 4", account_id: ACC, stage: "awarded", outcome: "won", amount: 100000, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
      { id: OPP_T2, tenant_id: T2, ref: "OPP-9", title: "Other workspace", account_id: ACC_T2, stage: "awarded", outcome: "won", amount: 1, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", issuer_name: "Aramco", portal: "ariba", bond_status: "held", reminders_sent: [], addenda_count: 0 },
      { opportunity_id: OPP_T2, tenant_id: T2, tender_no: "X-1", issuer_name: "X", portal: "email", bond_status: "held", reminders_sent: [], addenda_count: 0 },
    ],
    opportunity_lines: [
      { id: "l1", tenant_id: T1, opportunity_id: OPP, sl_no: "1.1", description: "Chain link fence 2.4m", uom: "m", qty: 100, rate: 200, discount_pct: 0, amount: 20000, is_selected: true, break_of: null },
      { id: "l2", tenant_id: T1, opportunity_id: OPP, sl_no: "1.2", description: "Excavation", uom: "m3", qty: 50, rate: 40, discount_pct: 0, amount: 2000, is_selected: true, break_of: null },
    ],
    tender_boq_lines: [
      { id: "b1", tenant_id: T1, opportunity_id: OPP, line_id: "l1", item_no: "1.1", cost_code: "32 31 13", unit_cost: 120, price_source: "supplier", price_source_ref: "RFQ-0004" },
      { id: "b2", tenant_id: T1, opportunity_id: OPP, line_id: "l2", item_no: "1.2", cost_code: "99 99 99", unit_cost: null, price_source: null, price_source_ref: null },
    ],
    tender_boq_sources: [{ id: "s1", tenant_id: T1, opportunity_id: OPP, file_name: "ARB-1-BOQ.xlsx", uploaded_at: "2026-10-05T00:00:00Z", version: 2, is_current: true }],
    invoices: [],
    contract_projects: [{ id: T2_PROJECT, tenant_id: T2, ref: "CPR-9001", name: "Other tenant's project", account_id: ACC_T2, source_opportunity_id: OPP_T2, status: "active", contract_value: 10, currency: "SAR", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    contract_project_variations: [{ id: T2_VARIATION, tenant_id: T2, project_id: T2_PROJECT, ref: "VAR-9001", title: "Secret change", status: "submitted", amount: 1, cost_amount: 1, submitted_by: OTHER_TENANT_USER }],
    contract_project_milestones: [{ id: T2_MILESTONE, tenant_id: T2, project_id: T2_PROJECT, title: "Other advance", basis: "fixed", percent: null, fixed_amount: 5, status: "planned", invoice_id: null, sort_order: 10 }],
  });
}

beforeEach(() => {
  state.db = seed();
  state.db.users.set(ASKER, { email: "asker@kamco.test", name: "S. Khan" });
  state.db.users.set(BOSS, { email: "boss@kamco.test", name: "A. Nasser" });
  state.db.unique("contract_projects", (a, b) => a.tenant_id === b.tenant_id && !!a.source_opportunity_id && a.source_opportunity_id === b.source_opportunity_id);
  state.db.unique("erp_masters", (a, b) => a.tenant_id === b.tenant_id && a.kind === b.kind && a.code === b.code);
  state.db.unique("project_budget_revisions", (a, b) => a.project_id === b.project_id && ["draft", "pending"].includes(String(a.status)) && ["draft", "pending"].includes(String(b.status)));
  state.features = { pipeline: true, gcc_tender: true, contract_projects: true, invoices: true };
  state.config = {};
  state.touched = []; state.changes = []; state.sent = []; state.seq = {}; state.invoicePosts = []; state.invoiceFails = false;
  state.view = true; state.edit = true;
  as(ASKER);
  process.env.RESEND_API_KEY = "test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function fromTender() {
  const res = await createPost(json("POST", { opportunity_id: OPP }));
  const j = await res.json();
  return { res, ...j } as { res: Response; id: string; ref: string; revision_id: string; cost_source: string; budget_note: string; estimated: number; unmapped_codes: string[] };
}
const goodLines = () => [
  { description: "Fence", resource_code: "11", cost_code: "32 31 13", qty: 100, unit: "m", unit_cost: 120 },
  { description: "Labour", resource_code: "31", cost_code: null, qty: 40, unit: "day", unit_cost: 250 },
];
async function withBaseline() {
  const p = await fromTender();
  await budgetPut(json("PUT", { revision_id: p.revision_id, lines: goodLines() }), ctx(p.id));
  as(ASKER);
  const ask = await askPost(json("POST", {}), ctx(p.id));
  const { id: requestId } = await ask.json();
  as(BOSS, "admin");
  await decide(json("PATCH", { action: "approve" }), dctx(p.id, requestId));
  as(ASKER);
  return p;
}
const project = (id: string) => rows("contract_projects").find((r) => r.id === id)!;
async function newVariation(p: { id: string }, body: Record<string, unknown> = {}) {
  const res = await variationsPost(json("POST", { title: "Extra gate", amount: 5000, cost_amount: 3000, change_request_ref: "CR-7", ...body }), ctx(p.id));
  return { res, ...(await res.json()) } as { res: Response; id: string; ref: string };
}
async function submitVariation(p: { id: string }, v: { id: string }) {
  return variationPatch(json("PATCH", { action: "submit" }), vctx(p.id, v.id));
}
async function approveVariation(p: { id: string }, v: { id: string }, action: "approve" | "reject" = "approve", comment?: string) {
  as(BOSS, "admin");
  const res = await variationPatch(json("PATCH", { action, comment }), vctx(p.id, v.id));
  as(ASKER);
  return res;
}

describe("the module is off", () => {
  it("every new route answers 404 and the new tables are never touched", async () => {
    state.features = { pipeline: true, gcc_tender: true, contract_projects: false, invoices: true };
    const id = T2_PROJECT;
    const answers = [
      await variationsGet(get(), ctx(id)), await variationsPost(json("POST", { title: "x" }), ctx(id)),
      await variationPatch(json("PATCH", { action: "approve" }), vctx(id, T2_VARIATION)), await variationDelete(json("DELETE"), vctx(id, T2_VARIATION)),
      await milestonesGet(get(), ctx(id)), await milestonesPost(json("POST", { title: "x", basis: "fixed", fixed_amount: 1 }), ctx(id)),
      await milestonePatch(json("PATCH", { title: "y" }), mctx(id, T2_MILESTONE)), await milestoneDelete(json("DELETE"), mctx(id, T2_MILESTONE)), await milestoneInvoice(json("POST"), mctx(id, T2_MILESTONE)),
    ];
    for (const a of answers) expect(a.status).toBe(404);
    expect(state.touched.filter((t) => NEW_TABLES.includes(t) || t === "invoices")).toEqual([]);
    expect(rows("invoices")).toHaveLength(0);
  });

  it("a person who may only view cannot change anything, but can read", async () => {
    const p = await fromTender();
    const v = await newVariation(p);
    await milestonesPost(json("POST", { title: "Advance", basis: "percent", percent: 30 }), ctx(p.id));
    state.edit = false;
    expect((await variationsGet(get(), ctx(p.id))).status).toBe(200);
    expect((await milestonesGet(get(), ctx(p.id))).status).toBe(200);
    expect((await variationsPost(json("POST", { title: "x" }), ctx(p.id))).status).toBe(403);
    expect((await submitVariation(p, v)).status).toBe(403);
    expect((await variationPatch(json("PATCH", { title: "y" }), vctx(p.id, v.id))).status).toBe(403);
    expect((await variationDelete(json("DELETE"), vctx(p.id, v.id))).status).toBe(403);
    expect((await milestonesPost(json("POST", { title: "x", basis: "fixed", fixed_amount: 1 }), ctx(p.id))).status).toBe(403);
    const m = mine("contract_project_milestones")[0];
    expect((await milestoneInvoice(json("POST"), mctx(p.id, String(m.id)))).status).toBe(403);
    expect(rows("invoices")).toHaveLength(0);
  });
});

describe("the budget starts from the winning bid's recorded cost", () => {
  function bidVersions(withCost: boolean) {
    rows("tender_bid_versions").push(
      { id: "bv1", tenant_id: T1, opportunity_id: OPP, version_no: 1, submitted_at: "2026-10-08T08:00:00Z", currency: "SAR", total: 21000, line_count: 2 },
      { id: "bv2", tenant_id: T1, opportunity_id: OPP, version_no: 2, submitted_at: "2026-10-12T08:00:00Z", currency: "SAR", total: 22000, line_count: 2 },
    );
    if (withCost) rows("tender_bid_version_costs").push({ id: "bc2", tenant_id: T1, opportunity_id: OPP, version_no: 2, total_cost: 14800, line_count: 2, snapshot: WINNING_COST });
  }

  it("uses the LAST version's cost instead of the current BOQ, and says so in the baseline's note", async () => {
    bidVersions(true);
    // An earlier version's cost must not be the one used.
    rows("tender_bid_version_costs").push({ id: "bc1", tenant_id: T1, opportunity_id: OPP, version_no: 1, total_cost: 1, line_count: 1, snapshot: { v: 1, margin_pct: 15, warnings: [], lines: [] } });
    const p = await fromTender();
    expect(p.res.status).toBe(201);
    expect(p.cost_source).toBe("bid_version_2");
    expect(p.budget_note).toBe("Started from bid version 2 (submitted 2026-10-12): the cost recorded when the bid went in.");
    const lines = mine("project_budget_lines");
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => String(l.description).startsWith("Chain link"))).toMatchObject({ unit_cost: 130, amount: 13000, cost_code: "32 31 13", cost_known: true });
    expect(lines.find((l) => l.description === "Excavation")).toMatchObject({ unit_cost: 36, cost_known: false, cost_code: null });
    expect(String(lines.find((l) => l.description === "Excavation")!.source_ref)).toContain("99 99 99 is not in your cost codes");
    expect(p.unmapped_codes).toEqual(["99 99 99"]);
    expect(p.estimated).toBe(1);
    const rev = mine("project_budget_revisions")[0];
    expect(rev).toMatchObject({ rev_no: 0, total: 14800, justification_text: p.budget_note });
  });

  it("falls back to the current BOQ for a version submitted before costs were stored, and says why", async () => {
    bidVersions(false);
    const p = await fromTender();
    expect(p.cost_source).toBe("boq");
    expect(p.budget_note).toBe("Started from the current BOQ: bid version 2 was submitted before bid costs were stored.");
    expect(mine("project_budget_lines").find((l) => String(l.description).startsWith("Chain link"))).toMatchObject({ unit_cost: 120 });
    expect(mine("project_budget_revisions")[0].justification_text).toBe(p.budget_note);
  });

  it("falls back to the current BOQ when no bid version was ever submitted", async () => {
    const p = await fromTender();
    expect(p.budget_note).toBe("Started from the current BOQ: no bid version was submitted for this tender.");
  });

  it("falls back, and still works, while migration 0230 is pending", async () => {
    bidVersions(true);
    rows("tender_bid_version_costs").length = 0;
    state.db.missing.add("tender_bid_version_costs");
    const p = await fromTender();
    expect(p.res.status).toBe(201);
    expect(p.budget_note).toContain("before bid costs were stored");
  });

  it("another workspace's bid cost is never used", async () => {
    rows("tender_bid_versions").push({ id: "bvx", tenant_id: T2, opportunity_id: OPP, version_no: 5, submitted_at: "2026-10-12T08:00:00Z", currency: "SAR", total: 1, line_count: 1 });
    rows("tender_bid_version_costs").push({ id: "bcx", tenant_id: T2, opportunity_id: OPP, version_no: 5, total_cost: 1, line_count: 1, snapshot: WINNING_COST });
    const p = await fromTender();
    expect(p.budget_note).toBe("Started from the current BOQ: no bid version was submitted for this tender.");
  });
});

describe("where the project came from, and the bid against the budget", () => {
  it("the project is given the tender, the winning version, the BOQ file and the estimates used, and the bid's cost against its budget", async () => {
    rows("tender_bid_versions").push({ id: "bv2", tenant_id: T1, opportunity_id: OPP, version_no: 2, submitted_at: "2026-10-12T08:00:00Z", currency: "SAR", total: 22000, line_count: 2 });
    rows("tender_bid_version_costs").push({ id: "bc2", tenant_id: T1, opportunity_id: OPP, version_no: 2, total_cost: 14800, line_count: 2, snapshot: WINNING_COST });
    rows("tender_boq_estimate_links").push({ tenant_id: T1, opportunity_id: OPP, estimate_id: "e1" }, { tenant_id: T1, opportunity_id: OPP, estimate_id: "e1" });
    rows("estimates").push({ id: "e1", tenant_id: T1, opportunity_id: OPP, ref: "EST-0003", name: "Fence build-up" }, { id: "e2", tenant_id: T2, opportunity_id: OPP, ref: "EST-9999", name: "Not ours" });
    const p = await withBaseline();
    const view = await (await oneGet(get(), ctx(p.id))).json();
    expect(view.origin).toMatchObject({
      deal: { id: OPP, ref: "OPP-1" }, bid: { version_no: 2, total: 22000, currency: "SAR" }, boq: { file_name: "ARB-1-BOQ.xlsx", version: 2 },
      estimates: [{ id: "e1", ref: "EST-0003" }],
    });
    // The approved budget is 22000 (the person edited the lines); the bid's cost was 14800.
    expect(view.bidAgainstBudget).toMatchObject({ available: true, version_no: 2, figures: { bid_price: 22000, bid_cost: 14800, budget: 22000, delta: 7200 } });
    expect(view.bidAgainstBudget.figures.delta_pct).toBeCloseTo(48.6, 1);
  });

  it("says plainly when the winning bid has no stored cost, and shows nothing for a project made by hand", async () => {
    rows("tender_bid_versions").push({ id: "bv1", tenant_id: T1, opportunity_id: OPP, version_no: 1, submitted_at: "2026-10-08T08:00:00Z", currency: "SAR", total: 21000, line_count: 2 });
    const p = await fromTender();
    const view = await (await oneGet(get(), ctx(p.id))).json();
    expect(view.bidAgainstBudget).toEqual({ available: false, version_no: 1 });
    const hand = await (await createPost(json("POST", { name: "Pump station", contract_value: 1000 }))).json();
    const handView = await (await oneGet(get(), ctx(hand.id))).json();
    expect(handView.origin).toBeNull();
    expect(handView.bidAgainstBudget).toBeNull();
  });
});

describe("variations", () => {
  it("a new one is a draft with a VAR ref, in this workspace, and does not touch the contract value", async () => {
    const p = await fromTender();
    const v = await newVariation(p);
    expect(v.res.status).toBe(201);
    expect(v.ref).toBe("VAR-0001");
    expect(mine("contract_project_variations")[0]).toMatchObject({ project_id: p.id, status: "draft", title: "Extra gate", amount: 5000, cost_amount: 3000, change_request_ref: "CR-7", created_by: ASKER });
    expect(project(p.id).contract_value).toBe(100000);
    expect(state.changes.some((c) => c.objectType === "contract_projects" && String(c.changes?.[0]?.field).includes("VAR-0001 added"))).toBe(true);
  });

  it("takes the status, the ref and who from the server, never from the body", async () => {
    const p = await fromTender();
    const res = await variationsPost(json("POST", { title: "Sneaky", status: "approved", ref: "VAR-0999", tenant_id: T2, project_id: T2_PROJECT, created_by: BOSS, decided_by: BOSS, amount: 1 }), ctx(p.id));
    expect(res.status).toBe(201);
    const row = mine("contract_project_variations").find((r) => r.title === "Sneaky")!;
    expect(row).toMatchObject({ status: "draft", ref: "VAR-0001", tenant_id: T1, project_id: p.id, created_by: ASKER });
    expect(row.decided_by).toBeUndefined();
  });

  it("needs a title and a real number; another workspace's project is a 404", async () => {
    const p = await fromTender();
    expect((await variationsPost(json("POST", { title: " " }), ctx(p.id))).status).toBe(422);
    expect((await variationsPost(json("POST", { title: "x", amount: "lots" }), ctx(p.id))).status).toBe(422);
    expect((await variationsPost(json("POST", { title: "x" }), ctx(T2_PROJECT))).status).toBe(404);
    expect((await variationsGet(get(), ctx(T2_PROJECT))).status).toBe(404);
    expect(mine("contract_project_variations")).toHaveLength(0);
  });

  it("another workspace's variation, or one of another project, matches nothing", async () => {
    const p = await fromTender();
    expect((await variationPatch(json("PATCH", { title: "mine now" }), vctx(p.id, T2_VARIATION))).status).toBe(404);
    expect((await variationDelete(json("DELETE"), vctx(p.id, T2_VARIATION))).status).toBe(404);
    as(BOSS, "admin");
    expect((await variationPatch(json("PATCH", { action: "approve" }), vctx(p.id, T2_VARIATION))).status).toBe(404);
    expect(rows("contract_project_variations").find((r) => r.id === T2_VARIATION)).toMatchObject({ status: "submitted", amount: 1 });
    expect(project(T2_PROJECT).contract_value).toBe(10);
  });

  it("a draft can be edited and removed; a nothing-to-change edit is refused", async () => {
    const p = await fromTender();
    const v = await newVariation(p);
    expect((await variationPatch(json("PATCH", {}), vctx(p.id, v.id))).status).toBe(400);
    const edited = await variationPatch(json("PATCH", { title: "Extra gate (revised)", amount: "6000" }), vctx(p.id, v.id));
    expect(edited.status).toBe(200);
    expect(mine("contract_project_variations")[0]).toMatchObject({ title: "Extra gate (revised)", amount: 6000, cost_amount: 3000 });
    expect((await variationDelete(json("DELETE"), vctx(p.id, v.id))).status).toBe(200);
    expect(mine("contract_project_variations")).toHaveLength(0);
  });

  it("sending asks the approvers: a pending request, a locked variation, and a note to the approver", async () => {
    const p = await fromTender();
    const v = await newVariation(p);
    const sent = await submitVariation(p, v);
    expect(sent.status).toBe(200);
    expect(mine("contract_project_variations")[0]).toMatchObject({ status: "submitted", submitted_by: ASKER });
    const req = mine("approval_requests")[0];
    expect(req).toMatchObject({ object_type: "contract_project_variations", object_id: v.id, kind: "project_variation", status: "pending", requested_by: ASKER });
    expect(String(req.reason)).toContain("VAR-0001");
    expect(state.sent.some((s) => /variation/i.test(s.subject))).toBe(true);
    // Locked: it cannot be edited, removed or sent again while it waits.
    expect((await variationPatch(json("PATCH", { title: "changed" }), vctx(p.id, v.id))).status).toBe(409);
    expect((await variationDelete(json("DELETE"), vctx(p.id, v.id))).status).toBe(409);
    expect((await submitVariation(p, v)).status).toBe(409);
  });

  it("cannot be sent with nothing priced, or when nobody else could approve", async () => {
    const p = await fromTender();
    const empty = await newVariation(p, { amount: 0, cost_amount: 0, title: "Nothing" });
    expect((await submitVariation(p, empty)).status).toBe(409);
    const v = await newVariation(p);
    as(BOSS, "admin");
    const alone = await submitVariation(p, v);
    expect(alone.status).toBe(409);
    expect((await alone.json()).error).toMatch(/No one else can approve/);
    expect(mine("approval_requests")).toHaveLength(0);
  });

  it("an approver approves: the amount is added to the contract value, once, and a budget revision is opened for the cost", async () => {
    const p = await withBaseline();
    expect(project(p.id).status).toBe("active");
    const v = await newVariation(p);
    await submitVariation(p, v);
    const res = await approveVariation(p, v);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toMatchObject({ status: "approved", contract_value: 105000, revision: "started", revision_no: 1 });
    expect(project(p.id).contract_value).toBe(105000);
    const row = mine("contract_project_variations")[0];
    expect(row).toMatchObject({ status: "approved", decided_by: BOSS });
    const revs = mine("project_budget_revisions").filter((r) => r.project_id === p.id);
    const rev1 = revs.find((r) => r.rev_no === 1)!;
    expect(rev1).toMatchObject({ status: "draft", justification_code: "client_variation", total: 25000, created_by: BOSS });
    expect(String(rev1.justification_text)).toContain("VAR-0001");
    expect(String(rev1.justification_text)).toContain("CR-7");
    expect(row.budget_revision_id).toBe(rev1.id);
    const lines = mine("project_budget_lines").filter((l) => l.revision_id === rev1.id);
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => String(l.description).startsWith("VAR-0001"))).toMatchObject({ resource_code: "51", qty: 1, unit_cost: 3000, amount: 3000 });
    // The approved baseline is untouched.
    expect(mine("project_budget_lines").filter((l) => l.revision_id === revs.find((r) => r.rev_no === 0)!.id)).toHaveLength(2);
    const log = state.changes.filter((c) => c.objectType === "contract_projects").flatMap((c) => c.changes ?? []);
    expect(log.some((c) => c.field === "Contract value" && c.from === 100000 && c.to === 105000)).toBe(true);
    // The revision shows through the existing revisions route.
    expect((await (await revisionsGet(get(), ctx(p.id))).json()).revisions.map((r: { rev_no: number }) => r.rev_no)).toEqual([0, 1]);
  });

  it("deciding twice, or approving something not waiting, does nothing the second time", async () => {
    const p = await withBaseline();
    const v = await newVariation(p);
    await submitVariation(p, v);
    expect((await approveVariation(p, v)).status).toBe(200);
    expect((await approveVariation(p, v)).status).toBe(409);
    expect(project(p.id).contract_value).toBe(105000);
    const draft = await newVariation(p, { title: "Not sent" });
    expect((await approveVariation(p, draft)).status).toBe(409);
    expect(project(p.id).contract_value).toBe(105000);
  });

  it("the person who sent it cannot approve it unless the workspace allows it; a plain member cannot decide at all", async () => {
    state.config = { tender: { approvers: [ASKER, BOSS] } };
    const p = await fromTender();
    const v = await newVariation(p);
    await submitVariation(p, v);
    const own = await variationPatch(json("PATCH", { action: "approve" }), vctx(p.id, v.id));
    expect(own.status).toBe(403);
    expect((await own.json()).error).toMatch(/your own request/);
    state.config = { tender: { approvers: [BOSS] } };
    const notApprover = await variationPatch(json("PATCH", { action: "approve" }), vctx(p.id, v.id));
    expect(notApprover.status).toBe(403);
    expect(project(p.id).contract_value).toBe(100000);
    expect(mine("contract_project_variations")[0].status).toBe("submitted");
    state.config = { tender: { approvers: [ASKER, BOSS], allow_self_approval: true } };
    expect((await variationPatch(json("PATCH", { action: "approve" }), vctx(p.id, v.id))).status).toBe(200);
    expect(project(p.id).contract_value).toBe(105000);
  });

  it("rejecting needs a comment, leaves the contract value alone, and the variation can be changed and sent again", async () => {
    const p = await withBaseline();
    const v = await newVariation(p);
    await submitVariation(p, v);
    expect((await approveVariation(p, v, "reject")).status).toBe(400);
    const res = await approveVariation(p, v, "reject", "Out of scope");
    expect(res.status).toBe(200);
    expect(project(p.id).contract_value).toBe(100000);
    expect(mine("contract_project_variations")[0]).toMatchObject({ status: "rejected" });
    expect(varRequests()[0]).toMatchObject({ status: "rejected", decision_comment: "Out of scope" });
    expect(mine("project_budget_revisions").filter((r) => r.project_id === p.id)).toHaveLength(1);
    // Edit puts it back to draft; sending again is a new request.
    expect((await variationPatch(json("PATCH", { amount: 4000 }), vctx(p.id, v.id))).status).toBe(200);
    expect(mine("contract_project_variations")[0]).toMatchObject({ status: "draft", amount: 4000 });
    expect((await submitVariation(p, v)).status).toBe(200);
    expect(varRequests()).toHaveLength(2);
  });

  it("only the person who sent it can withdraw it", async () => {
    const p = await fromTender();
    const v = await newVariation(p);
    await submitVariation(p, v);
    as(BOSS, "admin");
    expect((await variationPatch(json("PATCH", { action: "withdraw" }), vctx(p.id, v.id))).status).toBe(403);
    as(ASKER);
    expect((await variationPatch(json("PATCH", { action: "withdraw" }), vctx(p.id, v.id))).status).toBe(200);
    expect(mine("contract_project_variations")[0].status).toBe("draft");
    expect(mine("approval_requests")[0].status).toBe("cancelled");
  });

  it("with no approved baseline the value still moves, and no revision is opened (the cost goes into the baseline)", async () => {
    const p = await fromTender();
    const v = await newVariation(p);
    await submitVariation(p, v);
    const body = await (await approveVariation(p, v)).json();
    expect(body.outcome).toMatchObject({ status: "approved", revision: "no_baseline", contract_value: 105000 });
    expect(mine("project_budget_revisions").filter((r) => r.project_id === p.id)).toHaveLength(1);
  });

  it("with a revision already open, the value moves and no second revision is opened", async () => {
    const p = await withBaseline();
    const first = await newVariation(p, { title: "First" });
    await submitVariation(p, first);
    await approveVariation(p, first);
    const second = await newVariation(p, { title: "Second", amount: 1000, cost_amount: 500 });
    await submitVariation(p, second);
    const body = await (await approveVariation(p, second)).json();
    expect(body.outcome).toMatchObject({ status: "approved", revision: "already_open", contract_value: 106000 });
    expect(mine("project_budget_revisions").filter((r) => r.project_id === p.id)).toHaveLength(2);
  });

  it("an omission lowers the contract value and adds no negative budget line, but says so in the revision note", async () => {
    const p = await withBaseline();
    const v = await newVariation(p, { title: "Omit the gate", amount: -2000, cost_amount: -1200, change_request_ref: null });
    await submitVariation(p, v);
    const body = await (await approveVariation(p, v)).json();
    expect(body.outcome).toMatchObject({ revision: "started", contract_value: 98000 });
    const rev1 = mine("project_budget_revisions").find((r) => r.rev_no === 1)!;
    expect(String(rev1.justification_text)).toContain("lower the matching lines");
    expect(mine("project_budget_lines").filter((l) => l.revision_id === rev1.id)).toHaveLength(2);
  });

  it("cannot take the contract value below zero, and nothing is left half done", async () => {
    const p = await fromTender();
    const v = await newVariation(p, { amount: -100001, cost_amount: 0 });
    await submitVariation(p, v);
    const res = await approveVariation(p, v);
    expect(res.status).toBe(409);
    expect(project(p.id).contract_value).toBe(100000);
    expect(mine("contract_project_variations")[0].status).toBe("submitted");
    expect(mine("approval_requests")[0].status).toBe("pending");
  });

  it("totals: approved variations, revised and original contract value, and what waits", async () => {
    const p = await withBaseline();
    const a = await newVariation(p, { title: "A", amount: 5000, cost_amount: 3000 });
    await submitVariation(p, a);
    await approveVariation(p, a);
    const b = await newVariation(p, { title: "B", amount: 2500, cost_amount: 0 });
    await submitVariation(p, b);
    const data = await (await variationsGet(get(), ctx(p.id))).json();
    expect(data.totals).toMatchObject({ approved: 5000, approvedCost: 3000, pending: 2500, pendingCount: 1, revised: 105000, original: 100000, count: 2 });
    const waiting = data.variations.find((x: { title: string }) => x.title === "B");
    expect(waiting).toMatchObject({ status: "submitted", can_decide: false, mine: true });
    const done = data.variations.find((x: { title: string }) => x.title === "A");
    expect(done).toMatchObject({ status: "approved", revision_no: 1 });
  });

  it("while migration 0231 is pending the tab is told so (503) and nothing else breaks", async () => {
    state.db.missing.add("contract_project_variations");
    const p = await fromTender();
    const list = await variationsGet(get(), ctx(p.id));
    expect(list.status).toBe(503);
    expect((await list.json()).pending).toBe(true);
    const made = await variationsPost(json("POST", { title: "x" }), ctx(p.id));
    expect(made.status).toBe(503);
    expect((await made.json()).needsDatabaseUpdate).toBe(true);
    expect((await oneGet(get(), ctx(p.id))).status).toBe(200);
    expect((await budgetGet(get(`?revision=${p.revision_id}`), ctx(p.id))).status).toBe(200);
  });
});

describe("invoicing milestones", () => {
  const add = (p: { id: string }, body: Record<string, unknown>) => milestonesPost(json("POST", body), ctx(p.id));
  const ms = () => mine("contract_project_milestones");

  it("a milestone is planned, in order, and the schedule is read with its tiles", async () => {
    const p = await fromTender();
    expect((await add(p, { title: "Advance", basis: "percent", percent: 30, due_date: "2026-11-15" })).status).toBe(201);
    expect((await add(p, { title: "Mobilisation", basis: "fixed", fixed_amount: 10000 })).status).toBe(201);
    expect(ms().map((m) => [m.title, m.status, m.sort_order])).toEqual([["Advance", "planned", 10], ["Mobilisation", "planned", 20]]);
    const data = await (await milestonesGet(get(), ctx(p.id))).json();
    expect(data.milestones.map((m: { amount: number }) => m.amount)).toEqual([30000, 10000]);
    expect(data.totals).toMatchObject({ contracted: 100000, scheduled: 40000, invoiced: 0, toInvoice: 100000, percentTotal: 30, warning: null });
    expect(data).toMatchObject({ invoicesOn: true, hasCustomer: true, canEdit: true });
  });

  it("refuses a percent outside 0 to 100 or a missing amount, and warns (never blocks) when the percents pass 100", async () => {
    const p = await fromTender();
    expect((await add(p, { title: "x", basis: "percent", percent: 120 })).status).toBe(422);
    expect((await add(p, { title: "x", basis: "fixed" })).status).toBe(422);
    expect((await add(p, { title: "", basis: "fixed", fixed_amount: 1 })).status).toBe(422);
    expect((await add(p, { title: "A", basis: "percent", percent: 70 })).status).toBe(201);
    expect((await add(p, { title: "B", basis: "percent", percent: 70 })).status).toBe(201);
    const data = await (await milestonesGet(get(), ctx(p.id))).json();
    expect(data.totals.warning).toBe("The percent milestones add up to 140%. They should total at most 100%");
    expect(ms()).toHaveLength(2);
  });

  it("another workspace's project or milestone matches nothing, and the status, invoice and author are the server's", async () => {
    const p = await fromTender();
    expect((await add({ id: T2_PROJECT }, { title: "x", basis: "fixed", fixed_amount: 1 })).status).toBe(404);
    expect((await milestonePatch(json("PATCH", { title: "mine" }), mctx(p.id, T2_MILESTONE))).status).toBe(404);
    expect((await milestoneInvoice(json("POST"), mctx(p.id, T2_MILESTONE))).status).toBe(404);
    await add(p, { title: "Sneaky", basis: "fixed", fixed_amount: 5, status: "paid", invoice_id: "x", tenant_id: T2, project_id: T2_PROJECT, created_by: BOSS });
    expect(ms()[0]).toMatchObject({ status: "planned", invoice_id: null, tenant_id: T1, project_id: p.id, created_by: ASKER });
    expect(rows("contract_project_milestones").find((r) => r.id === T2_MILESTONE)).toMatchObject({ title: "Other advance" });
  });

  it("can be edited, moved between planned and ready, and removed; invoiced cannot be set by hand", async () => {
    const p = await fromTender();
    await add(p, { title: "Advance", basis: "percent", percent: 30 });
    const id = String(ms()[0].id);
    expect((await milestonePatch(json("PATCH", { title: "Advance payment", percent: 25, status: "ready" }), mctx(p.id, id))).status).toBe(200);
    expect(ms()[0]).toMatchObject({ title: "Advance payment", percent: 25, status: "ready" });
    expect((await milestonePatch(json("PATCH", { status: "invoiced" }), mctx(p.id, id))).status).toBe(409);
    expect((await milestonePatch(json("PATCH", { status: "paid" }), mctx(p.id, id))).status).toBe(409);
    expect((await milestonePatch(json("PATCH", { status: "nonsense" }), mctx(p.id, id))).status).toBe(422);
    expect((await milestonePatch(json("PATCH", { basis: "fixed" }), mctx(p.id, id))).status).toBe(422);
    expect((await milestoneDelete(json("DELETE"), mctx(p.id, id))).status).toBe(200);
    expect(ms()).toHaveLength(0);
  });

  it("Create invoice makes the draft invoice through the invoices route for the project's customer and links it both ways", async () => {
    const p = await fromTender();
    await add(p, { title: "Advance", basis: "percent", percent: 30, due_date: "2026-11-15" });
    const id = String(ms()[0].id);
    const res = await milestoneInvoice(json("POST"), mctx(p.id, id));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ invoice_ref: "INV-0001", amount: 30000 });
    expect(state.invoicePosts).toHaveLength(1);
    expect(state.invoicePosts[0]).toMatchObject({ account_id: ACC, due_date: "2026-11-15", lines: [{ qty: 1, rate: 30000 }] });
    expect(String(state.invoicePosts[0].notes)).toContain(String(p.ref));
    const invoice = rows("invoices")[0];
    expect(ms()[0]).toMatchObject({ status: "invoiced", invoice_id: invoice.id });
    expect(invoice.custom_data).toEqual({ source_contract_project_id: p.id, source_contract_project_milestone_id: id });
    expect(state.changes.some((c) => c.objectType === "contract_projects" && String(c.changes?.[0]?.field).includes("invoiced"))).toBe(true);
    // The tiles and the amount now locked.
    const data = await (await milestonesGet(get(), ctx(p.id))).json();
    expect(data.totals).toMatchObject({ invoiced: 30000, toInvoice: 70000 });
    expect(data.milestones[0]).toMatchObject({ display_status: "invoiced", invoice_ref: "INV-0001" });
    expect((await milestonePatch(json("PATCH", { percent: 50 }), mctx(p.id, id))).status).toBe(409);
    expect((await milestoneDelete(json("DELETE"), mctx(p.id, id))).status).toBe(409);
  });

  it("tax: the line is the amount before tax; a Saudi e-invoicing workspace is told VAT 15% comes on top, with the figures", async () => {
    state.features = { ...state.features, einvoicing_ksa: true };
    const p = await fromTender();
    await add(p, { title: "Advance", basis: "percent", percent: 20 });
    const data = await (await milestonesGet(get(), ctx(p.id))).json();
    expect(data.tax).toEqual({ kind: "added", label: "VAT", rate: 15, source: "einvoice" });
    expect((await milestoneInvoice(json("POST"), mctx(p.id, String(ms()[0].id)))).status).toBe(201);
    const sent = state.invoicePosts[0] as { lines: { rate: number }[]; notes: string };
    expect(sent.lines).toHaveLength(1);
    expect(sent.lines[0].rate).toBe(20000);
    expect(sent.notes).toContain("Amount before VAT: ");
    expect(sent.notes).toContain("20,000.00");
    expect(sent.notes).toContain("VAT 15%: ");
    expect(sent.notes).toContain("3,000.00");
    expect(sent.notes).toContain("Total with VAT: ");
    expect(sent.notes).toContain("23,000.00");
  });

  it("tax: another workspace sees its own tax setting added on top, and one with amounts including tax adds nothing", async () => {
    state.config = { tax: { label: "GST", rate: 18, inclusive: false } };
    const p = await fromTender();
    await add(p, { title: "Advance", basis: "percent", percent: 10 });
    expect((await (await milestonesGet(get(), ctx(p.id))).json()).tax).toEqual({ kind: "added", label: "GST", rate: 18, source: "workspace" });
    await milestoneInvoice(json("POST"), mctx(p.id, String(ms()[0].id)));
    expect(String(state.invoicePosts[0].notes)).toContain("GST 18%: ");
    expect(String(state.invoicePosts[0].notes)).toContain("11,800.00");
    state.config = { tax: { label: "VAT", rate: 5, inclusive: true } };
    expect((await (await milestonesGet(get(), ctx(p.id))).json()).tax).toEqual({ kind: "included", label: "VAT", rate: 5 });
  });

  it("tax: a workspace with no tax set says so on the schedule and in the invoice's notes, and the amount is still the milestone amount", async () => {
    const p = await fromTender();
    await add(p, { title: "Advance", basis: "percent", percent: 30 });
    expect((await (await milestonesGet(get(), ctx(p.id))).json()).tax).toEqual({ kind: "none" });
    await milestoneInvoice(json("POST"), mctx(p.id, String(ms()[0].id)));
    const sent = state.invoicePosts[0] as { lines: { rate: number }[]; notes: string };
    expect(sent.lines[0].rate).toBe(30000);
    expect(sent.notes).toContain("No tax configured");
    expect(sent.notes).not.toContain("Total with");
  });

  it("a second click, or two people at once, cannot make a second invoice", async () => {
    const p = await fromTender();
    await add(p, { title: "Advance", basis: "percent", percent: 30 });
    const id = String(ms()[0].id);
    const [a, b] = await Promise.all([milestoneInvoice(json("POST"), mctx(p.id, id)), milestoneInvoice(json("POST"), mctx(p.id, id))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(rows("invoices")).toHaveLength(1);
    expect((await milestoneInvoice(json("POST"), mctx(p.id, id))).status).toBe(409);
    expect(rows("invoices")).toHaveLength(1);
  });

  it("an approved variation moves what a percent milestone bills", async () => {
    const p = await withBaseline();
    await add(p, { title: "Advance", basis: "percent", percent: 30 });
    const v = await newVariation(p, { amount: 10000, cost_amount: 0 });
    await submitVariation(p, v);
    await approveVariation(p, v);
    const id = String(ms()[0].id);
    expect(await (await milestoneInvoice(json("POST"), mctx(p.id, id))).json()).toMatchObject({ amount: 33000 });
  });

  it("a paid invoice makes the milestone paid; a cancelled one makes it ready again and a new invoice can be made", async () => {
    const p = await fromTender();
    await add(p, { title: "Advance", basis: "fixed", fixed_amount: 5000 });
    const id = String(ms()[0].id);
    await milestoneInvoice(json("POST"), mctx(p.id, id));
    rows("invoices")[0].status = "paid";
    expect((await (await milestonesGet(get(), ctx(p.id))).json()).totals).toMatchObject({ invoiced: 5000, paid: 5000 });
    rows("invoices")[0].status = "cancelled";
    const data = await (await milestonesGet(get(), ctx(p.id))).json();
    expect(data.milestones[0].display_status).toBe("ready");
    expect(data.totals.invoiced).toBe(0);
    expect((await milestoneInvoice(json("POST"), mctx(p.id, id))).status).toBe(201);
    expect(rows("invoices")).toHaveLength(2);
    expect(ms()[0].invoice_id).toBe(rows("invoices")[1].id);
  });

  it("a failed invoice puts the milestone back, and a project without a customer, a zero amount or the Invoices module off is refused first", async () => {
    const p = await fromTender();
    await add(p, { title: "Advance", basis: "fixed", fixed_amount: 5000 });
    const id = String(ms()[0].id);
    state.invoiceFails = true;
    expect((await milestoneInvoice(json("POST"), mctx(p.id, id))).status).toBe(404);
    expect(ms()[0]).toMatchObject({ status: "planned", invoice_id: null });
    state.invoiceFails = false;
    state.features.invoices = false;
    expect((await milestoneInvoice(json("POST"), mctx(p.id, id))).status).toBe(403);
    state.features.invoices = true;
    project(p.id).account_id = null;
    expect((await milestoneInvoice(json("POST"), mctx(p.id, id))).status).toBe(409);
    project(p.id).account_id = ACC_T2;
    expect((await milestoneInvoice(json("POST"), mctx(p.id, id))).status).toBe(404);
    project(p.id).account_id = ACC;
    await add(p, { title: "Nothing", basis: "fixed", fixed_amount: 0 });
    expect((await milestoneInvoice(json("POST"), mctx(p.id, String(ms()[1].id)))).status).toBe(409);
    expect(rows("invoices")).toHaveLength(0);
    expect(state.invoicePosts.length).toBe(1);
  });

  it("while migration 0232 is pending the tab is told so (503) and nothing else breaks", async () => {
    state.db.missing.add("contract_project_milestones");
    const p = await fromTender();
    const list = await milestonesGet(get(), ctx(p.id));
    expect(list.status).toBe(503);
    expect((await list.json()).pending).toBe(true);
    const made = await add(p, { title: "x", basis: "fixed", fixed_amount: 1 });
    expect(made.status).toBe(503);
    expect((await oneGet(get(), ctx(p.id))).status).toBe(200);
  });
});
