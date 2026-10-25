import "server-only";
import { parseDelimited } from "@/lib/import/parse";
import { loadWorkbook, plainValue } from "@/lib/tender/boq/workbook";
import { MASTER_IMPORT_LIMITS, type Cell } from "./masters";

// Reading an uploaded code list into a grid (CSV or Excel). The bytes are judged here, not the file name: an .xlsx must be a zip, a
// CSV must be text. What the grid means is masters.ts's job.

const MAX_COLUMNS = 12;

export async function readMasterFile(fileName: string, bytes: Uint8Array): Promise<{ ok: true; grid: Cell[][] } | { ok: false; error: string }> {
  if (bytes.byteLength === 0) return { ok: false, error: "That file is empty" };
  if (bytes.byteLength > MASTER_IMPORT_LIMITS.maxBytes) return { ok: false, error: "That file is larger than 5 MB" };
  const name = fileName.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (name.endsWith(".xlsx")) {
    if (!isZip) return { ok: false, error: "That does not look like an Excel (.xlsx) file" };
    try {
      const wb = await loadWorkbook(bytes);
      const ws = wb.worksheets.find((s) => s.state !== "veryHidden" && s.actualRowCount > 0);
      if (!ws) return { ok: false, error: "The workbook has no data" };
      const grid: Cell[][] = [];
      const rows = Math.min(ws.rowCount, MASTER_IMPORT_LIMITS.maxRows + 20);
      for (let r = 1; r <= rows; r++) {
        const row: Cell[] = [];
        ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
          if (c <= MAX_COLUMNS) row[c - 1] = plainValue(cell.value);
        });
        grid.push(Array.from(row, (x) => x ?? null));
      }
      return { ok: true, grid };
    } catch {
      return { ok: false, error: "That Excel file could not be read" };
    }
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    if (isZip || bytes.includes(0)) return { ok: false, error: "That does not look like a CSV text file" };
    const text = new TextDecoder("utf-8").decode(bytes);
    return { ok: true, grid: parseDelimited(text) };
  }
  return { ok: false, error: "Upload a .csv or .xlsx file" };
}
