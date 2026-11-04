import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { loadWorkbook } from "./workbook";
import { writePricedWorkbook, type WritePlan } from "./write";

// The priced BOQ with its optional WBS column (docs/design/wbs.md slice 4): the client's own layout, one more column on the right when asked
// for, and a split line printed as `2.1 60 % · 2.2 15 % · 2.3 25 %`. Nothing about cost is passed in.

const ROOT = path.resolve(__dirname, "../../../..");

async function clientFile(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  ws.mergeCells("A1:G1"); ws.getCell("A1").value = "PIPELINE PACKAGE 4";
  ws.getRow(3).values = ["Item No.", "Description", "Unit", "Qty", "Unit Rate", "Amount", "Remarks"];
  ws.getRow(3).getCell(4).font = { bold: true, color: { argb: "FF336699" } };
  ws.getRow(4).values = ["2.1", "Steel access stair", "m", 337.1];
  ws.getRow(5).values = ["2.2", "Handrail", "m", 10];
  ws.getRow(6).values = ["2.3", "Gate", "no", 1];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const plan = (over: Partial<WritePlan> = {}): WritePlan => ({
  sheet: "BOQ", header_row: 3, qty_col: 4, rate_col: 5, amount_col: 6, added: false, total_row: null, first_row: 4, last_row: 6,
  rows: [{ row_no: 4, rate: 420, amount: 141582 }, { row_no: 5, rate: 800, amount: 8000 }], ...over,
});
const WBS = { rows: [{ row_no: 4, text: "1.1 60 % · 1.2 15 % · 2 25 %" }, { row_no: 5, text: "1.1" }, { row_no: 6, text: "" }] };

describe("the priced workbook's optional WBS column", () => {
  it("adds one header and one cell per row after the last used column, and leaves the client's cells where they were", async () => {
    const ws = (await loadWorkbook(await writePricedWorkbook(await clientFile(), plan({ wbs: WBS })))).getWorksheet("BOQ")!;
    expect(ws.getCell("H3").value).toBe("WBS");
    expect(ws.getCell("H4").value).toBe("1.1 60 % · 1.2 15 % · 2 25 %");
    expect(ws.getCell("H5").value).toBe("1.1");
    expect(ws.getCell("H6").value == null).toBe(true); // a row in no item stays blank
    expect(ws.getCell("E4").value).toBe(420);
    expect(ws.getCell("F4").value).toBe(141582);
    expect(ws.getCell("G3").value).toBe("Remarks");
    expect(ws.getCell("A1").isMerged).toBe(true);
    expect(ws.getCell("H3").font).toMatchObject({ bold: true }); // lends the look of the quantity header
  });

  it("is off unless asked for, and is not added when no row is in a WBS item", async () => {
    for (const wbs of [undefined, null, { rows: [{ row_no: 4, text: "" }] }]) {
      const ws = (await loadWorkbook(await writePricedWorkbook(await clientFile(), plan({ wbs })))).getWorksheet("BOQ")!;
      expect(ws.getCell("H3").value == null).toBe(true);
    }
  });

  it("goes after the rate and amount columns we added when the client's file had none", async () => {
    const wb = new ExcelJS.Workbook();
    const ws0 = wb.addWorksheet("Sheet1");
    ws0.getRow(1).values = ["Item", "Description", "Unit", "Qty"];
    ws0.getRow(2).values = ["1", "Pipe", "m", 10];
    const out = await writePricedWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), {
      sheet: "Sheet1", header_row: 1, qty_col: 4, rate_col: 5, amount_col: 6, added: true, total_row: null, first_row: 2, last_row: 2,
      rows: [{ row_no: 2, rate: 5.5, amount: 55 }], wbs: { rows: [{ row_no: 2, text: "1.1" }] },
    });
    const ws = (await loadWorkbook(out)).getWorksheet("Sheet1")!;
    expect(ws.getCell("E1").value).toBe("Unit rate");
    expect(ws.getCell("F1").value).toBe("Amount");
    expect(ws.getCell("G1").value).toBe("WBS");
    expect(ws.getCell("G2").value).toBe("1.1");
  });
});

describe("the route and the writers", () => {
  const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

  it("the download asks for it with wbs=1 and the e-mailed file does not carry it", () => {
    expect(read("src/app/api/opportunities/[id]/boq/export/route.ts")).toContain('exportPriced(gate.req, { withWbs: query.get("wbs") === "1" })');
    expect(read("src/app/api/opportunities/[id]/tender/bids/send-email/route.ts")).toMatch(/exportPriced\(gate\.req\)/);
    const dl = read("src/components/tender/BoqDownloads.tsx");
    expect(dl).toContain("&wbs=1");
    expect(dl).toContain("Add a WBS column");
  });

  it("carries only codes and percentages into the file: no cost, markup or margin", () => {
    const server = read("src/lib/tender/boq/server.ts");
    const part = server.slice(server.indexOf("async function wbsRowTexts"), server.indexOf("export async function exportPriced"));
    expect(part).toContain("splitListText");
    expect(part.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")).not.toMatch(/unit_cost|markup|margin|cost/i);
  });
});
