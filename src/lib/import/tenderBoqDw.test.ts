import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

// Tender BOQ lines on Data Workbench, all three modes (docs/design/tender-boq-connect.md section 2): the gate, the tender looked up
// in this workspace only, lines matched by item number on Import, the real id on Update, and cost / markup / the supplier named in
// a price reference nowhere in an Export.

let current: ReturnType<typeof fakeDb>;
let features: Record<string, boolean> = {};
let canEdit = true;
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

const importLines = await import("@/app/api/import/tender_boq_lines/route");
const exportLines = await import("@/app/api/export/tender_boq_lines/route");
const updateLines = await import("@/app/api/update/tender_boq_lines/route");
const { REGISTRY_OBJECT_TYPE } = await import("./registrySchema");
const { DW_CATALOG, ownedObjectIds } = await import("./catalog");
const { TENDER_BOQ_LINES_SPEC, TENDER_BOQ_UPDATE_KEYS } = await import("./tenderBoqLinesSchema");

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const O1 = "00000000-0000-4000-8000-000000000001";
const O2 = "00000000-0000-4000-8000-000000000002";
const O3 = "00000000-0000-4000-8000-000000000003";
const O9 = "00000000-0000-4000-8000-000000000009";

const deal = (id: string, ref: string, over: Row = {}): Row => ({ id, tenant_id: "t1", ref, title: `Deal ${ref}`, stage: "estimating", outcome: null, amount: 0, probability: 10, probability_override: null, currency: "SAR", ...over });
const tender = (id: string, no: string, over: Row = {}): Row => ({ opportunity_id: id, tenant_id: "t1", tender_no: no, issuer_name: "Client", portal: "email", closing_at: null, bid_bond_amount: null, addenda_count: 0, ...over });
const SECRET_REF = "Gulf Pipes RFQ-0012";

function seed(extra: Record<string, Row[]> = {}) {
  current = fakeDb({
    tenants: [{ id: "t1", config: {} }],
    opportunities: [
      deal(O1, "OPP-0044"),
      deal(O2, "OPP-0045"), // a plain deal, not a tender
      deal(O3, "OPP-0046"),
      deal(O9, "OPP-0099", { tenant_id: "t2" }),
    ],
    opportunity_tenders: [tender(O1, "T-0012"), tender(O3, "T-0013"), tender(O9, "T-0099", { tenant_id: "t2" })],
    opportunity_lines: [], tender_boq_lines: [], tender_boq_sources: [], standard_quotes: [], quotes: [],
    ...extra,
  }, { copyReads: true });
}

/** A tender (O1) with a priced line (1.1) and an unpriced one (1.2), the way an earlier upload and a pricing run leave them. */
function seedBoq(extra: Record<string, Row[]> = {}) {
  const line = (id: string, over: Row): Row => ({ id, tenant_id: "t1", opportunity_id: O1, discount_pct: 0, is_selected: true, show_on_pdf: true, ...over });
  const boq = (id: string, over: Row): Row => ({ id, tenant_id: "t1", opportunity_id: O1, source_id: "s1", cost_code: null, file_rate: null, price_source: null, price_source_ref: null, price_as_of: null, stale_accepted: false, unit_cost: null, markup_pct: null, removed_in_revision: false, ...over });
  seed({
    opportunity_lines: [
      line("l1", { sl_no: "1.1", description: "Excavation", uom: "m3", qty: 100, rate: 20, amount: 2000 }),
      line("l2", { sl_no: "1.2", description: "Backfill", uom: "m3", qty: 50, rate: 0, amount: 0 }),
      line("l9", { tenant_id: "t2", opportunity_id: O9, sl_no: "1", description: "Foreign line", uom: "m", qty: 1, rate: 5, amount: 5 }),
    ],
    tender_boq_sources: [{ id: "s1", tenant_id: "t1", opportunity_id: O1, version: 1, is_current: true, file_name: "boq.xlsx", storage_path: "t1/o1/x.xlsx", uploaded_at: "2026-10-20T00:00:00Z" }],
    tender_boq_lines: [
      boq("b1", { line_id: "l1", item_key: "n:1.1", item_no: "1.1", row_no: 2, file_description: "Excavation", file_uom: "m3", file_qty: 100, cost_code: "31 23", price_source: "supplier", price_source_ref: SECRET_REF, price_as_of: "2026-10-20", unit_cost: 17.3456, markup_pct: 15.3 }),
      boq("b2", { line_id: "l2", item_key: "n:1.2", item_no: "1.2", row_no: 3, file_description: "Backfill", file_uom: "m3", file_qty: 50 }),
      boq("b9", { tenant_id: "t2", opportunity_id: O9, line_id: "l9", item_key: "n:1", item_no: "1", row_no: 2, file_description: "Foreign line", file_uom: "m", file_qty: 1, price_source: "manual", unit_cost: 99.99 }),
    ],
    ...extra,
  });
}

const call = (handler: (r: never) => Promise<Response>, body: unknown) => handler(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never);
const rowsOf = (values: Record<string, string>[], fileName = "boq-lines.csv") => ({ fileName, rows: values.map((v, i) => ({ rowNum: i + 2, values: v })) });
const T = (over: Record<string, string>) => ({ tender_ref: "OPP-0044", ...over });

beforeEach(() => {
  logged.length = 0;
  features = { gcc_tender: true, pipeline: true };
  canEdit = true;
  seed();
});

describe("the object", () => {
  it("is a static spec; cost and markup are on no column, the rate is not an Update key and the id is not a field", () => {
    expect(REGISTRY_OBJECT_TYPE.tender_boq_lines).toBeNull();
    const keys = TENDER_BOQ_LINES_SPEC.fields.map((f) => f.key);
    for (const k of keys) expect(k).not.toMatch(/cost$|markup|price_source_ref|unit_cost/);
    expect(keys).toContain("cost_code");
    const byKey = new Map(TENDER_BOQ_LINES_SPEC.fields.map((f) => [f.key, f]));
    expect(byKey.get("tender_ref")).toMatchObject({ type: "ref", required: true });
    for (const k of ["amount", "rate_source", "price_as_of", "status", "row_no"]) expect(byKey.get(k)?.exportOnly, k).toBe(true);
    expect([...TENDER_BOQ_UPDATE_KEYS]).toEqual(["quantity", "description", "details", "cost_code", "wbs_code"]);
    // The WBS code is an Export and Update column, never an Import one (a new row must not regroup existing lines).
    expect(byKey.get("wbs_code")).toMatchObject({ updateOnly: true });
    expect(byKey.get("rate")?.exportOnly).toBeFalsy();
  });

  it("offers the upload's own header spellings", () => {
    const byKey = new Map(TENDER_BOQ_LINES_SPEC.fields.map((f) => [f.key, f]));
    expect(byKey.get("description")?.aliases).toContain("description of works");
    expect(byKey.get("quantity")?.aliases).toContain("qty");
  });
});

describe("the routes keep the proven shape", () => {
  const routes = ["import", "export", "update"].map((m) => `src/app/api/${m}/tender_boq_lines/route.ts`);

  it.each(routes)("%s resolves its tenant from the session, then gates on the module, then the Pipeline", (f) => {
    const src = read(f);
    expect(src).toContain("requireTenantUser()");
    expect(src).toContain('assertObjectFeature(tenantId, "tender_boq_lines")');
    expect(src).toContain("boqDwGate(");
    expect(src).not.toMatch(/tenantId\s*=\s*(body|values|rows)|body\.tenant|values\.tenant_id/);
    expect(src.indexOf("requireTenantUser()")).toBeLessThan(src.indexOf("assertObjectFeature("));
    expect(src.indexOf("assertObjectFeature(")).toBeLessThan(src.indexOf("boqDwGate("));
  });

  it("every query a route or the gate makes names the workspace; the writes go through the BOQ server's gate", () => {
    for (const f of routes) {
      for (const m of read(f).matchAll(/\.from\("([a-z_]+)"\)[^;]*?;\n/g)) expect(m[0], `${f}: ${m[0].slice(0, 80)}`).toMatch(/tenant_id|tenantId/);
    }
    expect(read(routes[0])).toContain("boqRequestFor(g.ctx, oppId, true)");
    expect(read(routes[2])).toContain("boqRequestFor(g.ctx, oppId, true)");
    expect(read(routes[2])).toContain('.in("id", ids.slice(i, i + 150)).eq("tenant_id", tenantId)');
    expect(read(routes[2])).not.toMatch(/item_key|nameKey/);
    expect(read(routes[1])).not.toMatch(/unit_cost|markup_pct|price_source_ref/);
  });
});

describe("Import", () => {
  it("creates deal lines, BOQ rows and a Data Workbench source with no stored workbook, and logs one entry for the tender", async () => {
    const j = await (await call(importLines.POST, rowsOf([
      T({ item_no: "1.1", description: "Excavation", unit: "m3", quantity: "1,200", cost_code: "31 23 16" }),
      T({ item_no: "1.2", description: "Pipe 24in", unit: "m", quantity: "2500", rate: "310" }),
    ]))).json();
    expect(j).toMatchObject({ inserted: 2, skipped: 0, failed: 0 });

    const lines = current.tables.opportunity_lines;
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.tenant_id === "t1" && l.opportunity_id === O1)).toBe(true);
    expect(lines.find((l) => l.sl_no === "1.1")).toMatchObject({ qty: 1200, rate: 0, amount: 0, description: "Excavation" });
    expect(lines.find((l) => l.sl_no === "1.2")).toMatchObject({ qty: 2500, rate: 310, amount: 775000 });

    const rows = current.tables.tender_boq_lines;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tenant_id === "t1" && r.opportunity_id === O1)).toBe(true);
    expect(rows.find((r) => r.item_no === "1.1")).toMatchObject({ cost_code: "31 23 16", row_no: 2, item_key: "n:1.1" });
    // A client rate in the file is the line's price, from the file, with no cost behind it.
    expect(rows.find((r) => r.item_no === "1.2")).toMatchObject({ price_source: "boq_rate", price_source_ref: "boq-lines.csv", unit_cost: null, markup_pct: null });

    expect(current.tables.tender_boq_sources).toEqual([expect.objectContaining({ tenant_id: "t1", opportunity_id: O1, version: 1, is_current: true, file_name: "boq-lines.csv", storage_path: "", size_bytes: 0, sheet_name: "Data Workbench", line_count: 2, uploaded_by: "u1" })]);

    const entries = logged.filter((l) => l.objectType === "opportunity_tenders");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ objectId: O1, tenantId: "t1" });
    expect(entries[0].changes).toEqual([{ field: "BOQ import (Data Workbench)", from: null, to: "boq-lines.csv · 2 lines" }]);
  });

  it("resolves the tender by Deal ID or by tender number, and groups rows of several tenders", async () => {
    const j = await (await call(importLines.POST, rowsOf([
      T({ description: "A", quantity: "1" }),
      { tender_ref: "t-0013", description: "B", quantity: "2" },
      { tender_ref: "T-0012", item_no: "9", description: "C", quantity: "3" },
    ]))).json();
    expect(j).toMatchObject({ inserted: 3, failed: 0 });
    expect(current.tables.opportunity_lines.filter((l) => l.opportunity_id === O1)).toHaveLength(2);
    expect(current.tables.opportunity_lines.filter((l) => l.opportunity_id === O3)).toHaveLength(1);
    expect(current.tables.tender_boq_sources).toHaveLength(2);
    expect(logged.filter((l) => l.objectType === "opportunity_tenders").map((l) => l.objectId).sort()).toEqual([O1, O3]);
  });

  it("an item number that is already on the tender updates it, a new version replaces the source, and one entry is logged", async () => {
    seedBoq();
    const j = await (await call(importLines.POST, rowsOf([
      T({ item_no: "1.1", description: "Excavation", unit: "m3", quantity: "120", cost_code: "31 23" }),
      T({ item_no: "1.2", description: "Backfill", unit: "m3", quantity: "50" }),
      T({ item_no: "1.3", description: "Disposal", unit: "m3", quantity: "10" }),
    ], "revised.csv"))).json();
    expect(j).toMatchObject({ inserted: 1, skipped: 2, failed: 0 });
    expect(j.outcomes.map((o: { status: string; reason?: string }) => o.reason)).toEqual(["Already on the tender — updated by item number", "Already on the tender — unchanged", undefined]);

    const l1 = current.tables.opportunity_lines.find((l) => l.id === "l1")!;
    // The priced line followed the file's new quantity and kept its rate: the amount is re-derived.
    expect(l1).toMatchObject({ qty: 120, rate: 20, amount: 2400 });
    expect(current.tables.opportunity_lines.filter((l) => l.opportunity_id === O1)).toHaveLength(3);

    const sources = current.tables.tender_boq_sources.filter((s) => s.opportunity_id === O1);
    expect(sources.map((s) => [s.version, s.is_current])).toEqual([[1, false], [2, true]]);
    expect(sources[1]).toMatchObject({ file_name: "revised.csv", storage_path: "" });
    const entries = logged.filter((l) => l.objectType === "opportunity_tenders");
    expect(entries).toHaveLength(1);
    expect(entries[0].changes?.[0]).toMatchObject({ field: "BOQ import (Data Workbench)", from: "boq.xlsx (v1)", to: "revised.csv · 3 lines · 1 added, 1 changed, 0 removed, 0 kept" });
  });

  it("only adds and updates: a two-line file against a twelve-line tender leaves all twelve untouched, priced or not", async () => {
    const line = (n: number, over: Row = {}): Row => ({ id: `ml${n}`, tenant_id: "t1", opportunity_id: O1, discount_pct: 0, is_selected: true, show_on_pdf: true, sl_no: `9.${n}`, description: `Item ${n}`, uom: "m", qty: 10, rate: n % 2 ? 5 : 0, amount: n % 2 ? 50 : 0, ...over });
    const boq = (n: number): Row => ({ id: `mb${n}`, tenant_id: "t1", opportunity_id: O1, source_id: "s1", line_id: `ml${n}`, item_key: `n:9.${n}`, item_no: `9.${n}`, row_no: n + 1, file_description: `Item ${n}`, file_uom: "m", file_qty: 10, cost_code: null, file_rate: null, price_source: n % 2 ? "manual" : null, price_source_ref: null, price_as_of: null, stale_accepted: false, unit_cost: null, markup_pct: null, removed_in_revision: false });
    const nums = Array.from({ length: 12 }, (_, i) => i + 1);
    seedBoq({ opportunity_lines: [...nums.map((n) => line(n))], tender_boq_lines: nums.map(boq) });
    const j = await (await call(importLines.POST, rowsOf([
      T({ item_no: "9.1", description: "Item 1", unit: "m", quantity: "15" }),
      T({ item_no: "9.99", description: "Brand new", unit: "m", quantity: "3" }),
    ]))).json();
    expect(j).toMatchObject({ inserted: 1, skipped: 1, failed: 0 });
    const mine = current.tables.tender_boq_lines.filter((r) => r.opportunity_id === O1);
    expect(mine).toHaveLength(13);
    for (const n of nums) expect(mine.find((r) => r.id === `mb${n}`), `row ${n}`).toMatchObject({ removed_in_revision: false });
    const lines = current.tables.opportunity_lines.filter((l) => l.opportunity_id === O1);
    expect(lines).toHaveLength(13);
    expect(lines.find((l) => l.id === "ml1")).toMatchObject({ qty: 15, amount: 75 });
    for (const n of nums.slice(1)) expect(lines.find((l) => l.id === `ml${n}`), `line ${n}`).toMatchObject({ qty: 10 });
    expect(logged.find((l) => l.objectType === "opportunity_tenders")!.changes?.[0].to).toContain("0 removed, 0 kept");
  });

  it("fails clearly for an unknown tender, a deal that is not a tender, another workspace's tender, a duplicate tender number and a bad row", async () => {
    seed({ opportunity_tenders: [tender(O1, "DUP"), tender(O3, "dup"), tender(O9, "T-0099", { tenant_id: "t2" })] });
    const j = await (await call(importLines.POST, rowsOf([
      { tender_ref: "OPP-9999", description: "x", quantity: "1" },
      { tender_ref: "OPP-0045", description: "x", quantity: "1" },
      { tender_ref: "OPP-0099", description: "x", quantity: "1" },
      { tender_ref: "T-0099", description: "x", quantity: "1" },
      { tender_ref: "DUP", description: "x", quantity: "1" },
      { description: "x", quantity: "1" },
      T({ description: "ok", quantity: "1" }),
      T({ description: "", quantity: "1" }),
      T({ description: "bad", quantity: "lots" }),
    ]))).json();
    expect(j).toMatchObject({ inserted: 1, failed: 8 });
    const reason = (n: number) => j.outcomes.find((o: { rowNum: number }) => o.rowNum === n).reason as string;
    expect(reason(2)).toMatch(/was not found/);
    expect(reason(3)).toMatch(/is not a tender/);
    expect(reason(4)).toMatch(/was not found/);
    expect(reason(5)).toMatch(/was not found/);
    expect(reason(6)).toBe("Tender number is not unique — use the Deal ID");
    expect(reason(7)).toMatch(/Tender is required/);
    expect(reason(9)).toBe("Description is required");
    expect(reason(10)).toBe("Quantity must be a number");
    expect(current.tables.opportunity_lines.filter((l) => l.opportunity_id !== O1)).toHaveLength(0);
    expect(current.tables.opportunity_lines.filter((l) => l.tenant_id === "t2")).toHaveLength(0);
  });

  it("a viewer is refused, and nothing is written", async () => {
    canEdit = false;
    const res = await call(importLines.POST, rowsOf([T({ description: "x", quantity: "1" })]));
    expect(res.status).toBe(403);
    expect(current.tables.opportunity_lines).toHaveLength(0);
    expect(current.tables.tender_boq_sources).toHaveLength(0);
  });
});

describe("Export", () => {
  it("carries the id, the tender's Deal ID and the status, in this workspace only, and no cost, markup or price reference", async () => {
    seedBoq();
    const res = await call(exportLines.POST, {});
    const j = await res.json();
    expect(j.rows).toHaveLength(2);
    const a = j.rows.find((r: Record<string, string>) => r.item_no === "1.1");
    expect(a).toEqual({
      id: "b1", tender_ref: "OPP-0044", item_no: "1.1", description: "Excavation", details: "", unit: "m3", quantity: "100", cost_code: "31 23", wbs_code: "", client_columns: "",
      rate: "20", amount: "2000", rate_source: "supplier", price_as_of: "2026-10-20", status: "priced", row_no: "2",
    });
    expect(j.rows.find((r: Record<string, string>) => r.item_no === "1.2")).toMatchObject({ id: "b2", rate: "", amount: "", rate_source: "", status: "unpriced" });
    const text = JSON.stringify(j);
    for (const secret of ["17.3456", "15.3", SECRET_REF, "unit_cost", "markup", "price_source_ref", "99.99", "Foreign line"]) expect(text, secret).not.toContain(secret);
  });

  it("marks a price older than the validity stale, and filters like the other exports", async () => {
    seedBoq({ tender_boq_lines: [
      { id: "b1", tenant_id: "t1", opportunity_id: O1, source_id: "s1", line_id: "l1", item_key: "n:1.1", item_no: "1.1", row_no: 2, file_description: "Excavation", file_uom: "m3", file_qty: 100, price_source: "supplier", price_as_of: "2026-01-01", stale_accepted: false, removed_in_revision: false },
      { id: "b2", tenant_id: "t1", opportunity_id: O1, source_id: "s1", line_id: "l2", item_key: "n:1.2", item_no: "1.2", row_no: 3, file_description: "Backfill", file_uom: "m3", file_qty: 50, removed_in_revision: false },
    ] });
    const all = await (await call(exportLines.POST, {})).json();
    expect(all.rows.find((r: Record<string, string>) => r.item_no === "1.1").status).toBe("stale");
    const only = await (await call(exportLines.POST, { filters: [{ field: "status", op: "equals", value: "unpriced" }] })).json();
    expect(only.rows.map((r: Record<string, string>) => r.item_no)).toEqual(["1.2"]);
  });

  it("answers an empty list while the BOQ tables are pending", async () => {
    current = fakeDb({ tenants: [{ id: "t1", config: {} }], opportunities: [deal(O1, "OPP-0044")], opportunity_tenders: [tender(O1, "T-0012")] }, { missingTables: ["tender_boq_sources", "tender_boq_lines"] });
    const res = await call(exportLines.POST, {});
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });

  it("a viewer may export", async () => {
    seedBoq();
    canEdit = false;
    expect((await call(exportLines.POST, {})).status).toBe(200);
  });
});

describe("Update (by id only)", () => {
  it("changes the quantity, recomputes the amount, changes description and cost code, and logs on the tender", async () => {
    seedBoq();
    const j = await (await call(updateLines.POST, rowsOf([
      { id: "b1", quantity: "150", description: "Excavation in rock", cost_code: "31 23 99" },
      { id: "b2", cost_code: "31 23 23" },
    ]))).json();
    expect(j).toMatchObject({ updated: 2, failed: 0 });
    expect(current.tables.opportunity_lines.find((l) => l.id === "l1")).toMatchObject({ qty: 150, amount: 3000, rate: 20, description: "Excavation in rock" });
    expect(current.tables.tender_boq_lines.find((r) => r.id === "b1")).toMatchObject({ cost_code: "31 23 99", file_qty: 100, file_description: "Excavation" });
    expect(current.tables.tender_boq_lines.find((r) => r.id === "b2")!.cost_code).toBe("31 23 23");

    const entries = logged.filter((l) => l.objectType === "opportunity_tenders");
    expect(entries).toHaveLength(1);
    expect(entries[0].changes!.map((c) => c.field).sort()).toEqual(["BOQ code 1.1", "BOQ code 1.2", "BOQ description 1.1", "BOQ quantity 1.1"]);
    // The cost-code entries must not start like the typed unit cost, which the change feed holds back.
    for (const c of entries[0].changes!) expect(c.field).not.toMatch(/^BOQ cost /);
  });

  it("ignores the rate, the item number, the unit and the tender, and says so only where they differ from the line", async () => {
    seedBoq();
    const j = await (await call(updateLines.POST, rowsOf([
      { id: "b1", quantity: "101", rate: "999", item_no: "1.1", unit: "m3", tender_ref: "OPP-0044" },
      { id: "b1", quantity: "101", rate: "20", item_no: "X", unit: "m3", tender_ref: "OPP-0044" },
    ]))).json();
    expect(j).toMatchObject({ updated: 1, skipped: 1, failed: 0 });
    expect(j.outcomes[0].reason).toBe("rate is not changed by a file (a rate is set on the Bill of quantities)");
    expect(j.outcomes[1]).toMatchObject({ status: "skipped", reason: "No change. item_no is not changed by a file" });
    expect(current.tables.opportunity_lines.find((l) => l.id === "l1")).toMatchObject({ qty: 101, rate: 20 });
    expect(current.tables.tender_boq_lines.find((r) => r.id === "b1")).toMatchObject({ item_no: "1.1", price_source: "supplier", unit_cost: 17.3456 });
  });

  it("a row with nothing to change is skipped, and an unchanged value reads No change", async () => {
    seedBoq();
    const j = await (await call(updateLines.POST, rowsOf([{ id: "b1" }, { id: "b1", quantity: "100", description: "Excavation" }]))).json();
    expect(j).toMatchObject({ updated: 0, skipped: 2, failed: 0 });
    expect(j.outcomes[0].reason).toBe("No mapped columns to update");
    expect(j.outcomes[1].reason).toBe("No change");
    expect(logged).toHaveLength(0);
  });

  it("fails a missing id, a code instead of an id, another workspace's id, a bad quantity and a blank description", async () => {
    seedBoq();
    const j = await (await call(updateLines.POST, rowsOf([
      { quantity: "1" },
      { id: "1.1", quantity: "1" },
      { id: "b9", quantity: "777" },
      { id: "b1", quantity: "-3" },
      { id: "b1", quantity: "many" },
      { id: "b1", description: " " },
    ]))).json();
    expect(j).toMatchObject({ updated: 0, failed: 6 });
    expect(j.outcomes[0].reason).toBe("Record ID is required to update a row");
    expect(j.outcomes[2].reason).toBe('No record with id "b9" found in this workspace');
    expect(j.outcomes[3].reason).toBe("Enter a quantity of 0 or more");
    expect(current.tables.opportunity_lines.find((l) => l.id === "l9")!.qty).toBe(1);
    expect(current.tables.opportunity_lines.find((l) => l.id === "l1")!.qty).toBe(100);
  });

  it("a viewer is refused, and nothing changes", async () => {
    seedBoq();
    canEdit = false;
    expect((await call(updateLines.POST, rowsOf([{ id: "b1", quantity: "5" }]))).status).toBe(403);
    expect(current.tables.opportunity_lines.find((l) => l.id === "l1")!.qty).toBe(100);
  });
});

describe("the client's own layout (Narration, Description, client columns)", () => {
  const SPEC = "1) Non-shrink cementitious grout.\n2) Under base plates, 50 mm.";
  const CLIENT = { "Sr #": "155", "Bill #": "A", Section: "00", "Page #": "00", "Revision #": "00", "Boq #": "A-00-00-00-A1518" };
  const file = (over: Record<string, string> = {}) => T({ item_no: "A1518", narration: "Grouting (Non-shrink)", description: SPEC, unit: "M3", quantity: "10.130", rate: "4,014.000", client_columns: JSON.stringify(CLIENT), ...over });

  it("imports a Narration as the line name and the Description as its details, keeps the client columns and the client's rate", async () => {
    seedBoq();
    const j = await (await call(importLines.POST, rowsOf([file()]))).json();
    expect(j).toMatchObject({ inserted: 1, failed: 0 });
    const boq = current.tables.tender_boq_lines.find((r) => r.item_key === "n:a1518")!;
    expect(boq).toMatchObject({ file_description: "Grouting (Non-shrink)", file_details: SPEC, file_rate: 4014, client_data: CLIENT, file_qty: 10.13 });
    expect(current.tables.opportunity_lines.find((l) => l.sl_no === "A1518")).toMatchObject({ description: "Grouting (Non-shrink)", rate: 4014, qty: 10.13 });
  });

  it("a file with a Description only is exactly as before: the name is the description and there are no details", async () => {
    seedBoq();
    await call(importLines.POST, rowsOf([T({ item_no: "Z1", description: "Plain line", unit: "m", quantity: "2" })]));
    const boq = current.tables.tender_boq_lines.find((r) => r.item_key === "n:z1")!;
    expect(boq).toMatchObject({ file_description: "Plain line", file_details: null, client_data: null });
  });

  it("round trips through Export: the name, the details and the client columns come back, and no cost, markup or price reference", async () => {
    seedBoq();
    await call(importLines.POST, rowsOf([file()]));
    const j = await (await call(exportLines.POST, {})).json();
    const row = j.rows.find((r: Record<string, string>) => r.item_no === "A1518");
    expect(row).toMatchObject({ description: "Grouting (Non-shrink)", details: SPEC, unit: "M3", quantity: "10.13", rate: "4014" });
    expect(JSON.parse(row.client_columns)).toEqual(CLIENT);
    const text = JSON.stringify(j);
    for (const secret of ["unit_cost", "markup", "price_source_ref", SECRET_REF, "17.3456"]) expect(text, secret).not.toContain(secret);
    // The exported cells import again to the same line.
    const again = await (await call(importLines.POST, rowsOf([T({ item_no: row.item_no, description: row.description, details: row.details, unit: row.unit, quantity: row.quantity, client_columns: row.client_columns })]))).json();
    expect(again).toMatchObject({ failed: 0 });
    expect(current.tables.tender_boq_lines.filter((r) => r.item_key === "n:a1518")).toHaveLength(1);
  });

  it("Update changes the details by Record ID and leaves the name and the client columns alone", async () => {
    seedBoq();
    await call(importLines.POST, rowsOf([file()]));
    const id = current.tables.tender_boq_lines.find((r) => r.item_key === "n:a1518")!.id as string;
    const j = await (await call(updateLines.POST, { rows: [{ rowNum: 2, values: { id, details: "Revised spec\n\n\n\nsecond paragraph", client_columns: "{}" } }] })).json();
    expect(j).toMatchObject({ updated: 1, failed: 0 });
    expect(current.tables.tender_boq_lines.find((r) => r.id === id)).toMatchObject({ file_description: "Grouting (Non-shrink)", file_details: "Revised spec\n\nsecond paragraph", client_data: CLIENT });
    expect(logged.at(-1)!.changes!.map((c) => c.field)).toEqual(["BOQ details A1518"]);
  });

  it("a Client columns cell that is not a JSON object fails that row only", async () => {
    seedBoq();
    const j = await (await call(importLines.POST, rowsOf([file({ client_columns: "Sr #: 155" }), file({ item_no: "A1519" })]))).json();
    expect(j).toMatchObject({ inserted: 1, failed: 1 });
    expect(j.outcomes.find((o: { status: string }) => o.status === "failed").reason).toMatch(/JSON object/);
  });

  it("Export and Update offer no Narration column; Import does", () => {
    const f = new Map(TENDER_BOQ_LINES_SPEC.fields.map((x) => [x.key, x]));
    expect(f.get("narration")?.importOnly).toBe(true);
    expect(f.get("client_columns")?.importOnly).toBeFalsy();
    expect(read("src/app/(app)/data-workbench/ExportFlow.tsx")).toContain("!f.importOnly");
    expect(read("src/app/(app)/data-workbench/DataWorkbenchClient.tsx")).toContain("!f.exportOnly && !f.importOnly");
  });

  it("while migration 0242 is pending the import still works, name from the Narration, and the details and client columns are left out", async () => {
    seedBoq();
    const real = current.client;
    const NEW = /file_details|client_data|header_info/;
    const failing = () => {
      const q: unknown = new Proxy({}, { get: (_t, p) => (p === "then" ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42703", message: "column does not exist" } }).then(res) : () => q) });
      return q;
    };
    current = { ...current, client: { from: (t: string) => {
      const q = real.from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (t !== "tender_boq_lines" && t !== "tender_boq_sources") return q;
      return new Proxy(q, { get(target, p: string) {
        if (p === "select") return (cols?: string) => (NEW.test(String(cols ?? "")) ? failing() : target.select(cols));
        if (p === "insert" || p === "update") return (payload: unknown) => ((Array.isArray(payload) ? payload : [payload]).some((x) => NEW.test(Object.keys(x as object).join(","))) ? failing() : target[p](payload));
        const v = target[p];
        return typeof v === "function" ? v.bind(target) : v;
      } });
    } } as unknown as typeof real };
    const j = await (await call(importLines.POST, rowsOf([file()]))).json();
    expect(j).toMatchObject({ inserted: 1, failed: 0 });
    const boq = current.tables.tender_boq_lines.find((r) => r.item_key === "n:a1518")!;
    expect(boq).toMatchObject({ file_description: "Grouting (Non-shrink)", file_rate: 4014 });
    expect(boq).not.toHaveProperty("file_details");
    expect(boq).not.toHaveProperty("client_data");
    expect(current.tables.tender_boq_sources.find((s) => s.is_current)).not.toHaveProperty("header_info");
  });
});

describe("the module gate", () => {
  it.each([["gcc_tender"], ["pipeline"]])("a workspace without %s gets 404 on every mode and nothing is read or written", async (flag) => {
    seedBoq();
    features = { gcc_tender: true, pipeline: true, [flag]: false };
    expect((await call(exportLines.POST, {})).status).toBe(404);
    expect((await call(importLines.POST, rowsOf([T({ description: "x", quantity: "1" })]))).status).toBe(404);
    expect((await call(updateLines.POST, rowsOf([{ id: "b1", quantity: "5" }]))).status).toBe(404);
    expect(current.tables.opportunity_lines.find((l) => l.id === "l1")!.qty).toBe(100);
    expect(current.tables.tender_boq_sources).toHaveLength(1);
  });
});

describe("the Data Workbench page lists the object only for an edition that has the Pipeline", () => {
  it("is in the catalog (Sales, under Deals, needing the Pipeline) and the page's static specs", () => {
    expect(DW_CATALOG.tender_boq_lines).toMatchObject({ group: "sales", parent: "opportunities", alsoNeeds: ["pipeline"] });
    expect(DW_CATALOG.tender_boq_lines.modes).toEqual(["import", "export", "update"]);
    const page = read("src/app/(app)/data-workbench/page.tsx");
    expect(page).toContain("tender_boq_lines: TENDER_BOQ_LINES_SPEC");
    expect(page).toContain("ownedObjectIds(");
  });

  it("the Pipeline filter lives in the catalog: no Pipeline, no object", () => {
    // The module mapping is mocked above; the edition flag is what featureForObject answers for this object.
    const owner = (id: string) => (id === "tender_boq_lines" ? ("gcc_tender" as const) : null);
    const features = { gcc_tender: true };
    expect(ownedObjectIds({ ...features, pipeline: true }, owner)).toContain("tender_boq_lines");
    expect(ownedObjectIds(features, owner)).not.toContain("tender_boq_lines");
    expect(ownedObjectIds({ pipeline: true }, owner)).not.toContain("tender_boq_lines");
  });
});

// ── The WBS code column (docs/design/wbs.md section 5; migration 0243) ────────────────────────────────────────────────

const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const W = { w1: U(101), w2: U(102), w21: U(103), w22: U(104), w3: U(105), wf: U(106), wt2: U(107) };
const BQ = { a: U(201), b: U(202), c: U(203), foreign: U(204) };
const wi = (id: string, code: string, name: string, parent: string | null, sort: number, over: Row = {}): Row => ({
  id, tenant_id: "t1", opportunity_id: O1, parent_id: parent, code, name, owner_employee_id: null, sort_order: sort, code_is_manual: false, note: null, created_at: null, ...over,
});

/** A tender with three lines and a WBS: 1 Civil, 2 Mechanical (2.1 Fabrication, 2.2 Erection), 3 Services. Line A is whole in 1, line B is split 60/40 over 2.1 and 2.2, line C is unassigned. */
function seedWbs(extra: Record<string, Row[]> = {}) {
  const dl = (id: string, sl: string, qty: number, rate: number): Row => ({ id, tenant_id: "t1", opportunity_id: O1, discount_pct: 0, is_selected: true, show_on_pdf: true, sl_no: sl, description: `Line ${sl}`, uom: "m", qty, rate, amount: qty * rate });
  const bq = (id: string, line: string, item: string, row: number, qty: number, over: Row = {}): Row => ({ id, tenant_id: "t1", opportunity_id: O1, source_id: "s1", line_id: line, item_key: `n:${item}`, item_no: item, row_no: row, file_description: `Line ${item}`, file_uom: "m", file_qty: qty, cost_code: null, file_rate: null, price_source: null, price_source_ref: null, price_as_of: null, stale_accepted: false, unit_cost: null, markup_pct: null, removed_in_revision: false, wbs_item_id: null, ...over });
  seed({
    opportunity_lines: [dl("la", "1.1", 100, 20), dl("lb", "1.2", 50, 10), dl("lc", "1.3", 10, 0), { ...dl("lf", "1", 1, 5), tenant_id: "t2", opportunity_id: O9 }],
    tender_boq_sources: [{ id: "s1", tenant_id: "t1", opportunity_id: O1, version: 1, is_current: true, file_name: "boq.xlsx", storage_path: "t1/o1/x.xlsx", uploaded_at: "2026-10-20T00:00:00Z" }],
    tender_boq_lines: [
      bq(BQ.a, "la", "1.1", 2, 100, { wbs_item_id: W.w1 }),
      bq(BQ.b, "lb", "1.2", 3, 50),
      bq(BQ.c, "lc", "1.3", 4, 10),
      bq(BQ.foreign, "lf", "1", 2, 1, { tenant_id: "t2", opportunity_id: O9 }),
    ],
    tender_wbs_items: [
      wi(W.w1, "1", "Civil", null, 10), wi(W.w2, "2", "Mechanical", null, 20), wi(W.w21, "2.1", "Fabrication", W.w2, 10), wi(W.w22, "2.2", "Erection", W.w2, 20), wi(W.w3, "3", "Services", null, 30),
      wi(W.wf, "9", "Other tender only", null, 10, { opportunity_id: O3 }),
      wi(W.wt2, "1", "Other workspace", null, 10, { tenant_id: "t2", opportunity_id: O9 }),
    ],
    tender_wbs_line_parts: [
      { id: "p1", tenant_id: "t1", opportunity_id: O1, boq_line_id: BQ.b, wbs_item_id: W.w21, share_pct: 60, sort_order: 0 },
      { id: "p2", tenant_id: "t1", opportunity_id: O1, boq_line_id: BQ.b, wbs_item_id: W.w22, share_pct: 40, sort_order: 1 },
    ],
    employees: [],
    ...extra,
  });
}
const partsFor = (boq: string) => current.tables.tender_wbs_line_parts.filter((p) => p.boq_line_id === boq).map((p) => [p.wbs_item_id, p.share_pct]);
const lineRow = (id: string) => current.tables.tender_boq_lines.find((r) => r.id === id)!;
const upd = async (values: Record<string, string>[]) => (await call(updateLines.POST, rowsOf(values))).json();

describe("the WBS code column", () => {
  it("is an Export and Update column of the BOQ lines, never an Import one", () => {
    const f = TENDER_BOQ_LINES_SPEC.fields.find((x) => x.key === "wbs_code")!;
    expect(f).toMatchObject({ updateOnly: true });
    expect(f.exportOnly).toBeFalsy();
    expect(read("src/app/(app)/data-workbench/DataWorkbenchClient.tsx")).toContain("!f.exportOnly && !f.updateOnly");
  });

  it("Export writes the item's code for a whole line, code:percent for a split line and nothing for an unassigned one", async () => {
    seedWbs();
    const j = await (await call(exportLines.POST, {})).json();
    const cell = (item: string) => j.rows.find((r: Record<string, string>) => r.item_no === item).wbs_code;
    expect(cell("1.1")).toBe("1");
    expect(cell("1.2")).toBe("2.1:60;2.2:40");
    expect(cell("1.3")).toBe("");
    expect(j.rows).toHaveLength(3);
  });

  it("Import never reads it: a new row, or a revised one, regroups nothing", async () => {
    seedWbs();
    const j = await (await call(importLines.POST, rowsOf([T({ item_no: "1.1", description: "Line 1.1", unit: "m", quantity: "100", wbs_code: "3" }), T({ item_no: "7.7", description: "New line", unit: "m", quantity: "2", wbs_code: "3" })]))).json();
    expect(j).toMatchObject({ failed: 0 });
    expect(lineRow(BQ.a).wbs_item_id).toBe(W.w1);
    const added = current.tables.tender_boq_lines.find((r) => r.item_key === "n:7.7")!;
    expect(added.wbs_item_id ?? null).toBeNull();
    expect(current.tables.tender_wbs_line_parts).toHaveLength(2);
  });

  it("Update puts a line in the item the code names, by the line's real id, and logs it on the tender", async () => {
    seedWbs();
    const j = await upd([{ id: BQ.c, wbs_code: "3" }]);
    expect(j).toMatchObject({ updated: 1, failed: 0 });
    expect(lineRow(BQ.c).wbs_item_id).toBe(W.w3);
    const entry = logged.filter((l) => l.objectType === "opportunity_tenders").at(-1)!;
    expect(entry).toMatchObject({ objectId: O1, tenantId: "t1" });
    expect(entry.changes!.map((c) => c.field)).toEqual(["WBS 3 lines"]);
  });

  it("a code matches without regard to case, and a split list is written as parts with the whole line cleared", async () => {
    seedWbs({ tender_wbs_items: [wi(W.w1, "C-100", "Civil", null, 10, { code_is_manual: true }), wi(W.w21, "F1", "Fab", null, 20), wi(W.w22, "E1", "Ere", null, 30)] });
    const j = await upd([{ id: BQ.c, wbs_code: "c-100:70; F1:30" }]);
    expect(j).toMatchObject({ updated: 1, failed: 0 });
    expect(lineRow(BQ.c).wbs_item_id ?? null).toBeNull();
    expect(partsFor(BQ.c)).toEqual([[W.w1, 70], [W.w21, 30]]);
    expect(logged.at(-1)!.changes!.map((c) => c.field)).toEqual(["WBS split 1.3"]);
  });

  it("a split that does not add up to 100 fails that row clearly and writes nothing", async () => {
    seedWbs();
    const j = await upd([{ id: BQ.c, wbs_code: "1:70;3:20" }, { id: BQ.a, wbs_code: "1:100;3:5" }]);
    expect(j).toMatchObject({ updated: 0, failed: 2 });
    expect(j.outcomes[0].reason).toBe("WBS shares add up to 90 %, not 100 %");
    expect(j.outcomes[1].reason).toBe("WBS shares add up to 105 %, not 100 %");
    expect(current.tables.tender_wbs_line_parts).toHaveLength(2);
    expect(lineRow(BQ.a).wbs_item_id).toBe(W.w1);
  });

  it("an unknown code, another tender's code, a single share under 100, a repeated code and a share that is not a number each fail the row", async () => {
    seedWbs();
    const j = await upd([
      { id: BQ.c, wbs_code: "7.7" }, { id: BQ.c, wbs_code: "9" }, { id: BQ.c, wbs_code: "1:60" }, { id: BQ.c, wbs_code: "1:50;1:50" }, { id: BQ.c, wbs_code: "1:abc;3:50" }, { id: BQ.c, wbs_code: "1;3:50" },
    ]);
    expect(j).toMatchObject({ updated: 0, failed: 6 });
    expect(j.outcomes.map((o: { reason: string }) => o.reason)).toEqual([
      "WBS 7.7 does not exist on this tender", "WBS 9 does not exist on this tender", "WBS shares add up to 60 %, not 100 %", "WBS 1 appears twice",
      'WBS 1: "abc" is not a share', "WBS 1 needs a share, like 1:60",
    ]);
    expect(lineRow(BQ.c).wbs_item_id ?? null).toBeNull();
  });

  it("an item with sub-items cannot hold a line, whole or as a part", async () => {
    seedWbs();
    const j = await upd([{ id: BQ.c, wbs_code: "2" }, { id: BQ.c, wbs_code: "2:50;3:50" }]);
    expect(j).toMatchObject({ updated: 0, failed: 2 });
    expect(j.outcomes[0].reason).toBe("WBS 2 has sub-items. Choose one of them");
    expect(j.outcomes[1].reason).toMatch(/2 has sub-items/);
  });

  it("one share at 100 unsplits a split line into that item, and an empty cell makes a line unassigned", async () => {
    seedWbs();
    const j = await upd([{ id: BQ.b, wbs_code: "2.1:100" }, { id: BQ.a, wbs_code: "" }]);
    expect(j).toMatchObject({ updated: 2, failed: 0 });
    expect(lineRow(BQ.b).wbs_item_id).toBe(W.w21);
    expect(partsFor(BQ.b)).toEqual([]);
    expect(lineRow(BQ.a).wbs_item_id ?? null).toBeNull();
  });

  it("what an export wrote is No change when it comes back, whole, split or empty", async () => {
    seedWbs();
    const exp = await (await call(exportLines.POST, {})).json();
    const back = exp.rows.map((r: Record<string, string>) => ({ id: r.id, wbs_code: r.wbs_code }));
    const j = await upd(back);
    expect(j).toMatchObject({ updated: 0, skipped: 3, failed: 0 });
    expect(logged).toHaveLength(0);
  });

  it("the left-over share of a split line (an item was removed) comes back as No change too, and can be fixed with a full list", async () => {
    seedWbs();
    current.tables.tender_wbs_line_parts = current.tables.tender_wbs_line_parts.filter((p) => p.id !== "p2");
    const exp = await (await call(exportLines.POST, {})).json();
    const cell = exp.rows.find((r: Record<string, string>) => r.item_no === "1.2").wbs_code;
    expect(cell).toBe("2.1:60");
    expect(await upd([{ id: BQ.b, wbs_code: cell }])).toMatchObject({ updated: 0, skipped: 1, failed: 0 });
    expect(await upd([{ id: BQ.b, wbs_code: "2.1:60;2.2:40" }])).toMatchObject({ updated: 1, failed: 0 });
    expect(partsFor(BQ.b)).toEqual([[W.w21, 60], [W.w22, 40]]);
  });

  it("a row that changes the quantity and the WBS does both; one that fails the WBS says the rest was applied", async () => {
    seedWbs();
    const ok = await upd([{ id: BQ.a, quantity: "120", wbs_code: "3" }]);
    expect(ok).toMatchObject({ updated: 1, failed: 0 });
    expect(current.tables.opportunity_lines.find((l) => l.id === "la")).toMatchObject({ qty: 120, amount: 2400 });
    expect(lineRow(BQ.a).wbs_item_id).toBe(W.w3);
    const bad = await upd([{ id: BQ.c, quantity: "11", wbs_code: "nowhere" }]);
    expect(bad.outcomes[0]).toMatchObject({ status: "failed", reason: "WBS nowhere does not exist on this tender (the other columns of this row were updated)" });
    expect(current.tables.opportunity_lines.find((l) => l.id === "lc")!.qty).toBe(11);
  });

  it("a file without the column never touches the grouping", async () => {
    seedWbs();
    await upd([{ id: BQ.b, quantity: "55" }]);
    expect(partsFor(BQ.b)).toHaveLength(2);
    expect(lineRow(BQ.a).wbs_item_id).toBe(W.w1);
  });

  it("another workspace's line id matches nothing, and the same line twice in a file is refused the second time", async () => {
    seedWbs();
    const j = await upd([{ id: BQ.foreign, wbs_code: "1" }, { id: BQ.c, wbs_code: "3" }, { id: BQ.c, wbs_code: "1" }]);
    expect(j.outcomes[0].reason).toBe(`No record with id "${BQ.foreign}" found in this workspace`);
    expect(j.outcomes[2]).toMatchObject({ status: "failed", reason: "This line is in the file twice" });
    expect(lineRow(BQ.foreign).wbs_item_id ?? null).toBeNull();
    expect(lineRow(BQ.c).wbs_item_id).toBe(W.w3);
  });

  it("a viewer is refused and nothing moves", async () => {
    seedWbs();
    canEdit = false;
    expect((await call(updateLines.POST, rowsOf([{ id: BQ.c, wbs_code: "3" }]))).status).toBe(403);
    expect(lineRow(BQ.c).wbs_item_id ?? null).toBeNull();
  });

  it("while migration 0243 is pending the export still works with an empty column and an Update with a code says why, while one without a code is unaffected", async () => {
    seedWbs();
    current = fakeDb(current.tables, { copyReads: true, missingTables: ["tender_wbs_items", "tender_wbs_line_parts"] });
    const exp = await (await call(exportLines.POST, {})).json();
    expect(exp.rows).toHaveLength(3);
    expect(exp.rows.every((r: Record<string, string>) => r.wbs_code === "")).toBe(true);
    const j = await upd([{ id: BQ.c, wbs_code: "3" }, { id: BQ.c, wbs_code: "" }]);
    expect(j.outcomes[0]).toMatchObject({ status: "failed", reason: "WBS needs a database update (migration 0243)" });
    expect(j.outcomes[1]).toMatchObject({ status: "skipped", reason: "No change" });
  });

  it("the column adds no cost to an Export", async () => {
    seedWbs();
    const text = JSON.stringify(await (await call(exportLines.POST, {})).json());
    for (const secret of ["unit_cost", "markup", "price_source_ref"]) expect(text, secret).not.toContain(secret);
  });
});
