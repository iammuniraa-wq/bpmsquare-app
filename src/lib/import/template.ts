import type { ObjectSpec } from "./types";

export function csvCell(value: string): string {
  let v = value ?? "";
  // CSV/formula injection: a cell starting with =, +, -, @ (or tab/CR) is run
  // as a formula by Excel/LibreOffice on open. This backs every Data
  // Workbench export, so cells routinely come from attacker-influenceable
  // tenant data -- prefix with a quote to force plain-text interpretation.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
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

export type ExportColumn = { key: string; label: string };

/** columns should already include the leading "Record ID" column when the export is meant for re-import as an Update. */
export function buildExportCsv(columns: ExportColumn[], rows: Record<string, string>[]): string {
  const header = csvRow(columns.map((c) => c.label));
  const body = rows.map((row) => csvRow(columns.map((c) => row[c.key] ?? "")));
  return BOM + [header, ...body].join("\r\n") + "\r\n";
}

export type ErrorReportRow = { rowNum: number; status: string; reason: string };

/** Lets the user fix problems in a spreadsheet rather than reading them off the screen. */
export function buildErrorReportCsv(rows: ErrorReportRow[]): string {
  const header = csvRow(["row", "status", "reason"]);
  const body = rows.map((r) => csvRow([String(r.rowNum), r.status, r.reason]));
  return BOM + [header, ...body].join("\r\n") + "\r\n";
}
