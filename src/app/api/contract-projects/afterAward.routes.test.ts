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
import { GET as allocGet, PUT as allocPut } from "./[id]/allocation/route";
import { PATCH as basisPatch } from "./[id]/allocation/basis/route";
import { POST as fillPost } from "./[id]/allocation/fill/route";
import { GET as wpGet, POST as wpPost } from "./[id]/work-packages/route";
import { PATCH as wpPatch, DELETE as wpDelete } from "./[id]/work-packages/[pid]/route";

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
  v: 1, warnings: [],
  lines: [
    {
      key: "no:1.1", item_no: "1.1", unit_cost: 130, markup_pct: 50, cost_code: "32 31 13", estimated: false, from_estimate: false, cost_total: 13000,
      lines: [{ resource_code: "11", cost_code: "32 31 13", wbs: "1.1", description: "Chain link fence 2.4m", qty: 100, unit: "m", unit_cost: 130, cost_known: true, source_ref: "Cost from RFQ-0004", reserve: false }],
    },
    {
      key: "no:1.2", item_no: "1.2", unit_cost: null, markup_pct: null, cost_code: "99 99 99", estimated: true, from_estimate: false, cost_total: 0,
      lines: [],
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
  return { res, ...j } as { res: Response; id: string; ref: string; revision_id: string; budget_note: string; unmapped_codes: string[] };
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

describe("the project starts as the contract, and Fill from tender costs reads the winning bid's recorded cost", () => {
  function bidVersions(withCost: boolean) {
    rows("tender_bid_versions").push(
      { id: "bv1", tenant_id: T1, opportunity_id: OPP, version_no: 1, submitted_at: "2026-10-08T08:00:00Z", currency: "SAR", total: 21000, line_count: 2 },
      { id: "bv2", tenant_id: T1, opportunity_id: OPP, version_no: 2, submitted_at: "2026-10-12T08:00:00Z", currency: "SAR", total: 22000, line_count: 2 },
    );
    if (withCost) rows("tender_bid_version_costs").push({ id: "bc2", tenant_id: T1, opportunity_id: OPP, version_no: 2, total_cost: 13000, line_count: 2, snapshot: WINNING_COST });
  }
  const fill = (id: string, body: Record<string, unknown> = {}) => fillPost(json("POST", body), ctx(id));

  it("creating from the tender copies the contract (quantity, the client's rate and amount) and NO cost, whichever bid was submitted", async () => {
    bidVersions(true);
    const p = await fromTender();
    expect(p.res.status).toBe(201);
    expect(p.budget_note).toBe("Contract lines from the tender; costs to be allocated.");
    const lines = mine("project_budget_lines");
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.unit_cost === 0 && l.amount === 0 && l.allocated === false)).toBe(true);
    expect(lines.find((l) => String(l.description).startsWith("Chain link"))).toMatchObject({ client_rate: 200, client_amount: 20000, source_line_id: "l1", cost_code: "32 31 13" });
    expect(p.unmapped_codes).toEqual(["99 99 99"]);
    expect(mine("project_budget_revisions")[0]).toMatchObject({ rev_no: 0, total: 0 });
  });

  it("Fill uses the LAST version's recorded cost; a line with none is listed, never filled with a guess", async () => {
    bidVersions(true);
    // An earlier version's cost must not be the one used.
    rows("tender_bid_version_costs").push({ id: "bc1", tenant_id: T1, opportunity_id: OPP, version_no: 1, total_cost: 1, line_count: 1, snapshot: { v: 1, warnings: [], lines: [] } });
    const p = await fromTender();
    const res = await fill(p.id);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ filled: 1, total: 13000 });
    expect(j.skipped).toEqual([{ item: "1.2", reason: "no recorded cost in bid v2" }]);
    const lines = mine("project_budget_lines");
    expect(lines.find((l) => String(l.description).startsWith("Chain link"))).toMatchObject({ amount: 13000, unit_cost: 130, allocated: true, source_ref: "Cost from bid v2 (RFQ-0004)" });
    expect(lines.find((l) => l.description === "Excavation")).toMatchObject({ amount: 0, allocated: false });
    expect(mine("project_budget_revisions")[0].total).toBe(13000);
    expect(state.changes.some((c) => c.changes?.some((x) => x.field === "Fill from tender costs" && x.to === 13000))).toBe(true);
  });

  it("without a stored bid cost it reads the tender's BOQ rows, only a cost above zero", async () => {
    bidVersions(false);
    const p = await fromTender();
    const j = await (await fill(p.id)).json();
    expect(j.filled).toBe(1);
    expect(mine("project_budget_lines").find((l) => String(l.description).startsWith("Chain link"))).toMatchObject({ amount: 12000, unit_cost: 120, allocated: true });
    expect(j.skipped).toEqual([{ item: "1.2", reason: "no recorded cost on the tender" }]);
  });

  it("does it once: a line that already has an allocation is kept unless the person confirms a replace", async () => {
    const p = await fromTender();
    const key = String(mine("project_budget_lines").find((l) => String(l.description).startsWith("Chain link"))!.line_key);
    await allocPut(json("PUT", { revision_id: p.revision_id, basis_rows: [{ line_key: key, amount: 500 }] }), ctx(p.id));
    const kept = await (await fill(p.id)).json();
    expect(kept.filled).toBe(0);
    expect(kept.skipped).toContainEqual({ item: "1.1", reason: "already allocated" });
    expect(mine("project_budget_lines").find((l) => l.line_key === key)!.amount).toBe(500);
    const replaced = await (await fill(p.id, { replace: true })).json();
    expect(replaced.filled).toBe(1);
    expect(mine("project_budget_lines").find((l) => l.line_key === key)!.amount).toBe(12000);
  });

  it("an old snapshot that holds a guessed cost (stored before costs stopped being guessed) is not filled", async () => {
    bidVersions(false);
    rows("tender_bid_version_costs").push({
      id: "bc2", tenant_id: T1, opportunity_id: OPP, version_no: 2, total_cost: 1800, line_count: 1,
      snapshot: { v: 1, margin_pct: 15, warnings: [], lines: [{ key: "no:1.2", item_no: "1.2", unit_cost: null, markup_pct: null, cost_code: null, estimated: true, from_estimate: false, cost_total: 1800, lines: [{ resource_code: "11", cost_code: null, wbs: "1.2", description: "Excavation", qty: 50, unit: "m3", unit_cost: 36, cost_known: false, source_ref: "Estimated: rate less 15% margin", reserve: false }] }] },
    });
    const p = await fromTender();
    const j = await (await fill(p.id)).json();
    expect(j.skipped).toContainEqual({ item: "1.2", reason: "no recorded cost in bid v2" });
    expect(mine("project_budget_lines").find((l) => l.description === "Excavation")).toMatchObject({ amount: 0, allocated: false });
  });

  it("another workspace's bid cost is never used", async () => {
    rows("tender_bid_versions").push({ id: "bvx", tenant_id: T2, opportunity_id: OPP, version_no: 5, submitted_at: "2026-10-12T08:00:00Z", currency: "SAR", total: 1, line_count: 1 });
    rows("tender_bid_version_costs").push({ id: "bcx", tenant_id: T2, opportunity_id: OPP, version_no: 5, total_cost: 1, line_count: 1, snapshot: WINNING_COST });
    const p = await fromTender();
    const j = await (await fill(p.id)).json();
    expect(j.filled).toBe(1); // the BOQ rows of THIS workspace, not the other workspace's 13000
    expect(mine("project_budget_lines").find((l) => String(l.description).startsWith("Chain link"))!.amount).toBe(12000);
  });

  it("a project made by hand has no tender to copy from; a view-only person cannot fill", async () => {
    const hand = await (await createPost(json("POST", { name: "By hand", contract_value: 100 }))).json();
    expect((await fill(hand.id)).status).toBe(409);
    const p = await fromTender();
    state.edit = false;
    expect((await fill(p.id)).status).toBe(403);
  });
});

describe("where the project came from, and the bid against the budget", () => {
  it("the project is given the tender, the winning version, the BOQ file and the estimates used, and the bid's cost against its budget", async () => {
    rows("tender_bid_versions").push({ id: "bv2", tenant_id: T1, opportunity_id: OPP, version_no: 2, submitted_at: "2026-10-12T08:00:00Z", currency: "SAR", total: 22000, line_count: 2 });
    rows("tender_bid_version_costs").push({ id: "bc2", tenant_id: T1, opportunity_id: OPP, version_no: 2, total_cost: 13000, line_count: 2, snapshot: WINNING_COST });
    rows("tender_boq_estimate_links").push({ tenant_id: T1, opportunity_id: OPP, estimate_id: "e1" }, { tenant_id: T1, opportunity_id: OPP, estimate_id: "e1" });
    rows("estimates").push({ id: "e1", tenant_id: T1, opportunity_id: OPP, ref: "EST-0003", name: "Fence build-up" }, { id: "e2", tenant_id: T2, opportunity_id: OPP, ref: "EST-9999", name: "Not ours" });
    const p = await withBaseline();
    const view = await (await oneGet(get(), ctx(p.id))).json();
    expect(view.origin).toMatchObject({
      deal: { id: OPP, ref: "OPP-1" }, bid: { version_no: 2, total: 22000, currency: "SAR" }, boq: { file_name: "ARB-1-BOQ.xlsx", version: 2 },
      estimates: [{ id: "e1", ref: "EST-0003" }],
    });
    // The approved budget is 22000 (the person edited the lines); the bid's recorded cost was 13000 (a line with no recorded cost adds nothing).
    expect(view.bidAgainstBudget).toMatchObject({ available: true, version_no: 2, figures: { bid_price: 22000, bid_cost: 13000, budget: 22000, delta: 9000 } });
    expect(view.bidAgainstBudget.figures.delta_pct).toBeCloseTo(69.2, 1);
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

// ── Allocating the budget, work packages (migration 0240) ──────────────────────────────────────────────────────────────────

const EMP_LOGIN = "e1111111-1111-4111-8111-111111111111";
const EMP_NO_LOGIN = "e2222222-2222-4222-8222-222222222222";
const EMP_T2 = "e3333333-3333-4333-8333-333333333333";
const EMP_OFF = "e4444444-4444-4444-8444-444444444444";
const pctx = (id: string, pid: string) => ({ params: Promise.resolve({ id, pid }) });
const keyOf = (p: string) => String(mine("project_budget_lines").find((l) => String(l.description).startsWith(p))!.line_key);
const lineOf = (p: string) => mine("project_budget_lines").find((l) => String(l.description).startsWith(p))!;
const alloc = (id: string, revision_id: string, basis_rows: unknown) => allocPut(json("PUT", { revision_id, basis_rows }), ctx(id));
const packs = () => mine("project_work_packages");

describe("allocating the budget by BOQ line", () => {
  beforeEach(() => {
    rows("employees").push(
      { id: EMP_LOGIN, tenant_id: T1, first_name: "Sara", last_name: "Khan", employee_code: "E-1", email: "sara@kamco.test", status: "active" },
      { id: EMP_NO_LOGIN, tenant_id: T1, first_name: "Omar", last_name: "Ali", employee_code: "E-2", email: "omar@kamco.test", status: "active" },
      { id: EMP_OFF, tenant_id: T1, first_name: "Gone", last_name: "Person", employee_code: "E-3", email: null, status: "inactive" },
      { id: EMP_T2, tenant_id: T2, first_name: "Other", last_name: "Workspace", employee_code: "X-1", email: null, status: "active" },
    );
    rows("tenant_users").push({ tenant_id: T1, user_id: "u-sara", role: "member", employee_id: EMP_LOGIN }, { tenant_id: T2, user_id: "u-other", role: "member", employee_id: EMP_T2 });
  });

  it("the cost typed on a line is the line's amount; the total, the unit cost and the margin follow it, and it is logged", async () => {
    const p = await fromTender();
    const res = await alloc(p.id, p.revision_id, [{ line_key: keyOf("Chain link"), amount: 15000 }, { line_key: keyOf("Excavation"), amount: "1500.555" }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, total: 16500.56 });
    expect(lineOf("Chain link")).toMatchObject({ amount: 15000, unit_cost: 150, allocated: true });
    expect(lineOf("Excavation")).toMatchObject({ amount: 1500.56, unit_cost: 30.0112, allocated: true });
    expect(mine("project_budget_revisions")[0].total).toBe(16500.56);
    const view = await (await oneGet(get(), ctx(p.id))).json();
    expect(view.margin).toMatchObject({ amount: 83499.44, state: "ok" });
    expect(view.allocation.totals).toMatchObject({ allocatedCount: 2, unallocatedCount: 0 });
    expect(state.changes.some((c) => c.changes?.some((x) => x.field === "Allocated" && x.from === 0 && x.to === 16500.56))).toBe(true);
  });

  it("nothing allocated reads as 'none', never 100 percent; null clears a line", async () => {
    const p = await fromTender();
    const before = await (await oneGet(get(), ctx(p.id))).json();
    expect(before.margin.state).toBe("none");
    expect(before.allocation.totals).toMatchObject({ allocatedCount: 0, unallocatedCount: 2 });
    await alloc(p.id, p.revision_id, [{ line_key: keyOf("Chain link"), amount: 15000 }]);
    await alloc(p.id, p.revision_id, [{ line_key: keyOf("Chain link"), amount: null }]);
    expect(lineOf("Chain link")).toMatchObject({ amount: 0, unit_cost: 0, allocated: false });
    expect(mine("project_budget_revisions")[0].total).toBe(0);
  });

  it("refuses what cannot be an allocation, and writes nothing", async () => {
    const p = await fromTender();
    for (const bad of [[{ line_key: keyOf("Chain link"), amount: -1 }], [{ line_key: keyOf("Chain link"), amount: "abc" }], [{ line_key: "ffffffff-ffff-4fff-8fff-fffffffffffe", amount: 5 }], "x", [{ line_key: keyOf("Chain link"), amount: 1 }, { line_key: keyOf("Chain link"), amount: 2 }]]) {
      expect((await alloc(p.id, p.revision_id, bad)).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await allocPut(json("PUT", { basis_rows: [] }), ctx(p.id))).status).toBe(400);
    expect(mine("project_budget_lines").every((l) => l.allocated === false)).toBe(true);
  });

  it("is locked once the baseline is waiting for approval or approved; the view stays readable", async () => {
    const p = await fromTender();
    await alloc(p.id, p.revision_id, [{ line_key: keyOf("Chain link"), amount: 15000 }]);
    const ask = await askPost(json("POST", {}), ctx(p.id));
    expect([200, 201]).toContain(ask.status);
    const waiting = await alloc(p.id, p.revision_id, [{ line_key: keyOf("Chain link"), amount: 1 }]);
    expect(waiting.status).toBe(409);
    expect((await waiting.json()).locked).toBe(true);
    expect(lineOf("Chain link").amount).toBe(15000);
    expect((await allocGet(get(), ctx(p.id))).status).toBe(200);
  });

  it("a view-only person cannot allocate; another workspace's project and revision are a 404", async () => {
    const p = await fromTender();
    state.edit = false;
    expect((await alloc(p.id, p.revision_id, [])).status).toBe(403);
    state.edit = true;
    expect((await alloc(T2_PROJECT, p.revision_id, [])).status).toBe(404);
    expect((await alloc(p.id, "aaaaaaaa-0000-4000-8000-000000000000", [])).status).toBe(404);
    expect((await allocGet(get(), ctx(T2_PROJECT))).status).toBe(404);
  });

  it("while migration 0240 is pending it says so instead of failing", async () => {
    const p = await fromTender();
    state.db.missingColumns.project_budget_lines = new Set(["allocated"]);
    const res = await alloc(p.id, p.revision_id, [{ line_key: keyOf("Chain link"), amount: 5 }]);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("migration 0240");
  });

  it("GET gives the allocation, the packages, the employees (with whether each has a login) and whether Fill is possible", async () => {
    const p = await fromTender();
    const j = await (await allocGet(get(), ctx(p.id))).json();
    expect(j.allocation.basis).toBe("line");
    expect(j.allocation.lineRows).toHaveLength(2);
    expect(j.fill_available).toBe(true);
    // Ordered by surname; whether each has a login is what the owner picker needs.
    expect(j.employees).toEqual([
      { id: EMP_NO_LOGIN, name: "Omar Ali", code: "E-2", email: "omar@kamco.test", has_login: false },
      { id: EMP_LOGIN, name: "Sara Khan", code: "E-1", email: "sara@kamco.test", has_login: true },
    ]);
  });
});

describe("work packages and allocating by package", () => {
  const base = async () => {
    const p = await fromTender();
    return { p, a: keyOf("Chain link"), b: keyOf("Excavation") };
  };
  const make = (id: string, body: Record<string, unknown>) => wpPost(json("POST", body), ctx(id));

  beforeEach(() => {
    rows("employees").push(
      { id: EMP_LOGIN, tenant_id: T1, first_name: "Sara", last_name: "Khan", employee_code: "E-1", email: null, status: "active" },
      { id: EMP_NO_LOGIN, tenant_id: T1, first_name: "Omar", last_name: "Ali", employee_code: "E-2", email: null, status: "active" },
      { id: EMP_OFF, tenant_id: T1, first_name: "Gone", last_name: "Person", employee_code: "E-3", email: null, status: "inactive" },
      { id: EMP_T2, tenant_id: T2, first_name: "Other", last_name: "Workspace", employee_code: "X-1", email: null, status: "active" },
    );
    rows("tenant_users").push({ tenant_id: T1, user_id: "u-sara", role: "member", employee_id: EMP_LOGIN }, { tenant_id: T2, user_id: "u-other", role: "member", employee_id: EMP_T2 });
    state.db.unique("project_work_packages", (x, y) => x.project_id === y.project_id && x.code === y.code);
    state.db.unique("project_work_package_lines", (x, y) => x.project_id === y.project_id && x.line_key === y.line_key);
  });

  it("makes a package with a code, a name, an owner who has a login and its lines; the code is unique on the project", async () => {
    const { p, a } = await base();
    const res = await make(p.id, { code: "WP-1", name: "Earthworks", owner_employee_id: EMP_LOGIN, line_keys: [a] });
    expect(res.status).toBe(201);
    expect(packs()[0]).toMatchObject({ code: "WP-1", name: "Earthworks", owner_employee_id: EMP_LOGIN, project_id: p.id, tenant_id: T1 });
    expect(mine("project_work_package_lines")).toHaveLength(1);
    expect((await make(p.id, { code: "WP-1", name: "Again" })).status).toBe(409);
    const list = await (await wpGet(get(), ctx(p.id))).json();
    expect(list.packages).toEqual([expect.objectContaining({ code: "WP-1", owner_name: "Sara Khan", line_keys: [a] })]);
    expect(state.changes.some((c) => c.changes?.some((x) => x.field === "Work package WP-1 added"))).toBe(true);
  });

  it("an owner without a login is refused with 'Create login' first; so is an inactive one, and an employee of another workspace is a 404", async () => {
    const { p } = await base();
    const noLogin = await make(p.id, { code: "WP-1", name: "x", owner_employee_id: EMP_NO_LOGIN });
    expect(noLogin.status).toBe(422);
    const j = await noLogin.json();
    expect(j.error).toContain("has no login");
    expect(j.needs_login).toBe(true);
    expect((await make(p.id, { code: "WP-1", name: "x", owner_employee_id: EMP_OFF })).status).toBe(422);
    expect((await make(p.id, { code: "WP-1", name: "x", owner_employee_id: EMP_T2 })).status).toBe(404);
    expect(packs()).toHaveLength(0);
    // Once the login exists the same request works.
    rows("tenant_users").push({ tenant_id: T1, user_id: "u-omar", role: "member", employee_id: EMP_NO_LOGIN });
    expect((await make(p.id, { code: "WP-1", name: "x", owner_employee_id: EMP_NO_LOGIN })).status).toBe(201);
  });

  it("a line sits in one package: a second package asking for it gets '<item> is already in <code>'", async () => {
    const { p, a, b } = await base();
    await make(p.id, { code: "WP-1", name: "One", line_keys: [a] });
    const clash = await make(p.id, { code: "WP-2", name: "Two", line_keys: [a, b] });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toBe("1.1 is already in WP-1");
    expect(packs()).toHaveLength(1);
    expect((await make(p.id, { code: "WP-2", name: "Two", line_keys: ["ffffffff-ffff-4fff-8fff-fffffffffffe"] })).status).toBe(422);
  });

  it("changing a package replaces its lines and its owner; a view-only person and another workspace's package are refused", async () => {
    const { p, a, b } = await base();
    const id = (await (await make(p.id, { code: "WP-1", name: "One", line_keys: [a] })).json()).id as string;
    expect((await wpPatch(json("PATCH", { line_keys: [b], owner_employee_id: EMP_LOGIN, name: "Renamed" }), pctx(p.id, id))).status).toBe(200);
    expect(mine("project_work_package_lines").map((l) => l.line_key)).toEqual([b]);
    expect(packs()[0]).toMatchObject({ name: "Renamed", owner_employee_id: EMP_LOGIN });
    expect((await wpPatch(json("PATCH", { owner_employee_id: EMP_NO_LOGIN }), pctx(p.id, id))).status).toBe(422);
    expect((await wpPatch(json("PATCH", { owner_employee_id: null }), pctx(p.id, id))).status).toBe(200);
    expect(packs()[0].owner_employee_id).toBeNull();
    rows("project_work_packages").push({ id: "pw-t2", tenant_id: T2, project_id: T2_PROJECT, code: "WP-9", name: "Theirs", owner_employee_id: null, allocated_cost: null, sort_order: 10, note: null });
    expect((await wpPatch(json("PATCH", { name: "Mine now" }), pctx(p.id, "pw-t2"))).status).toBe(404);
    expect((await wpDelete(json("DELETE"), pctx(p.id, "pw-t2"))).status).toBe(404);
    state.edit = false;
    expect((await wpPatch(json("PATCH", { name: "x" }), pctx(p.id, id))).status).toBe(403);
    expect((await make(p.id, { code: "WP-3", name: "x" })).status).toBe(403);
  });

  it("by work package: a cost typed on a package is spread over its lines in proportion to the client's amounts; lines in no package are not allocated", async () => {
    const { p, a, b } = await base();
    const id = (await (await make(p.id, { code: "WP-1", name: "One", line_keys: [a, b] })).json()).id as string;
    expect((await basisPatch(json("PATCH", { basis: "package" }), ctx(p.id))).status).toBe(200);
    expect(project(p.id).allocation_basis).toBe("package");
    // In package mode the body carries packages, not lines.
    expect((await alloc(p.id, p.revision_id, [])).status).toBe(422);
    const res = await allocPut(json("PUT", { revision_id: p.revision_id, packages: [{ id, allocated_cost: 11000 }] }), ctx(p.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 11000 });
    // 20,000 and 2,000 of the client's money: 10,000 and 1,000 of the cost.
    expect(lineOf("Chain link")).toMatchObject({ amount: 10000, allocated: true });
    expect(lineOf("Excavation")).toMatchObject({ amount: 1000, allocated: true });
    expect(packs()[0].allocated_cost).toBe(11000);
    // Taking a line out of the package puts it back to not allocated and re-spreads the cost over the rest.
    await wpPatch(json("PATCH", { line_keys: [a] }), pctx(p.id, id));
    expect(lineOf("Chain link")).toMatchObject({ amount: 11000, allocated: true });
    expect(lineOf("Excavation")).toMatchObject({ amount: 0, allocated: false });
    expect(mine("project_budget_revisions")[0].total).toBe(11000);
    // Removing the package takes its cost with it.
    expect((await wpDelete(json("DELETE"), pctx(p.id, id))).status).toBe(200);
    expect(packs()).toHaveLength(0);
    expect(mine("project_work_package_lines")).toHaveLength(0);
    expect(mine("project_budget_lines").every((l) => l.allocated === false && l.amount === 0)).toBe(true);
    expect(mine("project_budget_revisions")[0].total).toBe(0);
  });

  it("a package id from another workspace in an allocation is a 404 and changes nothing", async () => {
    const { p, a } = await base();
    await make(p.id, { code: "WP-1", name: "One", line_keys: [a] });
    await basisPatch(json("PATCH", { basis: "package" }), ctx(p.id));
    rows("project_work_packages").push({ id: "aaaaaaaa-1111-4111-8111-000000000009", tenant_id: T2, project_id: T2_PROJECT, code: "WP-9", name: "Theirs", owner_employee_id: null, allocated_cost: 5, sort_order: 10, note: null });
    const res = await allocPut(json("PUT", { revision_id: p.revision_id, packages: [{ id: "aaaaaaaa-1111-4111-8111-000000000009", allocated_cost: 99 }] }), ctx(p.id));
    expect(res.status).toBe(404);
    expect(rows("project_work_packages").find((x) => x.id === "aaaaaaaa-1111-4111-8111-000000000009")!.allocated_cost).toBe(5);
  });

  it("switching the basis clears what was typed and keeps the grouping; it is refused once a baseline is waiting or approved", async () => {
    const { p, a } = await base();
    await make(p.id, { code: "WP-1", name: "One", line_keys: [a] });
    await alloc(p.id, p.revision_id, [{ line_key: a, amount: 700 }]);
    const done = await basisPatch(json("PATCH", { basis: "package" }), ctx(p.id));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ basis: "package", total: 0 });
    expect(lineOf("Chain link")).toMatchObject({ amount: 0, allocated: false });
    expect(mine("project_work_package_lines")).toHaveLength(1); // grouping kept
    expect((await basisPatch(json("PATCH", { basis: "nonsense" }), ctx(p.id))).status).toBe(400);
    await basisPatch(json("PATCH", { basis: "line" }), ctx(p.id));
    await alloc(p.id, p.revision_id, [{ line_key: a, amount: 700 }]);
    await askPost(json("POST", {}), ctx(p.id));
    const locked = await basisPatch(json("PATCH", { basis: "package" }), ctx(p.id));
    expect(locked.status).toBe(409);
    expect(project(p.id).allocation_basis).not.toBe("package");
    expect(lineOf("Chain link").amount).toBe(700);
  });

  it("Fill by package sums the recorded costs of a package's lines and spreads them", async () => {
    const { p, a, b } = await base();
    const id = (await (await make(p.id, { code: "WP-1", name: "One", line_keys: [a, b] })).json()).id as string;
    await basisPatch(json("PATCH", { basis: "package" }), ctx(p.id));
    const res = await fillPost(json("POST", {}), ctx(p.id));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.filled).toBe(1);
    expect(j.skipped).toContainEqual({ item: "1.2", reason: "no recorded cost on the tender" });
    expect(packs().find((x) => x.id === id)!.allocated_cost).toBe(12000);
    // The whole package cost (12,000) is laid over both lines by the client's amounts.
    expect(Number(lineOf("Chain link").amount) + Number(lineOf("Excavation").amount)).toBe(12000);
  });

  it("while migration 0240 is pending the work packages say so", async () => {
    const { p } = await base();
    state.db.missing.add("project_work_packages");
    expect((await make(p.id, { code: "WP-1", name: "x" })).status).toBe(503);
    const list = await wpGet(get(), ctx(p.id));
    expect(list.status).toBe(503);
    expect((await list.json()).pending).toBe(true);
  });
});
