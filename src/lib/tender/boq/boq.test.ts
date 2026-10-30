import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { assignKeys, colLetter, detectColumns, detectLayout, extractLines, parseColumnMap, parseNumber, planColumns, sameLayout, type Grid } from "./parse";
import { diffBoq, diffSummary, type ExistingLine } from "./diff";
import { AUTO_PRIORITY, ageDays, isStale, parseValidityDays, pickAuto, rateFor, refuseCandidate, staleText, type Candidate } from "./price";
import { loadWorkbook, sheetNames, sheetToGrid } from "./workbook";
import { buildAnswerSheet, writePricedWorkbook, type WritePlan } from "./write";

// GCC tender deals, slice 3a: the pure rules. Reading a messy client sheet, matching a revised one against the deal, choosing a
// price source and its age limit, and writing numbers back into the client's own workbook without disturbing it.

/** A client BOQ the way they really arrive: a merged title block, blank rows, a header in row 6, section headings, a subtotal, a grand total. */
async function messyWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ Bill 1");
  ws.mergeCells("A1:H1"); ws.getCell("A1").value = "SAUDI ARAMCO - PIPELINE PACKAGE 4";
  ws.mergeCells("A2:H2"); ws.getCell("A2").value = "BILL OF QUANTITIES - Tender ARB-4400123";
  ws.getCell("A3").value = "Prices in SAR, excluding VAT";
  ws.getRow(6).values = ["Item No.", "Description of Works", "Unit", "Qty", "Cost Code", "Unit Rate (SAR)", "Amount (SAR)"];
  ws.getRow(6).font = { bold: true };
  ws.getRow(6).getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  ws.getRow(7).values = ["", "SECTION A - EARTHWORKS"];
  ws.getRow(8).values = ["A.1", "Excavation in ordinary soil", "m3", 1200, "31 23 16", null, null];
  ws.getRow(9).values = ["A.2", "Backfill with selected material", "m3", 850.5, "31 23 23", 18.5, null];
  ws.getRow(10).values = [];
  ws.getRow(11).values = ["", "Sub-total Section A"];
  ws.getRow(12).values = ["", "SECTION B - PIPEWORK"];
  ws.getRow(13).values = ["B.1", "Supply and lay 24\" carbon steel pipe", "m", 2500, "33 11 13"];
  ws.getRow(14).values = ["B.2", "Total station survey of the route", "ls", 1, "01 71 23"];
  ws.getRow(15).values = ["", "Grand Total"];
  ws.getCell("G9").value = { formula: "D9*F9", result: 15734.25 };
  ws.getCell("G15").value = { formula: "SUM(G8:G14)", result: 0 };
  ws.getColumn(2).width = 48;
  const other = wb.addWorksheet("Notes");
  other.getCell("A1").value = "Keep this sheet";
  other.getCell("B2").value = { formula: "A1&\"!\"", result: "Keep this sheet!" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("header and column detection", () => {
  it("finds the header under a merged title block and maps every column", async () => {
    const wb = await loadWorkbook(await messyWorkbook());
    const grid = sheetToGrid(wb.getWorksheet("BOQ Bill 1")!);
    const layout = detectLayout(grid);
    expect(layout.headerRow).toBe(6);
    expect(layout.map).toEqual({ item_no: 1, description: 2, uom: 3, qty: 4, cost_code: 5, rate: 6, amount: 7 });
  });

  it("reads the lines, skipping headings, blank rows, subtotals and the grand total, and finds the client's total row", async () => {
    const wb = await loadWorkbook(await messyWorkbook());
    const grid = sheetToGrid(wb.getWorksheet("BOQ Bill 1")!);
    const { headerRow, map } = detectLayout(grid);
    const parsed = extractLines(grid, headerRow!, map);
    expect(parsed.lines.map((l) => [l.row_no, l.item_no, l.qty, l.cost_code])).toEqual([
      [8, "A.1", 1200, "31 23 16"], [9, "A.2", 850.5, "31 23 23"], [13, "B.1", 2500, "33 11 13"], [14, "B.2", 1, "01 71 23"],
    ]);
    // "Total station survey" is an item, not a total.
    expect(parsed.lines.find((l) => l.item_no === "B.2")?.description).toBe("Total station survey of the route");
    expect(parsed.lines[1].file_rate).toBe(18.5);
    expect(parsed.lines[0].file_rate).toBeNull();
    expect(parsed.total_row).toBe(15);
    expect(parsed.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining(["Heading (no quantity)", "Total row"]));
    expect(parsed.skipped.some((s) => s.text.includes("Sub-total"))).toBe(true);
  });

  it("a sheet with no recognisable header says so instead of guessing", () => {
    const grid: Grid = [["Some notes"], [null, "random", 4, 5], ["more", 1, 2, 3]];
    expect(detectLayout(grid)).toEqual({ headerRow: null, map: {}, labels: [] });
  });

  it("knows the usual spellings, currency suffixes and bilingual headers", () => {
    const m = detectColumns(["S. No", "Item Description / الوصف", "UOM", "Quantity", "Rate (QAR)", "Total Amount (QAR)", "CSI Code"]).map;
    expect(m).toEqual({ item_no: 1, description: 2, uom: 3, qty: 4, rate: 5, amount: 6, cost_code: 7 });
    expect(detectColumns(["Sl.", "Particulars", "Unit", "Qty."]).map).toEqual({ item_no: 1, description: 2, uom: 3, qty: 4 });
  });

  it("reuses a saved layout only when the header texts still match", () => {
    const grid: Grid = [["Item", "Description", "Qty"], ["1", "x", 1]];
    expect(sameLayout(grid, 1, ["Item", "Description", "Qty"])).toBe(true);
    expect(sameLayout(grid, 1, ["Item", "Description of works", "Qty"])).toBe(false);
    expect(sameLayout(grid, 1, [])).toBe(false);
  });

  it("reads numbers the way people type them", () => {
    expect(parseNumber("1,250.50")).toBe(1250.5);
    expect(parseNumber("12 ")).toBe(12);
    expect(parseNumber("n/a")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(colLetter(1)).toBe("A");
    expect(colLetter(27)).toBe("AA");
  });

  it("a mapping from the fix-the-mapping panel needs description and quantity, and a column once", () => {
    expect(parseColumnMap({ description: 2, qty: 4, item_no: 1 })).toEqual({ description: 2, qty: 4, item_no: 1 });
    expect(parseColumnMap({ description: 2 })).toBeNull();
    expect(parseColumnMap({ description: 2, qty: 2 })).toBeNull();
    expect(parseColumnMap({ description: 2, qty: 999 })).toBeNull();
    expect(parseColumnMap({ description: 2, qty: 3, evil: 4 })).toEqual({ description: 2, qty: 3 });
  });

  it("repeats of an item number or a description get #2, #3 in order", () => {
    const keys = assignKeys([
      { item_no: "1", description: "a", uom: null }, { item_no: "1", description: "b", uom: null },
      { item_no: null, description: "Cable  tray", uom: "m" }, { item_no: null, description: "cable tray", uom: "M" },
    ]).map((l) => l.key);
    expect(keys).toEqual(["n:1", "n:1#2", "d:cable tray|m", "d:cable tray|m#2"]);
  });

  it("plans the rate and amount columns: the client's own, else after the last used column", () => {
    const grid: Grid = [[], ["Item", "Description", "Unit", "Qty", "Cost code"]];
    expect(planColumns(grid, 2, { item_no: 1, description: 2, uom: 3, qty: 4, cost_code: 5 })).toEqual({ rate_col: 6, amount_col: 7, added: true });
    expect(planColumns(grid, 2, { description: 2, qty: 4, rate: 6, amount: 7 })).toEqual({ rate_col: 6, amount_col: 7, added: false });
    expect(planColumns(grid, 2, { description: 2, qty: 4, amount: 8 })).toEqual({ rate_col: 9, amount_col: 8, added: true });
  });
});

describe("re-uploading a revised BOQ", () => {
  const line = (key: string, over: Partial<Parameters<typeof diffBoq>[1][number]> = {}) => ({ row_no: 1, item_no: key, description: `Item ${key}`, uom: "m", qty: 10, cost_code: null, file_rate: null, key: `n:${key}`, ...over });
  const have = (key: string, over: Partial<ExistingLine> = {}): ExistingLine => ({ key: `n:${key}`, item_no: key, description: `Item ${key}`, uom: "m", qty: 10, cost_code: null, priced: false, removed: false, ...over });

  it("matches by item number: added, changed, unchanged", () => {
    const d = diffBoq([have("1"), have("2"), have("3")], [line("1"), line("2", { qty: 12 }), line("3", { description: "Item 3 (revised)" }), line("4")]);
    expect(d.unchanged).toBe(1);
    expect(d.added.map((l) => l.key)).toEqual(["n:4"]);
    expect(d.changed.map((c) => [c.key, c.fields])).toEqual([["n:2", ["quantity"]], ["n:3", ["description"]]]);
    expect(diffSummary(d)).toBe("1 added, 2 changed");
  });

  it("a line that left the file is dropped when unpriced and KEPT, flagged, when priced", () => {
    const d = diffBoq([have("1"), have("2", { priced: true }), have("3")], [line("1")]);
    expect(d.dropped.map((l) => l.key)).toEqual(["n:3"]);
    expect(d.kept.map((l) => l.key)).toEqual(["n:2"]);
    expect(diffSummary(d)).toContain("1 priced line kept");
  });

  it("a line flagged as gone earlier is not reported again, and one that comes back is a change", () => {
    const again = diffBoq([have("1", { removed: true, priced: true })], []);
    expect(again.kept).toEqual([]);
    expect(again.dropped).toEqual([]);
    const back = diffBoq([have("1", { removed: true })], [line("1")]);
    expect(back.changed[0].fields).toEqual(["back in the file"]);
  });

  it("identical files change nothing", () => {
    const d = diffBoq([have("1"), have("2")], [line("1"), line("2")]);
    expect(diffSummary(d)).toBe("No changes");
  });
});

describe("price sources and the validity rule", () => {
  const TODAY = "2026-10-26";
  const c = (source: Candidate["source"], price: number, as_of: string | null, kind: Candidate["kind"] = "cost", ref = `${source}-ref`): Candidate => ({ source, ref, label: ref, price, kind, as_of });

  it("counts days and applies the limit to supplier and past-project prices only", () => {
    expect(ageDays("2026-04-29", TODAY)).toBe(180);
    expect(isStale("supplier", "2026-04-29", TODAY, 180)).toBe(false); // exactly 180 days is still valid
    expect(isStale("supplier", "2026-04-28", TODAY, 180)).toBe(true);
    expect(isStale("past_project", "2025-01-01", TODAY, 180)).toBe(true);
    expect(isStale("bom", "2020-01-01", TODAY, 180)).toBe(false);
    expect(isStale("boq_rate", null, TODAY, 180)).toBe(false);
    expect(isStale("supplier", null, TODAY, 180)).toBe(true); // no date cannot be shown fresh
    expect(staleText("2026-03-27", TODAY)).toBe("stale, 213 days old");
    expect(staleText(null, TODAY)).toBe("stale, no date");
  });

  it("reads the workspace setting defensively", () => {
    expect(parseValidityDays(undefined)).toBe(180);
    expect(parseValidityDays(90)).toBe(90);
    expect(parseValidityDays("120")).toBe(120);
    expect(parseValidityDays(0)).toBe(180);
    expect(parseValidityDays(-5)).toBe(180);
    expect(parseValidityDays(2.5)).toBe(180);
    expect(parseValidityDays(99999)).toBe(180);
  });

  it("price all: supplier fresh first, then BOM, then past project fresh", () => {
    const all = [c("past_project", 90, "2026-10-01", "sell"), c("bom", 70, "2026-01-01"), c("supplier", 60, "2026-09-01")];
    expect(pickAuto(all, TODAY, 180).chosen?.source).toBe("supplier");
    expect(pickAuto(all.filter((x) => x.source !== "supplier"), TODAY, 180).chosen?.source).toBe("bom");
    expect(pickAuto(all.filter((x) => x.source === "past_project"), TODAY, 180).chosen?.source).toBe("past_project");
    expect(AUTO_PRIORITY).toEqual(["supplier", "bom", "past_project"]);
  });

  it("a stale supplier price is skipped for a fresh BOM one, and with nothing fresh the line stays unpriced with the reason", () => {
    const stale = c("supplier", 50, "2025-12-01");
    expect(pickAuto([stale, c("bom", 70, null)], TODAY, 180).chosen?.source).toBe("bom");
    const none = pickAuto([stale, c("past_project", 99, "2025-01-01", "sell")], TODAY, 180);
    expect(none.chosen).toBeNull();
    expect(none.reason).toMatch(/Only stale prices \(newest 329 days old, limit 180\)/);
    expect(pickAuto([], TODAY, 180).reason).toMatch(/No supplier, BOM or past-project price/);
    expect(pickAuto([c("supplier", 5, null)], TODAY, 180).reason).toMatch(/without a date/);
  });

  it("the newest supplier price wins, then the lower one; the client's own rate is never auto-picked", () => {
    const a = c("supplier", 55, "2026-08-01", "cost", "A");
    const b = c("supplier", 52, "2026-09-10", "cost", "B");
    const d = c("supplier", 51, "2026-09-10", "cost", "D");
    expect(pickAuto([a, b, d], TODAY, 180).chosen?.ref).toBe("D");
    expect(pickAuto([c("boq_rate", 10, "2026-10-26", "sell")], TODAY, 180).chosen).toBeNull();
  });

  it("a stale candidate is refused unless the person chooses it knowingly", () => {
    const stale = c("supplier", 50, "2025-12-01");
    expect(refuseCandidate(stale, TODAY, 180, false)).toMatch(/stale, 329 days old/);
    expect(refuseCandidate(stale, TODAY, 180, true)).toBeNull();
    expect(refuseCandidate(c("supplier", 0, TODAY), TODAY, 180, true)).toMatch(/no price/);
  });

  it("a cost becomes a selling rate with the markup; a selling price is used as it is", () => {
    expect(rateFor({ kind: "cost", price: 100 }, 12.5)).toBe(112.5);
    expect(rateFor({ kind: "cost", price: 100 }, 0)).toBe(100);
    expect(rateFor({ kind: "sell", price: 99.999 }, 50)).toBe(100);
    expect(rateFor({ kind: "cost", price: 10 }, Number.NaN)).toBe(10);
    expect(rateFor({ kind: "cost", price: 10 }, -20)).toBe(10);
  });
});

describe("writing the priced workbook", () => {
  const basePlan = (over: Partial<WritePlan> = {}): WritePlan => ({
    sheet: "BOQ Bill 1", header_row: 6, qty_col: 4, rate_col: 6, amount_col: 7, added: false, total_row: 15, first_row: 8, last_row: 14,
    rows: [{ row_no: 8, rate: 20, amount: 24000 }, { row_no: 9, rate: 18.5, amount: 15734.25 }, { row_no: 13, rate: 310.5, amount: 776250 }], ...over,
  });

  it("round trip: our numbers land in the client's cells and everything else is left as it was", async () => {
    const original = await messyWorkbook();
    const out = await writePricedWorkbook(original, basePlan());
    const wb = await loadWorkbook(out);
    const ws = wb.getWorksheet("BOQ Bill 1")!;
    expect(ws.getCell("F8").value).toBe(20);
    expect(ws.getCell("G8").value).toBe(24000);
    expect(ws.getCell("F13").value).toBe(310.5);
    // The client's own formula in the amount column stays a formula, with the new result.
    expect(ws.getCell("G9").value).toMatchObject({ formula: "D9*F9", result: 15734.25 });
    // Unpriced rows stay exactly as sent (blank).
    expect(ws.getCell("F14").value == null).toBe(true);
    expect(ws.getCell("G14").value == null).toBe(true);
    // The client's total keeps its formula and gets the sum.
    expect(ws.getCell("G15").value).toMatchObject({ formula: "SUM(G8:G14)", result: 24000 + 15734.25 + 776250 });
    // Formatting, merges, widths and the other sheet survive.
    expect(ws.getCell("A1").value).toBe("SAUDI ARAMCO - PIPELINE PACKAGE 4");
    expect(ws.getCell("A1").isMerged).toBe(true);
    expect(ws.getCell("D6").fill).toMatchObject({ fgColor: { argb: "FFFFFF00" } });
    expect(ws.getRow(6).font?.bold).toBe(true);
    expect(ws.getColumn(2).width).toBe(48);
    expect(sheetNames(wb)).toEqual(["BOQ Bill 1", "Notes"]);
    expect(wb.getWorksheet("Notes")!.getCell("B2").value).toMatchObject({ formula: 'A1&"!"' });
    // Recalculated when it opens.
    const { default: JSZip } = await import("jszip");
    const xml = await (await JSZip.loadAsync(out)).file("xl/workbook.xml")!.async("string");
    expect(xml).toMatch(/fullCalcOnLoad="1"/);
  });

  it("the file we wrote reads back as the same BOQ, now with its rates", async () => {
    const out = await writePricedWorkbook(await messyWorkbook(), basePlan());
    const grid = sheetToGrid((await loadWorkbook(out)).getWorksheet("BOQ Bill 1")!);
    const { headerRow, map } = detectLayout(grid);
    const parsed = extractLines(grid, headerRow!, map);
    expect(parsed.lines.map((l) => [l.item_no, l.file_rate])).toEqual([["A.1", 20], ["A.2", 18.5], ["B.1", 310.5], ["B.2", null]]);
  });

  it("a client's total that is a typed number is replaced by a SUM formula over the item rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOQ");
    ws.getRow(1).values = ["Item", "Description", "Unit", "Qty", "Rate", "Amount"];
    ws.getRow(2).values = ["1", "Pipe", "m", 10];
    ws.getRow(3).values = ["", "Total", "", "", "", 0];
    const out = await writePricedWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), {
      sheet: "BOQ", header_row: 1, qty_col: 4, rate_col: 5, amount_col: 6, added: false, total_row: 3, first_row: 2, last_row: 2, rows: [{ row_no: 2, rate: 5, amount: 50 }],
    });
    const back = (await loadWorkbook(out)).getWorksheet("BOQ")!;
    expect(back.getCell("F3").value).toMatchObject({ formula: "SUM(F2:F2)", result: 50 });
  });

  it("a file with no rate or amount column gets them after the last used column, headed and formatted like the quantity column", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getRow(1).values = ["Item", "Description", "Unit", "Qty"];
    ws.getRow(1).getCell(4).font = { bold: true, color: { argb: "FF336699" } };
    ws.getRow(2).values = ["1", "Pipe", "m", 10];
    ws.getRow(3).values = ["2", "Valve", "no", 2];
    const out = await writePricedWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), {
      sheet: "Sheet1", header_row: 1, qty_col: 4, rate_col: 5, amount_col: 6, added: true, total_row: null, first_row: 2, last_row: 3,
      rows: [{ row_no: 2, rate: 5.5, amount: 55 }],
    });
    const back = (await loadWorkbook(out)).getWorksheet("Sheet1")!;
    expect(back.getCell("E1").value).toBe("Unit rate");
    expect(back.getCell("F1").value).toBe("Amount");
    expect(back.getCell("E1").font).toMatchObject({ bold: true });
    expect(back.getCell("E2").value).toBe(5.5);
    expect(back.getCell("F2").value).toBe(55);
    expect(back.getCell("E2").numFmt).toBe("#,##0.00");
    expect(back.getCell("E3").value == null).toBe(true); // unpriced: left blank
  });

  it("a sheet that is gone is an error the route can explain", async () => {
    await expect(writePricedWorkbook(await messyWorkbook(), basePlan({ sheet: "Gone" }))).rejects.toThrow(/no longer in the file/);
  });

  it("the answer sheet is a clean list: item, description, unit, quantity, rate, amount, notes, and no cost anywhere", async () => {
    const out = await buildAnswerSheet([
      { item_no: "A.1", description: "Excavation", uom: "m3", qty: 1200, rate: 20, amount: 24000, notes: "31 23 16" },
      { item_no: null, description: "Valve", uom: "no", qty: 2, rate: null, amount: null, notes: "Not priced" },
    ], "ARB-4400123");
    const wb = await loadWorkbook(out);
    const ws = wb.getWorksheet("Answer sheet")!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Item", "Description", "Unit", "Quantity", "Unit rate", "Amount", "Notes"]);
    expect(ws.getCell("F2").value).toBe(24000);
    expect(ws.getCell("G3").value).toBe("Not priced");
    expect(ws.getCell("F4").value).toMatchObject({ result: 24000 });
    expect(JSON.stringify(ws.getSheetValues())).not.toMatch(/cost|margin|markup/i);
  });

  const terms = { name: "Standard 30/70", lines: ["Advance: 30%, on award", "Balance: 70%, on delivery"] };

  it("the chosen payment terms are printed on their own last sheet of the answer sheet and the priced file; nothing is added without a choice", async () => {
    const sheet = await loadWorkbook(await buildAnswerSheet([{ item_no: "A.1", description: "Excavation", uom: "m3", qty: 1, rate: 20, amount: 20, notes: "" }], "ARB-1", terms));
    expect(sheet.worksheets.map((w) => w.name)).toEqual(["Answer sheet", "Payment terms"]);
    const pt = sheet.getWorksheet("Payment terms")!;
    expect(pt.getCell("A1").value).toBe("Payment terms");
    expect(pt.getCell("A2").value).toBe("Standard 30/70");
    expect(pt.getCell("A4").value).toBe("Advance: 30%, on award");
    expect(pt.getCell("A5").value).toBe("Balance: 70%, on delivery");
    expect(JSON.stringify(pt.getSheetValues())).not.toMatch(/cost|margin|markup/i);

    const priced = await loadWorkbook(await writePricedWorkbook(await messyWorkbook(), basePlan({ terms })));
    expect(priced.worksheets.at(-1)!.name).toBe("Payment terms");
    expect(priced.getWorksheet("BOQ Bill 1")!.getCell("F8").value).toBe(20);

    expect((await loadWorkbook(await buildAnswerSheet([], "ARB-1"))).worksheets.map((w) => w.name)).toEqual(["Answer sheet"]);
    expect((await loadWorkbook(await buildAnswerSheet([], "ARB-1", { name: "Empty", lines: [] }))).worksheets.map((w) => w.name)).toEqual(["Answer sheet"]);
    const plain = await loadWorkbook(await writePricedWorkbook(await messyWorkbook(), basePlan()));
    expect(plain.getWorksheet("Payment terms")).toBeUndefined();
  });
});
