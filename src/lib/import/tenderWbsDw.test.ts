import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

// The tender's WBS on Data Workbench (all three modes) and on the v1 API (docs/design/wbs.md section 5): the gate, the tender looked up in
// this workspace only, items found by code, parents in any order, ids tenant-verified, the left-over cases, and no cost anywhere.

let current: ReturnType<typeof fakeDb>;
let features: Record<string, boolean> = {};
let canEdit = true;
let apiAllowed = true;
const authCalls: string[] = [];
const logged: { objectType: string; objectId: string; tenantId: string; changes?: { field: string; from?: unknown; to?: unknown }[] }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true,
}));
vi.mock("@/lib/objectFeatures", () => ({
  assertObjectFeature: async () => (features.gcc_tender ? null : NextResponse.json({ error: "Not found" }, { status: 404 })),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => "all",
  canViewWorkcenter: () => true,
  canEditWorkcenter: () => canEdit,
}));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-11-01" }));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});
vi.mock("@/app/api/v1/_auth", async () => {
  const real = await vi.importActual<typeof import("@/app/api/v1/_auth")>("@/app/api/v1/_auth");
  return {
    ...real,
    authorizeApi: async (_req: Request, object: string) => {
      authCalls.push(object);
      return apiAllowed ? { tenantId: "t1", scopes: { read: true, write: false, objects: ["tenders"] }, keyId: null } : { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
    },
  };
});

const importItems = await import("@/app/api/import/tender_wbs_items/route");
const exportItems = await import("@/app/api/export/tender_wbs_items/route");
const updateItems = await import("@/app/api/update/tender_wbs_items/route");
const wbsRoute = await import("@/app/api/v1/tenders/[id]/wbs/route");
const boqRoute = await import("@/app/api/v1/tenders/[id]/boq/route");
const { REGISTRY_OBJECT_TYPE } = await import("./registrySchema");
const { DW_CATALOG } = await import("./catalog");
const { TENDER_WBS_ITEMS_SPEC, TENDER_WBS_UPDATE_KEYS } = await import("./tenderWbsItemsSchema");

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const O1 = U(1), O2 = U(2), O3 = U(3), O9 = U(9);
const W = { w1: U(101), w2: U(102), w21: U(103), w22: U(104), w3: U(105), wf: U(106), wt2: U(107) };
const BQ = { a: U(201), b: U(202), c: U(203) };
const EMP = { ana: U(301), old: U(302), foreign: U(303) };

const deal = (id: string, ref: string, over: Row = {}): Row => ({ id, tenant_id: "t1", ref, title: `Deal ${ref}`, stage: "estimating", outcome: null, amount: 0, probability: 10, probability_override: null, currency: "SAR", ...over });
const tender = (id: string, no: string, over: Row = {}): Row => ({ opportunity_id: id, tenant_id: "t1", tender_no: no, issuer_name: "Client", portal: "email", closing_at: null, bid_bond_amount: null, addenda_count: 0, ...over });
const wi = (id: string, code: string, name: string, parent: string | null, sort: number, over: Row = {}): Row => ({
  id, tenant_id: "t1", opportunity_id: O1, parent_id: parent, code, name, owner_employee_id: null, sort_order: sort, code_is_manual: false, note: null, created_at: null, ...over,
});

function seed(extra: Record<string, Row[]> = {}) {
  const dl = (id: string, sl: string, qty: number, rate: number): Row => ({ id, tenant_id: "t1", opportunity_id: O1, discount_pct: 0, is_selected: true, show_on_pdf: true, sl_no: sl, description: `Line ${sl}`, uom: "m", qty, rate, amount: qty * rate });
  const bq = (id: string, line: string, item: string, row: number, qty: number, over: Row = {}): Row => ({ id, tenant_id: "t1", opportunity_id: O1, source_id: "s1", line_id: line, item_key: `n:${item}`, item_no: item, row_no: row, file_description: `Line ${item}`, file_uom: "m", file_qty: qty, cost_code: null, file_rate: null, price_source: null, price_source_ref: "SECRET SUPPLIER", price_as_of: null, stale_accepted: false, unit_cost: 17.77, markup_pct: 12.5, removed_in_revision: false, wbs_item_id: null, ...over });
  current = fakeDb({
    tenants: [{ id: "t1", config: {} }],
    opportunities: [deal(O1, "OPP-0044"), deal(O2, "OPP-0045"), deal(O3, "OPP-0046"), deal(O9, "OPP-0099", { tenant_id: "t2" })],
    opportunity_tenders: [tender(O1, "T-0012"), tender(O3, "T-0013"), tender(O9, "T-0099", { tenant_id: "t2" })],
    opportunity_lines: [dl("la", "1.1", 100, 20), dl("lb", "1.2", 50, 10), dl("lc", "1.3", 10, 0)],
    tender_boq_sources: [{ id: "s1", tenant_id: "t1", opportunity_id: O1, version: 1, is_current: true, file_name: "boq.xlsx", storage_path: "x", uploaded_at: "2026-10-20T00:00:00Z" }],
    tender_boq_lines: [bq(BQ.a, "la", "1.1", 2, 100, { wbs_item_id: W.w1 }), bq(BQ.b, "lb", "1.2", 3, 50), bq(BQ.c, "lc", "1.3", 4, 10)],
    tender_wbs_items: [
      wi(W.w1, "1", "Civil", null, 10, { owner_employee_id: EMP.ana }), wi(W.w2, "2", "Mechanical", null, 20), wi(W.w21, "2.1", "Fabrication", W.w2, 10), wi(W.w22, "2.2", "Erection", W.w2, 20),
      wi(W.w3, "3", "Services", null, 30, { note: "Out of scope for now" }),
      wi(W.wf, "9", "Other tender only", null, 10, { opportunity_id: O3 }),
      wi(W.wt2, "1", "Other workspace", null, 10, { tenant_id: "t2", opportunity_id: O9 }),
    ],
    tender_wbs_line_parts: [
      { id: "p1", tenant_id: "t1", opportunity_id: O1, boq_line_id: BQ.b, wbs_item_id: W.w21, share_pct: 60, sort_order: 0 },
      { id: "p2", tenant_id: "t1", opportunity_id: O1, boq_line_id: BQ.b, wbs_item_id: W.w22, share_pct: 40, sort_order: 1 },
    ],
    employees: [
      { id: EMP.ana, tenant_id: "t1", first_name: "Ana", last_name: "Lopez", email: "Ana@x.test", status: "active" },
      { id: EMP.old, tenant_id: "t1", first_name: "Old", last_name: "Hand", email: "old@x.test", status: "inactive" },
      { id: EMP.foreign, tenant_id: "t2", first_name: "Far", last_name: "Away", email: "far@x.test", status: "active" },
    ],
    ...extra,
  }, { copyReads: true });
}
const seedEmpty = () => seed({ tender_wbs_items: [], tender_wbs_line_parts: [] });

const call = (handler: (r: never) => Promise<Response>, body: unknown) => handler(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never);
const rowsOf = (values: Record<string, string>[]) => ({ fileName: "wbs.csv", rows: values.map((v, i) => ({ rowNum: i + 2, values: v })) });
const T = (over: Record<string, string>) => ({ tender_ref: "OPP-0044", ...over });
const items = () => current.tables.tender_wbs_items.filter((i) => i.opportunity_id === O1 && i.tenant_id === "t1");
const byCode = (code: string) => items().find((i) => i.code === code)!;
const get = (handler: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, qs = "") =>
  handler(new Request(`http://x/api/v1/tenders/${id}/x${qs}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  logged.length = 0;
  authCalls.length = 0;
  features = { gcc_tender: true, pipeline: true };
  canEdit = true;
  apiAllowed = true;
  seed();
});

describe("the object", () => {
  it("is a static spec in the catalog (Sales, under Deals, needing the Pipeline) with all three modes", () => {
    expect(REGISTRY_OBJECT_TYPE.tender_wbs_items).toBeNull();
    expect(DW_CATALOG.tender_wbs_items).toMatchObject({ group: "sales", parent: "opportunities", alsoNeeds: ["pipeline"] });
    expect(DW_CATALOG.tender_wbs_items.modes).toEqual(["import", "export", "update"]);
    const byKey = new Map(TENDER_WBS_ITEMS_SPEC.fields.map((f) => [f.key, f]));
    expect(byKey.get("tender_ref")).toMatchObject({ type: "ref", required: true });
    expect(byKey.get("name")).toMatchObject({ required: true });
    for (const k of ["lines", "shared_lines", "client_amount"]) expect(byKey.get(k)?.exportOnly, k).toBe(true);
    for (const k of TENDER_WBS_ITEMS_SPEC.fields.map((f) => f.key)) expect(k).not.toMatch(/cost|markup|margin/);
    expect([...TENDER_WBS_UPDATE_KEYS]).toEqual(["name", "code", "parent_code", "owner_email", "note"]);
    expect(read("src/app/(app)/data-workbench/page.tsx")).toContain("tender_wbs_items: TENDER_WBS_ITEMS_SPEC");
  });

  it("the Data Workbench page does not offer it while migration 0243 is pending", () => {
    const page = read("src/app/(app)/data-workbench/page.tsx");
    expect(page).toMatch(/from\("tender_wbs_items"\)\.select\("id"\)\.eq\("tenant_id", tenantId\)\.limit\(1\)/);
    expect(page).toContain('probe.error.code === "42P01"');
  });
});

describe("the routes keep the proven shape", () => {
  const routes = ["import", "export", "update"].map((m) => `src/app/api/${m}/tender_wbs_items/route.ts`);

  it.each(routes)("%s resolves its tenant from the session, then gates on the module, then the Pipeline", (f) => {
    const src = read(f);
    expect(src).toContain("requireTenantUser()");
    expect(src).toContain('assertObjectFeature(tenantId, "tender_wbs_items")');
    expect(src).toContain("boqDwGate(");
    expect(src).not.toMatch(/tenantId\s*=\s*(body|values|rows)|body\.tenant|values\.tenant_id/);
    expect(src.indexOf("requireTenantUser()")).toBeLessThan(src.indexOf("assertObjectFeature("));
    expect(src.indexOf("assertObjectFeature(")).toBeLessThan(src.indexOf("boqDwGate("));
  });

  it("every query a route makes names the workspace, writes go through the WBS writers behind boqRequestFor, and Update matches by id and workspace", () => {
    for (const f of routes) {
      for (const m of read(f).matchAll(/\.from\("([a-z_]+)"\)[^;]*?;\n/g)) expect(m[0], `${f}: ${m[0].slice(0, 80)}`).toMatch(/tenant_id|tenantId/);
    }
    expect(read(routes[0])).toContain("boqRequestFor(g.ctx, oppId, true)");
    expect(read(routes[0])).toContain("createItem(");
    expect(read(routes[2])).toContain("boqRequestFor(g.ctx, oppId, true)");
    expect(read(routes[2])).toContain("updateItem(");
    expect(read(routes[2])).toContain('.in("id", ids.slice(i, i + 150)).eq("tenant_id", tenantId)');
    expect(read(routes[2])).not.toMatch(/\.eq\("code"|item_key|nameKey/);
    expect(read(routes[1])).not.toMatch(/unit_cost|markup_pct|price_source_ref|cost_price/);
    const helper = read("src/lib/import/tenderWbsServer.ts");
    const reads = [...helper.matchAll(/fetchAllRows<[^\n]*?>\(([^)\n]*)\)/g)];
    expect(reads.length).toBe(3);
    for (const m of reads) expect(m[1]).toContain("tenantId");
  });
});

describe("Import", () => {
  beforeEach(() => seedEmpty());

  it("builds a tree from a file whose children come before their parents, typed codes kept, the rest numbered", async () => {
    const j = await (await call(importItems.POST, rowsOf([
      T({ code: "1.1", name: "Earthworks", parent_code: "1" }), T({ code: "1", name: "Civil works" }), T({ name: "Services" }), T({ code: "1.1.1", name: "Excavation", parent_code: "1.1" }),
    ]))).json();
    expect(j).toMatchObject({ inserted: 4, failed: 0, skipped: 0 });
    const civil = byCode("1"), earth = byCode("1.1"), exc = byCode("1.1.1");
    expect(earth.parent_id).toBe(civil.id);
    expect(exc.parent_id).toBe(earth.id);
    expect([civil, earth, exc].every((i) => i.code_is_manual === true && i.tenant_id === "t1" && i.opportunity_id === O1)).toBe(true);
    expect(items().find((i) => i.name === "Services")).toMatchObject({ code: "2", code_is_manual: false, parent_id: null });
    const entries = logged.filter((l) => l.objectType === "opportunity_tenders");
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.objectId === O1 && e.tenantId === "t1")).toBe(true);
  });

  it("loading the same file twice adds nothing the second time", async () => {
    const file = rowsOf([T({ code: "1", name: "Civil works" }), T({ code: "1.1", name: "Earthworks", parent_code: "1" })]);
    expect(await (await call(importItems.POST, file)).json()).toMatchObject({ inserted: 2 });
    const again = await (await call(importItems.POST, file)).json();
    expect(again).toMatchObject({ inserted: 0, skipped: 2, failed: 0 });
    expect(again.outcomes[0].reason).toBe("WBS 1 is already on the tender");
    expect(items()).toHaveLength(2);
  });

  it("finds the tender by Deal ID or tender number, and groups rows of several tenders", async () => {
    const j = await (await call(importItems.POST, rowsOf([T({ code: "1", name: "A" }), { tender_ref: "t-0013", code: "1", name: "B" }]))).json();
    expect(j).toMatchObject({ inserted: 2, failed: 0 });
    expect(current.tables.tender_wbs_items.filter((i) => i.opportunity_id === O3 && i.name === "B")).toHaveLength(1);
    expect(items().filter((i) => i.name === "A")).toHaveLength(1);
  });

  it("sets the owner from an active employee's email, in this workspace only", async () => {
    const j = await (await call(importItems.POST, rowsOf([
      T({ code: "1", name: "Ok", owner_email: "ana@X.test" }), T({ code: "2", name: "Inactive", owner_email: "old@x.test" }), T({ code: "3", name: "Elsewhere", owner_email: "far@x.test" }), T({ code: "4", name: "Nobody", owner_email: "no@x.test" }),
    ]))).json();
    expect(j).toMatchObject({ inserted: 1, failed: 3 });
    expect(byCode("1").owner_employee_id).toBe(EMP.ana);
    expect(j.outcomes[1].reason).toBe("No active employee with the email old@x.test");
    expect(j.outcomes[2].reason).toBe("No active employee with the email far@x.test");
    expect(items()).toHaveLength(1);
  });

  it("fails clearly: no name, a parent that does not exist, a fourth level, a bad tender, a deal that is not a tender, another workspace's tender", async () => {
    const j = await (await call(importItems.POST, rowsOf([
      T({ code: "1", name: "" }), T({ code: "2", name: "Orphan", parent_code: "9.9" }),
      T({ code: "3", name: "L1" }), T({ code: "3.1", name: "L2", parent_code: "3" }), T({ code: "3.1.1", name: "L3", parent_code: "3.1" }), T({ code: "3.1.1.1", name: "L4", parent_code: "3.1.1" }),
      { tender_ref: "OPP-9999", name: "x" }, { tender_ref: "OPP-0045", name: "x" }, { tender_ref: "OPP-0099", name: "x" }, { name: "x" },
    ]))).json();
    expect(j).toMatchObject({ inserted: 3, failed: 7 });
    const reason = (n: number) => j.outcomes.find((o: { rowNum: number }) => o.rowNum === n).reason as string;
    expect(reason(2)).toBe("Name is required");
    expect(reason(3)).toBe("Parent WBS 9.9 does not exist on this tender");
    expect(reason(7)).toMatch(/three levels/);
    expect(reason(8)).toMatch(/was not found/);
    expect(reason(9)).toBe('"OPP-0045" is not a tender');
    expect(reason(10)).toMatch(/was not found/);
    expect(reason(11)).toMatch(/Tender is required/);
    expect(current.tables.tender_wbs_items.filter((i) => i.tenant_id === "t2")).toHaveLength(0);
  });

  it("a typed code that clashes with another tender's code is fine, and a code already on this tender is skipped", async () => {
    seed();
    const j = await (await call(importItems.POST, rowsOf([T({ code: "9", name: "Same code as the other tender" }), T({ code: "1", name: "Already there" })]))).json();
    expect(j).toMatchObject({ inserted: 1, skipped: 1, failed: 0 });
    expect(items().filter((i) => i.code === "9")).toHaveLength(1);
  });

  it("a viewer is refused, a workspace without the module gets 404, and neither writes", async () => {
    canEdit = false;
    expect((await call(importItems.POST, rowsOf([T({ name: "x" })]))).status).toBe(403);
    canEdit = true;
    features = { gcc_tender: false, pipeline: true };
    expect((await call(importItems.POST, rowsOf([T({ name: "x" })]))).status).toBe(404);
    expect(items()).toHaveLength(0);
  });

  it("while migration 0243 is pending every row says why and nothing is written", async () => {
    current = fakeDb(current.tables, { copyReads: true, missingTables: ["tender_wbs_items", "tender_wbs_line_parts"] });
    const j = await (await call(importItems.POST, rowsOf([T({ name: "x" })]))).json();
    expect(j).toMatchObject({ inserted: 0, failed: 1 });
    expect(j.outcomes[0].reason).toBe("WBS needs a database update (migration 0243)");
  });
});

describe("Export", () => {
  it("carries the id, the tender's Deal ID, parent and owner, and the rolled-up client figures, in this workspace only", async () => {
    const j = await (await call(exportItems.POST, {})).json();
    const row = (code: string, tender = "OPP-0044") => j.rows.find((r: Record<string, string>) => r.code === code && r.tender_ref === tender);
    expect(j.rows.map((r: Record<string, string>) => `${r.tender_ref}/${r.code}`).sort()).toEqual(["OPP-0044/1", "OPP-0044/2", "OPP-0044/2.1", "OPP-0044/2.2", "OPP-0044/3", "OPP-0046/9"]);
    expect(row("1")).toEqual({ id: W.w1, tender_ref: "OPP-0044", code: "1", name: "Civil", parent_code: "", owner_email: "Ana@x.test", note: "", lines: "1", shared_lines: "0", client_amount: "2000" });
    expect(row("2.1")).toMatchObject({ id: W.w21, parent_code: "2", lines: "1", shared_lines: "1", client_amount: "300" });
    expect(row("2")).toMatchObject({ lines: "2", shared_lines: "2", client_amount: "500" });
    expect(row("3")).toMatchObject({ note: "Out of scope for now", lines: "0", client_amount: "0" });
  });

  it("names no cost, markup, supplier or other workspace", async () => {
    const text = JSON.stringify(await (await call(exportItems.POST, {})).json());
    for (const secret of ["17.77", "12.5", "SECRET SUPPLIER", "unit_cost", "markup", "price_source_ref", "Other workspace", "far@x.test"]) expect(text, secret).not.toContain(secret);
  });

  it("filters like the other exports, answers empty while 0243 is pending, and lets a viewer export", async () => {
    const only = await (await call(exportItems.POST, { filters: [{ field: "code", op: "equals", value: "2.2" }] })).json();
    expect(only.rows.map((r: Record<string, string>) => r.code)).toEqual(["2.2"]);
    canEdit = false;
    expect((await call(exportItems.POST, {})).status).toBe(200);
    current = fakeDb(current.tables, { copyReads: true, missingTables: ["tender_wbs_items", "tender_wbs_line_parts"] });
    const res = await call(exportItems.POST, {});
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });

  it("round trips through Import and Update: what an export wrote is No change, and loads into an empty tender", async () => {
    const exp = await (await call(exportItems.POST, {})).json();
    const mine = exp.rows.filter((r: Record<string, string>) => r.tender_ref === "OPP-0044");
    const back = await (await call(updateItems.POST, { rows: mine.map((r: Record<string, string>, i: number) => ({ rowNum: i + 2, values: r })) })).json();
    expect(back).toMatchObject({ updated: 0, skipped: 5, failed: 0 });
    expect(logged).toHaveLength(0);
    seedEmpty();
    const loaded = await (await call(importItems.POST, { fileName: "x.csv", rows: mine.map((r: Record<string, string>, i: number) => ({ rowNum: i + 2, values: { ...r, id: undefined } })) })).json();
    expect(loaded).toMatchObject({ inserted: 5, failed: 0 });
    expect(items().map((i) => [i.code, i.name]).sort()).toEqual(mine.map((r: Record<string, string>) => [r.code, r.name]).sort());
    expect(byCode("2.1").parent_id).toBe(byCode("2").id);
  });
});

describe("Update (by id only)", () => {
  const upd = async (values: Record<string, string>[]) => (await call(updateItems.POST, rowsOf(values))).json();

  it("renames, retypes the code, sets the owner by email and the note, and logs on the tender", async () => {
    const j = await upd([
      { id: W.w3, name: "Site services", note: "Revised" }, { id: W.w22, owner_email: "ana@x.test" }, { id: W.w2, code: "M-200" },
    ]);
    expect(j).toMatchObject({ updated: 3, failed: 0 });
    expect(items().find((i) => i.id === W.w3)).toMatchObject({ name: "Site services", note: "Revised" });
    expect(items().find((i) => i.id === W.w22)).toMatchObject({ owner_employee_id: EMP.ana });
    expect(items().find((i) => i.id === W.w2)).toMatchObject({ code: "M-200", code_is_manual: true });
    const fields = logged.filter((l) => l.objectType === "opportunity_tenders").flatMap((l) => l.changes!.map((c) => c.field));
    expect(fields).toEqual(expect.arrayContaining(["WBS 3 renamed", "WBS 2.2 owner", "WBS 2 code"]));
  });

  it("moves an item under a parent named by its code, and the auto codes follow", async () => {
    const j = await upd([{ id: W.w3, parent_code: "2" }]);
    expect(j).toMatchObject({ updated: 1, failed: 0 });
    expect(items().find((i) => i.id === W.w3)).toMatchObject({ parent_id: W.w2, code: "2.3" });
    expect(logged.at(-1)!.changes!.map((c) => c.field)).toContain("WBS 3 moved");
  });

  it("an empty parent moves the item to the top level and an empty owner clears it", async () => {
    const j = await upd([{ id: W.w21, parent_code: "" }, { id: W.w1, owner_email: "" }]);
    expect(j).toMatchObject({ updated: 2, failed: 0 });
    expect(items().find((i) => i.id === W.w21)!.parent_id ?? null).toBeNull();
    expect(items().find((i) => i.id === W.w1)!.owner_employee_id ?? null).toBeNull();
  });

  it("the tender's rules hold: a cycle, a fourth level, an unknown parent, a duplicate code, a blank name and an unknown owner each fail that row", async () => {
    const j = await upd([
      { id: W.w2, parent_code: "2.1" }, { id: W.w3, parent_code: "2.2" }, { id: W.w1, parent_code: "9" }, { id: W.w1, code: "3" }, { id: W.w1, name: " " }, { id: W.w1, owner_email: "no@x.test" },
    ]);
    expect(j).toMatchObject({ updated: 0, failed: 6 });
    const why = j.outcomes.map((o: { reason: string }) => o.reason);
    expect(why[0]).toBe("An item cannot be moved under itself");
    expect(why[1]).toBe("2.2 holds lines. Add a sub-item for them first.");
    expect(why[2]).toBe("Parent WBS 9 does not exist on this tender");
    expect(why[3]).toBe("The code 3 is already used on this tender");
    expect(why[4]).toBe("Give the WBS item a name");
    expect(why[5]).toBe("No active employee with the email no@x.test");
    expect(items().find((i) => i.id === W.w2)!.parent_id ?? null).toBeNull();
  });

  it("fails a missing id, a code instead of an id and another workspace's id; another tender's item is edited through its own tender", async () => {
    const j = await upd([{ name: "x" }, { id: "2.1", name: "x" }, { id: W.wt2, name: "Hijacked" }, { id: W.wf, name: "Renamed on its own tender" }]);
    expect(j.outcomes[0].reason).toBe("Record ID is required to update a row");
    expect(j.outcomes[1].reason).toBe('No record with id "2.1" found in this workspace');
    expect(j.outcomes[2].reason).toBe(`No record with id "${W.wt2}" found in this workspace`);
    expect(j.outcomes[3].status).toBe("updated");
    expect(current.tables.tender_wbs_items.find((i) => i.id === W.wt2)!.name).toBe("Other workspace");
    expect(logged.find((l) => l.objectType === "opportunity_tenders")!.objectId).toBe(O3);
  });

  it("a code cannot reach an item of another tender: the parent named must be on the item's own tender", async () => {
    const k = await upd([{ id: W.w1, parent_code: "9" }, { id: W.wf, parent_code: "1" }]);
    expect(k.outcomes[0]).toMatchObject({ status: "failed", reason: "Parent WBS 9 does not exist on this tender" });
    // The other tender's item names "1" too, but there it means nothing: that tender has no item 1.
    expect(k.outcomes[1]).toMatchObject({ status: "failed", reason: "Parent WBS 1 does not exist on this tender" });
  });

  it("a row with nothing mapped is skipped, an unchanged value is No change, a viewer is refused", async () => {
    const j = await upd([{ id: W.w1 }, { id: W.w1, name: "Civil", code: "1", parent_code: "", owner_email: "ana@x.test", note: "" }]);
    expect(j).toMatchObject({ updated: 0, skipped: 2, failed: 0 });
    expect(j.outcomes.map((o: { reason: string }) => o.reason)).toEqual(["No mapped columns to update", "No change"]);
    canEdit = false;
    expect((await call(updateItems.POST, rowsOf([{ id: W.w3, name: "Nope" }]))).status).toBe(403);
    expect(items().find((i) => i.id === W.w3)!.name).toBe("Services");
  });

  it("a workspace without the module gets 404, and while 0243 is pending the answer says so", async () => {
    features = { gcc_tender: false, pipeline: true };
    expect((await call(updateItems.POST, rowsOf([{ id: W.w3, name: "x" }]))).status).toBe(404);
    features = { gcc_tender: true, pipeline: true };
    current = fakeDb(current.tables, { copyReads: true, missingTables: ["tender_wbs_items", "tender_wbs_line_parts"] });
    const res = await call(updateItems.POST, rowsOf([{ id: W.w3, name: "x" }]));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("WBS needs a database update (migration 0243)");
  });
});

describe("GET /api/v1/tenders/{id}/wbs", () => {
  const json = async (res: Response) => res.json() as Promise<{ data: Record<string, unknown>[]; meta: Record<string, unknown> }>;

  it("authorizes with the explicit tenders scope and answers the tree with roll-ups and parts", async () => {
    const res = await get(wbsRoute.GET, O1);
    expect(res.status).toBe(200);
    expect(authCalls).toEqual(["tenders"]);
    const { data, meta } = await json(res);
    expect(data.map((d) => [d.code, d.level, d.parent_code])).toEqual([["1", 1, null], ["2", 1, null], ["2.1", 2, "2"], ["2.2", 2, "2"], ["3", 1, null]]);
    const item = (code: string) => data.find((d) => d.code === code)!;
    expect(item("1")).toMatchObject({ owner_name: "Ana Lopez", line_count: 1, client_amount: 2000, tender_id: O1 });
    expect(item("2")).toMatchObject({ line_count: 2, shared_count: 2, client_amount: 500 });
    expect(item("2.1").parts).toEqual([{ boq_line_id: BQ.b, item_no: "1.2", share_pct: 60, quantity: 30, amount: 300, status: "priced" }]);
    expect(meta).toMatchObject({ wbs_pending: false, wbs_total: { line_count: 3, shared_count: 2, client_amount: 2500 }, unassigned: { lines: 1, client_amount: 0 } });
    expect(typeof meta.total).toBe("number");
  });

  it("carries no cost, markup, supplier or employee id", async () => {
    const text = JSON.stringify(await (await get(wbsRoute.GET, O1)).json());
    for (const secret of ["17.77", "12.5", "SECRET SUPPLIER", "unit_cost", "markup", "margin", "price_source", "owner_employee_id", EMP.ana]) expect(text, secret).not.toContain(secret);
  });

  it("pages, filters and searches like any list", async () => {
    const lvl = await json(await get(wbsRoute.GET, O1, "?filter=level:eq:2"));
    expect(lvl.data.map((d) => d.code)).toEqual(["2.1", "2.2"]);
    const q = await json(await get(wbsRoute.GET, O1, "?search=erection"));
    expect(q.data.map((d) => d.code)).toEqual(["2.2"]);
    const bad = await get(wbsRoute.GET, O1, "?filter=unit_cost:gt:1");
    expect(bad.status).toBe(422);
  });

  it("is a 404 for a deal that is not a tender, another workspace's tender, a bad id and a workspace without the Pipeline; a key without the scope is refused", async () => {
    expect((await get(wbsRoute.GET, O2)).status).toBe(404);
    expect((await get(wbsRoute.GET, O9)).status).toBe(404);
    expect((await get(wbsRoute.GET, "nope")).status).toBe(404);
    features = { gcc_tender: true, pipeline: false };
    expect((await get(wbsRoute.GET, O1)).status).toBe(404);
    features = { gcc_tender: true, pipeline: true };
    apiAllowed = false;
    expect((await get(wbsRoute.GET, O1)).status).toBe(403);
  });

  it("is an empty list, not an error, with no WBS yet and while 0243 is pending", async () => {
    seedEmpty();
    const none = await json(await get(wbsRoute.GET, O1));
    expect(none.data).toEqual([]);
    expect(none.meta.wbs_pending).toBe(false);
    current = fakeDb(current.tables, { copyReads: true, missingTables: ["tender_wbs_items", "tender_wbs_line_parts"] });
    const pending = await json(await get(wbsRoute.GET, O1));
    expect(pending.data).toEqual([]);
    expect(pending.meta.wbs_pending).toBe(true);
  });

  it("the BOQ endpoint carries wbs_code and wbs_parts on every row, and no cost", async () => {
    const res = await get(boqRoute.GET, O1);
    const { data } = await json(res);
    const row = (item: string) => data.find((d) => d.item_no === item)!;
    expect(row("1.1")).toMatchObject({ wbs_code: "1", wbs_parts: [] });
    expect(row("1.2")).toMatchObject({ wbs_code: "2.1:60;2.2:40" });
    expect(row("1.2").wbs_parts).toEqual([
      { wbs_code: "2.1", share_pct: 60, quantity: 30, amount: 300 }, { wbs_code: "2.2", share_pct: 40, quantity: 20, amount: 200 },
    ]);
    expect(row("1.3")).toMatchObject({ wbs_code: null, wbs_parts: [] });
    const filtered = await json(await get(boqRoute.GET, O1, "?filter=wbs_code:eq:1"));
    expect(filtered.data.map((d) => d.item_no)).toEqual(["1.1"]);
    const text = JSON.stringify(data);
    for (const secret of ["17.77", "12.5", "SECRET SUPPLIER", "unit_cost", "markup"]) expect(text, secret).not.toContain(secret);
  });
});
