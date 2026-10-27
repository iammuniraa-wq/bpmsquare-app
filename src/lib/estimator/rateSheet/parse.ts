// Reading a supplier rate sheet (GCC tender deals, slice 3c-2). PURE: it works on a grid of plain cell values, so the header
// detection and the row rules are unit-tested without a workbook. The same tolerant approach as the BOQ reader
// (src/lib/tender/boq/parse.ts): find the header row by how many known column names it carries, map the columns from those names,
// read the rows below it, and report every row it could not use with a reason. The cell helpers (label normalising, number
// reading) are the BOQ reader's own; only the column vocabulary is a rate sheet's.

import { cellText, normaliseLabel, parseNumber } from "@/lib/tender/boq/parse";
import type { Cell, Grid } from "@/lib/tender/boq/parse";
import { parseDelimited } from "@/lib/import/parse";

export const RATE_FIELDS = ["name", "sku", "uom", "rate", "currency", "supplier", "as_of", "note"] as const;
export type RateField = (typeof RATE_FIELDS)[number];
/** field -> 1-based column number. */
export type RateColumnMap = Partial<Record<RateField, number>>;

export const RATE_FIELD_LABEL: Record<RateField, string> = {
  name: "Item name", sku: "SKU", uom: "Unit", rate: "Rate", currency: "Currency", supplier: "Supplier", as_of: "As of date", note: "Source note",
};

export const RATE_LIMITS = {
  maxRows: 2000,
  maxSheetRows: 6000,
  headerSearchRows: 30,
  maxColumns: 30,
  maxFileBytes: 5 * 1024 * 1024,
  maxName: 200,
  maxSku: 80,
  maxUom: 20,
  maxText: 120,
  maxRate: 1_000_000_000,
} as const;

const EXACT: Record<RateField, string[]> = {
  name: ["item", "item name", "name", "description", "item description", "material", "material description", "product", "product name", "product description", "particulars", "article", "article name", "details"],
  sku: ["sku", "item code", "item no", "item number", "code", "part no", "part number", "product code", "material code", "article no", "article number", "catalogue no", "catalog no", "ref", "reference", "supplier code"],
  uom: ["unit", "units", "uom", "u o m", "um", "unit of measure", "unit of measurement", "measure"],
  rate: ["rate", "unit rate", "unit price", "price", "cost", "unit cost", "net price", "net rate", "rate per unit", "price per unit", "quoted rate", "quoted price", "supply rate"],
  currency: ["currency", "curr", "ccy", "cur", "currency code"],
  supplier: ["supplier", "supplier name", "vendor", "vendor name", "quoted by", "manufacturer"],
  as_of: ["as of", "as of date", "date", "price date", "valid from", "valid from date", "valid date", "effective", "effective date", "quote date", "quotation date", "rate date", "date of quote"],
  note: ["source", "note", "notes", "remarks", "remark", "comment", "comments", "quote ref", "quotation ref", "quotation no", "quote no", "offer ref"],
};

const CONTAINS: Record<RateField, RegExp> = {
  name: /description|item name|product name|material/,
  sku: /\bsku\b|item code|part (no|number)|product code|material code/,
  uom: /\bunit of\b|\buom\b/,
  rate: /\brate\b|unit price|unit cost|net price/,
  currency: /currency/,
  supplier: /supplier|vendor/,
  as_of: /\bas of\b|valid from|effective|price date|quote date/,
  note: /\bsource\b|\bremarks?\b|quot(e|ation) (ref|no)/,
};

type Hit = { field: RateField; strength: number };

/** What a header label could be: exact names score 2, looser matches 1. */
export function classifyRateLabel(raw: string): Hit[] {
  const label = normaliseLabel(raw);
  if (!label) return [];
  const hits: Hit[] = [];
  for (const f of RATE_FIELDS) {
    if (EXACT[f].includes(label)) hits.push({ field: f, strength: 2 });
    else if (CONTAINS[f].test(label)) hits.push({ field: f, strength: 1 });
  }
  const exact = hits.filter((h) => h.strength === 2);
  return exact.length > 0 ? exact : hits;
}

export type RateColumnMatch = { map: RateColumnMap; score: number };

/** The best field for each column of a header row, each field used once (the strongest, then the leftmost column wins). */
export function detectRateColumns(headerCells: readonly Cell[]): RateColumnMatch {
  const options: { col: number; field: RateField; strength: number }[] = [];
  headerCells.slice(0, RATE_LIMITS.maxColumns).forEach((cell, i) => {
    for (const h of classifyRateLabel(cellText(cell))) options.push({ col: i + 1, field: h.field, strength: h.strength });
  });
  options.sort((a, b) => b.strength - a.strength || a.col - b.col);
  const map: RateColumnMap = {};
  const usedCols = new Set<number>();
  let score = 0;
  for (const o of options) {
    if (map[o.field] != null || usedCols.has(o.col)) continue;
    map[o.field] = o.col;
    usedCols.add(o.col);
    score += o.strength;
  }
  return { map, score };
}

export type RateLayout = { headerRow: number | null; map: RateColumnMap };

/** A rate sheet needs a rate and a way to name the item (its name or its SKU). */
const usable = (m: RateColumnMap) => m.rate != null && (m.name != null || m.sku != null);

/** Find the header row (the one carrying the most known column names). Title rows and notes score nothing. */
export function detectRateLayout(grid: Grid): RateLayout {
  let best: { row: number; match: RateColumnMatch } | null = null;
  const limit = Math.min(grid.length, RATE_LIMITS.headerSearchRows);
  for (let r = 0; r < limit; r++) {
    const match = detectRateColumns(grid[r] ?? []);
    if (!usable(match.map)) continue;
    if (!best || match.score > best.match.score) best = { row: r + 1, match };
  }
  return best ? { headerRow: best.row, map: best.match.map } : { headerRow: null, map: {} };
}

// ── Dates ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function ymd(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A date cell as YYYY-MM-DD, or null when it is empty or not a date. Day first for 15/10/2026 (the Gulf's habit), month first only when
 * the day cannot be the first number (10/15/2026). An Excel serial number (a date cell read as a number) is understood too.
 */
export function parseSheetDate(v: Cell | undefined): string | null {
  if (v == null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 36526 || v > 73415) return null; // 2000-01-01 .. 2100-12-31
    const t = Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000;
    const d = new Date(t);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = v.trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return ymd(y, b, a) ?? (a <= 12 && b > 12 ? ymd(y, a, b) : null);
  }
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return ymd(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  if (/^\d{5}$/.test(s)) return parseSheetDate(Number(s));
  return null;
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RateRow = {
  /** 1-based spreadsheet row. */
  row_no: number;
  name: string;
  sku: string | null;
  uom: string | null;
  rate: number;
  /** Upper case ISO code, or null when the sheet does not say (the workspace's currency is assumed). */
  currency: string | null;
  supplier: string | null;
  note: string | null;
  /** YYYY-MM-DD from the row, or null (the sheet-level date applies). */
  as_of: string | null;
  /** The row had text in the date cell that is not a date. */
  date_unreadable: boolean;
  /** A currency cell that is not a three-letter code. */
  currency_unreadable: boolean;
};

export type SkippedRateRow = { row_no: number; reason: string; text: string };

export type ParsedRates = { rows: RateRow[]; skipped: SkippedRateRow[]; truncated: boolean };

const squash = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** Read the item rows below the header. Section headings, blank rows and rows without a usable rate are skipped (and reported). */
export function extractRates(grid: Grid, headerRow: number, map: RateColumnMap): ParsedRates {
  const rows: RateRow[] = [];
  const skipped: SkippedRateRow[] = [];
  let truncated = false;
  const at = (row: Cell[], field: RateField): Cell => (map[field] != null ? row[map[field]! - 1] ?? null : null);

  for (let r = headerRow; r < Math.min(grid.length, RATE_LIMITS.maxSheetRows); r++) {
    const row = grid[r] ?? [];
    const rowNo = r + 1;
    if (row.every((c) => cellText(c) === "")) continue;
    const name = squash(cellText(at(row, "name")), RATE_LIMITS.maxName);
    const sku = squash(cellText(at(row, "sku")), RATE_LIMITS.maxSku);
    const label = name || sku;
    if (!label) { skipped.push({ row_no: rowNo, reason: "Not an item", text: row.map(cellText).filter(Boolean).join(" ").slice(0, 80) }); continue; }
    const rate = parseNumber(at(row, "rate"));
    if (rate == null) { skipped.push({ row_no: rowNo, reason: "No rate (a heading?)", text: label.slice(0, 80) }); continue; }
    if (rate <= 0 || rate > RATE_LIMITS.maxRate) { skipped.push({ row_no: rowNo, reason: "Rate out of range", text: label.slice(0, 80) }); continue; }
    if (rows.length >= RATE_LIMITS.maxRows) {
      truncated = true;
      skipped.push({ row_no: rowNo, reason: `Only the first ${RATE_LIMITS.maxRows} items are read`, text: label.slice(0, 80) });
      continue;
    }
    const currencyText = cellText(at(row, "currency")).toUpperCase();
    const dateCell = at(row, "as_of");
    const asOf = parseSheetDate(dateCell);
    rows.push({
      row_no: rowNo,
      name: name || sku,
      sku: sku || null,
      uom: squash(cellText(at(row, "uom")), RATE_LIMITS.maxUom) || null,
      rate,
      currency: /^[A-Z]{3}$/.test(currencyText) ? currencyText : null,
      supplier: squash(cellText(at(row, "supplier")), RATE_LIMITS.maxText) || null,
      note: squash(cellText(at(row, "note")), RATE_LIMITS.maxText) || null,
      as_of: asOf,
      date_unreadable: asOf == null && cellText(dateCell) !== "",
      currency_unreadable: currencyText !== "" && !/^[A-Z]{3}$/.test(currencyText),
    });
  }
  return { rows, skipped, truncated };
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RateFileKind = "xlsx" | "csv";

/** The kind of file by its name and its first bytes: an Excel workbook is a zip ("PK"); a CSV has no NUL bytes. Null when it is neither. */
export function rateFileKind(fileName: string, bytes: Uint8Array): RateFileKind | { error: string } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xls")) return { error: "The old .xls format is not read. Save the file as .xlsx or .csv." };
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b ? "xlsx" : { error: "That is not an Excel workbook (.xlsx)." };
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const head = bytes.subarray(0, Math.min(bytes.length, 4096));
    return head.includes(0) ? { error: "That does not look like a CSV text file." } : "csv";
  }
  return { error: "Upload an Excel (.xlsx) or CSV file." };
}

/** A CSV as the same grid an Excel sheet gives: every non-empty field is text, which the readers above turn into numbers and dates. */
export function csvToGrid(text: string): Grid {
  return parseDelimited(text).slice(0, RATE_LIMITS.maxSheetRows).map((r) => r.slice(0, RATE_LIMITS.maxColumns).map((c) => (c === "" ? null : c)));
}
