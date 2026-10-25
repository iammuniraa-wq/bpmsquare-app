import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { messyWorkbook } from "@/lib/tender/boq/testing/workbooks";

// GCC tender deals, slice 3a: the BOQ routes against an in-memory database. The questions asked are the ones the brief lists:
// the flag off is a 404 that touches no table, another workspace cannot reach a deal's BOQ or borrow its prices, a re-upload
// updates by item number and never silently drops a priced line, a stale price is never applied unless chosen knowingly, a price
// cannot be forged from the request, and the priced file carries rates but no cost.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  tenantId: "t1",
  features: {} as Record<string, boolean>,
  view: true,
  edit: true,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
}));

const T1 = "t1";
const T2 = "t2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const WON1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const WON_T2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const TODAY = "2026-10-26";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: state.tenantId, userId: state.user.id, role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: () => state.view,
  canEditWorkcenter: () => state.edit,
}));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => TODAY, tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));

import { NextRequest } from "next/server";
import { GET as boqGet, POST as boqPost } from "./[id]/boq/route";
import { POST as previewPost } from "./[id]/boq/preview/route";
import { GET as candGet } from "./[id]/boq/candidates/route";
import { POST as pricePost } from "./[id]/boq/price/route";
import { GET as exportGet } from "./[id]/boq/export/route";
import { loadWorkbook, sheetNames } from "@/lib/tender/boq/workbook";

const url = (q = "") => new URL(`http://internal.invalid/x${q}`);
const ctx = (id = OPP) => ({ params: Promise.resolve({ id }) });
const get = (q = "") => new NextRequest(url(q), { method: "GET" });
const jpost = (body: unknown) => new NextRequest(url(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const xlsx = (buf: Buffer, name = "ARB-4400123 BOQ.xlsx") => new File([new Uint8Array(buf)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const upload = (file: File, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.set("file", file);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return new NextRequest(url(), { method: "POST", body: form });
};

const lines = () => state.db.rows("opportunity_lines").filter((l) => l.opportunity_id === OPP);
const boqRows = () => state.db.rows("tender_boq_lines").filter((l) => l.opportunity_id === OPP);
const boqByItem = (item: string) => boqRows().find((b) => b.item_no === item)!;
const lineOf = (item: string) => lines().find((l) => l.id === boqByItem(item).line_id)!;
const boqTables = () => state.touched.filter((t) => t.startsWith("tender_boq") || t === "opportunity_lines");

async function applyFirst() {
  const res = await boqPost(upload(xlsx(await messyWorkbook())), ctx());
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }, { id: T2, config: {} }],
    opportunities: [
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard deal", account_id: "acc", stage: "qualify", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Pipes for Plant 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0, probability: 25 },
      { id: OPP_T2, tenant_id: T2, ref: "OPP-3", title: "Other tenant tender", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "x", team: [], amount: 0 },
      { id: WON1, tenant_id: T1, ref: "OPP-9", title: "Won tender", account_id: "acc", stage: "awarded", outcome: "won", closed_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" },
      { id: WON_T2, tenant_id: T2, ref: "OPP-8", title: "Other tenant won", account_id: "acc", stage: "awarded", outcome: "won", closed_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-4400123", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: OPP_T2, tenant_id: T2, tender_no: "T2-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: WON1, tenant_id: T1, tender_no: "ARB-2025-77", reminders_sent: [], addenda_count: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { opportunity_id: WON_T2, tenant_id: T2, tender_no: "T2-OLD", reminders_sent: [], addenda_count: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ],
  });
  state.tenantId = T1;
  state.features = { pipeline: true, gcc_tender: true };
  state.view = true; state.edit = true;
  state.touched = []; state.changes = [];
  state.user = { id: "u1", email: "me@t1.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("flag off, other workspace, view-only", () => {
  it("with gcc_tender off every route is a 404 and no table is touched", async () => {
    state.features = { pipeline: true };
    const file = xlsx(await messyWorkbook());
    const answers = [
      await boqGet(get(), ctx()), await boqPost(upload(file), ctx()), await previewPost(upload(file), ctx()),
      await candGet(get("?line=cccccccc-cccc-4ccc-8ccc-cccccccccccc"), ctx()), await pricePost(jpost({ all: true }), ctx()), await exportGet(get("?kind=priced"), ctx()),
    ];
    expect(answers.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(state.touched).toEqual([]);
    expect(state.db.rows("tender_boq_sources")).toEqual([]);
  });

  it("without the Pipeline module it is a 404 too", async () => {
    state.features = { gcc_tender: true };
    expect((await boqGet(get(), ctx())).status).toBe(404);
    expect(state.touched).toEqual([]);
  });

  it("a standard deal (no tender row) has no BOQ", async () => {
    expect((await boqGet(get(), ctx(OPP_STD))).status).toBe(404);
    expect((await boqPost(upload(xlsx(await messyWorkbook())), ctx(OPP_STD))).status).toBe(404);
    expect(state.db.rows("tender_boq_sources")).toEqual([]);
    expect(state.db.rows("opportunity_lines")).toEqual([]);
  });

  it("a user of another workspace cannot reach, upload to, price or download a deal's BOQ", async () => {
    await applyFirst();
    const boqId = String(boqByItem("A.1").id);
    state.tenantId = T2;
    const answers = [
      await boqGet(get(), ctx(OPP)), await boqPost(upload(xlsx(await messyWorkbook())), ctx(OPP)), await candGet(get(`?line=${boqId}`), ctx(OPP)),
      await pricePost(jpost({ line: boqId, source: "manual", rate: 1 }), ctx(OPP)), await exportGet(get("?kind=priced"), ctx(OPP)),
    ];
    expect(answers.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(lines()).toHaveLength(4);
    expect(Number(lineOf("A.1").rate)).toBe(0);
  });

  it("a person who can only view the Pipeline reads the BOQ but cannot change it", async () => {
    await applyFirst();
    state.edit = false;
    expect((await boqGet(get(), ctx())).status).toBe(200);
    expect((await boqPost(upload(xlsx(await messyWorkbook())), ctx())).status).toBe(403);
    expect((await pricePost(jpost({ all: true }), ctx())).status).toBe(403);
    expect((await previewPost(upload(xlsx(await messyWorkbook())), ctx())).status).toBe(403);
    state.view = false;
    expect((await boqGet(get(), ctx())).status).toBe(404);
  });

  it("with migration 0223 pending the BOQ answers 'pending' and the upload says a database update is needed", async () => {
    state.db.missing.add("tender_boq_sources");
    state.db.missing.add("tender_boq_lines");
    const got = await (await boqGet(get(), ctx())).json();
    expect(got.pending).toBe(true);
    const res = await boqPost(upload(xlsx(await messyWorkbook())), ctx());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/0223/);
    expect(lines()).toEqual([]);
    expect(state.db.objectsIn("tender-boq-files")).toEqual([]);
  });
});

describe("uploading the client's BOQ", () => {
  it("the preview says what it found and writes nothing", async () => {
    const res = await previewPost(upload(xlsx(await messyWorkbook())), ctx());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ sheet: "BOQ Bill 1", header_row: 6, needs_mapping: false, line_count: 4, total_row: 15, diff: null });
    expect(j.map).toEqual({ item_no: 1, description: 2, uom: 3, qty: 4, cost_code: 5, rate: 6, amount: 7 });
    expect(j.columns.added).toBe(false);
    expect(lines()).toEqual([]);
    expect(state.db.rows("tender_boq_sources")).toEqual([]);
    expect(state.db.objectsIn("tender-boq-files")).toEqual([]);
  });

  it("creates the deal lines, keeps the client's item number and cost code, and prices a line the client already priced", async () => {
    const out = await applyFirst();
    expect(out).toMatchObject({ line_count: 4, added: 4, priced_from_file: 1 });
    expect(lines().map((l) => [l.sl_no, l.qty, l.rate, l.tenant_id])).toEqual([["A.1", 1200, 0, T1], ["A.2", 850.5, 18.5, T1], ["B.1", 2500, 0, T1], ["B.2", 1, 0, T1]]);
    expect(boqRows().map((b) => [b.item_no, b.cost_code, b.row_no, b.tenant_id])).toEqual([["A.1", "31 23 16", 8, T1], ["A.2", "31 23 23", 9, T1], ["B.1", "33 11 13", 13, T1], ["B.2", "01 71 23", 14, T1]]);
    expect(boqByItem("A.2")).toMatchObject({ price_source: "boq_rate", price_as_of: TODAY });
    const src = state.db.rows("tender_boq_sources")[0];
    expect(src).toMatchObject({ tenant_id: T1, opportunity_id: OPP, sheet_name: "BOQ Bill 1", header_row: 6, is_current: true, version: 1, rate_col: 6, amount_col: 7, added_columns: false, total_row: 15, line_count: 4 });
    expect(String(src.storage_path).startsWith(`${T1}/${OPP}/`)).toBe(true);
    expect(state.db.objectsIn("tender-boq-files")).toHaveLength(1);
    expect(state.changes.some((c) => c.objectType === "opportunity_tenders" && c.changes?.[0].field === "BOQ upload")).toBe(true);
    // The deal amount follows the lines.
    expect(Number(state.db.rows("opportunities").find((o) => o.id === OPP)!.amount)).toBe(15734.25);
  });

  it("refuses a file that is not an Excel workbook, whatever it is called", async () => {
    const res = await boqPost(upload(new File([new TextEncoder().encode("<html><script>alert(1)</script></html>")], "boq.xlsx")), ctx());
    expect(res.status).toBe(422);
    expect(lines()).toEqual([]);
    const pdf = await boqPost(upload(new File([new TextEncoder().encode("%PDF-1.4\n%%EOF")], "boq.pdf")), ctx());
    expect(pdf.status).toBe(422);
  });

  it("a sheet with no recognisable header asks for the mapping instead of guessing, and the mapping panel's choice is used", async () => {
    const wb = await messyWorkbook({ rows: [] });
    // Rewrite the header so nothing is recognised.
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(wb as unknown as ArrayBuffer);
    const ws = book.getWorksheet("BOQ Bill 1")!;
    ws.getRow(6).values = ["A", "B", "C", "D"];
    ws.getRow(7).values = ["1", "Bolts", "no", 10];
    ws.getRow(8).values = ["2", "Nuts", "no", 20];
    const odd = Buffer.from(await book.xlsx.writeBuffer());
    const first = await (await previewPost(upload(xlsx(odd)), ctx())).json();
    expect(first.needs_mapping).toBe(true);
    expect((await boqPost(upload(xlsx(odd)), ctx())).status).toBe(422);
    const fixed = { sheet: "BOQ Bill 1", header_row: "6", map: JSON.stringify({ item_no: 1, description: 2, uom: 3, qty: 4 }) };
    const res = await boqPost(upload(xlsx(odd), fixed), ctx());
    expect(res.status).toBe(200);
    expect(lines().map((l) => l.description)).toEqual(["Bolts", "Nuts"]);
    // Rate and amount columns do not exist in that file: they are added after the last used column, and the source says so.
    expect(state.db.rows("tender_boq_sources")[0]).toMatchObject({ added_columns: true, rate_col: 5, amount_col: 6 });
    // A bad map is refused whole.
    expect((await boqPost(upload(xlsx(odd), { ...fixed, map: JSON.stringify({ description: 2, qty: 2 }) }), ctx())).status).toBe(422);
  });
});

describe("re-uploading a revised BOQ", () => {
  const revised = (rows: (string | number | null)[][]) => messyWorkbook({ rows });

  it("updates by item number, adds new lines, and never duplicates", async () => {
    await applyFirst();
    const idsBefore = lines().map((l) => l.id);
    const rev = await revised([
      ["A.1", "Excavation in ordinary soil", "m3", 1300, "31 23 16"],
      ["A.2", "Backfill with selected material", "m3", 850.5, "31 23 23", 18.5],
      ["B.1", "Supply and lay 24\" carbon steel pipe", "m", 2500, "33 11 13"],
      ["B.2", "Total station survey of the route", "ls", 1, "01 71 23"],
      ["C.1", "Hydrotest", "ls", 1, "33 08 00"],
    ]);
    const prev = await (await previewPost(upload(xlsx(rev)), ctx())).json();
    expect(prev.diff).toMatchObject({ added: 1, changed: 1, unchanged: 3, dropped: 0, kept: 0 });
    expect(prev.diff.changed_items).toEqual([{ item: "A.1 Excavation in ordinary soil", fields: ["quantity"] }]);
    expect(lines()).toHaveLength(4);

    const res = await boqPost(upload(xlsx(rev)), ctx());
    expect(await res.json()).toMatchObject({ added: 1, changed: 1, dropped: 0, kept: 0 });
    expect(lines()).toHaveLength(5);
    expect(lines().filter((l) => l.sl_no === "A.1")).toHaveLength(1);
    expect(lineOf("A.1").id).toBe(idsBefore[0]); // the same deal line, updated
    expect(Number(lineOf("A.1").qty)).toBe(1300);
    expect(boqRows().filter((b) => b.item_no === "A.1")).toHaveLength(1);
    const sources = state.db.rows("tender_boq_sources");
    expect(sources.map((s) => [s.version, s.is_current])).toEqual([[1, false], [2, true]]);
    expect(boqByItem("A.1").source_id).toBe(sources[1].id);
  });

  it("a line that left the file is removed when unpriced and KEPT, flagged, when priced", async () => {
    await applyFirst();
    expect((await pricePost(jpost({ line: boqByItem("B.1").id, source: "manual", rate: 300 }), ctx())).status).toBe(200);
    const rev = await revised([
      ["A.1", "Excavation in ordinary soil", "m3", 1200, "31 23 16"],
      ["A.2", "Backfill with selected material", "m3", 850.5, "31 23 23", 18.5],
    ]);
    const prev = await (await previewPost(upload(xlsx(rev)), ctx())).json();
    expect(prev.diff).toMatchObject({ dropped: 1, kept: 1 });
    expect(prev.diff.kept_items[0]).toMatch(/B\.1/);
    await boqPost(upload(xlsx(rev)), ctx());
    expect(lines().map((l) => l.sl_no).sort()).toEqual(["A.1", "A.2", "B.1"]);
    expect(Number(lineOf("B.1").rate)).toBe(300); // the priced line and its rate are untouched
    expect(boqByItem("B.1").removed_in_revision).toBe(true);
    expect(boqRows().some((b) => b.item_no === "B.2")).toBe(false);
    const shown = await (await boqGet(get(), ctx())).json();
    expect(shown.lines.filter((l: { removed: boolean }) => l.removed).map((l: { item_no: string }) => l.item_no)).toEqual(["B.1"]);
    expect(shown.totals.lines).toBe(2);
  });

  it("a person's edit of a deal line survives a revised file that did not change that line", async () => {
    await applyFirst();
    lineOf("A.1").description = "Excavation (our wording)";
    await boqPost(upload(xlsx(await revised([
      ["A.1", "Excavation in ordinary soil", "m3", 1200, "31 23 16"],
      ["A.2", "Backfill with selected material", "m3", 850.5, "31 23 23", 18.5],
      ["B.1", "Supply and lay 24\" carbon steel pipe", "m", 2500, "33 11 13"],
      ["B.2", "Total station survey of the route", "ls", 1, "01 71 23"],
    ]))), ctx());
    expect(lineOf("A.1").description).toBe("Excavation (our wording)");
  });

  it("finds its deal lines again after the Lines editor re-saved them (new ids, sequence numbers)", async () => {
    await applyFirst();
    await pricePost(jpost({ line: boqByItem("B.1").id, source: "manual", rate: 300 }), ctx());
    // The editor deletes and re-inserts every line: new ids, sl_no 1..n.
    const old = lines().map((l) => ({ ...l }));
    state.db.tables.opportunity_lines = state.db.rows("opportunity_lines").filter((l) => l.opportunity_id !== OPP);
    old.forEach((l, i) => state.db.rows("opportunity_lines").push({ ...l, id: `ffffffff-ffff-4fff-8fff-fffffffff00${i}`, sl_no: String(i + 1) }));
    for (const b of boqRows()) b.line_id = null;
    const shown = await (await boqGet(get(), ctx())).json();
    expect(shown.lines.every((l: { linked: boolean }) => l.linked)).toBe(true);
    expect(shown.lines.find((l: { item_no: string }) => l.item_no === "B.1")).toMatchObject({ rate: 300, priced: true, price_source: "manual" });
  });
});

describe("price sources and the validity rule", () => {
  const P1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
  beforeEach(async () => {
    state.db.rows("suppliers").push({ id: "s1", tenant_id: T1, name: "Gulf Pipes" });
    state.db.rows("products").push(
      { id: P1, tenant_id: T1, name: "Supply and lay 24\" carbon steel pipe", sku: null, cost_price: 40, cost_price_as_of: "2025-11-01", supplier_id: "s1" },
      { id: "p-t2", tenant_id: T2, name: "Excavation in ordinary soil", sku: null, cost_price: 1, cost_price_as_of: TODAY, supplier_id: null },
    );
    state.db.rows("rfqs").push({ id: "r1", tenant_id: T1, ref: "RFQ-0012", title: "Pipes" });
    state.db.rows("rfq_lines").push({ id: "rl1", tenant_id: T1, rfq_id: "r1", product_id: P1 });
    state.db.rows("rfq_suppliers").push({ id: "rs1", tenant_id: T1, rfq_id: "r1", supplier_id: "s1", status: "replied" });
    state.db.rows("rfq_responses").push({ id: "rr1", tenant_id: T1, rfq_supplier_id: "rs1", rfq_line_id: "rl1", status: "quoted", unit_price: 42, fx_rate: null, submitted_at: "2026-09-01T10:00:00Z" });
    await applyFirst();
    // The pipe line is the one the product is about; the other lines have no product.
    lineOf("B.1").product_id = P1;
  });

  const cands = async (item: string) => (await (await candGet(get(`?line=${boqByItem(item).id}`), ctx())).json()) as { candidates: { source: string; ref: string; price: number; kind: string; stale: boolean; stale_text: string | null }[]; validity_days: number };

  it("offers a fresh RFQ price and a stale product cost price, each with its age, and the client's own rate", async () => {
    const j = await cands("B.1");
    expect(j.validity_days).toBe(180);
    const rfq = j.candidates.find((c) => c.ref.startsWith("RFQ-0012"))!;
    expect(rfq).toMatchObject({ source: "supplier", price: 42, kind: "cost", stale: false });
    const cost = j.candidates.find((c) => c.ref.startsWith("Cost price of"))!;
    expect(cost).toMatchObject({ source: "supplier", price: 40, stale: true });
    expect(cost.stale_text).toBe("stale, 359 days old");
    expect((await cands("A.2")).candidates).toEqual([expect.objectContaining({ source: "boq_rate", price: 18.5, kind: "sell", stale: false })]);
  });

  it("a stale price is refused unless chosen knowingly, and the knowing choice is recorded", async () => {
    const stale = (await cands("B.1")).candidates.find((c) => c.ref.startsWith("Cost price of"))!;
    const refused = await pricePost(jpost({ line: boqByItem("B.1").id, source: "supplier", ref: stale.ref }), ctx());
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toMatch(/stale, 359 days old/);
    expect(Number(lineOf("B.1").rate)).toBe(0);
    const ok = await pricePost(jpost({ line: boqByItem("B.1").id, source: "supplier", ref: stale.ref, markup_pct: 10, accept_stale: true }), ctx());
    expect(ok.status).toBe(200);
    expect(Number(lineOf("B.1").rate)).toBe(44);
    expect(Number(lineOf("B.1").amount)).toBe(110000);
    expect(boqByItem("B.1")).toMatchObject({ price_source: "supplier", price_as_of: "2025-11-01", stale_accepted: true, unit_cost: 40, markup_pct: 10 });
    const shown = await (await boqGet(get(), ctx())).json();
    expect(shown.lines.find((l: { item_no: string }) => l.item_no === "B.1")).toMatchObject({ stale: true, stale_accepted: true });
    expect(shown.totals.stale).toBe(0); // accepted knowingly is not counted as an open problem
  });

  it("a fresh price is applied with the markup on a cost", async () => {
    const fresh = (await cands("B.1")).candidates.find((c) => c.ref.startsWith("RFQ-0012"))!;
    await pricePost(jpost({ line: boqByItem("B.1").id, source: "supplier", ref: fresh.ref, markup_pct: 25 }), ctx());
    expect(Number(lineOf("B.1").rate)).toBe(52.5);
    expect(boqByItem("B.1")).toMatchObject({ stale_accepted: false, unit_cost: 42, markup_pct: 25 });
  });

  it("the price comes from the source, never from the request: a made-up offer is refused", async () => {
    const forged = await pricePost(jpost({ line: boqByItem("B.1").id, source: "supplier", ref: "RFQ-0012 · Gulf Pipes", rate: 1, price: 1 }), ctx());
    expect(forged.status).toBe(200); // a real offer, priced at ITS price, the body's rate is ignored
    expect(Number(lineOf("B.1").rate)).toBe(42);
    const fake = await pricePost(jpost({ line: boqByItem("B.1").id, source: "supplier", ref: "RFQ-9999 · Nobody" }), ctx());
    expect(fake.status).toBe(422);
    expect(Number(lineOf("B.1").rate)).toBe(42);
    expect((await pricePost(jpost({ line: boqByItem("B.1").id, source: "manual", rate: -5 }), ctx())).status).toBe(422);
    expect((await pricePost(jpost({ line: boqByItem("B.1").id, source: "gold", rate: 5 }), ctx())).status).toBe(400);
  });

  it("price all uses fresh sources only, skips lines that already have a rate, and says why it left the rest", async () => {
    const res = await pricePost(jpost({ all: true, markup_pct: 20 }), ctx());
    const j = await res.json();
    expect(j.priced).toBe(1); // B.1 from the fresh RFQ; A.2 already priced; A.1 and B.2 have no source
    expect(Number(lineOf("B.1").rate)).toBe(50.4);
    expect(Number(lineOf("A.2").rate)).toBe(18.5);
    expect(j.left_count).toBe(2);
    expect(j.left.map((x: { reason: string }) => x.reason)).toEqual(["No supplier, BOM or past-project price found", "No supplier, BOM or past-project price found"]);
  });

  it("price all does not use a stale supplier price, even when it is the only one", async () => {
    state.db.tables.rfq_responses = [];
    const j = await (await pricePost(jpost({ all: true, markup_pct: 0 }), ctx())).json();
    expect(j.priced).toBe(0);
    expect(j.left.find((x: { item: string }) => x.item.startsWith("B.1")).reason).toMatch(/Only stale prices \(newest 359 days old, limit 180\)/);
    expect(Number(lineOf("B.1").rate)).toBe(0);
  });

  it("the workspace's own validity limit decides what is stale", async () => {
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { tender: { price_validity_days: 20 } };
    const j = await cands("B.1");
    expect(j.validity_days).toBe(20);
    expect(j.candidates.find((c) => c.ref.startsWith("RFQ-0012"))!.stale).toBe(true); // 55 days old
  });

  it("past project: the last awarded tender line of THIS workspace with the same cost code, and nothing from another workspace", async () => {
    state.db.rows("opportunity_lines").push(
      { id: "wl1", tenant_id: T1, opportunity_id: WON1, description: "Excavation, ordinary", rate: 21, product_id: null },
      { id: "wl2", tenant_id: T2, opportunity_id: WON_T2, description: "Excavation, ordinary", rate: 999, product_id: null },
    );
    state.db.rows("tender_boq_lines").push(
      { id: "wb1", tenant_id: T1, opportunity_id: WON1, line_id: "wl1", cost_code: "31 23 16", item_key: "n:1", row_no: 1 },
      { id: "wb2", tenant_id: T2, opportunity_id: WON_T2, line_id: "wl2", cost_code: "31 23 16", item_key: "n:1", row_no: 1 },
    );
    const j = await cands("A.1");
    const past = j.candidates.filter((c) => c.source === "past_project");
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({ price: 21, kind: "sell", stale: false, ref: "OPP-9 · ARB-2025-77" });
    // And a selling price is used as it is.
    await pricePost(jpost({ line: boqByItem("A.1").id, source: "past_project", ref: past[0].ref, markup_pct: 50 }), ctx());
    expect(Number(lineOf("A.1").rate)).toBe(21);
    expect(boqByItem("A.1")).toMatchObject({ price_source: "past_project", unit_cost: null, markup_pct: null });
  });

  it("an open deal is never a past project, and neither is this one", async () => {
    state.db.rows("opportunities").find((o) => o.id === WON1)!.outcome = "open";
    state.db.rows("opportunity_lines").push({ id: "wl1", tenant_id: T1, opportunity_id: WON1, description: "Excavation, ordinary", rate: 21, product_id: null });
    state.db.rows("tender_boq_lines").push({ id: "wb1", tenant_id: T1, opportunity_id: WON1, line_id: "wl1", cost_code: "31 23 16", item_key: "n:1", row_no: 1 });
    expect((await cands("A.1")).candidates.filter((c) => c.source === "past_project")).toEqual([]);
  });

  it("a BOQ line id of another deal is not found through this deal", async () => {
    const other = "cccccccc-cccc-4ccc-8ccc-cccccccccc99";
    state.db.rows("opportunities").push({ id: other, tenant_id: T1, ref: "OPP-7", title: "Second tender", account_id: "acc", stage: "estimating", outcome: "open" });
    state.db.rows("opportunity_tenders").push({ opportunity_id: other, tenant_id: T1, tender_no: "X", reminders_sent: [], addenda_count: 0 });
    expect((await candGet(get(`?line=${boqByItem("A.1").id}`), ctx(other))).status).toBe(404);
    expect((await pricePost(jpost({ line: boqByItem("A.1").id, source: "manual", rate: 5 }), ctx(other))).status).toBe(404);
  });
});

describe("the files that go out", () => {
  const read = async (res: Response) => loadWorkbook(new Uint8Array(await res.arrayBuffer()));

  it("the priced BOQ is the client's file with our rate and amount in it, and no cost anywhere", async () => {
    await applyFirst();
    const P = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
    state.db.rows("products").push({ id: P, tenant_id: T1, name: "Supply and lay 24\" carbon steel pipe", sku: null, cost_price: 123.45, cost_price_as_of: TODAY, supplier_id: null });
    const pipe = lineOf("B.1");
    pipe.product_id = P;
    const cand = (await (await candGet(get(`?line=${boqByItem("B.1").id}`), ctx())).json()).candidates.find((c: { source: string }) => c.source === "supplier");
    await pricePost(jpost({ line: boqByItem("B.1").id, source: "supplier", ref: cand.ref, markup_pct: 30 }), ctx());
    expect(Number(lineOf("B.1").rate)).toBe(160.49);
    await pricePost(jpost({ line: boqByItem("A.1").id, source: "manual", rate: 20 }), ctx());

    const res = await exportGet(get("?kind=priced"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename=".*priced\.xlsx"/);
    expect(res.headers.get("x-unpriced-count")).toBe("1"); // B.2
    const wb = await read(res);
    expect(sheetNames(wb)).toEqual(["BOQ Bill 1", "Notes"]);
    const ws = wb.getWorksheet("BOQ Bill 1")!;
    expect(ws.getCell("F8").value).toBe(20);
    expect(ws.getCell("G8").value).toBe(24000);
    expect(ws.getCell("F13").value).toBe(160.49);
    expect(ws.getCell("F9").value).toBe(18.5);
    expect(ws.getCell("F14").value == null).toBe(true); // unpriced: blank
    expect(ws.getCell("A1").isMerged).toBe(true);
    // The client's own total formula is kept (it recalculates on open), with the new sum as its result.
    expect(ws.getCell("G15").value).toMatchObject({ formula: "SUM(G8:G14)", result: 24000 + 15734.25 + 160.49 * 2500 });
    // No cost, markup or margin in any cell of the file we hand back.
    const all = JSON.stringify(wb.worksheets.map((w) => w.getSheetValues()));
    expect(all).not.toContain("123.45");
    expect(all).not.toMatch(/markup|margin|unit_cost|"cost"/i);
  });

  it("the answer sheet lists the lines with rates and marks the unpriced ones", async () => {
    await applyFirst();
    const res = await exportGet(get("?kind=answer"), ctx());
    expect(res.status).toBe(200);
    const ws = (await read(res)).getWorksheet("Answer sheet")!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Item", "Description", "Unit", "Quantity", "Unit rate", "Amount", "Notes"]);
    expect(ws.getCell("A3").value).toBe("A.2");
    expect(ws.getCell("E3").value).toBe(18.5);
    expect(ws.getCell("G2").value).toBe("Not priced");
    expect((await exportGet(get("?kind=other"), ctx())).status).toBe(400);
  });

  it("before anything is uploaded there is nothing to download", async () => {
    expect((await exportGet(get("?kind=priced"), ctx())).status).toBe(404);
    expect((await exportGet(get("?kind=answer"), ctx())).status).toBe(404);
  });

  it("the Lines tab editor cannot save a deal that has more lines than it keeps (it would delete the rest)", async () => {
    const { PUT } = await import("./[id]/lines/route");
    for (let i = 0; i < 201; i++) state.db.rows("opportunity_lines").push({ id: `big${i}`, tenant_id: T1, opportunity_id: OPP, sl_no: String(i), description: `L${i}`, qty: 1, rate: 0, amount: 0 });
    const res = await PUT(jpost({ lines: [{ description: "one" }] }), ctx());
    expect(res.status).toBe(409);
    expect(lines()).toHaveLength(201);
  });
});
