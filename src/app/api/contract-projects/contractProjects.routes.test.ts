import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 5a: contract projects, against an in-memory database. The questions asked here are the ones the design
// lists: another workspace's rows, foreign ids, the flag off, the lock after approval, the reason on later revisions, who may approve,
// one project per tender, and the migration still pending.

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
  seq: 0,
}));

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const ASKER = "11111111-1111-4111-8111-111111111111";
const BOSS = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_USER = "99999999-9999-4999-8999-999999999999";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_OPEN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const T2_PROJECT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const T2_REVISION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

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
    const ref = `CPR-${String(++state.seq).padStart(4, "0")}`;
    const now = new Date().toISOString();
    return admin.from(table).insert({ ...record, ref, created_at: now, updated_at: now }).select(select).single();
  },
}));
vi.mock("resend", () => ({
  Resend: class { emails = { send: async (p: { from: string; to: string[]; subject: string; text: string }) => { state.sent.push(p); return { error: null }; } }; },
}));

import { NextRequest } from "next/server";
import { GET as listGet, POST as createPost } from "./route";
import { GET as oneGet, PATCH as onePatch, DELETE as oneDelete } from "./[id]/route";
import { GET as budgetGet, PUT as budgetPut } from "./[id]/budget/route";
import { GET as revisionsGet, POST as revisionPost } from "./[id]/revisions/route";
import { PATCH as revisionPatch } from "./[id]/revisions/[revId]/route";
import { POST as askPost } from "./[id]/approval/route";
import { PATCH as decide } from "./[id]/approval/[requestId]/route";
import { GET as handoverGet } from "./[id]/handover/route";
import { GET as mastersGet, POST as mastersPost } from "./masters/route";
import { PATCH as masterPatch } from "./masters/[id]/route";
import { POST as mastersImport } from "./masters/import/route";
import { GET as settingsGet, PUT as settingsPut } from "@/app/api/settings/contract-projects/route";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (qs = "") => new NextRequest(new URL(`http://internal.invalid/x${qs}`));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const rctx = (id: string, revId: string) => ({ params: Promise.resolve({ id, revId }) });
const dctx = (id: string, requestId: string) => ({ params: Promise.resolve({ id, requestId }) });
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };
const rows = (t: string) => state.db.rows(t);
const projects = () => rows("contract_projects");
const NEW_TABLES = ["contract_projects", "project_budget_revisions", "project_budget_lines", "erp_masters"];

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
      { id: OPP_OPEN, tenant_id: T1, ref: "OPP-2", title: "Still bidding", account_id: ACC, stage: "estimating", outcome: "open", amount: 5000, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
      { id: OPP_T2, tenant_id: T2, ref: "OPP-9", title: "Other workspace", account_id: ACC_T2, stage: "awarded", outcome: "won", amount: 1, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", issuer_name: "Aramco", portal: "ariba", bond_status: "held", reminders_sent: [], addenda_count: 0 },
      { opportunity_id: OPP_OPEN, tenant_id: T1, tender_no: "ARB-2", issuer_name: "Aramco", portal: "ariba", bond_status: "held", reminders_sent: [], addenda_count: 0 },
      { opportunity_id: OPP_T2, tenant_id: T2, tender_no: "X-1", issuer_name: "X", portal: "email", bond_status: "held", reminders_sent: [], addenda_count: 0 },
    ],
    opportunity_lines: [
      { id: "l1", tenant_id: T1, opportunity_id: OPP, sl_no: "1.1", description: "Chain link fence 2.4m", uom: "m", qty: 100, rate: 200, discount_pct: 0, amount: 20000, is_selected: true, break_of: null },
      { id: "l2", tenant_id: T1, opportunity_id: OPP, sl_no: "1.2", description: "Excavation", uom: "m3", qty: 50, rate: 40, discount_pct: 0, amount: 2000, is_selected: true, break_of: null },
      { id: "l3", tenant_id: T1, opportunity_id: OPP, sl_no: "1.3", description: "Not selected", uom: "m", qty: 1, rate: 1, discount_pct: 0, amount: 1, is_selected: false, break_of: null },
    ],
    tender_boq_lines: [
      { id: "b1", tenant_id: T1, opportunity_id: OPP, line_id: "l1", item_no: "1.1", cost_code: "32 31 13", unit_cost: 120, price_source: "supplier", price_source_ref: "RFQ-0004" },
      { id: "b2", tenant_id: T1, opportunity_id: OPP, line_id: "l2", item_no: "1.2", cost_code: "99 99 99", unit_cost: null, price_source: null, price_source_ref: null },
    ],
    contract_projects: [{ id: T2_PROJECT, tenant_id: T2, ref: "CPR-9001", name: "Other tenant's project", account_id: ACC_T2, source_opportunity_id: OPP_T2, status: "draft", contract_value: 10, currency: "SAR", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    project_budget_revisions: [{ id: T2_REVISION, tenant_id: T2, project_id: T2_PROJECT, rev_no: 0, status: "draft", total: 10 }],
    project_budget_lines: [{ id: "t2l", tenant_id: T2, project_id: T2_PROJECT, revision_id: T2_REVISION, line_no: 1, line_key: "ffffffff-ffff-4fff-8fff-fffffffffff1", description: "Secret cost", qty: 1, unit_cost: 10, amount: 10, resource_code: "11", cost_known: true, reserve: false }],
    erp_masters: [{ id: "m-t2", tenant_id: T2, kind: "cost_code", code: "ONLY-T2", name: "Other workspace's code", parent_code: null, flags: {}, source: "manual", active: true }],
  });
}

beforeEach(() => {
  state.db = seed();
  state.db.users.set(ASKER, { email: "asker@kamco.test", name: "S. Khan" });
  state.db.users.set(BOSS, { email: "boss@kamco.test", name: "A. Nasser" });
  state.db.users.set(OTHER_TENANT_USER, { email: "x@other.test" });
  state.db.unique("contract_projects", (a, b) => a.tenant_id === b.tenant_id && !!a.source_opportunity_id && a.source_opportunity_id === b.source_opportunity_id);
  state.db.unique("erp_masters", (a, b) => a.tenant_id === b.tenant_id && a.kind === b.kind && a.code === b.code);
  state.db.unique("project_budget_revisions", (a, b) => a.project_id === b.project_id && ["draft", "pending"].includes(String(a.status)) && ["draft", "pending"].includes(String(b.status)));
  state.features = { pipeline: true, gcc_tender: true, contract_projects: true };
  state.config = {};
  state.touched = []; state.changes = []; state.sent = []; state.seq = 0;
  state.view = true; state.edit = true;
  as(ASKER);
  process.env.RESEND_API_KEY = "test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// A project from the awarded tender, ready to work on.
async function fromTender() {
  const res = await createPost(json("POST", { opportunity_id: OPP }));
  const j = await res.json();
  return { res, ...j } as { res: Response; id: string; ref: string; revision_id: string; unmapped_codes: string[]; skipped: number; budget_note: string };
}
const mine = (t: string) => rows(t).filter((r) => r.tenant_id === T1);
const goodLines = () => [
  { description: "Fence", resource_code: "11", cost_code: "32 31 13", qty: 100, unit: "m", unit_cost: 120 },
  { description: "Labour", resource_code: "31", cost_code: null, qty: 40, unit: "day", unit_cost: 250 },
];
async function withBaseline() {
  const p = await fromTender();
  await budgetPut(json("PUT", { revision_id: p.revision_id, lines: goodLines() }), ctx(p.id));
  return p;
}
async function askAndApprove(p: { id: string }, comment?: string) {
  as(ASKER);
  const ask = await askPost(json("POST", {}), ctx(p.id));
  const { id: requestId } = await ask.json();
  as(BOSS, "admin");
  const res = await decide(json("PATCH", { action: "approve", comment }), dctx(p.id, requestId));
  return { res, requestId };
}

describe("the module is off", () => {
  it("every route answers 404 and the new tables are never touched", async () => {
    state.features = { pipeline: true, gcc_tender: true, contract_projects: false };
    const id = T2_PROJECT;
    const answers = [
      await listGet(get()), await createPost(json("POST", { name: "x" })), await oneGet(get(), ctx(id)), await onePatch(json("PATCH", { name: "y" }), ctx(id)), await oneDelete(json("DELETE"), ctx(id)),
      await budgetGet(get(`?revision=${T2_REVISION}`), ctx(id)), await budgetPut(json("PUT", { revision_id: T2_REVISION, lines: [] }), ctx(id)),
      await revisionsGet(get(), ctx(id)), await revisionPost(json("POST", { justification_code: "other" }), ctx(id)), await askPost(json("POST", {}), ctx(id)),
      await decide(json("PATCH", { action: "approve" }), dctx(id, T2_REVISION)), await handoverGet(get(), ctx(id)),
      await mastersGet(get("?summary=1")), await mastersPost(json("POST", { kind: "cost_code", code: "1", name: "x" })), await settingsGet(), await settingsPut(json("PUT", { margin_floor_pct: 10 })),
    ];
    for (const a of answers) expect(a.status).toBe(404);
    expect(state.touched.filter((t) => NEW_TABLES.includes(t))).toEqual([]);
    expect(projects()).toHaveLength(1);
  });

  it("is also off without the tender edition", async () => {
    state.features = { pipeline: true, gcc_tender: false, contract_projects: true };
    expect((await listGet(get())).status).toBe(404);
    expect(state.touched.filter((t) => NEW_TABLES.includes(t))).toEqual([]);
  });

  it("a person who may not open Contract Projects gets a 404 too, and one who may only view cannot change anything", async () => {
    state.view = false;
    expect((await listGet(get())).status).toBe(404);
    state.view = true; state.edit = false;
    expect((await listGet(get())).status).toBe(200);
    expect((await createPost(json("POST", { name: "x" }))).status).toBe(403);
    expect((await budgetPut(json("PUT", { revision_id: T2_REVISION, lines: [] }), ctx(T2_PROJECT))).status).toBe(403);
  });
});

describe("creating from a won tender", () => {
  it("makes the project, revision 0 as a draft, and the budget lines from the deal's lines", async () => {
    const p = await fromTender();
    expect(p.res.status).toBe(201);
    expect(p.ref).toBe("CPR-0001");
    const project = mine("contract_projects")[0];
    expect(project).toMatchObject({ tenant_id: T1, name: "ARB-1 Fence for Plant 4", account_id: ACC, source_opportunity_id: OPP, status: "draft", contract_value: 100000, currency: "SAR", created_by: ASKER });
    const revs = mine("project_budget_revisions");
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ rev_no: 0, status: "draft", project_id: project.id });
    const lines = mine("project_budget_lines");
    expect(lines).toHaveLength(2);
    expect(p.skipped).toBe(1);
    // The contract, not a budget: the client's rate and amount, the line it came from, NO cost and not allocated.
    const fence = lines.find((l) => String(l.description).startsWith("Chain link"))!;
    expect(fence).toMatchObject({ resource_code: "11", cost_code: "32 31 13", unit_cost: 0, amount: 0, allocated: false, cost_known: true, wbs: "1.1", client_rate: 200, client_amount: 20000, source_line_id: "l1", qty: 100 });
    const dig = lines.find((l) => l.description === "Excavation")!;
    expect(dig).toMatchObject({ cost_code: null, unit_cost: 0, amount: 0, allocated: false, client_rate: 40, client_amount: 2000, source_line_id: "l2" });
    expect(dig.source_ref).toBeNull();
    expect(p.unmapped_codes).toEqual(["99 99 99"]);
    expect(p.budget_note).toBe("Contract lines from the tender; costs to be allocated.");
    expect(revs[0].total).toBe(0);
  });

  it("while migration 0240 is pending a project from a tender is refused with a plain message (it could not say 'not allocated'), and nothing is left behind", async () => {
    state.db.missingColumns.project_budget_lines = new Set(["allocated"]);
    const res = await createPost(json("POST", { opportunity_id: OPP }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("migration 0240");
    expect(mine("contract_projects")).toHaveLength(0);
    expect(mine("project_budget_lines")).toHaveLength(0);
  });

  it("seeds the starter lists once (source default) and never touches an edited entry", async () => {
    await fromTender();
    const resources = mine("erp_masters").filter((m) => m.kind === "resource");
    expect(resources.map((r) => r.code)).toContain("1105");
    expect(mine("erp_masters").every((m) => m.source === "default")).toBe(true);
    expect(mine("erp_masters").some((m) => m.kind === "cost_code" && m.code === "32 31 13" && m.parent_code === "32")).toBe(true);
    const before = mine("erp_masters").length;
    mine("erp_masters").find((m) => m.code === "11")!.name = "Materials (edited)";
    await mastersGet(get("?summary=1"));
    await mastersGet(get("?summary=1"));
    expect(mine("erp_masters")).toHaveLength(before);
    expect(mine("erp_masters").find((m) => m.code === "11")!.name).toBe("Materials (edited)");
  });

  it("the contract value is the awarded value when the tender recorded one", async () => {
    rows("opportunity_tenders").find((t) => t.opportunity_id === OPP)!.award_value = 90000;
    await fromTender();
    expect(mine("contract_projects")[0].contract_value).toBe(90000);
  });

  it("is logged, with who made it from where", async () => {
    const p = await fromTender();
    const c = state.changes.find((x) => x.objectType === "contract_projects" && x.action === "create");
    expect(c?.objectId).toBe(p.id);
    expect(c?.changes?.[0].field).toBe("Created from tender");
  });

  it("refuses a second project from the same tender with a 409 that names the first", async () => {
    const first = await fromTender();
    const again = await createPost(json("POST", { opportunity_id: OPP }));
    expect(again.status).toBe(409);
    const j = await again.json();
    expect(j.already_exists).toBe(true);
    expect(j.project_id).toBe(first.id);
    expect(mine("contract_projects")).toHaveLength(1);
  });

  it("the database's unique index is the backstop when two creates race", async () => {
    const first = await fromTender();
    // The pre-check is bypassed by inserting directly: the unique constraint answers 23505 and the route turns it into the same 409.
    const direct = await state.db.from("contract_projects").insert({ tenant_id: T1, source_opportunity_id: OPP, name: "dup" });
    expect(direct.error?.code).toBe("23505");
    expect(first.id).toBeTruthy();
  });

  it("only an awarded tender becomes a project; an open tender, another workspace's tender and a made-up id are refused", async () => {
    expect((await createPost(json("POST", { opportunity_id: OPP_OPEN }))).status).toBe(409);
    expect((await createPost(json("POST", { opportunity_id: OPP_T2 }))).status).toBe(404);
    expect((await createPost(json("POST", { opportunity_id: "nope" }))).status).toBe(404);
    expect(mine("contract_projects")).toHaveLength(0);
  });

  it("while the migration is pending creating answers 503 and nothing else breaks", async () => {
    state.db.missing.add("contract_projects");
    const res = await createPost(json("POST", { opportunity_id: OPP }));
    expect(res.status).toBe(503);
    expect((await res.json()).needsDatabaseUpdate).toBe(true);
    const list = await listGet(get());
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ rows: [], needsDatabaseUpdate: true });
    expect((await oneGet(get(), ctx(T2_PROJECT))).status).toBe(503);
  });
});

describe("creating by hand", () => {
  it("needs a name, checks the account and the manager against the workspace", async () => {
    expect((await createPost(json("POST", { name: "  " }))).status).toBe(400);
    expect((await createPost(json("POST", { name: "Pump station", account_id: ACC_T2 }))).status).toBe(404);
    expect((await createPost(json("POST", { name: "Pump station", manager_id: OTHER_TENANT_USER }))).status).toBe(404);
    expect((await createPost(json("POST", { name: "Pump station", contract_value: -5 }))).status).toBe(422);
    expect(mine("contract_projects")).toHaveLength(0);
    const ok = await createPost(json("POST", { name: "Pump station", account_id: ACC, manager_id: BOSS, contract_value: 2500 }));
    expect(ok.status).toBe(201);
    expect(mine("contract_projects")[0]).toMatchObject({ name: "Pump station", account_id: ACC, manager_id: BOSS, contract_value: 2500, source_opportunity_id: null });
    expect(mine("project_budget_revisions")).toHaveLength(1);
    expect(mine("project_budget_lines")).toHaveLength(0);
  });
});

describe("another workspace's rows", () => {
  it("are never listed, read, changed, deleted or exported, and its codes and budget never appear", async () => {
    await fromTender();
    const list = await (await listGet(get())).json();
    expect(list.rows.map((r: { name: string }) => r.name)).not.toContain("Other tenant's project");
    expect(list.total).toBe(1);
    expect((await oneGet(get(), ctx(T2_PROJECT))).status).toBe(404);
    expect((await onePatch(json("PATCH", { name: "stolen" }), ctx(T2_PROJECT))).status).toBe(404);
    expect((await oneDelete(json("DELETE"), ctx(T2_PROJECT))).status).toBe(404);
    expect((await budgetGet(get(`?revision=${T2_REVISION}`), ctx(T2_PROJECT))).status).toBe(404);
    expect((await handoverGet(get(), ctx(T2_PROJECT))).status).toBe(404);
    expect(projects().find((p) => p.id === T2_PROJECT)!.name).toBe("Other tenant's project");
    const masters = await (await mastersGet(get("?kind=cost_code&all=1"))).json();
    expect(masters.rows.map((m: { code: string }) => m.code)).not.toContain("ONLY-T2");
  });

  it("a revision of another project (or workspace) cannot be written to by naming it on your own project", async () => {
    const p = await fromTender();
    const res = await budgetPut(json("PUT", { revision_id: T2_REVISION, lines: [{ description: "sneaky", resource_code: "11" }] }), ctx(p.id));
    expect(res.status).toBe(404);
    expect(rows("project_budget_lines").filter((l) => l.revision_id === T2_REVISION)).toHaveLength(1);
  });
});

describe("the project header", () => {
  it("changes only the allowed fields and logs the change", async () => {
    const p = await fromTender();
    const res = await onePatch(json("PATCH", { name: "Renamed", contract_value: 95000, planned_start: "2026-11-01", planned_end: "2027-02-01", ref: "HACK", erp_id: "X", tenant_id: T2, status: "active" }), ctx(p.id));
    expect(res.status).toBe(409); // a draft project cannot be "activated" by hand
    const ok = await onePatch(json("PATCH", { name: "Renamed", contract_value: 95000, planned_start: "2026-11-01", planned_end: "2027-02-01", ref: "HACK", erp_id: "X", tenant_id: T2 }), ctx(p.id));
    expect(ok.status).toBe(200);
    const row = mine("contract_projects")[0];
    expect(row).toMatchObject({ name: "Renamed", contract_value: 95000, planned_start: "2026-11-01", ref: "CPR-0001", tenant_id: T1 });
    expect(row.erp_id ?? null).toBeNull();
    expect(state.changes.some((c) => c.objectType === "contract_projects" && c.action === "update" && c.changes?.some((x) => x.field === "name"))).toBe(true);
  });

  it("verifies the account and the manager, and the dates", async () => {
    const p = await fromTender();
    expect((await onePatch(json("PATCH", { account_id: ACC_T2 }), ctx(p.id))).status).toBe(404);
    expect((await onePatch(json("PATCH", { manager_id: OTHER_TENANT_USER }), ctx(p.id))).status).toBe(404);
    expect((await onePatch(json("PATCH", { planned_start: "2027-01-01", planned_end: "2026-01-01" }), ctx(p.id))).status).toBe(422);
    expect((await onePatch(json("PATCH", {}), ctx(p.id))).status).toBe(400);
    expect((await onePatch(json("PATCH", { manager_id: BOSS }), ctx(p.id))).status).toBe(200);
  });

  it("deletes only a project that never had a baseline sent", async () => {
    const a = await fromTender();
    expect((await oneDelete(json("DELETE"), ctx(a.id))).status).toBe(200);
    expect(mine("contract_projects")).toHaveLength(0);
    const b = await withBaseline();
    await askPost(json("POST", {}), ctx(b.id));
    expect((await oneDelete(json("DELETE"), ctx(b.id))).status).toBe(409);
    expect(mine("contract_projects")).toHaveLength(1);
  });
});

describe("the budget lines", () => {
  it("saves a draft, computes every amount and the total itself, and keeps the line keys it was given", async () => {
    const p = await fromTender();
    const before = mine("project_budget_lines")[0].line_key as string;
    const res = await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ ...goodLines()[0], line_key: before }, goodLines()[1]], total: 1 }), ctx(p.id));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.total).toBe(22000);
    const lines = mine("project_budget_lines");
    expect(lines.map((l) => l.amount)).toEqual([12000, 10000]);
    expect(lines.map((l) => l.line_no)).toEqual([1, 2]);
    expect(lines[0].line_key).toBe(before);
    expect(mine("project_budget_revisions")[0].total).toBe(22000);
    expect(state.changes.some((c) => c.changes?.[0]?.field === "Budget revision 0")).toBe(true);
  });

  it("refuses unknown resource and cost codes and income-side resources, naming them, and writes nothing", async () => {
    const p = await fromTender();
    const keep = mine("project_budget_lines").length;
    const r1 = await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ description: "x", resource_code: "77" }] }), ctx(p.id));
    expect(r1.status).toBe(422);
    expect((await r1.json()).error).toContain("77");
    const r2 = await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ description: "x", resource_code: "11", cost_code: "ZZ-1" }] }), ctx(p.id));
    expect(r2.status).toBe(422);
    expect((await r2.json()).error).toContain("ZZ-1");
    const r3 = await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ description: "x", resource_code: "91" }] }), ctx(p.id));
    expect(r3.status).toBe(422);
    const r4 = await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ description: "", resource_code: "11" }] }), ctx(p.id));
    expect(r4.status).toBe(422);
    expect(mine("project_budget_lines")).toHaveLength(keep);
  });

  it("a line that already uses a code keeps working, and a code switched off is refused for new use", async () => {
    const p = await fromTender();
    state.db.rows("erp_masters").find((m) => m.tenant_id === T1 && m.kind === "resource" && m.code === "21")!.active = false;
    expect((await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ description: "x", resource_code: "21" }] }), ctx(p.id))).status).toBe(422);
  });

  it("is locked while waiting for approval and after approval: 409, nothing written", async () => {
    const p = await withBaseline();
    const snapshot = JSON.stringify(mine("project_budget_lines"));
    await askPost(json("POST", {}), ctx(p.id));
    const waiting = await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ description: "change", resource_code: "11" }] }), ctx(p.id));
    expect(waiting.status).toBe(409);
    expect((await waiting.json()).locked).toBe(true);
    as(BOSS, "admin");
    const { id: requestId } = (await state.db.from("approval_requests").select("id").eq("status", "pending").single()).data as { id: string };
    await decide(json("PATCH", { action: "approve" }), dctx(p.id, requestId));
    const approved = await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ description: "change", resource_code: "11" }] }), ctx(p.id));
    expect(approved.status).toBe(409);
    expect(JSON.stringify(mine("project_budget_lines"))).toBe(snapshot);
  });
});

describe("asking for approval and deciding", () => {
  it("locks the revision, marks the baseline as waiting, records who asked, and tells the approvers", async () => {
    const p = await withBaseline();
    const res = await askPost(json("POST", {}), ctx(p.id));
    expect(res.status).toBe(201);
    const ar = rows("approval_requests")[0];
    expect(ar).toMatchObject({ tenant_id: T1, object_type: "contract_projects", object_id: p.id, kind: "project_baseline", proposed_value: p.revision_id, requested_by: ASKER, status: "pending" });
    expect(String(ar.reason)).toContain("Baseline budget");
    expect(mine("project_budget_revisions")[0].status).toBe("pending");
    expect(mine("contract_projects")[0].status).toBe("baseline_pending");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toEqual(["boss@kamco.test"]);
    expect(state.sent[0].text).toContain("https://kamco.example.com/contract-projects/");
    expect(state.db.rows("record_comments")[0]).toMatchObject({ object_type: "contract_projects", object_id: p.id, author_id: ASKER });
    expect(state.db.rows("email_log")[0]).toMatchObject({ kind: "tender", related_object_type: "contract_projects" });
  });

  it("is refused for an empty budget, a line with no resource, and a second request; and when no one else could approve", async () => {
    const p = await fromTender();
    await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [] }), ctx(p.id));
    expect((await askPost(json("POST", {}), ctx(p.id))).status).toBe(409);
    await budgetPut(json("PUT", { revision_id: p.revision_id, lines: [{ description: "no resource" }] }), ctx(p.id));
    expect((await (await askPost(json("POST", {}), ctx(p.id))).json()).error).toContain("no resource");
    await budgetPut(json("PUT", { revision_id: p.revision_id, lines: goodLines() }), ctx(p.id));
    expect((await askPost(json("POST", {}), ctx(p.id))).status).toBe(201);
    expect((await askPost(json("POST", {}), ctx(p.id))).status).toBe(409);
    // A one-admin workspace: the only approver is the person asking.
    state.db.rows("tenant_users").splice(0, state.db.rows("tenant_users").length, { tenant_id: T1, user_id: ASKER, role: "admin" });
    const lone = await createPost(json("POST", { name: "Lone" }));
    const loneId = (await lone.json()).id;
    const rev = mine("project_budget_revisions").find((r) => r.project_id === loneId)!;
    await budgetPut(json("PUT", { revision_id: rev.id, lines: goodLines() }), ctx(loneId));
    const blocked = await askPost(json("POST", {}), ctx(loneId));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toContain("No one else");
  });

  it("the person who asked cannot approve it; an approver can, with the baseline locked and the project active", async () => {
    const p = await withBaseline();
    const ask = await askPost(json("POST", {}), ctx(p.id));
    const { id: requestId } = await ask.json();
    state.db.rows("tenant_users").find((u) => u.user_id === ASKER)!.role = "admin"; // even an admin may not approve their own request
    as(ASKER, "admin");
    const own = await decide(json("PATCH", { action: "approve" }), dctx(p.id, requestId));
    expect(own.status).toBe(403);
    expect(mine("project_budget_revisions")[0].status).toBe("pending");
    as(BOSS, "admin");
    const ok = await decide(json("PATCH", { action: "approve", comment: "Looks right" }), dctx(p.id, requestId));
    expect(ok.status).toBe(200);
    expect(mine("project_budget_revisions")[0]).toMatchObject({ status: "approved", approved_by: BOSS });
    expect(mine("project_budget_revisions")[0].locked_at).toBeTruthy();
    expect(mine("contract_projects")[0].status).toBe("active");
    expect(rows("approval_requests")[0]).toMatchObject({ status: "approved", decided_by: BOSS, decision_comment: "Looks right" });
    expect(state.sent.some((m) => m.subject.startsWith("Approved:") && m.to.includes("asker@kamco.test"))).toBe(true);
  });

  it("the workspace can allow self-approval for a one-admin team", async () => {
    state.config = { tender: { allow_self_approval: true, approvers: [ASKER] } };
    state.db.rows("tenant_users").find((u) => u.user_id === ASKER)!.role = "admin";
    const p = await withBaseline();
    const ask = await askPost(json("POST", {}), ctx(p.id));
    expect(ask.status).toBe(201);
    const { id: requestId } = await ask.json();
    expect((await decide(json("PATCH", { action: "approve" }), dctx(p.id, requestId))).status).toBe(200);
  });

  it("someone who is not an approver cannot decide", async () => {
    const p = await withBaseline();
    const { id: requestId } = await (await askPost(json("POST", {}), ctx(p.id))).json();
    as("33333333-3333-4333-8333-333333333333");
    expect((await decide(json("PATCH", { action: "approve" }), dctx(p.id, requestId))).status).toBe(403);
  });

  it("a rejection needs a comment and returns the revision to draft so it can be edited and asked again", async () => {
    const p = await withBaseline();
    const { id: requestId } = await (await askPost(json("POST", {}), ctx(p.id))).json();
    as(BOSS, "admin");
    expect((await decide(json("PATCH", { action: "reject" }), dctx(p.id, requestId))).status).toBe(400);
    expect((await decide(json("PATCH", { action: "reject", comment: "Labour is low" }), dctx(p.id, requestId))).status).toBe(200);
    expect(mine("project_budget_revisions")[0].status).toBe("draft");
    expect(mine("contract_projects")[0].status).toBe("draft");
    as(ASKER);
    expect((await budgetPut(json("PUT", { revision_id: p.revision_id, lines: goodLines() }), ctx(p.id))).status).toBe(200);
    expect((await askPost(json("POST", {}), ctx(p.id))).status).toBe(201);
  });

  it("the person who asked can withdraw; two people deciding at once cannot both win; a request of another project is not found", async () => {
    const p = await withBaseline();
    const { id: requestId } = await (await askPost(json("POST", {}), ctx(p.id))).json();
    as(BOSS, "admin");
    expect((await decide(json("PATCH", { action: "cancel" }), dctx(p.id, requestId))).status).toBe(403);
    as(ASKER);
    expect((await decide(json("PATCH", { action: "cancel" }), dctx(p.id, requestId))).status).toBe(200);
    expect(mine("project_budget_revisions")[0].status).toBe("draft");
    expect((await decide(json("PATCH", { action: "cancel" }), dctx(p.id, requestId))).status).toBe(409);
    const other = await createPost(json("POST", { name: "Other" }));
    const otherId = (await other.json()).id;
    expect((await decide(json("PATCH", { action: "approve" }), dctx(otherId, requestId))).status).toBe(404);
  });

  it("while approval_requests is missing (0221 pending) asking answers 503 and the revision stays a draft", async () => {
    const p = await withBaseline();
    state.db.missing.add("approval_requests");
    const res = await askPost(json("POST", {}), ctx(p.id));
    expect(res.status).toBe(503);
    expect((await res.json()).needsDatabaseUpdate).toBe(true);
    expect(mine("project_budget_revisions")[0].status).toBe("draft");
  });

  it("the bid / no-bid approvals of the same table are not touched by it", async () => {
    const p = await withBaseline();
    rows("approval_requests").push({ id: "a0000000-0000-4000-8000-000000000001", tenant_id: T1, object_type: "opportunity_tenders", object_id: OPP, kind: "tender_bid_decision", proposed_value: "go", requested_by: ASKER, status: "pending", created_at: "2026-10-20T00:00:00Z" });
    expect((await askPost(json("POST", {}), ctx(p.id))).status).toBe(201);
    expect(rows("approval_requests").find((r) => r.kind === "tender_bid_decision")!.status).toBe("pending");
  });
});

describe("revisions", () => {
  it("cannot start before a baseline is approved, and need a reason from the list (Other needs a note)", async () => {
    const p = await withBaseline();
    expect((await revisionPost(json("POST", { justification_code: "scope_change" }), ctx(p.id))).status).toBe(409);
    await askAndApprove(p);
    state.db.rows("erp_masters"); // lists exist
    expect((await revisionPost(json("POST", {}), ctx(p.id))).status).toBe(422);
    expect((await revisionPost(json("POST", { justification_code: "made-up" }), ctx(p.id))).status).toBe(422);
    expect((await revisionPost(json("POST", { justification_code: "other", justification_text: "  " }), ctx(p.id))).status).toBe(422);
    expect(mine("project_budget_revisions")).toHaveLength(1);
    const ok = await revisionPost(json("POST", { justification_code: "scope_change", justification_text: "Client added a bay" }), ctx(p.id));
    expect(ok.status).toBe(201);
    expect((await ok.json()).rev_no).toBe(1);
  });

  it("copies the approved lines with the same keys, allows one open revision at a time, and leaves the approved one alone", async () => {
    const p = await withBaseline();
    await askAndApprove(p);
    as(ASKER);
    const approvedKeys = mine("project_budget_lines").map((l) => l.line_key);
    const made = await revisionPost(json("POST", { justification_code: "price_change" }), ctx(p.id));
    const { id: revId } = await made.json();
    const copied = mine("project_budget_lines").filter((l) => l.revision_id === revId);
    expect(copied.map((l) => l.line_key)).toEqual(approvedKeys);
    expect(mine("project_budget_revisions").find((r) => r.id === revId)).toMatchObject({ status: "draft", rev_no: 1, justification_code: "price_change", created_by: ASKER });
    expect((await revisionPost(json("POST", { justification_code: "price_change" }), ctx(p.id))).status).toBe(409);
    // Edit the draft revision; the baseline stays as it was.
    const edited = copied.map((l) => ({ line_key: l.line_key, description: l.description, resource_code: l.resource_code, cost_code: l.cost_code, qty: l.qty, unit: l.unit, unit_cost: Number(l.unit_cost) + 10 }));
    expect((await budgetPut(json("PUT", { revision_id: revId, lines: edited }), ctx(p.id))).status).toBe(200);
    expect(mine("project_budget_lines").filter((l) => l.revision_id === p.revision_id).map((l) => l.amount)).toEqual([12000, 10000]);
  });

  it("approving a later revision supersedes the one before it, and the view compares the two", async () => {
    const p = await withBaseline();
    await askAndApprove(p);
    const { id: revId } = await (await revisionPost(json("POST", { justification_code: "scope_change", justification_text: "More fence" }), ctx(p.id))).json();
    const copied = mine("project_budget_lines").filter((l) => l.revision_id === revId);
    await budgetPut(json("PUT", { revision_id: revId, lines: [...copied.map((l) => ({ line_key: l.line_key, description: l.description, resource_code: l.resource_code, cost_code: l.cost_code, qty: l.qty, unit: l.unit, unit_cost: l.unit_cost })), { description: "Extra bay", resource_code: "11", qty: 1, unit_cost: 500 }] }), ctx(p.id));
    const view = await (await oneGet(get(), ctx(p.id))).json();
    expect(view.revision.id).toBe(revId);
    expect(view.compare.diff.added).toHaveLength(1);
    expect(view.compare.diff.delta).toBe(500);
    const { res, requestId } = await askAndApprove(p);
    expect(res.status).toBe(200);
    expect(requestId).toBeTruthy();
    const revs = mine("project_budget_revisions");
    expect(revs.find((r) => r.id === p.revision_id)!.status).toBe("superseded");
    expect(revs.find((r) => r.id === revId)!.status).toBe("approved");
    expect(revs.filter((r) => r.status === "approved")).toHaveLength(1);
    // Superseded revisions stay readable.
    const old = await (await budgetGet(get(`?revision=${p.revision_id}`), ctx(p.id))).json();
    expect(old.lines).toHaveLength(2);
    expect((await (await revisionsGet(get(), ctx(p.id))).json()).revisions.map((r: { status: string }) => r.status)).toEqual(["superseded", "approved"]);
  });

  it("the reason can be changed while the revision is a draft and not after it is sent", async () => {
    const p = await withBaseline();
    await askAndApprove(p);
    const { id: revId } = await (await revisionPost(json("POST", { justification_code: "scope_change" }), ctx(p.id))).json();
    expect((await revisionPatch(json("PATCH", { justification_code: "error_correction" }), rctx(p.id, revId))).status).toBe(200);
    expect(mine("project_budget_revisions").find((r) => r.id === revId)!.justification_code).toBe("error_correction");
    expect((await revisionPatch(json("PATCH", { justification_code: "other" }), rctx(p.id, revId))).status).toBe(422);
    expect((await revisionPatch(json("PATCH", { justification_code: "nope" }), rctx(p.id, revId))).status).toBe(422);
    expect((await revisionPatch(json("PATCH", { justification_code: "scope_change" }), rctx(p.id, p.revision_id))).status).toBe(409);
  });

  it("a project can be closed once active and reopened; a closed project takes no budget edits or revisions", async () => {
    const p = await withBaseline();
    expect((await onePatch(json("PATCH", { status: "closed" }), ctx(p.id))).status).toBe(409);
    await askAndApprove(p);
    as(ASKER);
    expect((await onePatch(json("PATCH", { status: "closed" }), ctx(p.id))).status).toBe(200);
    expect((await revisionPost(json("POST", { justification_code: "scope_change" }), ctx(p.id))).status).toBe(409);
    expect((await onePatch(json("PATCH", { status: "active" }), ctx(p.id))).status).toBe(200);
    expect((await revisionPost(json("POST", { justification_code: "scope_change" }), ctx(p.id))).status).toBe(201);
  });
});

describe("the project view and the handover file", () => {
  it("gives totals, the planned margin and the approval state for the person looking", async () => {
    const p = await withBaseline();
    await askPost(json("POST", {}), ctx(p.id));
    as(BOSS, "admin");
    const view = await (await oneGet(get(), ctx(p.id))).json();
    expect(view.totals.total).toBe(22000);
    expect(view.margin).toEqual({ amount: 78000, pct: 78, state: "ok" });
    expect(view.approval.pending).toMatchObject({ rev_no: 0, mine: false });
    expect(view.approval.canDecide).toBe(true);
    expect(view.account_name).toBe("Aramco");
    expect(view.resources.map((r: { code: string }) => r.code)).toContain("1105");
    as(ASKER);
    const mineView = await (await oneGet(get(), ctx(p.id))).json();
    expect(mineView.approval.canDecide).toBe(false);
    expect(mineView.approval.pending.mine).toBe(true);
  });

  it("downloads an Excel file with the budget, only to someone who can open the project, and logs it", async () => {
    const p = await withBaseline();
    const res = await handoverGet(get(), ctx(p.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("CPR-0001-budget-rev0.xlsx");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const { default: Excel } = await import("exceljs");
    const wb = new Excel.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    expect(wb.getWorksheet("Budget")!.getRow(2).getCell(7).value).toBe("Fence");
    expect(state.changes.some((c) => c.changes?.[0]?.field === "Handover file downloaded")).toBe(true);
  }, 30_000);
});

describe("the code lists", () => {
  const upload = (kind: string, name: string, content: string | Uint8Array, preview = false) => {
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", new File([content as BlobPart], name));
    if (preview) fd.set("preview", "1");
    return new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", body: fd });
  };

  it("lists are read by members, written only by admins, and searched by code or name", async () => {
    const res = await mastersGet(get("?kind=resource&q=metals"));
    expect(res.status).toBe(200);
    expect((await res.json()).rows.map((r: { code: string }) => r.code)).toEqual(["1105"]);
    expect((await mastersPost(json("POST", { kind: "cost_code", code: "X1", name: "x" }))).status).toBe(403);
    expect((await mastersImport(upload("cost_code", "a.csv", "Code,Name\nA,B"))).status).toBe(403);
    expect((await masterPatch(json("PATCH", { active: false }), ctx(T2_PROJECT))).status).toBe(403);
  });

  it("an admin adds one entry (a parent must exist, a code once) and switches one off without deleting it", async () => {
    as(BOSS, "admin");
    const ok = await mastersPost(json("POST", { kind: "cost_code", code: "03 31 00", name: "Structural Concrete", parent_code: "03" }));
    expect(ok.status).toBe(201);
    expect(mine("erp_masters").find((m) => m.code === "03 31 00")).toMatchObject({ source: "manual", parent_code: "03", active: true });
    expect((await mastersPost(json("POST", { kind: "cost_code", code: "03 31 00", name: "again" }))).status).toBe(409);
    expect((await mastersPost(json("POST", { kind: "cost_code", code: "Q", name: "q", parent_code: "nope" }))).status).toBe(422);
    expect((await mastersPost(json("POST", { kind: "nonsense", code: "Q", name: "q" }))).status).toBe(400);
    const row = mine("erp_masters").find((m) => m.code === "03 31 00")!;
    expect((await masterPatch(json("PATCH", { active: false }), ctx(row.id as string))).status).toBe(200);
    expect(row.active).toBe(false);
    expect((await mastersGet(get("?kind=cost_code&q=03 31"))).status).toBe(200);
    expect((await (await mastersGet(get("?kind=cost_code&q=03 31"))).json()).rows).toHaveLength(0);
    expect((await (await mastersGet(get("?kind=cost_code&q=03 31&all=1"))).json()).rows).toHaveLength(1);
    expect((await masterPatch(json("PATCH", { active: false }), ctx("not-an-id"))).status).toBe(404);
  });

  it("a file import adds new codes and replaces the name and parent of ones it already has, matching on list and code", async () => {
    as(BOSS, "admin");
    await mastersGet(get("?summary=1"));
    const csv = "Code,Name,Parent\n03,Concrete (client wording),\n03 31 00,Structural Concrete,03\nNEW-1,Brand new,03\nbad,,\n03 31 00,Duplicate,\n";
    const preview = await mastersImport(upload("cost_code", "codes.csv", csv, true));
    const pj = await preview.json();
    expect(pj).toMatchObject({ preview: true, added: 2, updated: 1, refused: 2 });
    expect(mine("erp_masters").some((m) => m.code === "NEW-1")).toBe(false);
    const res = await mastersImport(upload("cost_code", "codes.csv", csv));
    expect(res.status).toBe(200);
    const concrete = mine("erp_masters").find((m) => m.kind === "cost_code" && m.code === "03")!;
    expect(concrete).toMatchObject({ name: "Concrete (client wording)", source: "file" });
    expect(mine("erp_masters").find((m) => m.code === "NEW-1")).toMatchObject({ parent_code: "03", source: "file", tenant_id: T1 });
    expect(mine("erp_masters").filter((m) => m.kind === "cost_code" && m.code === "03")).toHaveLength(1);
    expect(rows("erp_masters").filter((m) => m.tenant_id === T2)).toHaveLength(1);
    // The same codes in the resource list are a different list: untouched.
    expect(mine("erp_masters").find((m) => m.kind === "resource" && m.code === "03")).toBeUndefined();
    expect(state.changes.some((c) => String(c.changes?.[0]?.field).includes("imported from codes.csv"))).toBe(true);
  });

  it("refuses a file that is not a CSV or a real workbook, one with no header, and an empty one", async () => {
    as(BOSS, "admin");
    expect((await mastersImport(upload("cost_code", "x.pdf", "%PDF"))).status).toBe(422);
    expect((await mastersImport(upload("cost_code", "x.xlsx", "this is not a zip"))).status).toBe(422);
    expect((await mastersImport(upload("cost_code", "x.csv", ""))).status).toBe(422);
    const noHeader = await mastersImport(upload("cost_code", "x.csv", "03,Concrete\n04,Masonry\n"));
    expect(noHeader.status).toBe(422);
    expect((await noHeader.json()).error).toContain("header");
    expect((await mastersImport(upload("what", "x.csv", "Code,Name\nA,B"))).status).toBe(400);
  });

  it("reads an Excel workbook the same way", async () => {
    as(BOSS, "admin");
    const { default: Excel } = await import("exceljs");
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet("Cost codes");
    ws.addRow(["Code", "Name", "Parent"]); ws.addRow(["77", "Seventy-seven", null]); ws.addRow(["77 10", "Child", "77"]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const res = await mastersImport(upload("cost_code", "codes.xlsx", buf));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: 2, updated: 0, refused: 0 });
    expect(mine("erp_masters").find((m) => m.code === "77 10")!.parent_code).toBe("77");
  });
});

describe("the workspace settings of the module", () => {
  const milestone = (title: string, percent: number, trigger = "") => ({ title, basis: "percent", percent, trigger });

  it("the margin floor: admin only, 0 to 95 or empty, kept with the rest of the config", async () => {
    expect((await settingsGet()).status).toBe(403);
    expect((await settingsPut(json("PUT", { margin_floor_pct: 20 }))).status).toBe(403);
    as(BOSS, "admin");
    expect(await (await settingsGet()).json()).toEqual({ margin_floor_pct: null, payment_term_templates: [] });
    expect((await settingsPut(json("PUT", { margin_floor_pct: 120 }))).status).toBe(422);
    expect((await settingsPut(json("PUT", { margin_floor_pct: "abc" }))).status).toBe(422);
    expect((await settingsPut(json("PUT", {}))).status).toBe(400);
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { tender: { approvers: [BOSS] }, contract_projects: { default_margin_pct: 15 } };
    expect((await settingsPut(json("PUT", { margin_floor_pct: 12.5 }))).status).toBe(200);
    const cfg = state.db.rows("tenants").find((t) => t.id === T1)!.config as Record<string, Record<string, unknown>>;
    expect(cfg.contract_projects.margin_floor_pct).toBe(12.5);
    expect(cfg.contract_projects).not.toHaveProperty("default_margin_pct"); // the retired setting is dropped on the first save
    expect(cfg.tender.approvers).toEqual([BOSS]);
    expect((await (await settingsGet()).json()).margin_floor_pct).toBe(12.5);
    expect((await settingsPut(json("PUT", { margin_floor_pct: null }))).status).toBe(200);
    expect((await (await settingsGet()).json()).margin_floor_pct).toBeNull();
  });

  it("payment-term templates: saved whole, each new one gets an id, a bad one is refused and nothing is written", async () => {
    as(BOSS, "admin");
    const good = [{ name: "30 / 60 / 10", milestones: [milestone("Advance", 30, "On award"), milestone("Delivery", 60, "On delivery"), milestone("Retention", 10, "After 12 months")] }];
    const saved = await settingsPut(json("PUT", { payment_term_templates: good }));
    expect(saved.status).toBe(200);
    const returned = (await saved.json()).payment_term_templates as { id: string; name: string }[];
    expect(returned).toHaveLength(1);
    expect(returned[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await (await settingsGet()).json()).payment_term_templates).toEqual(returned.map((t) => expect.objectContaining({ id: t.id, name: "30 / 60 / 10" })));

    for (const bad of [
      [{ name: "", milestones: [milestone("A", 10)] }],
      [{ name: "No milestones", milestones: [] }],
      [{ name: "Over", milestones: [milestone("A", 120)] }],
      [{ name: "Same", milestones: [milestone("A", 10)] }, { name: "same", milestones: [milestone("B", 10)] }],
    ]) expect((await settingsPut(json("PUT", { payment_term_templates: bad }))).status, JSON.stringify(bad)).toBe(422);
    expect(((await (await settingsGet()).json()).payment_term_templates as unknown[]).length).toBe(1);
  });
});
