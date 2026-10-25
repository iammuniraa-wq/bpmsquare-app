import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { messyWorkbook } from "@/lib/tender/boq/testing/workbooks";

// GCC tender slice 3a, four faults found live-testing it: the Lines editor kept a stale copy of the lines the BOQ had just written,
// the lines came out in text order (1.1, 1.10, 1.2), the client's units were lost, and (UI, see BondRelease.test.ts) a bond could be
// released without asking. These run the real routes against an in-memory database.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  tenantId: "t1",
  features: {} as Record<string, boolean>,
  user: { id: "u1", email: "me@t1.test" },
}));

const T1 = "t1";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: state.tenantId, userId: state.user.id, role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({}), canViewWorkcenter: () => true, canEditWorkcenter: () => true }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-26", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/changeLog", () => ({ diffForLog: () => [], diffLineItems: () => [], logChange: async () => {} }));

import { NextRequest } from "next/server";
import { GET as boqGet, POST as boqPost } from "./[id]/boq/route";
import { POST as pricePost } from "./[id]/boq/price/route";
import { GET as exportGet } from "./[id]/boq/export/route";
import { PUT as linesPut } from "./[id]/lines/route";
import { loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { boqOrderedLines } from "@/lib/tender/boq/lineSync";
import { linesVersion } from "@/lib/sales/dealLines";
import { loadWorkbook } from "@/lib/tender/boq/workbook";

const url = () => new URL("http://internal.invalid/x");
const ctx = (id = OPP) => ({ params: Promise.resolve({ id }) });
const get = (q = "") => new NextRequest(new URL(`http://internal.invalid/x${q}`), { method: "GET" });
const json = (method: "POST" | "PUT", body: unknown) => new NextRequest(url(), { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const upload = (buf: Buffer) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buf)], "client boq.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return new NextRequest(url(), { method: "POST", body: form });
};

const admin = () => ({ from: (t: string) => state.db.from(t) }) as unknown as Parameters<typeof loadOpportunityLines>[0];
const dealLines = (opp = OPP) => state.db.rows("opportunity_lines").filter((l) => l.opportunity_id === opp);
const boqRows = () => state.db.rows("tender_boq_lines").filter((l) => l.opportunity_id === OPP);

/** What the Lines editor sends: every saved line, as the page loaded it. */
const editorBody = (lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  ...extra,
  lines: lines.map((l) => ({ local_id: l.id, description: l.description, uom: l.uom ?? "Nos", qty: String(l.qty), rate: String(l.rate), discount_pct: "0" })),
});

const unitsFile = () => messyWorkbook({
  rows: [
    ["1.1", "Excavation", "m", 100, "cc1", 5],
    ["1.2", "Backfill", "no", 2, "cc2"],
    ["1.3", "Concrete", "m3", 3, "cc3"],
    ["1.4", "Survey", "lot", 1, "cc4"],
    ["1.5", "Pipe five", "m", 5, "cc5"],
    ["1.6", "Pipe six", "m", 6, "cc6"],
    ["1.7", "Pipe seven", "m", 7, "cc7"],
    ["1.8", "Pipe eight", "m", 8, "cc8"],
    ["1.9", "Pipe nine", "m", 9, "cc9"],
    ["1.10", "Pipe ten", "m", 10, "cc10"],
  ],
});

async function applyUnits() {
  const res = await boqPost(upload(await unitsFile()), ctx());
  expect(res.status).toBe(200);
}

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }],
    opportunities: [
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard deal", account_id: "acc", stage: "qualify", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Pipes for Plant 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0, probability: 25 },
    ],
    opportunity_tenders: [{ opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    opportunity_lines: [
      { id: "std-1", tenant_id: T1, opportunity_id: OPP_STD, sl_no: "1", description: "Gate", uom: "Nos", qty: 1, rate: 100, discount_pct: 0, amount: 100 },
    ],
  });
  state.tenantId = T1;
  state.features = { pipeline: true, gcc_tender: true };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("A. the Lines editor cannot overwrite what the BOQ wrote", () => {
  it("refuses a save made from lines that are no longer the saved ones, and changes nothing", async () => {
    await applyUnits();
    const opened = dealLines();
    const version = linesVersion(opened as never);

    // The BOQ tab prices a line while the editor still holds the lines it opened.
    const first = boqRows().find((b) => b.item_no === "1.2")!;
    expect((await pricePost(json("POST", { line: first.id, source: "manual", rate: 40 }), ctx())).status).toBe(200);

    const before = JSON.stringify(dealLines());
    const res = await linesPut(json("PUT", editorBody(opened, { base_version: version })), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Reload the lines/);
    expect(body.code).toBe("lines_changed");
    expect(JSON.stringify(dealLines())).toBe(before);
    expect(dealLines()).toHaveLength(10);
  });

  it("accepts a save made from the current lines, keeps each line's link to its BOQ row, and answers with the new version", async () => {
    await applyUnits();
    const current = dealLines();
    const res = await linesPut(json("PUT", editorBody(current, { base_version: linesVersion(current as never) })), ctx());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.lines).toHaveLength(10);
    expect(j.version).toBe(linesVersion(dealLines() as never));
    // The lines were replaced by new rows; every BOQ row points at one of them, so prices and order survive.
    const ids = new Set(dealLines().map((l) => l.id));
    expect(boqRows().every((b) => typeof b.line_id === "string" && ids.has(b.line_id as string))).toBe(true);
    // The client's item numbers stay on the lines.
    expect(dealLines().map((l) => l.sl_no).sort()).toEqual(["1.1", "1.10", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9"]);
  });

  it("a re-upload also makes an old copy stale", async () => {
    await applyUnits();
    const version = linesVersion(dealLines() as never);
    const changed = await messyWorkbook({ rows: [["1.1", "Excavation", "m", 150, "cc1", 5], ["1.2", "Backfill", "no", 2, "cc2"]] });
    expect((await boqPost(upload(changed), ctx())).status).toBe(200);
    const res = await linesPut(json("PUT", editorBody(dealLines(), { base_version: version })), ctx());
    expect(res.status).toBe(409);
  });

  it("a caller that sends no version (the RFQ price apply, the API) is unchanged, even on a BOQ deal", async () => {
    await applyUnits();
    const res = await linesPut(json("PUT", editorBody(dealLines())), ctx());
    expect(res.status).toBe(200);
  });

  it("a standard deal behaves exactly as before: any version is ignored, nothing is checked", async () => {
    const lines = dealLines(OPP_STD);
    const res = await linesPut(json("PUT", editorBody(lines, { base_version: "not-the-version" })), ctx(OPP_STD));
    expect(res.status).toBe(200);
    expect(dealLines(OPP_STD)).toHaveLength(1);
    // And a standard deal's response still carries its lines.
    expect((await res.json()).lines).toHaveLength(1);
  });

  it("the page reloads the editor when the server's lines change (the editor is remounted from the fresh lines)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx", "utf8");
    expect(src).toMatch(/base_version: baseVersion/);
    expect(src).toMatch(/key=\{editorKey\}/);
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(linesVersion === baseVersion\)/);
    expect(src).toMatch(/adoptServerLines\(\);/);
    // Unsaved edits are never replaced silently; the person chooses.
    expect(src).toMatch(/if \(linesDirty\) \{ setServerMoved\(true\); return; \}/);
    expect(src).toMatch(/onLinesChanged=\{\(\) => router\.refresh\(\)\}/);
  });
});

describe("B. the lines follow the order of the client's file", () => {
  it("1.1, 1.2 ... 1.10 come out in that order, not as text", async () => {
    await applyUnits();
    const loaded = await loadOpportunityLines(admin(), T1, OPP);
    expect(loaded.map((l) => l.sl_no)).toEqual(["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10"]);
  });

  it("a file with mixed item formats keeps the file's own sequence in the editor list, the BOQ list and both exports", async () => {
    const file = await messyWorkbook({
      rows: [
        ["B.3", "Pipe", "m", 1, "c1", 4],
        ["A", "Mobilisation", "lot", 1, "c2"],
        ["10", "Ten", "no", 2, "c3"],
        ["2", "Two", "no", 3, "c4"],
        ["1.1", "One point one", "m", 4, "c5"],
        ["1.1.2", "Deeper", "m", 5, "c6"],
        ["3", "Three", "no", 6, "c7"],
      ],
    });
    expect((await boqPost(upload(file), ctx())).status).toBe(200);
    const fileOrder = ["B.3", "A", "10", "2", "1.1", "1.1.2", "3"];

    // The Lines editor: what the page and the editor's save answer.
    const ordered = await boqOrderedLines(admin(), T1, OPP, await loadOpportunityLines(admin(), T1, OPP));
    expect(ordered.map((l) => l.sl_no)).toEqual(fileOrder);

    // The BOQ tab.
    const state1 = await (await boqGet(get(), ctx())).json();
    expect(state1.lines.map((l: { item_no: string }) => l.item_no)).toEqual(fileOrder);

    // The answer sheet.
    const answer = await loadWorkbook(new Uint8Array(Buffer.from(await (await exportGet(get("?kind=answer"), ctx())).arrayBuffer())));
    const items: string[] = [];
    answer.worksheets[0].eachRow((row) => { const v = String(row.getCell(1).value ?? ""); if (fileOrder.includes(v)) items.push(v); });
    expect(items).toEqual(fileOrder);

    // The priced file keeps the client's own rows where they were.
    const priced = await loadWorkbook(new Uint8Array(Buffer.from(await (await exportGet(get("?kind=priced"), ctx())).arrayBuffer())));
    const sheet = priced.getWorksheet("BOQ Bill 1")!;
    expect([7, 8, 9, 10, 11, 12, 13].map((r) => String(sheet.getRow(r).getCell(1).value))).toEqual(fileOrder);
  });

  it("the order survives a save from the Lines editor", async () => {
    await applyUnits();
    const current = dealLines();
    const res = await linesPut(json("PUT", editorBody(current, { base_version: linesVersion(current as never) })), ctx());
    const j = await res.json();
    expect(j.lines.map((l: { sl_no: string }) => l.sl_no)).toEqual(["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10"]);
  });

  it("a re-upload's diff lists lines in the file's order", async () => {
    await applyUnits();
    const changed = await messyWorkbook({
      rows: Array.from({ length: 10 }, (_, i) => [`1.${i + 1}`, i === 1 ? "Backfill changed" : `Pipe ${i + 1}`, "m", i + 1, `cc${i + 1}`]),
    });
    const form = new FormData();
    form.set("file", new File([new Uint8Array(changed)], "client boq.xlsx"));
    const { POST: previewPost } = await import("./[id]/boq/preview/route");
    const j = await (await previewPost(new NextRequest(url(), { method: "POST", body: form }), ctx())).json();
    expect(j.diff.changed_items.length).toBeGreaterThan(0);
    const items = j.diff.changed_items.map((x: { item: string }) => x.item.split(" ")[0]);
    const sorted = [...items].sort((a: string, b: string) => a.localeCompare(b, "en", { numeric: true }));
    expect(items).toEqual(sorted);
  });
});

describe("C. the client's units are kept", () => {
  it("the BOQ unit is carried to the deal line and shown as the client wrote it", async () => {
    await applyUnits();
    expect(dealLines().map((l) => l.uom)).toEqual(["m", "no", "m3", "lot", "m", "m", "m", "m", "m", "m"]);
    const s = await (await boqGet(get(), ctx())).json();
    expect(s.lines.slice(0, 4).map((l: { uom: string }) => l.uom)).toEqual(["m", "no", "m3", "lot"]);
  });

  it("an editor save that maps a unit to a standard one does not change the client's text in the answer sheet or the priced file", async () => {
    await applyUnits();
    // The editor maps "m" to the metre option and "no" to Nos on load; saving writes those to the deal line.
    const lines = dealLines().map((l) => ({ ...l, uom: l.uom === "m" ? "Mtr" : l.uom === "no" ? "Nos" : l.uom }));
    const res = await linesPut(json("PUT", editorBody(lines, { base_version: linesVersion(dealLines() as never) })), ctx());
    expect(res.status).toBe(200);
    expect(dealLines().find((l) => l.sl_no === "1.1")!.uom).toBe("Mtr");
    // The BOQ tab and the answer sheet still say what the client's file said.
    const s = await (await boqGet(get(), ctx())).json();
    expect(s.lines.slice(0, 4).map((l: { uom: string }) => l.uom)).toEqual(["m", "no", "m3", "lot"]);
    const answer = await loadWorkbook(new Uint8Array(Buffer.from(await (await exportGet(get("?kind=answer"), ctx())).arrayBuffer())));
    const units: string[] = [];
    answer.worksheets[0].eachRow((row) => { if (["1.1", "1.2", "1.3", "1.4"].includes(String(row.getCell(1).value))) units.push(String(row.getCell(3).value)); });
    expect(units).toEqual(["m", "no", "m3", "lot"]);
    // The priced file is the client's own file: its unit cells are untouched.
    const priced = await loadWorkbook(new Uint8Array(Buffer.from(await (await exportGet(get("?kind=priced"), ctx())).arrayBuffer())));
    const sheet = priced.getWorksheet("BOQ Bill 1")!;
    expect([7, 8, 9, 10].map((r) => String(sheet.getRow(r).getCell(3).value))).toEqual(["m", "no", "m3", "lot"]);
  });
});
