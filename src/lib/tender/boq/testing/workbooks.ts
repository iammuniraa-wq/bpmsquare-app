// Workbooks for the BOQ tests, built the way client files really arrive. A test helper, not product code: nothing outside *.test.ts imports it.
import ExcelJS from "exceljs";

/** A client BOQ: a merged title block, blank rows, a header in row 6, section headings, a subtotal, a grand total, and a second sheet. */
export async function messyWorkbook(over: { rows?: (string | number | null)[][]; sheet?: string } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(over.sheet ?? "BOQ Bill 1");
  ws.mergeCells("A1:H1"); ws.getCell("A1").value = "SAUDI ARAMCO - PIPELINE PACKAGE 4";
  ws.mergeCells("A2:H2"); ws.getCell("A2").value = "BILL OF QUANTITIES - Tender ARB-4400123";
  ws.getCell("A3").value = "Prices in SAR, excluding VAT";
  ws.getRow(6).values = ["Item No.", "Description of Works", "Unit", "Qty", "Cost Code", "Unit Rate (SAR)", "Amount (SAR)"];
  ws.getRow(6).font = { bold: true };
  ws.getRow(6).getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  const rows = over.rows ?? [
    ["", "SECTION A - EARTHWORKS"],
    ["A.1", "Excavation in ordinary soil", "m3", 1200, "31 23 16", null, null],
    ["A.2", "Backfill with selected material", "m3", 850.5, "31 23 23", 18.5, null],
    [],
    ["", "Sub-total Section A"],
    ["", "SECTION B - PIPEWORK"],
    ["B.1", "Supply and lay 24\" carbon steel pipe", "m", 2500, "33 11 13"],
    ["B.2", "Total station survey of the route", "ls", 1, "01 71 23"],
    ["", "Grand Total"],
  ];
  rows.forEach((r, i) => { ws.getRow(7 + i).values = r; });
  const last = 7 + rows.length - 1;
  if (!over.rows) {
    ws.getCell("G9").value = { formula: "D9*F9", result: 15734.25 };
    ws.getCell(`G${last}`).value = { formula: `SUM(G8:G${last - 1})`, result: 0 };
  }
  ws.getColumn(2).width = 48;
  const other = wb.addWorksheet("Notes");
  other.getCell("A1").value = "Keep this sheet";
  other.getCell("B2").value = { formula: "A1&\"!\"", result: "Keep this sheet!" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
