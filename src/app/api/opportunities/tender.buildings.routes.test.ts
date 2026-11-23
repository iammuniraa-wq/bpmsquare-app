import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Buildings and element codes on a TENDER (migration 0253; docs/design/pcbs-buildings-elements.md): the same panel as on the project, on the tender's
// WBS and Bill of quantities, and the codes that travel to the project with the lines. Run against the real routes and an in-memory database.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  view: true,
  edit: true,
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  seq: 0,
}));

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const L = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const B = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;
const T2_ITEM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: "admin", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: state.config, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({}), canViewWorkcenter: () => state.view, canEditWorkcenter: () => state.edit }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-11-24", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [], diffLineItems: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: Record<string, unknown>) => { select: (s: string) => { single: () => Promise<unknown> } } } }, table: string, _tid: string, record: Record<string, unknown>, select: string) => {
    state.seq += 1;
    return admin.from(table).insert({ ...record, ref: `CPR-${String(state.seq).padStart(4, "0")}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select(select).single();
  },
}));

import { NextRequest } from "next/server";
import { GET as buildingsGet, POST as buildingsPost } from "./[id]/tender/buildings/route";
import { PATCH as buildingPatch, DELETE as buildingDelete } from "./[id]/tender/buildings/[itemId]/route";
import { PATCH as elementPatch } from "./[id]/tender/elements/[lineId]/route";
import { POST as issuePost } from "./[id]/tender/elements/issue/route";
import { PUT as assignPut } from "./[id]/tender/wbs/assign/route";
import { PUT as splitPut } from "./[id]/tender/wbs/split/route";
import { POST as createProject } from "../contract-projects/route";

const json = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = () => new NextRequest(new URL("http://internal.invalid/x"));
const ctx = (id = OPP) => ({ params: Promise.resolve({ id }) });
const ictx = (itemId: string, id = OPP) => ({ params: Promise.resolve({ id, itemId }) });
const lctx = (lineId: string, id = OPP) => ({ params: Promise.resolve({ id, lineId }) });
const rows = (t: string) => state.db.rows(t);
const boq = (n: number) => rows("tender_boq_lines").find((b) => b.id === B(n))!;

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, slug: "pcbs", name: "PCBS", is_demo: false, config: {}, custom_domain: null }, { id: T2, slug: "x", name: "X", is_demo: false, config: {}, custom_domain: null }],
    accounts: [{ id: ACC, tenant_id: T1, name: "Client" }],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-1", title: "Precast job", account_id: ACC, stage: "awarded", outcome: "won", amount: 100000, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
      { id: OPP_T2, tenant_id: T2, ref: "OPP-9", title: "Other", account_id: ACC, stage: "estimating", outcome: null, amount: 1, currency: "SAR", created_at: "2026-10-01T00:00:00Z" },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "T-1", issuer_name: "Client", portal: "ariba", bond_status: "held", reminders_sent: [], addenda_count: 0 },
      { opportunity_id: OPP_T2, tenant_id: T2, tender_no: "X-1", issuer_name: "X", portal: "email", bond_status: "held", reminders_sent: [], addenda_count: 0 },
    ],
    opportunity_lines: [
      { id: L(1), tenant_id: T1, opportunity_id: OPP, sl_no: "1.1", description: "Slab", uom: "m2", qty: 100, rate: 200, discount_pct: 0, amount: 20000, is_selected: true, break_of: null },
      { id: L(2), tenant_id: T1, opportunity_id: OPP, sl_no: "1.2", description: "Wall", uom: "m2", qty: 50, rate: 400, discount_pct: 0, amount: 20000, is_selected: true, break_of: null },
    ],
    tender_boq_sources: [{ id: "s1", tenant_id: T1, opportunity_id: OPP, file_name: "BOQ.xlsx", uploaded_at: "2026-10-05T00:00:00Z", version: 1, is_current: true }],
    tender_boq_lines: [
      { id: B(1), tenant_id: T1, opportunity_id: OPP, line_id: L(1), item_key: "n:1.1", item_no: "1.1", row_no: 2, file_description: "Slab", file_uom: "m2", file_qty: 100, cost_code: null, unit_cost: null, removed_in_revision: false, wbs_item_id: null, element_type: null, element_code: null, model_qty: null },
      { id: B(2), tenant_id: T1, opportunity_id: OPP, line_id: L(2), item_key: "n:1.2", item_no: "1.2", row_no: 3, file_description: "Wall", file_uom: "m2", file_qty: 50, cost_code: null, unit_cost: null, removed_in_revision: false, wbs_item_id: null, element_type: null, element_code: null, model_qty: null },
    ],
    erp_masters: [
      { id: "m1", tenant_id: T1, kind: "element_type", code: "HCS", name: "Hollow core slab", parent_code: null, flags: {}, source: "manual", active: true },
      { id: "m2", tenant_id: T1, kind: "element_type", code: "WAL", name: "Wall panel", parent_code: null, flags: {}, source: "manual", active: true },
      { id: "m3", tenant_id: T1, kind: "resource", code: "11", name: "Material", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m4", tenant_id: T1, kind: "cost_code", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m5", tenant_id: T1, kind: "justification", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m6", tenant_id: T1, kind: "division", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m7", tenant_id: T1, kind: "reserve_type", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
      { id: "m8", tenant_id: T1, kind: "job_location", code: "x", name: "x", parent_code: null, flags: {}, source: "default", active: true },
    ],
    tender_wbs_items: [{ id: T2_ITEM, tenant_id: T2, opportunity_id: OPP_T2, parent_id: null, code: "1", name: "Their building", building_code: "B01", sort_order: 10, code_is_manual: false }],
  });
  state.db.unique("tender_wbs_items", (a, b) => a.opportunity_id === b.opportunity_id && !!a.building_code && a.building_code === b.building_code);
  state.db.unique("tender_wbs_items", (a, b) => a.opportunity_id === b.opportunity_id && a.code === b.code);
  state.db.unique("tender_boq_lines", (a, b) => a.opportunity_id === b.opportunity_id && !!a.element_code && a.element_code === b.element_code);
  state.db.unique("contract_projects", (a, b) => a.tenant_id === b.tenant_id && !!a.source_opportunity_id && a.source_opportunity_id === b.source_opportunity_id);
  state.db.unique("erp_masters", (a, b) => a.tenant_id === b.tenant_id && a.kind === b.kind && a.code === b.code);
  state.features = { pipeline: true, gcc_tender: true, contract_projects: true, contract_buildings: true };
  state.config = {}; state.changes = []; state.view = true; state.edit = true; state.seq = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function building(code: string, name = `Block ${code}`) {
  const res = await buildingsPost(json("POST", { code, name }), ctx());
  return { res, ...(await res.json()) } as { res: Response; id: string; code: string };
}
async function inBuilding(b: { id: string }, lines: number[]) {
  const res = await assignPut(json("PUT", { boq_ids: lines.map(B), wbs_item_id: b.id }), ctx());
  expect(res.status).toBe(200);
}

describe("the add-on is off", () => {
  it("answers { enabled: false } on the read and 404 on every write, and writes nothing", async () => {
    state.features = { pipeline: true, gcc_tender: true, contract_projects: true, contract_buildings: false };
    expect(await (await buildingsGet(get(), ctx())).json()).toEqual({ enabled: false });
    for (const a of [
      await buildingsPost(json("POST", { code: "B01", name: "x" }), ctx()), await buildingPatch(json("PATCH", { name: "x" }), ictx(T2_ITEM)), await buildingDelete(json("DELETE"), ictx(T2_ITEM)),
      await elementPatch(json("PATCH", { element_type: "HCS" }), lctx(B(1))), await issuePost(json("POST", {}), ctx()),
    ]) expect(a.status).toBe(404);
    expect(rows("tender_wbs_items").filter((i) => i.tenant_id === T1)).toHaveLength(0);
  });

  it("is the same without the Contract projects module", async () => {
    state.features = { pipeline: true, gcc_tender: true, contract_projects: false, contract_buildings: true };
    expect(await (await buildingsGet(get(), ctx())).json()).toEqual({ enabled: false });
  });
});

describe("buildings on a tender", () => {
  it("adds a building with a unique code on this tender only, and another workspace's deal or item is not reachable", async () => {
    const a = await building("b01");
    expect(a.res.status).toBe(201);
    expect(rows("tender_wbs_items").find((i) => i.id === a.id)).toMatchObject({ building_code: "B01", opportunity_id: OPP, tenant_id: T1 });
    expect((await building("B01")).res.status).toBe(409);
    expect((await building("WAYTOOLONG")).res.status).toBe(422);
    expect((await buildingsGet(get(), ctx(OPP_T2))).status).toBe(404);
    expect((await buildingPatch(json("PATCH", { name: "Hijack" }), ictx(T2_ITEM))).status).toBe(404);
    expect(rows("tender_wbs_items").find((i) => i.id === T2_ITEM)?.name).toBe("Their building");
    expect(state.changes.some((c) => c.changes?.some((x) => x.field === "Building B01 added"))).toBe(true);
  });

  it("reads the Buildings view with the contract value, the client quantity and the model's beside it", async () => {
    const b = await building("B01");
    await inBuilding(b, [1, 2]);
    await elementPatch(json("PATCH", { element_type: "HCS", model_qty: 110 }), lctx(B(1)));
    const v = await (await buildingsGet(get(), ctx())).json();
    expect(v).toMatchObject({ enabled: true, scope: "tender", lock: null, pending: false });
    expect(v.view.buildings[0]).toMatchObject({ code: "B01", line_count: 2, element_count: 1, client_amount: 40000 });
    expect(v.rows.find((r: { ref: string }) => r.ref === "1.1")).toMatchObject({ building_code: "B01", client_qty: 100, model_qty: 110, element_type: "HCS", band: "over" });
  });

  it("refuses to remove a building that holds lines, and to move one under another item", async () => {
    const b = await building("B01");
    await inBuilding(b, [1]);
    const refused = await buildingDelete(json("DELETE"), ictx(b.id));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/holds 1 line/);
    const empty = await building("B02");
    expect((await buildingDelete(json("DELETE"), ictx(empty.id))).status).toBe(200);
  });
});

describe("element codes on a tender", () => {
  it("issues codes per building and type, is idempotent, and a typed code must be unique on the deal", async () => {
    const b = await building("B01");
    await inBuilding(b, [1, 2]);
    await elementPatch(json("PATCH", { element_type: "HCS" }), lctx(B(1)));
    await elementPatch(json("PATCH", { element_type: "WAL" }), lctx(B(2)));
    const preview = await (await issuePost(json("POST", { preview: true }), ctx())).json();
    expect(preview.plan.summary).toEqual(["1 code: B01-HCS-0001", "1 code: B01-WAL-0001"]);
    expect(boq(1).element_code ?? null).toBeNull();
    const done = await (await issuePost(json("POST", {}), ctx())).json();
    expect(done.written).toBe(2);
    expect(boq(1).element_code).toBe("B01-HCS-0001");
    expect((await (await issuePost(json("POST", {}), ctx())).json()).written).toBe(0);
    expect((await elementPatch(json("PATCH", { element_code: "b01-hcs-0001" }), lctx(B(2)))).status).toBe(409);
    expect((await elementPatch(json("PATCH", { element_type: "SEC" }), lctx(B(2)))).status).toBe(422);
    expect((await elementPatch(json("PATCH", { element_type: "HCS" }), lctx(B(1)))).status).toBe(200);
    expect((await elementPatch(json("PATCH", { element_type: "WAL" }), lctx(B(1)))).status).toBe(422);
  });

  it("an element cannot be split across buildings", async () => {
    const b1 = await building("B01");
    const b2 = await building("B02");
    await inBuilding(b1, [1]);
    await elementPatch(json("PATCH", { element_type: "HCS", element_code: "A-1" }), lctx(B(1)));
    const res = await splitPut(json("PUT", { boq_id: B(1), parts: [{ wbs_item_id: b1.id, share_pct: 50 }, { wbs_item_id: b2.id, share_pct: 50 }] }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("An element belongs to one building");
    // a line without a code may be split across buildings
    const free = await splitPut(json("PUT", { boq_id: B(2), parts: [{ wbs_item_id: b1.id, share_pct: 50 }, { wbs_item_id: b2.id, share_pct: 50 }] }), ctx());
    expect(free.status).toBe(200);
  });

  it("a view-only person reads but cannot change", async () => {
    state.edit = false;
    expect((await buildingsGet(get(), ctx())).status).toBe(200);
    expect((await buildingsPost(json("POST", { code: "B01", name: "x" }), ctx())).status).toBe(403);
    expect((await issuePost(json("POST", {}), ctx())).status).toBe(403);
  });

  it("reissue is refused once the tender became a project, and allowed before", async () => {
    const b = await building("B01");
    await inBuilding(b, [1]);
    await elementPatch(json("PATCH", { element_type: "HCS" }), lctx(B(1)));
    await issuePost(json("POST", {}), ctx());
    expect((await buildingPatch(json("PATCH", { code: "B09" }), ictx(b.id))).status).toBe(409);
    const ok = await buildingPatch(json("PATCH", { code: "B09", reissue: true }), ictx(b.id));
    expect(ok.status).toBe(200);
    expect(boq(1).element_code).toBe("B09-HCS-0001");
  });
});

describe("the codes travel to the project with the lines", () => {
  it("the project keeps the type, the code and the model quantity, freezes the client quantity and the pattern, and copies the buildings", async () => {
    const b = await building("B01", "Block one");
    await inBuilding(b, [1]);
    await elementPatch(json("PATCH", { element_type: "HCS", model_qty: 104 }), lctx(B(1)));
    await issuePost(json("POST", {}), ctx());
    const made = await createProject(json("POST", { opportunity_id: OPP }));
    expect(made.status).toBe(201);
    const { id } = await made.json();
    const line = rows("project_budget_lines").find((l) => l.project_id === id && l.wbs === "1.1")!;
    expect(line).toMatchObject({ element_type: "HCS", element_code: "B01-HCS-0001", client_qty: 100, model_qty: 104, qty: 100 });
    expect(rows("project_work_packages").find((p) => p.project_id === id && p.building_code === "B01")).toMatchObject({ name: "Block one", parent_id: null });
    expect(rows("contract_projects").find((p) => p.id === id)?.element_pattern).toBe("{building}-{type}-{seq:4}");
    const other = rows("project_budget_lines").find((l) => l.project_id === id && l.wbs === "1.2")!;
    expect(other).toMatchObject({ client_qty: 50 });
    // the tender's codes are the project's now: a reissue on the tender is refused
    const refused = await buildingPatch(json("PATCH", { code: "B10", reissue: true }), ictx(b.id));
    expect(refused.status).toBe(409);
    expect(boq(1).element_code).toBe("B01-HCS-0001");
  });
});

describe("the client's own Excel carries Building and Element columns", () => {
  it("reads them into the element fields and the building, lists an unknown building without creating it, and never overwrites a line's own value", async () => {
    const { openBoqRequest } = await import("@/lib/tender/boq/server");
    const { applyFileElementColumns, elementColumnsOf } = await import("@/lib/elements/fileColumns");
    expect(elementColumnsOf({ "Building / Area": "B01", "Element Type": "hcs", "Element code": "pc-1", Remarks: "x" })).toEqual({ building: "B01", type: "hcs", code: "pc-1" });
    const b = await building("B01", "Block one");
    const opened = await openBoqRequest(OPP, true);
    if (!opened.ok) throw new Error("the tender did not open");
    const r = await applyFileElementColumns(opened.req, [
      { key: "n:1.1", client_data: { "Building / Area": "block one", "Element Type": "hcs", "Element Code": "pc-1" } },
      { key: "n:1.2", client_data: { Building: "Block 9", "Element Type": "zzz" } },
    ]);
    expect(boq(1)).toMatchObject({ element_type: "HCS", element_code: "PC-1", wbs_item_id: b.id });
    expect(boq(2).element_type ?? null).toBeNull();
    expect(r.notes.some((n) => /zzz/i.test(n) && /Element types list/.test(n))).toBe(true);
    expect(r.notes.some((n) => /Block 9/.test(n) && /not on this tender/.test(n))).toBe(true);
    expect(rows("tender_wbs_items").filter((i) => i.tenant_id === T1)).toHaveLength(1);
    // a second read with other values changes nothing the line already has
    await applyFileElementColumns(opened.req, [{ key: "n:1.1", client_data: { "Element Type": "wal", "Element Code": "other-9" } }]);
    expect(boq(1)).toMatchObject({ element_type: "HCS", element_code: "PC-1" });
    state.features = { pipeline: true, gcc_tender: true, contract_projects: true, contract_buildings: false };
    const off = await applyFileElementColumns(opened.req, [{ key: "n:1.2", client_data: { "Element Type": "wal" } }]);
    expect(off).toEqual({ applied: 0, notes: [] });
    expect(boq(2).element_type ?? null).toBeNull();
  });
});
