import type ExcelJS from "exceljs";
import { loadWorkbook, plainValue, sheetNames } from "@/lib/tender/boq/workbook";
import type { Cell, Grid } from "@/lib/tender/boq/parse";
import { RATE_LIMITS, detectRateLayout } from "./parse";

// A supplier's Excel workbook as the plain grid parse.ts reads. The BOQ reader's workbook loading and cell reading are reused
// as they are (src/lib/tender/boq/workbook.ts); the one addition is dates: the BOQ reader drops them (a BOQ has none), a rate
// sheet's "valid from" column is one, so a date cell is turned into YYYY-MM-DD text here.

const isoDate = (d: Date): string | null =>
  Number.isNaN(d.getTime()) ? null : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function cellValue(v: ExcelJS.CellValue | undefined): Cell {
  if (v instanceof Date) return isoDate(v);
  // A formula whose result is a date.
  if (v && typeof v === "object" && "result" in v && (v as { result?: unknown }).result instanceof Date) return isoDate((v as { result: Date }).result);
  return plainValue(v);
}

function sheetGrid(ws: ExcelJS.Worksheet): Grid {
  const rows = Math.min(ws.rowCount, RATE_LIMITS.maxSheetRows);
  const grid: Grid = [];
  for (let r = 1; r <= rows; r++) {
    const out: Cell[] = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      if (c > RATE_LIMITS.maxColumns) return;
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      out[c - 1] = cellValue(cell.value);
    });
    grid.push(Array.from(out, (x) => x ?? null));
  }
  return grid;
}

export type ChosenSheet = { name: string; grid: Grid };

/** The first sheet with a usable header (a rate and an item name or SKU); the first sheet with anything on it when none has one. */
export async function readRateWorkbook(bytes: Uint8Array): Promise<ChosenSheet | null> {
  const wb = await loadWorkbook(bytes);
  const names = sheetNames(wb).slice(0, 12);
  let firstWithData: ChosenSheet | null = null;
  for (const name of names) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const grid = sheetGrid(ws);
    if (!firstWithData) firstWithData = { name, grid };
    if (detectRateLayout(grid).headerRow != null) return { name, grid };
  }
  return firstWithData;
}
