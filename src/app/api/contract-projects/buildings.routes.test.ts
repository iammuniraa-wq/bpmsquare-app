import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Buildings and element codes of a contract project (migrations 0253 and 0254; docs/design/pcbs-buildings-elements.md), against an in-memory database.
// The questions asked are the design's: another workspace's rows, the add-on off, a view-only person, a locked budget, a unique code, the pattern and
// its numbers, an element that cannot be split across buildings, the quantity the budget uses, a revision arriving as a comparison that never writes
// an approved line, and the migrations still pending.

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
  seq: {} as Record<string, number>,
}));

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const ASKER = "11111111-1111-4111-8111-111111111111";
const BOSS = "22222222-2222-4222-8222-222222222222";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const T2_PROJECT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const T2_ITEM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

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
    state.seq[table] = (state.seq[table] ?? 0) + 1;
    const ref = `CPR-${String(state.seq[table]).padStart(4, "0")}`;
    const now = new Date().toISOString();
    return admin.from(table).insert({ ...record, ref, created_at: now, updated_at: now }).select(select).single();
  },
}));

import { NextRequest } from "next/server";
import { POST as createPost } from "./route";
import { PUT as budgetPut, GET as budgetGet } from "./[id]/budget/route";
import { POST as askPost } from "./[id]/approval/route";
import { PATCH as decide } from "./[id]/approval/[requestId]/route";
import { GET as buildingsGet, POST as buildingsPost } from "./[id]/buildings/route";
import { PATCH as buildingPatch, DELETE as buildingDelete } from "./[id]/buildings/[itemId]/route";
import { PATCH as elementPatch } from "./[id]/elements/[lineKey]/route";
import { POST as issuePost } from "./[id]/elements/issue/route";
import { GET as importsGet, POST as importsPost } from "./[id]/model-imports/route";
import { GET as importGet, PATCH as importPatch } from "./[id]/model-imports/[importId]/route";
import { PUT as wpAssign } from "./[id]/work-packages/assign/route";
import { PUT as wpSplit } from "./[id]/work-packages/split/route";
import { POST as wpPost } from "./[id]/work-packages/route";
import { GET as handoverGet } from "./[id]/handover/route";
import { POST as mastersPost } from "./masters/route";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (qs = "") => new NextRequest(new URL(`http://internal.invalid/x${qs}`));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ictx = (id: string, itemId: string) => ({ params: Promise.resolve({ id, itemId }) });
const lctx = (id: string, lineKey: string) => ({ params: Promise.resolve({ id, lineKey }) });
const mctx = (id: string, importId: string) => ({ params: Promise.resolve({ id, importId }) });
const dctx = (id: string, requestId: string) => ({ params: Promise.resolve({ id, requestId }) });
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };
const rows = (t: string) => state.db.rows(t);
const mine = (t: string) => rows(t).filter((r) => r.tenant_id === T1);

function seed() {
  return new MemoryDb({
    tenants: [
      { id: T1, slug: "pcbs", name: "PCBS", is_demo: false, config: {}, custom_domain: "pcbs.example.com" },
      { id: T2, slug: "other", name: "Other", is_demo: false, config: {}, custom_domain: null },
    ],
    tenant_users: [{ tenant_id: T1, user_id: ASKER, role: "member" }, { tenant_id: T1, user_id: BOSS, role: "admin" }],
    accounts: [{ id: ACC, tenant_id: T1, name: "Client" }, { id: ACC_T2, tenant_id: T2, name: "Other client" }],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-1", title: "Precast job", account_id: ACC, stage: "awarded", outcome: "won", amount: 100000, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
      { id: OPP_T2, tenant_id: T2, ref: "OPP-9", title: "Other workspace", account_id: ACC_T2, stage: "awarded", outcome: "won", amount: 1, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "T-1", issuer_name: "Client", portal: "ariba", bond_status: "held", reminders_sent: [], addenda_count: 0 },
      { opportunity_id: OPP_T2, tenant_id: T2, tender_no: "X-1", issuer_name: "X", portal: "email", bond_status: "held", reminders_sent: [], addenda_count: 0 },
    ],
    opportunity_lines: [
      { id: "10000000-0000-4000-8000-000000000001", tenant_id: T1, opportunity_id: OPP, sl_no: "1.1", description: "Hollow core slab 200", uom: "m2", qty: 100, rate: 200, discount_pct: 0, amount: 20000, is_selected: true, break_of: null },
      { id: "10000000-0000-4000-8000-000000000002", tenant_id: T1, opportunity_id: OPP, sl_no: "1.2", description: "Wall panel", uom: "m2", qty: 50, rate: 400, discount_pct: 0, amount: 20000, is_selected: true, break_of: null },
      { id: "10000000-0000-4000-8000-000000000003", tenant_id: T1, opportunity_id: OPP, sl_no: "1.3", description: "Transport", uom: "LS", qty: 1, rate: 5000, discount_pct: 0, amount: 5000, is_selected: true, break_of: null },
    ],
    tender_boq_lines: [
      { id: "b1", tenant_id: T1, opportunity_id: OPP, line_id: "10000000-0000-4000-8000-000000000001", item_no: "1.1", cost_code: null, unit_cost: null, file_qty: 100, element_type: "HCS", element_code: null, model_qty: null },
      { id: "b2", tenant_id: T1, opportunity_id: OPP, line_id: "10000000-0000-4000-8000-000000000002", item_no: "1.2", cost_code: null, unit_cost: null, file_qty: 50, element_type: "WAL", element_code: null, model_qty: null },
      { id: "b3", tenant_id: T1, opportunity_id: OPP, line_id: "10000000-0000-4000-8000-000000000003", item_no: "1.3", cost_code: null, unit_cost: null, file_qty: 1, element_type: null, element_code: null, model_qty: null },
    ],
    tender_boq_sources: [{ id: "s1", tenant_id: T1, opportunity_id: OPP, file_name: "BOQ.xlsx", uploaded_at: "2026-10-05T00:00:00Z", version: 1, is_current: true }],
    erp_masters: [
      { id: "m1", tenant_id: T1, kind: "element_type", code: "HCS", name: "Hollow core slab", parent_code: null, flags: {}, source: "manual", active: true },
      { id: "m2", tenant_id: T1, kind: "element_type", code: "WAL", name: "Wall panel", parent_code: null, flags: {}, source: "manual", active: true },
      { id: "m3", tenant_id: T1, kind: "element_type", code: "OLD", name: "Switched off", parent_code: null, flags: {}, source: "manual", active: false },
      { id: "m4", tenant_id: T1, kind: "justification", code: "scope_change", name: "Scope change", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m5", tenant_id: T1, kind: "resource", code: "11", name: "Material", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m6", tenant_id: T1, kind: "cost_code", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m7", tenant_id: T1, kind: "division", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m8", tenant_id: T1, kind: "reserve_type", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m9", tenant_id: T1, kind: "job_location", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m10", tenant_id: T2, kind: "element_type", code: "SEC", name: "Other workspace type", parent_code: null, flags: {}, source: "manual", active: true },
    ],
    contract_projects: [{ id: T2_PROJECT, tenant_id: T2, ref: "CPR-9001", name: "Other tenant's project", account_id: ACC_T2, source_opportunity_id: OPP_T2, status: "active", contract_value: 10, currency: "SAR", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    project_work_packages: [{ id: T2_ITEM, tenant_id: T2, project_id: T2_PROJECT, code: "1", name: "Their building", parent_id: null, building_code: "B01", sort_order: 10, code_is_manual: false }],
  });
}

beforeEach(() => {
  state.db = seed();
  state.db.users.set(ASKER, { email: "asker@pcbs.test", name: "S. Khan" });
  state.db.users.set(BOSS, { email: "boss@pcbs.test", name: "A. Nasser" });
  state.db.unique("contract_projects", (a, b) => a.tenant_id === b.tenant_id && !!a.source_opportunity_id && a.source_opportunity_id === b.source_opportunity_id);
  state.db.unique("erp_masters", (a, b) => a.tenant_id === b.tenant_id && a.kind === b.kind && a.code === b.code);
  state.db.unique("project_budget_revisions", (a, b) => a.project_id === b.project_id && ["draft", "pending"].includes(String(a.status)) && ["draft", "pending"].includes(String(b.status)));
  // The database's own unique indexes of 0253: a building code per project, an element code per project and revision.
  state.db.unique("project_work_packages", (a, b) => a.project_id === b.project_id && !!a.building_code && a.building_code === b.building_code);
  state.db.unique("project_budget_lines", (a, b) => a.project_id === b.project_id && a.revision_id === b.revision_id && !!a.element_code && a.element_code === b.element_code);
  state.features = { pipeline: true, gcc_tender: true, contract_projects: true, contract_buildings: true };
  state.config = {};
  state.touched = []; state.changes = []; state.seq = {};
  state.view = true; state.edit = true;
  as(ASKER);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function fromTender() {
  const res = await createPost(json("POST", { opportunity_id: OPP }));
  const j = await res.json();
  return { res, ...j } as { res: Response; id: string; ref: string; revision_id: string };
}
const lineOf = (projectId: string, itemNo: string) => mine("project_budget_lines").find((l) => l.project_id === projectId && l.wbs === itemNo)!;
async function addBuilding(id: string, code: string, name = `Building ${code}`) {
  const res = await buildingsPost(json("POST", { code, name }), ctx(id));
  return { res, ...(await res.json()) } as { res: Response; id: string; code: string; error?: string };
}
/** A project with two buildings, the two slab/wall lines in B01 and the transport line left in no building. */
async function twoBuildings() {
  const p = await fromTender();
  const b1 = await addBuilding(p.id, "B01");
  const b2 = await addBuilding(p.id, "B02");
  const lines = ["1.1", "1.2"].map((n) => String(lineOf(p.id, n).line_key));
  const res = await wpAssign(json("PUT", { line_keys: lines, package_id: b1.id }), ctx(p.id));
  expect(res.status).toBe(200);
  return { p, b1, b2, keys: { slab: lines[0], wall: lines[1], transport: String(lineOf(p.id, "1.3").line_key) } };
}
async function baseline(p: { id: string; revision_id: string }) {
  const put = await budgetPut(json("PUT", { revision_id: p.revision_id, lines: mine("project_budget_lines").filter((l) => l.revision_id === p.revision_id).map((l) => ({ ...l, resource_code: "11", unit_cost: 10, amount: undefined, allocated: true })) }), ctx(p.id));
  expect(put.status).toBe(200);
  as(ASKER);
  const ask = await askPost(json("POST", {}), ctx(p.id));
  const askJ = await ask.json();
  expect(ask.status).toBe(201);
  const { id: requestId } = askJ;
  as(BOSS, "admin");
  const dec = await decide(json("PATCH", { action: "approve" }), dctx(p.id, requestId));
  expect(dec.status).toBe(200);
  as(ASKER);
}
const view = async (id: string) => (await buildingsGet(get(), ctx(id))).json();

describe("the add-on is off", () => {
  it("answers { enabled: false } on the read and 404 on every write, and never touches the new tables", async () => {
    state.features = { pipeline: true, gcc_tender: true, contract_projects: true, contract_buildings: false };
    const p = await fromTender();
    state.touched = [];
    expect(await (await buildingsGet(get(), ctx(p.id))).json()).toEqual({ enabled: false });
    as(BOSS, "admin");
    const answers = [
      await buildingsPost(json("POST", { code: "B01", name: "x" }), ctx(p.id)),
      await buildingPatch(json("PATCH", { name: "y" }), ictx(p.id, T2_ITEM)),
      await buildingDelete(json("DELETE"), ictx(p.id, T2_ITEM)),
      await issuePost(json("POST", {}), ctx(p.id)),
      await elementPatch(json("PATCH", { element_type: "HCS" }), lctx(p.id, "ffffffff-ffff-4fff-8fff-ffffffffffff")),
      await importsGet(get(), ctx(p.id)),
      await importsPost(json("POST", { rows: [{ element_type: "HCS", qty: 1 }] }), ctx(p.id)),
      await importGet(get(), mctx(p.id, "ffffffff-ffff-4fff-8fff-ffffffffffff")),
      await mastersPost(json("POST", { kind: "element_type", code: "COL", name: "Column" })),
    ];
    for (const a of answers) expect(a.status).toBe(404);
    expect(state.touched.filter((t) => ["project_model_imports", "project_model_import_rows"].includes(t))).toEqual([]);
    expect(mine("erp_masters").some((r) => r.code === "COL")).toBe(false);
  });

  it("the module off is the same: the add-on needs Contract projects", async () => {
    state.features = { pipeline: true, gcc_tender: true, contract_projects: false, contract_buildings: true };
    expect((await buildingsGet(get(), ctx(T2_PROJECT))).status).toBe(404);
  });
});

describe("buildings", () => {
  it("a building is a top-level WBS item with a unique code of 1 to 6 characters, in this project only", async () => {
    const p = await fromTender();
    const a = await addBuilding(p.id, "b01", "Block one");
    expect(a.res.status).toBe(201);
    expect(a.code).toBe("B01");
    expect(mine("project_work_packages").find((x) => x.id === a.id)).toMatchObject({ building_code: "B01", parent_id: null, name: "Block one" });
    expect((await addBuilding(p.id, "B01")).res.status).toBe(409);
    expect((await addBuilding(p.id, "TOO-LONG")).res.status).toBe(422);
    expect((await buildingsPost(json("POST", { code: "B05" }), ctx(p.id))).status).toBe(422);
    expect(state.changes.some((c) => c.changes?.some((x) => x.field === "Building B01 added"))).toBe(true);
    // the same code may exist in another project, and another workspace's item is not reachable by id
    expect((await buildingPatch(json("PATCH", { name: "Hijacked" }), ictx(p.id, T2_ITEM))).status).toBe(404);
    expect((await buildingDelete(json("DELETE"), ictx(p.id, T2_ITEM))).status).toBe(404);
    expect(rows("project_work_packages").find((x) => x.id === T2_ITEM)?.name).toBe("Their building");
    expect((await buildingsGet(get(), ctx(T2_PROJECT))).status).toBe(404);
  });

  it("a view-only person reads but cannot add", async () => {
    const p = await fromTender();
    state.edit = false;
    expect((await buildingsGet(get(), ctx(p.id))).status).toBe(200);
    expect((await buildingsPost(json("POST", { code: "B01", name: "x" }), ctx(p.id))).status).toBe(403);
  });

  it("makes the site-wide Common building on request, once", async () => {
    const p = await fromTender();
    const made = await buildingsPost(json("POST", { common: true }), ctx(p.id));
    expect(made.status).toBe(201);
    expect((await made.json()).code).toBe("COM");
    expect((await buildingsPost(json("POST", { common: true }), ctx(p.id))).status).toBe(409);
  });

  it("derives the building of a line from its WBS item and counts the rest as no building", async () => {
    const { p, b1 } = await twoBuildings();
    const v = await view(p.id);
    const b01 = v.view.buildings.find((b: { code: string }) => b.code === "B01");
    expect(b01).toMatchObject({ name: "Building B01", line_count: 2, client_amount: 40000 });
    expect(v.view.buildings.find((b: { code: string }) => b.code === "B02")).toMatchObject({ line_count: 0 });
    expect(v.view.no_building).toMatchObject({ line_count: 1, client_amount: 5000 });
    expect(v.rows.find((r: { ref: string }) => r.ref === "1.1")).toMatchObject({ building_code: "B01", element_type: "HCS", client_qty: 100 });
    expect(b1.code).toBe("B01");
  });

  it("refuses to remove a building that holds lines, with the count, and removes an empty one", async () => {
    const { p, b1, b2 } = await twoBuildings();
    const refused = await buildingDelete(json("DELETE"), ictx(p.id, b1.id));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/holds 2 lines/);
    expect(mine("project_work_packages").some((x) => x.id === b1.id)).toBe(true);
    expect((await buildingDelete(json("DELETE"), ictx(p.id, b2.id))).status).toBe(200);
    expect(mine("project_work_packages").some((x) => x.id === b2.id)).toBe(false);
  });

  it("a building cannot be moved under another item, and a child item cannot be made a building", async () => {
    const { p, b1 } = await twoBuildings();
    const child = await wpPost(json("POST", { name: "Foundations", parent_id: b1.id }), ctx(p.id));
    expect(child.status).toBe(201);
    const { id: childId } = await child.json();
    const asBuilding = await buildingPatch(json("PATCH", { code: "F01" }), ictx(p.id, childId));
    expect(asBuilding.status).toBe(422);
    expect((await asBuilding.json()).error).toMatch(/top-level/);
  });
});

describe("element type and element code", () => {
  it("issues codes from the pattern, per building and type, in line order, and says what it would do first", async () => {
    const { p, keys } = await twoBuildings();
    const preview = await (await issuePost(json("POST", { preview: true }), ctx(p.id))).json();
    expect(preview.plan.summary).toEqual(["1 code: B01-HCS-0001", "1 code: B01-WAL-0001"]);
    expect(preview.written).toBe(0);
    expect(mine("project_budget_lines").some((l) => l.element_code)).toBe(false);
    const done = await (await issuePost(json("POST", {}), ctx(p.id))).json();
    expect(done.written).toBe(2);
    expect(lineOf(p.id, "1.1").element_code).toBe("B01-HCS-0001");
    expect(lineOf(p.id, "1.2").element_code).toBe("B01-WAL-0001");
    expect(lineOf(p.id, "1.3").element_code ?? null).toBeNull();
    expect(state.changes.some((c) => c.changes?.some((x) => x.field === "Element codes issued"))).toBe(true);
    expect(keys.slab).toBeTruthy();
  });

  it("is idempotent, never reuses a number, and freezes the pattern on the project with its first code", async () => {
    const { p, keys } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    expect(mine("contract_projects").find((x) => x.id === p.id)?.element_pattern).toBe("{building}-{type}-{seq:4}");
    const again = await (await issuePost(json("POST", {}), ctx(p.id))).json();
    expect(again.written).toBe(0);
    // a later change of the workspace pattern does not touch a project that already issued
    state.config = { contract_elements: { pattern: "{type}.{seq:3}" } };
    const second = await elementPatch(json("PATCH", { element_code: null }), lctx(p.id, keys.slab));
    expect(second.status).toBe(200);
    const next = await (await issuePost(json("POST", {}), ctx(p.id))).json();
    expect(next.plan.assignments[0].code).toBe("B01-HCS-0001");
    expect(next.pattern).toBe("{building}-{type}-{seq:4}");
  });

  it("a project that has not issued yet follows the workspace pattern", async () => {
    const { p } = await twoBuildings();
    state.config = { contract_elements: { pattern: "{type}.{seq:3}", code_max: 12 } };
    const done = await (await issuePost(json("POST", {}), ctx(p.id))).json();
    expect(done.plan.assignments.map((a: { code: string }) => a.code)).toEqual(["HCS.001", "WAL.001"]);
  });

  it("refuses a pattern that cannot fit the longest code", async () => {
    const { p } = await twoBuildings();
    state.config = { contract_elements: { pattern: "{project}-{building}-{type}-{seq:6}", code_max: 20 } };
    const res = await issuePost(json("POST", {}), ctx(p.id));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/limit is 20/);
  });

  it("a typed code is kept as typed (upper-cased), must be unique, and an imported one outside the pattern is flagged, not refused", async () => {
    const { p, keys } = await twoBuildings();
    const typed = await elementPatch(json("PATCH", { element_code: "pc-slab-77" }), lctx(p.id, keys.slab));
    expect(typed.status).toBe(200);
    expect(lineOf(p.id, "1.1").element_code).toBe("PC-SLAB-77");
    expect((await elementPatch(json("PATCH", { element_code: "PC-SLAB-77" }), lctx(p.id, keys.wall))).status).toBe(409);
    expect((await elementPatch(json("PATCH", { element_code: "bad code" }), lctx(p.id, keys.wall))).status).toBe(422);
    expect((await view(p.id)).rows.find((r: { ref: string }) => r.ref === "1.1").outside_pattern).toBe(true);
  });

  it("the type must be in the workspace's list, and cannot change under an issued code", async () => {
    const { p, keys } = await twoBuildings();
    expect((await elementPatch(json("PATCH", { element_type: "SEC" }), lctx(p.id, keys.transport))).status).toBe(422);
    expect((await elementPatch(json("PATCH", { element_type: "OLD" }), lctx(p.id, keys.transport))).status).toBe(422);
    expect((await elementPatch(json("PATCH", { element_type: "HCS" }), lctx(p.id, keys.transport))).status).toBe(200);
    await issuePost(json("POST", {}), ctx(p.id));
    const changed = await elementPatch(json("PATCH", { element_type: "WAL" }), lctx(p.id, keys.slab));
    expect(changed.status).toBe(422);
    expect((await changed.json()).error).toMatch(/Clear the code first/);
    expect((await elementPatch(json("PATCH", { element_type: "WAL", element_code: null }), lctx(p.id, keys.slab))).status).toBe(200);
  });

  it("an issued code needs a building: a line in no building is skipped with the reason", async () => {
    const { p, keys } = await twoBuildings();
    await elementPatch(json("PATCH", { element_type: "HCS" }), lctx(p.id, keys.transport));
    const preview = await (await issuePost(json("POST", { preview: true }), ctx(p.id))).json();
    expect(preview.plan.skipped).toEqual([{ key: keys.transport, reason: "Not in a building" }]);
  });

  it("a cost-only category line takes no code of its own", async () => {
    const { p, keys } = await twoBuildings();
    const slab = lineOf(p.id, "1.1");
    rows("project_budget_lines").push({ ...slab, id: "cat1", line_key: "99999999-9999-4999-8999-999999999999", line_no: 9, client_rate: null, client_amount: 0, element_type: null, element_code: null, source_line_id: slab.source_line_id });
    const refused = await elementPatch(json("PATCH", { element_code: "X-1" }), lctx(p.id, "99999999-9999-4999-8999-999999999999"));
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toMatch(/contract line/);
    expect(keys.slab).toBeTruthy();
  });

  it("an element cannot be split across buildings, but can be split across the activities of one", async () => {
    const { p, b1, b2, keys } = await twoBuildings();
    await elementPatch(json("PATCH", { element_code: "A-1" }), lctx(p.id, keys.slab));
    const a1 = await wpPost(json("POST", { name: "Pour", parent_id: b1.id }), ctx(p.id));
    const a2 = await wpPost(json("POST", { name: "Cure", parent_id: b1.id }), ctx(p.id));
    const x1 = (await a1.json()).id, x2 = (await a2.json()).id;
    const across = await wpSplit(json("PUT", { line_key: keys.slab, parts: [{ package_id: x1, share_pct: 50 }, { package_id: b2.id, share_pct: 50 }] }), ctx(p.id));
    expect(across.status).toBe(422);
    expect((await across.json()).error).toBe("An element belongs to one building");
    const within = await wpSplit(json("PUT", { line_key: keys.slab, parts: [{ package_id: x1, share_pct: 60 }, { package_id: x2, share_pct: 40 }] }), ctx(p.id));
    expect(within.status).toBe(200);
    // a line with no code may still be split across buildings
    const free = await wpSplit(json("PUT", { line_key: keys.wall, parts: [{ package_id: b2.id, share_pct: 50 }, { package_id: x1, share_pct: 50 }] }), ctx(p.id));
    expect(free.status).toBe(200);
  });

  it("the budget grid never erases an element: a save without the fields keeps them, and a body that names a code cannot set one", async () => {
    const { p, keys } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    const before = await (await budgetGet(get(`?revision=${p.revision_id}`), ctx(p.id))).json();
    const lines = before.lines.map((l: Record<string, unknown>) => ({ ...l, element_code: l.line_key === keys.transport ? "FORGED-1" : undefined, element_type: undefined, resource_code: "11", unit_cost: 5, amount: undefined }));
    const saved = await budgetPut(json("PUT", { revision_id: p.revision_id, lines }), ctx(p.id));
    expect(saved.status).toBe(200);
    expect(lineOf(p.id, "1.1")).toMatchObject({ element_code: "B01-HCS-0001", element_type: "HCS", client_qty: 100 });
    expect(lineOf(p.id, "1.3").element_code ?? null).toBeNull();
  });

  it("answers the migration pending state without crashing", async () => {
    const p = await fromTender();
    const rowsOf = rows("project_work_packages");
    rowsOf.length = 0;
    const v = await buildingsGet(get(), ctx(p.id));
    expect(v.status).toBe(200);
  });
});

describe("the locked budget", () => {
  it("answers 409 locked once the baseline is approved, for an element edit and for issuing, and says to start a revision", async () => {
    const { p, keys } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    await baseline(p);
    const edit = await elementPatch(json("PATCH", { element_code: "NEW-1" }), lctx(p.id, keys.slab));
    expect(edit.status).toBe(409);
    expect((await edit.json()).locked).toBe(true);
    const issue = await issuePost(json("POST", {}), ctx(p.id));
    expect(issue.status).toBe(409);
    expect(lineOf(p.id, "1.1").element_code).toBe("B01-HCS-0001");
    const v = await view(p.id);
    expect(v.lock).toMatch(/locked/);
  });

  it("changing a building code under issued codes is refused, reissued before the baseline, final after it", async () => {
    const { p, b1 } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    const refused = await buildingPatch(json("PATCH", { code: "B09" }), ictx(p.id, b1.id));
    expect(refused.status).toBe(409);
    expect((await refused.json()).used_by).toBe(2);
    const preview = await (await buildingPatch(json("PATCH", { code: "B09", reissue: true, preview: true }), ictx(p.id, b1.id))).json();
    expect(preview.preview.rows).toEqual([expect.objectContaining({ from: "B01-HCS-0001", to: "B09-HCS-0001" }), expect.objectContaining({ from: "B01-WAL-0001", to: "B09-WAL-0001" })]);
    expect(lineOf(p.id, "1.1").element_code).toBe("B01-HCS-0001");
    const done = await buildingPatch(json("PATCH", { code: "B09", reissue: true }), ictx(p.id, b1.id));
    expect(done.status).toBe(200);
    expect(lineOf(p.id, "1.1").element_code).toBe("B09-HCS-0001");
    expect(mine("project_work_packages").find((x) => x.id === b1.id)?.building_code).toBe("B09");
    expect(state.changes.some((c) => c.changes?.some((x) => x.field === "Element code" && x.from === "B01-HCS-0001" && x.to === "B09-HCS-0001"))).toBe(true);
    await baseline(p);
    const final = await buildingPatch(json("PATCH", { code: "B10", reissue: true }), ictx(p.id, b1.id));
    expect(final.status).toBe(409);
    expect(lineOf(p.id, "1.1").element_code).toBe("B09-HCS-0001");
  });

  it("renaming a building changes nothing issued", async () => {
    const { p, b1 } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    const res = await buildingPatch(json("PATCH", { name: "Block A" }), ictx(p.id, b1.id));
    expect(res.status).toBe(200);
    expect(lineOf(p.id, "1.1").element_code).toBe("B01-HCS-0001");
    expect(mine("project_work_packages").find((x) => x.id === b1.id)?.name).toBe("Block A");
  });
});

describe("client quantity and model quantity", () => {
  it("copies the client quantity from the tender file and freezes it, keeps the model quantity beside it, and never moves the budget on its own", async () => {
    const { p, keys } = await twoBuildings();
    expect(lineOf(p.id, "1.1")).toMatchObject({ client_qty: 100, qty: 100 });
    const set = await elementPatch(json("PATCH", { model_qty: 106 }), lctx(p.id, keys.slab));
    expect(set.status).toBe(200);
    expect(lineOf(p.id, "1.1")).toMatchObject({ model_qty: 106, qty: 100, client_qty: 100 });
    const row = (await view(p.id)).rows.find((r: { ref: string }) => r.ref === "1.1");
    expect(row).toMatchObject({ uses: "client", variance_qty: 6, variance_pct: 6, band: "over" });
  });

  it("accepting the model quantity moves the budget quantity and its cost, never the contract side, and can be undone", async () => {
    const { p, keys } = await twoBuildings();
    const slab = lineOf(p.id, "1.1");
    slab.unit_cost = 10; slab.amount = 1000; slab.allocated = true;
    await elementPatch(json("PATCH", { model_qty: 110 }), lctx(p.id, keys.slab));
    const ok = await elementPatch(json("PATCH", { accept_model: true }), lctx(p.id, keys.slab));
    expect(ok.status).toBe(200);
    expect(lineOf(p.id, "1.1")).toMatchObject({ qty: 110, amount: 1100, client_qty: 100, client_amount: 20000 });
    expect((await view(p.id)).rows.find((r: { ref: string }) => r.ref === "1.1").uses).toBe("model");
    await elementPatch(json("PATCH", { use_client: true }), lctx(p.id, keys.slab));
    expect(lineOf(p.id, "1.1")).toMatchObject({ qty: 100, amount: 1000 });
    const none = await elementPatch(json("PATCH", { accept_model: true }), lctx(p.id, keys.wall));
    expect(none.status).toBe(422);
  });
});

describe("the model comparison", () => {
  const batch = (rows: Record<string, unknown>[]) => ({ source: "connector", model_ref: "Revit v3", rows });
  async function comparison(p: { id: string }, rowsIn: Record<string, unknown>[]) {
    const res = await importsPost(json("POST", batch(rowsIn)), ctx(p.id));
    return { res, ...(await res.json()) } as { res: Response; id: string; import_no: number; rows: number; error?: string };
  }

  it("stores a batch and matches it without writing to the budget; a bad row names its number", async () => {
    const { p } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    const before = JSON.stringify(mine("project_budget_lines"));
    const c = await comparison(p, [
      { building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0001", qty: 130, unit: "m2" },
      { building_code: "B01", element_type: "WAL", element_code: "B01-WAL-0001", qty: 50, unit: "m2" },
      { building_code: "B07", building_name: "Block 7", element_type: "HCS", element_code: "B07-HCS-0001", qty: 12, unit: "m2" },
    ]);
    expect(c.res.status).toBe(201);
    expect(c.import_no).toBe(1);
    expect(JSON.stringify(mine("project_budget_lines"))).toBe(before);
    const detail = await (await importGet(get(), mctx(p.id, c.id))).json();
    expect(detail.rows.map((r: { kind: string }) => r.kind)).toEqual(["qty_changed", "same", "new_building"]);
    expect(detail.rows[0]).toMatchObject({ current_qty: 100, matched_key: String(lineOf(p.id, "1.1").line_key) });
    const bad = await comparison(p, [{ element_type: "HCS", qty: -2 }]);
    expect(bad.res.status).toBe(422);
    expect(bad.error).toMatch(/Row 1/);
    expect((await (await importsGet(get(), ctx(p.id))).json()).imports).toHaveLength(1);
  });

  it("applies only ticked rows to revision 0 while no baseline is approved, accepting the quantity and adding the new element", async () => {
    const { p, keys } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    const c = await comparison(p, [
      { building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0001", qty: 130, unit: "m2" },
      { building_code: "B01", element_type: "WAL", element_code: "B01-WAL-0001", qty: 55, unit: "m2" },
      { building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0002", qty: 12, unit: "m2" },
    ]);
    const done = await importPatch(json("PATCH", { action: "apply", rows: [1, 3] }), mctx(p.id, c.id));
    expect(done.status).toBe(200);
    expect((await done.json()).started_revision).toBe(false);
    expect(lineOf(p.id, "1.1")).toMatchObject({ model_qty: 130, qty: 130, client_qty: 100 });
    expect(lineOf(p.id, "1.2")).toMatchObject({ qty: 50 });
    expect(lineOf(p.id, "1.2").model_qty ?? null).toBeNull();
    const added = mine("project_budget_lines").find((l) => l.element_code === "B01-HCS-0002");
    expect(added).toMatchObject({ element_type: "HCS", qty: 12, model_qty: 12, allocated: false, revision_id: p.revision_id });
    expect(mine("project_work_package_lines").some((l) => l.line_key === added?.line_key)).toBe(true);
    expect(mine("project_model_imports").find((i) => i.id === c.id)?.status).toBe("applied");
    expect((await importPatch(json("PATCH", { action: "apply", rows: [2] }), mctx(p.id, c.id))).status).toBe(409);
    expect(keys.wall).toBeTruthy();
  });

  it("after the baseline is approved it starts a draft revision with a reason, and the approved lines are never written", async () => {
    const { p } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    await baseline(p);
    const approved = JSON.stringify(mine("project_budget_lines").filter((l) => l.revision_id === p.revision_id));
    const c = await comparison(p, [{ building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0001", qty: 140, unit: "m2" }]);
    const noReason = await importPatch(json("PATCH", { action: "apply", rows: [1], justification_code: "nope" }), mctx(p.id, c.id));
    expect(noReason.status).toBe(422);
    expect(mine("project_budget_revisions").filter((r) => r.project_id === p.id)).toHaveLength(1);
    const done = await importPatch(json("PATCH", { action: "apply", rows: [1], justification_code: "scope_change" }), mctx(p.id, c.id));
    expect(done.status).toBe(200);
    const j = await done.json();
    expect(j.started_revision).toBe(true);
    expect(j.revision_rev_no).toBe(1);
    expect(JSON.stringify(mine("project_budget_lines").filter((l) => l.revision_id === p.revision_id))).toBe(approved);
    const draft = mine("project_budget_revisions").find((r) => r.project_id === p.id && r.status === "draft");
    expect(draft).toMatchObject({ rev_no: 1, justification_code: "scope_change" });
    expect(mine("project_budget_lines").find((l) => l.revision_id === draft?.id && l.element_code === "B01-HCS-0001")).toMatchObject({ qty: 140, model_qty: 140 });
    expect(mine("project_budget_revisions").filter((r) => ["draft", "pending"].includes(String(r.status)))).toHaveLength(1);
  });

  it("applies nothing, and opens no revision, when no ticked row can be applied; a dismissed comparison keeps the budget", async () => {
    const { p } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    await baseline(p);
    const c = await comparison(p, [{ building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0001", qty: 100, unit: "m2" }]);
    const none = await importPatch(json("PATCH", { action: "apply", rows: [1] }), mctx(p.id, c.id));
    expect(none.status).toBe(422);
    expect(mine("project_budget_revisions").filter((r) => r.project_id === p.id)).toHaveLength(1);
    expect((await importPatch(json("PATCH", { action: "dismiss" }), mctx(p.id, c.id))).status).toBe(200);
    expect(mine("project_model_imports").find((i) => i.id === c.id)?.status).toBe("dismissed");
    expect((await importPatch(json("PATCH", { action: "dismiss" }), mctx(p.id, c.id))).status).toBe(409);
  });

  it("flags what the budget has that the model does not mention, only in the buildings it names, and never removes it", async () => {
    const { p } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    const c = await comparison(p, [{ building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0001", qty: 100, unit: "m2" }]);
    const detail = await (await importGet(get(), mctx(p.id, c.id))).json();
    expect(detail.rows.map((r: { kind: string }) => r.kind)).toEqual(["same", "not_in_model"]);
    const gone = await importPatch(json("PATCH", { action: "apply", rows: [2] }), mctx(p.id, c.id));
    expect(gone.status).toBe(422);
    expect(lineOf(p.id, "1.2")).toMatchObject({ qty: 50, element_code: "B01-WAL-0001" });
  });

  it("one workspace cannot see or apply another's comparison, and a view-only person cannot add one", async () => {
    const { p } = await twoBuildings();
    rows("project_model_imports").push({ id: "f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0", tenant_id: T2, project_id: T2_PROJECT, import_no: 1, source: "file", status: "open", row_count: 0 });
    expect((await importGet(get(), mctx(p.id, "f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0"))).status).toBe(404);
    expect((await importPatch(json("PATCH", { action: "dismiss" }), mctx(p.id, "f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0"))).status).toBe(404);
    expect(rows("project_model_imports")[0].status).toBe("open");
    state.edit = false;
    expect((await importsPost(json("POST", batch([{ element_type: "HCS", qty: 1 }])), ctx(p.id))).status).toBe(403);
    expect((await importsGet(get(), ctx(p.id))).status).toBe(200);
  });
});

describe("the handover workbook", () => {
  it("adds the building and element columns and a Buildings sheet only for a workspace with the add-on", { timeout: 60_000 }, async () => {
    const { p } = await twoBuildings();
    await issuePost(json("POST", {}), ctx(p.id));
    const ExcelJS = (await import("exceljs")).default;
    const read = async () => {
      const res = await handoverGet(get(), ctx(p.id));
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
      return wb;
    };
    const on = await read();
    expect(on.worksheets.map((w) => w.name)).toContain("Buildings");
    const budget = on.getWorksheet("Budget")!;
    const header = (budget.getRow(1).values as unknown[]).slice(1).map(String);
    expect(header.slice(-7)).toEqual(["Building code", "Building", "Element type", "Element code", "Client qty", "Model qty", "Budget uses"]);
    expect(header.slice(0, 3)).toEqual(["#", "Resource code", "Resource"]);
    const first = (budget.getRow(2).values as unknown[]).slice(1);
    expect(first.slice(-7, -3)).toEqual(["B01", "Building B01", "HCS", "B01-HCS-0001"]);
    state.features = { pipeline: true, gcc_tender: true, contract_projects: true, contract_buildings: false };
    const off = await read();
    expect(off.worksheets.map((w) => w.name)).not.toContain("Buildings");
    expect(((off.getWorksheet("Budget")!.getRow(1).values as unknown[]).slice(1)).length).toBe(header.length - 7);
  });
});
