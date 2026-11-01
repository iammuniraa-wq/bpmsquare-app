import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// KAMCO's own BOQ sheet (docs/design/boq-client-format.md): a Project Code / Project Name block, then Sr #, Bill #, Section, Page #,
// Revision #, Item #, Boq #, Narration, Description, Unit, QTY, Rate, Amount. Read through the real routes against an in-memory
// database: the item number is Item # (not Sr #), Section is client data (not a cost code), the Narration is the line name, the long
// Description is the details, and the priced file goes back in the client's own columns.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  pending: false,
  changes: [] as { objectType: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
}));

const T1 = "t1";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const TODAY = "2026-11-01";
const NEW_COLUMNS = /file_details|client_data|header_info/;

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (t: string) => {
      const q = state.db.from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (!state.pending || (t !== "tender_boq_lines" && t !== "tender_boq_sources")) return q;
      // Migration 0242 not applied: any statement that names its columns answers "column does not exist".
      const failing = (): unknown => {
        const f: unknown = new Proxy({}, { get: (_x, p) => (p === "then" ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42703", message: "column does not exist" } }).then(res) : () => f) });
        return f;
      };
      return new Proxy(q, {
        get(target, p: string) {
          if (p === "select") return (cols?: string) => (NEW_COLUMNS.test(String(cols ?? "")) ? failing() : target.select(cols));
          if (p === "insert" || p === "update") return (payload: unknown) => ((Array.isArray(payload) ? payload : [payload]).some((x) => NEW_COLUMNS.test(Object.keys(x as object).join(","))) ? failing() : target[p](payload));
          const v = target[p];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
    auth: state.db.auth,
    storage: state.db.storage,
  }),
  getAuthUser: async () => ({ id: "u1", email: "me@t1.test" }),
  requireTenantUser: async () => ({ tenantId: T1, userId: "u1", role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({}), canViewWorkcenter: () => true, canEditWorkcenter: () => true }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => TODAY, tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));

import { NextRequest } from "next/server";
import { GET as boqGet, POST as boqPost } from "./[id]/boq/route";
import { POST as previewPost } from "./[id]/boq/preview/route";
import { POST as pricePost } from "./[id]/boq/price/route";
import { GET as exportGet } from "./[id]/boq/export/route";
import { PATCH as linePatch } from "./[id]/boq/lines/[boqId]/route";

const SPEC_STAIR = "1) Supply and fix steel stair as per drawing.\n2) Including paint and anchors.";
const SPEC_GROUT = "1) Non-shrink cementitious grout.\n2) Under base plates, 50 mm thick.";

async function clientWorkbook(over: { grout?: string } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ Sheet");
  ws.getCell("A1").value = "Project Code"; ws.getCell("B1").value = "C1093";
  ws.getCell("A2").value = "Project Name"; ws.getCell("B2").value = "CS & A Work for IPA Project";
  ws.getRow(4).values = ["Sr #", "Bill #", "Section", "Page #", "Revision #", "Item #", "Boq #", "Narration", "Description", "Unit", "QTY", "Rate", "Amount"];
  ws.getRow(5).values = [154, "A", "00", "00", "00", "A1516", "A-00-00-00-A1516", "Steel stair", SPEC_STAIR, "M", 337.1, 4570, 1540547];
  ws.getRow(6).values = [155, "A", "00", "00", "00", "A1518", "A-00-00-00-A1518", "Grouting (Non-shrink) (For steel structure)", over.grout ?? SPEC_GROUT, "M3", "10.130", "4,014.000", "40,661.820"];
  ws.getRow(7).values = [156, "A", "00", "00", "00", "A1521", "A-00-00-00-A1521", "Anchor Bolt (M20, L=825mm)", "Supply and install anchor bolts M20 with nuts.", "EA", 574, 66.7, 38285.8];
  ws.getRow(8).values = [null, null, null, null, null, null, null, null, "Grand Total", null, null, null, 1619494.62];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const url = () => new URL("http://internal.invalid/x");
const ctx = (id = OPP) => ({ params: Promise.resolve({ id }) });
const xlsx = (buf: Buffer, name = "BOQ Sheet C1093.xlsx") => new File([new Uint8Array(buf)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const upload = (file: File) => { const form = new FormData(); form.set("file", file); return new NextRequest(url(), { method: "POST", body: form }); };
const get = (q = "") => new NextRequest(new URL(`http://internal.invalid/x${q}`), { method: "GET" });
const json = (method: string, body: unknown) => new NextRequest(url(), { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const boqRows = () => state.db.rows("tender_boq_lines").filter((l) => l.opportunity_id === OPP);
const boqByItem = (item: string) => boqRows().find((b) => b.item_no === item)!;
const lineOf = (item: string) => state.db.rows("opportunity_lines").find((l) => l.id === boqByItem(item).line_id)!;

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }],
    opportunities: [{ id: OPP, tenant_id: T1, ref: "OPP-2", title: "IPA structural steel", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0, probability: 25 }],
    opportunity_tenders: [{ opportunity_id: OPP, tenant_id: T1, tender_no: null, reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
  });
  state.features = { pipeline: true, gcc_tender: true };
  state.pending = false;
  state.changes = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reading the client's own sheet", () => {
  it("finds the header under the title block, takes Item # as the item number and Narration as the name, and keeps Section out of the cost code", async () => {
    const res = await previewPost(upload(xlsx(await clientWorkbook())), ctx());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ header_row: 4, needs_mapping: false, line_count: 3, total_row: 8, details_count: 3, notice: null });
    expect(j.map).toEqual({ item_no: 6, narration: 8, description: 9, uom: 10, qty: 11, rate: 12, amount: 13 });
    expect(j.map.cost_code).toBeUndefined();
    expect(j.header_info).toEqual({ project_code: "C1093", project_name: "CS & A Work for IPA Project" });
    expect(j.client_columns).toEqual(["Sr #", "Bill #", "Section", "Page #", "Revision #", "Boq #"]);
    expect(j.sample[0]).toMatchObject({ item_no: "A1516", description: "Steel stair", qty: 337.1, uom: "M", file_rate: 4570, details: SPEC_STAIR });
    expect(state.db.rows("tender_boq_sources")).toEqual([]);
  });

  it("stores the name, the details with their line breaks, the client columns, the numbers and the title block", async () => {
    const res = await boqPost(upload(xlsx(await clientWorkbook())), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ line_count: 3, added: 3, priced_from_file: 3 });
    expect(boqByItem("A1516")).toMatchObject({
      cost_code: null, file_description: "Steel stair", file_details: SPEC_STAIR, file_uom: "M", file_qty: 337.1, file_rate: 4570, price_source: "boq_rate",
      client_data: { "Sr #": "154", "Bill #": "A", Section: "00", "Page #": "00", "Revision #": "00", "Boq #": "A-00-00-00-A1516" },
    });
    expect(boqByItem("A1518")).toMatchObject({ file_description: "Grouting (Non-shrink) (For steel structure)", file_qty: 10.13, file_rate: 4014 });
    expect(lineOf("A1516")).toMatchObject({ sl_no: "A1516", description: "Steel stair", qty: 337.1, rate: 4570, amount: 1540547 });
    expect(lineOf("A1518")).toMatchObject({ qty: 10.13, rate: 4014, amount: 40661.82 });
    expect(lineOf("A1521")).toMatchObject({ qty: 574, rate: 66.7, amount: 38285.8 });
    expect(state.db.rows("tender_boq_sources")[0]).toMatchObject({ header_info: { project_code: "C1093", project_name: "CS & A Work for IPA Project" }, total_row: 8, rate_col: 12, amount_col: 13, added_columns: false });
  });

  it("the Bill of quantities state returns the name in the table and the details and client columns for the row panel", async () => {
    await boqPost(upload(xlsx(await clientWorkbook())), ctx());
    const state_ = await (await boqGet(get(), ctx())).json();
    const row = state_.lines.find((l: { item_no: string }) => l.item_no === "A1516");
    expect(row).toMatchObject({ description: "Steel stair", details: SPEC_STAIR, client_data: { "Sr #": "154", Section: "00" }, cost_code: null });
    expect(row.description).not.toContain("\n");
  });

  it("the priced workbook goes back in the client's own Rate and Amount columns, with every other column and the title block untouched", async () => {
    await boqPost(upload(xlsx(await clientWorkbook())), ctx());
    const id = String(boqByItem("A1516").id);
    expect((await pricePost(json("POST", { line: id, source: "manual", rate: 5000 }), ctx())).status).toBe(200);
    const res = await exportGet(get("?kind=priced"), ctx());
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("BOQ Sheet")!;
    expect(ws.getCell("A1").value).toBe("Project Code");
    expect(ws.getCell("B2").value).toBe("CS & A Work for IPA Project");
    expect(ws.getCell("A5").value).toBe(154);
    expect(ws.getCell("F5").value).toBe("A1516");
    expect(ws.getCell("I5").value).toBe(SPEC_STAIR);
    expect(ws.getCell("L5").value).toBe(5000);
    expect(ws.getCell("M5").value).toBe(1685500);
    // The client's own rate on a line nobody changed is written back as it was.
    expect(ws.getCell("L7").value).toBe(66.7);
    expect(ws.getCell("M7").value).toBe(38285.8);
    expect(ws.columnCount).toBe(13);
  });

  it("the answer sheet keeps item, name, unit, quantity, rate and amount, with no details column", async () => {
    await boqPost(upload(xlsx(await clientWorkbook())), ctx());
    const res = await exportGet(get("?kind=answer"), ctx());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Answer sheet")!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Item", "Description", "Unit", "Quantity", "Unit rate", "Amount", "Notes"]);
    expect([ws.getCell("A2").value, ws.getCell("B2").value, ws.getCell("C2").value]).toEqual(["A1516", "Steel stair", "M"]);
  });

  it("a revised sheet whose details changed reports the line as changed (details) and updates it", async () => {
    await boqPost(upload(xlsx(await clientWorkbook())), ctx());
    const revised = await clientWorkbook({ grout: "1) Non-shrink cementitious grout, 60 mm thick." });
    const pre = await (await previewPost(upload(xlsx(revised)), ctx())).json();
    expect(pre.diff).toMatchObject({ added: 0, changed: 1, unchanged: 2 });
    expect(pre.diff.changed_items[0].fields).toEqual(["details"]);
    expect(pre.reused_map).toBe(true);
    await boqPost(upload(xlsx(revised)), ctx());
    expect(boqByItem("A1518").file_details).toBe("1) Non-shrink cementitious grout, 60 mm thick.");
  });

  it("an editor changes a line's details from the row panel, and it is logged", async () => {
    await boqPost(upload(xlsx(await clientWorkbook())), ctx());
    const boqId = String(boqByItem("A1516").id);
    const res = await linePatch(json("PATCH", { details: "Own wording\n\n\n\nsecond paragraph" }), { params: Promise.resolve({ id: OPP, boqId }) });
    expect(res.status).toBe(200);
    expect(boqByItem("A1516").file_details).toBe("Own wording\n\nsecond paragraph");
    expect(state.changes.at(-1)!.changes!.map((c) => c.field)).toEqual(["BOQ details A1516"]);
  });
});

describe("while migration 0242 is pending", () => {
  it("the preview says a database update is needed, and the upload still creates the lines with the Narration as the name", async () => {
    state.pending = true;
    const pre = await (await previewPost(upload(xlsx(await clientWorkbook())), ctx())).json();
    expect(pre.notice).toBe("Applying this layout fully needs a database update (migration 0242)");
    expect(pre).toMatchObject({ line_count: 3, details_count: 3 });
    const res = await boqPost(upload(xlsx(await clientWorkbook())), ctx());
    expect(res.status).toBe(200);
    expect(boqByItem("A1516")).toMatchObject({ file_description: "Steel stair", file_rate: 4570 });
    expect(boqByItem("A1516")).not.toHaveProperty("file_details");
    expect(boqByItem("A1516")).not.toHaveProperty("client_data");
    expect(state.db.rows("tender_boq_sources")[0]).not.toHaveProperty("header_info");
    const shown = await (await boqGet(get(), ctx())).json();
    expect(shown.lines).toHaveLength(3);
    expect(shown.lines[0]).toMatchObject({ description: "Steel stair", details: null, client_data: null });
  });

  it("editing details says a database update is needed instead of failing silently", async () => {
    state.pending = true;
    await boqPost(upload(xlsx(await clientWorkbook())), ctx());
    const boqId = String(boqByItem("A1516").id);
    const res = await linePatch(json("PATCH", { details: "x" }), { params: Promise.resolve({ id: OPP, boqId }) });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("migration 0242");
  });
});
