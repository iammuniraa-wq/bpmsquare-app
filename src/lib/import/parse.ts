import type { ParsedSheet } from "./types";

const DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Counts delimiters outside quoted regions across the first few records so that
 * commas inside quoted prose don't outvote the real delimiter.
 */
function detectDelimiter(text: string): string {
  const sample = text.slice(0, 64_000);
  let best = ",";
  let bestScore = -1;

  for (const delim of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    let records = 0;

    for (let i = 0; i < sample.length && records < 5; i++) {
      const ch = sample[i];
      if (ch === '"') {
        if (inQuotes && sample[i + 1] === '"') { i++; continue; }
        inQuotes = !inQuotes;
      } else if (!inQuotes && ch === delim) {
        count++;
      } else if (!inQuotes && (ch === "\n" || ch === "\r")) {
        records++;
      }
    }
    if (count > bestScore) { bestScore = count; best = delim; }
  }

  return bestScore > 0 ? best : ",";
}

/**
 * RFC 4180 parser operating on the whole character stream. Splitting on newlines
 * before handling quotes corrupts every field containing an embedded line break,
 * which is common in notes, terms and scope-of-work columns.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const delim = delimiter ?? detectDelimiter(clean);

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let sawAnyChar = false;

  const endField = () => {
    record.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };

  const endRecord = () => {
    endField();
    if (record.some((cell) => cell !== "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    sawAnyChar = true;

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === "\r") {
      if (clean[i + 1] === "\n") i++;
      endRecord();
    } else if (ch === "\n") {
      endRecord();
    } else {
      field += ch;
    }
  }

  if (sawAnyChar && (field !== "" || record.length > 0)) endRecord();

  return records;
}

function toSheet(records: string[][], format: "csv" | "xlsx", sheetName?: string): ParsedSheet {
  if (records.length === 0) {
    return { headers: [], rows: [], rowNumbers: [], format, sheetName };
  }

  const headers = records[0].map((h) => h.trim());
  const width = Math.max(headers.length, ...records.map((r) => r.length));
  const rows: string[][] = [];
  const rowNumbers: number[] = [];

  for (let i = 1; i < records.length; i++) {
    const padded = Array.from({ length: width }, (_, col) => records[i][col] ?? "");
    rows.push(padded);
    // Header occupies row 1, matching the row numbers a user sees in Excel.
    rowNumbers.push(i + 1);
  }

  return {
    headers: Array.from({ length: width }, (_, col) => headers[col] ?? ""),
    rows,
    rowNumbers,
    format,
    sheetName,
  };
}

export function parseCsvText(text: string): ParsedSheet {
  return toSheet(parseDelimited(text), "csv");
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "object") {
    const maybe = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(maybe.richText)) return maybe.richText.map((r) => r.text).join("");
    if (maybe.text != null) return String(maybe.text);
    if (maybe.result != null) return String(maybe.result);
    return "";
  }
  return String(value).trim();
}

async function parseXlsxFile(file: File): Promise<ParsedSheet> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const raw = (await readXlsxFile(file)) as unknown as unknown[][];
  const records = raw
    .map((row) => row.map(cellToString))
    .filter((row) => row.some((cell) => cell !== ""));
  return toSheet(records, "xlsx");
}

export class ImportParseError extends Error {}

const MAX_BYTES = 15 * 1024 * 1024;

export async function parseImportFile(file: File): Promise<ParsedSheet> {
  if (file.size > MAX_BYTES) {
    throw new ImportParseError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please split it into files under 15 MB.`
    );
  }

  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    try {
      const sheet = await parseXlsxFile(file);
      if (sheet.headers.length === 0) {
        throw new ImportParseError("That spreadsheet's first sheet appears to be empty.");
      }
      return sheet;
    } catch (e) {
      if (e instanceof ImportParseError) throw e;
      throw new ImportParseError(
        "Could not read that Excel file. If it was saved from an older version of Excel, re-save it as .xlsx or .csv."
      );
    }
  }

  if (name.endsWith(".xls")) {
    throw new ImportParseError(
      "The legacy .xls format is not supported. Open it in Excel and use File → Save As → Excel Workbook (.xlsx) or CSV."
    );
  }

  const text = await file.text();
  if (text.includes("\u0000")) {
    throw new ImportParseError(
      "That looks like a binary file, not a CSV. If it is a spreadsheet, save it as .xlsx or .csv first."
    );
  }

  const sheet = parseCsvText(text);
  if (sheet.headers.length === 0) {
    throw new ImportParseError("That file appears to be empty.");
  }
  return sheet;
}
