import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const logged = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v, unsealSecret: (v: string) => v }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {}, logChange: async (_c: unknown, p: Record<string, unknown>) => { logged.push(p); } }));

import { loadErpOrgCodes } from "../erpOrgCodes";
import { orgKey } from "../erpOrgPure";
import { fakeAdmin, seedMiddleware, T1, T2, type Row } from "../testHarness";
import { csvExport, csvImport, listsView, putList } from "./listOps";
import type { OpsCtx } from "./engineOps";

const SEG_RETAIL = "aaaaaaaa-0000-4000-8000-000000000001";
const SEG_GONE = "aaaaaaaa-0000-4000-8000-000000000009";
const SEG_FOREIGN = "cccccccc-0000-4000-8000-000000000001";
const OT_EXPORT = "bbbbbbbb-0000-4000-8000-000000000001";
const seg = orgKey("segment", SEG_RETAIL);
const ot = orgKey("order_type", OT_EXPORT);

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => { logged.length = 0; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

function db() {
  const s = seedMiddleware();
  s.segments = [
    { id: SEG_RETAIL, tenant_id: T1, name: "Saudi retail", code: "KSA-R" },
    { id: SEG_FOREIGN, tenant_id: T2, name: "Foreign market", code: "F" },
  ] as Row[];
  s.sales_order_types = [{ id: OT_EXPORT, tenant_id: T1, name: "Export order", active: true, sort_order: 1 }] as Row[];
  return fakeAdmin(s);
}
const ctx = (d: ReturnType<typeof fakeAdmin>, tenantId = T1): OpsCtx => ({ supabase: d.client, admin: d.client, tenantId, userId: "u-1" });
const saved = (d: ReturnType<typeof fakeAdmin>, connection: string, kind: string) =>
  (d.tables.integration_value_lists ?? []).find((l) => l.connection_id === connection && l.kind === kind);

describe("what the Mapping tab offers", () => {
  it("SAP is offered the sales area list only, with the coverages and order types to pick from", async () => {
    const d = db();
    const v = (await listsView(ctx(d), "sap_s4")).body as Body;
    expect(v.standardKinds.map((k: Body) => k.kind)).toEqual(["sales_area"]);
    expect(v.org.options).toEqual([
      { key: seg, label: "Saudi retail", group: "Coverage" },
      { key: ot, label: "Export order", group: "Order type" },
    ]);
    expect(v.org.names.segment[SEG_RETAIL]).toBe("Saudi retail");
  });

  it("Dynamics 365 keeps its six lists and gains the ERP company list; a webhook gets neither organisation list", async () => {
    const d = db();
    const dyn = (await listsView(ctx(d), "dynamics365")).body as Body;
    expect(dyn.standardKinds.map((k: Body) => k.kind)).toEqual(["unit", "currency", "country", "payment_terms", "incoterms", "status", "erp_company"]);
    expect(dyn.org).toBeDefined();
  });

  it("another workspace's coverages and order types are never offered", async () => {
    const d = db();
    const v = (await listsView(ctx(d), "sap_s4")).body as Body;
    expect(JSON.stringify(v.org)).not.toContain("Foreign market");
    const other = (await listsView(ctx(d, T2), "sap_s4")).body as Body;
    expect(other.org.options.map((o: Body) => o.label)).toEqual(["Foreign market"]);
  });
});

describe("saving an organisation list", () => {
  it("saves a coverage row and an order type row, logs it, and does not count the rows as unused", async () => {
    const d = db();
    const r = await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: seg, erp: "1000/10/00" }, { bpm: ot, erp: "2000/20/10" }], default_in: "ignored" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "sales_area", label: "Sales area", default_in: null, counts: { rows: 2, unused: 0 } });
    expect(saved(d, "sap_s4", "sales_area")).toMatchObject({ tenant_id: T1 });
    expect(logged.at(-1)).toMatchObject({ objectType: "value_list", action: "create" });
  });

  it("refuses typed text, a bad sales area and an unknown target, each with the row", async () => {
    const d = db();
    const typed = await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: "Saudi retail", erp: "1000/10/00" }], default_in: null });
    expect(typed.status).toBe(422);
    expect((typed.body.errors as Body[])[0]).toMatchObject({ row: 0 });
    const bad = await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: seg, erp: "1000/10" }], default_in: null });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatch(/not a sales area/);
    expect(saved(d, "sap_s4", "sales_area")).toBeUndefined();
  });

  it("another workspace's coverage id cannot be saved", async () => {
    const d = db();
    const r = await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: orgKey("segment", SEG_FOREIGN), erp: "1000/10/00" }], default_in: null });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("That coverage or order type was not found in this workspace.");
    const missing = await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: orgKey("segment", SEG_GONE), erp: "1000/10/00" }], default_in: null });
    expect(missing.status).toBe(422);
  });

  it("a list belongs to the connection that uses it", async () => {
    const d = db();
    expect((await putList(ctx(d), "dynamics365", "sales_area", { rows: [], default_in: null })).status).toBe(422);
    expect((await putList(ctx(d), "sap_s4", "erp_company", { rows: [], default_in: null })).status).toBe(422);
    expect((await putList(ctx(d), "dynamics365", "erp_company", { rows: [{ bpm: seg, erp: "USMF" }], default_in: null })).status).toBe(200);
  });

  it("a row whose coverage was deleted stays until the person removes it, but a new dead key is refused", async () => {
    const d = db();
    await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: seg, erp: "1000/10/00" }, { bpm: ot, erp: "2000/20/10" }], default_in: null });
    d.tables.segments = d.tables.segments.filter((s) => s.id !== SEG_RETAIL);
    const again = await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: seg, erp: "1000/10/00" }, { bpm: ot, erp: "2000/20/11" }], default_in: null });
    expect(again.status).toBe(200);
    const view = (await listsView(ctx(d), "sap_s4")).body as Body;
    expect(view.lists[0].rows[0].bpm).toBe(seg);
    expect(view.org.names.segment[SEG_RETAIL]).toBeUndefined();
    const fresh = await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: orgKey("segment", SEG_GONE), erp: "1000/10/00" }], default_in: null });
    expect(fresh.status).toBe(422);
  });

  it("one workspace never sees another's list", async () => {
    const d = db();
    await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: seg, erp: "1000/10/00" }], default_in: null });
    expect(((await listsView(ctx(d, T2), "sap_s4")).body as Body).lists).toEqual([]);
  });
});

describe("CSV for an organisation list", () => {
  it("exports the coverage and order type NAMES, and reads them back to keys", async () => {
    const d = db();
    await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: seg, erp: "1000/10/00" }, { bpm: ot, erp: "2000/20/10" }], default_in: null });
    const out = await csvExport(ctx(d), "sap_s4", "sales_area");
    expect("csv" in out && out.csv).toContain("Saudi retail,1000/10/00,yes");
    expect("csv" in out && out.csv).toContain("Export order,2000/20/10,yes");
    const text = "bpm_value,erp_code,inbound\nsaudi retail,3000/30/00,yes\n";
    const preview = await csvImport(ctx(d), "sap_s4", "sales_area", text, false);
    expect(preview.body).toMatchObject({ preview: { added: 0, changed: 1, removed: 1 } });
    const applied = await csvImport(ctx(d), "sap_s4", "sales_area", text, true);
    expect(applied.body).toMatchObject({ applied: true });
    expect((saved(d, "sap_s4", "sales_area")!.rows as Body[])).toEqual([{ bpm: seg, erp: "3000/30/00", inbound: true }]);
  });

  it("a name that is not a coverage or order type of this workspace names its row", async () => {
    const d = db();
    const r = await csvImport(ctx(d), "sap_s4", "sales_area", "bpm_value,erp_code\nForeign market,1000/10/00\n", false);
    expect(r.status).toBe(422);
    expect((r.body.errors as Body[])[0]).toMatchObject({ row: 0 });
  });
});

describe("the chips on Coverage and Order types", () => {
  it("collects each mapped code by its key, from both connectors, tenant-scoped", async () => {
    const d = db();
    await putList(ctx(d), "sap_s4", "sales_area", { rows: [{ bpm: seg, erp: "1000/10/00" }], default_in: null });
    await putList(ctx(d), "dynamics365", "erp_company", { rows: [{ bpm: seg, erp: "USMF" }, { bpm: ot, erp: "" }], default_in: null });
    const codes = await loadErpOrgCodes(d.client, T1);
    expect(codes[seg]).toEqual([
      { kind: "sales_area", label: "Sales area", connection: "sap_s4", code: "1000/10/00" },
      { kind: "erp_company", label: "ERP company", connection: "dynamics365", code: "USMF" },
    ]);
    expect(codes[ot]).toBeUndefined();
    expect(await loadErpOrgCodes(d.client, T2)).toEqual({});
  });
});
