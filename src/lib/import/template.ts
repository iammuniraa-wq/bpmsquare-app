import type { ObjectSpec } from "./types";

function csvCell(value: string): string {
  const v = value ?? "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

const BOM = "﻿";

export function buildTemplateCsv(spec: ObjectSpec): string {
  const keys = spec.fields.map((f) => f.key);
  const header = csvRow(keys);
  const samples = spec.sampleRows.map((row) => csvRow(keys.map((k) => row[k] ?? "")));
  return BOM + [header, ...samples].join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type ErrorReportRow = { rowNum: number; status: string; reason: string };

/** Lets the user fix problems in a spreadsheet rather than reading them off the screen. */
export function buildErrorReportCsv(rows: ErrorReportRow[]): string {
  const header = csvRow(["row", "status", "reason"]);
  const body = rows.map((r) => csvRow([String(r.rowNum), r.status, r.reason]));
  return BOM + [header, ...body].join("\r\n") + "\r\n";
}
