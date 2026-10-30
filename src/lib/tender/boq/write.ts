import type ExcelJS from "exceljs";
import { colLetter } from "./parse";
import { loadWorkbook } from "./workbook";

// Writing the priced workbook and the Ariba answer sheet (slice 3a).
//
// The priced workbook is the CLIENT'S OWN FILE with our numbers in it: the original is loaded, the unit rate and the amount are
// written into the cells the saved column map points at, and everything else (other sheets, formats, merged cells, formulas,
// widths) is left as it was. What is written is the SELLING rate and its amount; no cost, margin or markup is ever passed in,
// so none can reach the file.

export type PricedRow = { row_no: number; rate: number; amount: number };

/** The payment terms chosen on the tender, printed as lines on their own sheet: a template name and one line per milestone. */
export type TermsText = { name: string; lines: string[] };

export type WritePlan = {
  sheet: string;
  header_row: number;
  /** The quantity column: its header cell lends its look to the columns we add. */
  qty_col: number | null;
  rate_col: number;
  amount_col: number;
  /** The client's file had no rate / amount column: they are written after the last used column, with a header. */
  added: boolean;
  total_row: number | null;
  /** First and last item row of the BOQ, priced or not, for the total's SUM range. */
  first_row: number;
  last_row: number;
  /** Only the lines that have a rate. The others are left exactly as the client sent them. */
  rows: PricedRow[];
  /** The tender's chosen payment terms. Nothing is added to the file when absent. */
  terms?: TermsText | null;
};

const MONEY_FORMAT = "#,##0.00";

/** A last sheet with the payment terms. Own sheet, so the client's layout and the portal-paste sheet stay as they are. */
function addTermsSheet(wb: ExcelJS.Workbook, terms: TermsText | null | undefined) {
  if (!terms || terms.lines.length === 0) return;
  const ws = wb.addWorksheet(wb.getWorksheet("Payment terms") ? "Payment terms (bid)" : "Payment terms");
  ws.getColumn(1).width = 90;
  ws.getCell(1, 1).value = "Payment terms";
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.getCell(2, 1).value = terms.name;
  terms.lines.forEach((line, i) => { ws.getCell(4 + i, 1).value = line; });
}

const isFormula = (v: ExcelJS.CellValue): v is ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue =>
  !!v && typeof v === "object" && ("formula" in (v as object) || "sharedFormula" in (v as object));

/** A slave cell of a merged range cannot be written: its master shows. */
const isMergedSlave = (cell: ExcelJS.Cell) => cell.isMerged && !!cell.master && cell.master.address !== cell.address;

/** Put a number in a cell; a cell that already holds a formula keeps it and only gets the new result, so the client's own maths stays theirs. */
function setNumber(cell: ExcelJS.Cell, n: number, keepFormula: boolean) {
  if (isMergedSlave(cell)) return;
  const cur = cell.value;
  if (keepFormula && isFormula(cur)) cell.value = { ...cur, result: n } as ExcelJS.CellValue;
  else cell.value = n;
}

export async function writePricedWorkbook(original: Uint8Array, plan: WritePlan): Promise<Buffer> {
  const wb = await loadWorkbook(original);
  const ws = wb.getWorksheet(plan.sheet);
  if (!ws) throw new Error(`The sheet "${plan.sheet}" is no longer in the file`);

  if (plan.added) {
    const lend = plan.qty_col ? ws.getCell(plan.header_row, plan.qty_col) : null;
    for (const [col, text] of [[plan.rate_col, "Unit rate"], [plan.amount_col, "Amount"]] as const) {
      const head = ws.getCell(plan.header_row, col);
      if (isMergedSlave(head)) continue;
      if (head.value == null || head.value === "") head.value = text;
      if (lend) head.style = { ...lend.style };
    }
    const w = (n: number | null) => (n ? ws.getColumn(n).width : undefined);
    for (const col of [plan.rate_col, plan.amount_col]) if (!ws.getColumn(col).width) ws.getColumn(col).width = w(plan.qty_col) ?? 14;
  }

  for (const r of plan.rows) {
    const rate = ws.getCell(r.row_no, plan.rate_col);
    const amount = ws.getCell(r.row_no, plan.amount_col);
    setNumber(rate, r.rate, false);
    setNumber(amount, r.amount, true);
    if (plan.added) {
      if (!isMergedSlave(rate)) rate.numFmt = MONEY_FORMAT;
      if (!isMergedSlave(amount)) amount.numFmt = MONEY_FORMAT;
    }
  }

  if (plan.total_row) {
    const cell = ws.getCell(plan.total_row, plan.amount_col);
    const sum = Math.round(plan.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (!isMergedSlave(cell)) {
      if (isFormula(cell.value)) setNumber(cell, sum, true);
      else {
        const L = colLetter(plan.amount_col);
        cell.value = { formula: `SUM(${L}${plan.first_row}:${L}${plan.last_row})`, result: sum } as ExcelJS.CellValue;
        if (plan.added) cell.numFmt = MONEY_FORMAT;
      }
    }
  }

  // The client's formulas are recalculated when the file opens, so a total they own shows the new figures even in a viewer that kept the old result.
  addTermsSheet(wb, plan.terms);
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type AnswerRow = { item_no: string | null; description: string; uom: string | null; qty: number; rate: number | null; amount: number | null; notes: string };

/** A clean sheet of the lines for copy and paste into a portal form (Ariba): item, description, unit, quantity, rate, amount, notes. */
export async function buildAnswerSheet(rows: readonly AnswerRow[], title: string, terms?: TermsText | null): Promise<Buffer> {
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("Answer sheet");
  ws.columns = [
    { header: "Item", key: "item", width: 12 },
    { header: "Description", key: "description", width: 60 },
    { header: "Unit", key: "uom", width: 10 },
    { header: "Quantity", key: "qty", width: 12 },
    { header: "Unit rate", key: "rate", width: 14 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Notes", key: "notes", width: 28 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    ws.addRow({ item: r.item_no ?? "", description: r.description, uom: r.uom ?? "", qty: r.qty, rate: r.rate ?? "", amount: r.amount ?? "", notes: r.notes });
  }
  const last = rows.length + 1;
  ws.getColumn("qty").numFmt = "#,##0.##";
  ws.getColumn("rate").numFmt = MONEY_FORMAT;
  ws.getColumn("amount").numFmt = MONEY_FORMAT;
  const total = Math.round(rows.reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100;
  const t = ws.addRow({ description: "Total" });
  t.font = { bold: true };
  t.getCell("amount").value = { formula: `SUM(F2:F${Math.max(last, 2)})`, result: total } as ExcelJS.CellValue;
  t.getCell("amount").numFmt = MONEY_FORMAT;
  addTermsSheet(wb, terms);
  wb.title = title.slice(0, 100);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
