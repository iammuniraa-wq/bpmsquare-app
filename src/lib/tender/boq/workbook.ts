import type ExcelJS from "exceljs";
import { BOQ_LIMITS, type Cell, type Grid } from "./parse";

// Reading a client's workbook into the plain grid parse.ts works on (slice 3a), reusing the Excel reading of the estimator's
// intake (exceljs, loaded the same lazy way as src/lib/estimator/intakeFiles/convert.ts). The estimator's reader turns a sheet
// into TEXT for a model; a BOQ needs the cells themselves, with their positions, so this keeps the row and column of every cell.

/** exceljs is large: loaded on first use, like the intake reader. */
export async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb;
}

/** A cell's value as the plain thing a person sees: text, a number, or nothing. Formulas read as their last result. */
export function plainValue(v: ExcelJS.CellValue | undefined): Cell {
  if (v == null || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (v instanceof Date) return null;
  const o = v as unknown as Record<string, unknown>;
  if (Array.isArray(o.richText)) {
    const t = (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim();
    return t === "" ? null : t;
  }
  if ("result" in o) return plainValue(o.result as ExcelJS.CellValue);
  if (typeof o.text === "string") return o.text.trim() === "" ? null : o.text;
  return null;
}

/** The worksheets with something in them, in workbook order. */
export function sheetNames(wb: ExcelJS.Workbook): string[] {
  return wb.worksheets.filter((ws) => ws.state !== "veryHidden" && ws.actualRowCount > 0).map((ws) => ws.name);
}

/** grid[r][c], 0-based. A merged range keeps its text in the top-left cell only, so a merged title never reads as a row of headers. */
export function sheetToGrid(ws: ExcelJS.Worksheet): Grid {
  const rows = Math.min(ws.rowCount, BOQ_LIMITS.maxRows);
  const grid: Grid = [];
  for (let r = 1; r <= rows; r++) {
    const out: Cell[] = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      if (c > BOQ_LIMITS.maxColumns) return;
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      out[c - 1] = plainValue(cell.value);
    });
    // Holes in a sparse row read as empty cells.
    grid.push(Array.from(out, (x) => x ?? null));
  }
  return grid;
}
