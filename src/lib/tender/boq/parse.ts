// Reading a client's BOQ sheet (GCC tender deals, slice 3a). PURE: it works on a grid of plain cell values, so the header
// and column detection is unit-tested without a workbook. The workbook itself is turned into a grid by workbook.ts.
//
// AI-free on purpose: a client's BOQ has a title block (often merged cells), then a header row, then item rows, section
// headings, subtotals and a grand total. We find the header row by how many known column names it carries, map the columns
// from those names, and read the rows below it. The "fix the mapping" panel lets a person correct any of it; nothing here
// is trusted beyond what the person confirms.

import type { RowOutcome } from "@/lib/import/types";

export type Cell = string | number | null;
/** grid[r][c], both 0-based. Spreadsheet row 1 is grid[0]. Merged cells carry their text in the top-left cell only. */
export type Grid = Cell[][];

export const BOQ_FIELDS = ["item_no", "narration", "description", "uom", "qty", "cost_code", "rate", "amount"] as const;
export type BoqField = (typeof BOQ_FIELDS)[number];
/** field -> 1-based column number. */
export type ColumnMap = Partial<Record<BoqField, number>>;

export const FIELD_LABEL: Record<BoqField, string> = {
  item_no: "Item no.", narration: "Narration", description: "Description", uom: "Unit", qty: "Quantity", cost_code: "Cost code", rate: "Unit rate", amount: "Amount",
};
/** The three a line cannot be read without. */
export const REQUIRED_FIELDS: BoqField[] = ["description", "qty"];

export const BOQ_LIMITS = { maxLines: 2000, headerSearchRows: 60, maxColumns: 40, maxRows: 6000, maxFileBytes: 15 * 1024 * 1024 } as const;

// ── Text helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A header label for comparing: lower case, currency/brackets and punctuation gone, one space between words. */
export function normaliseLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(sar|qar|aed|kwd|omr|bhd|usd|eur|gbp|inr)\b/g, " ")
    .replace(/[._:\-/\\,*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const cellText = (v: Cell | undefined): string => (v == null ? "" : typeof v === "number" ? String(v) : v.trim());

/** "1,250.50", "1 250", "12" -> number; anything else -> null. */
export function parseNumber(v: Cell | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.replace(/[,\s ]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── Header detection ────────────────────────────────────────────────────────────────────────────────────────────────

/** The header spellings of each field. Exported so the Data Workbench spec offers the very same aliases the upload detects. */
export const EXACT: Record<BoqField, string[]> = {
  item_no: ["item", "item no", "item number", "item ref", "no", "sl", "sl no", "s no", "sr", "sr no", "serial", "serial no", "serial number", "bill no", "bill ref", "bill item", "ref", "reference", "pos", "position", "clause", "clause no", "sn", "s n", "number", "bq no", "boq no", "boq item"],
  narration: ["narration", "short description", "short name", "item name", "item title", "brief description"],
  description: ["description", "item description", "description of work", "description of works", "description of item", "description of items", "work description", "material description", "particulars", "scope", "scope of work", "scope of works", "work item", "details", "activity"],
  uom: ["unit", "units", "uom", "u o m", "um", "unit of measure", "unit of measurement", "measure"],
  qty: ["qty", "quantity", "quantities", "q ty", "qnty", "total qty", "total quantity", "boq qty", "boq quantity", "est qty", "estimated quantity", "no of units"],
  cost_code: ["cost code", "cost code no", "csi", "csi code", "masterformat", "master format", "masterformat code", "master format code", "division", "wbs", "wbs code", "spec section", "specification section", "spec ref", "code", "item code", "spec no"],
  rate: ["rate", "unit rate", "unit price", "price", "rate per unit", "contractor rate", "bid rate", "quoted rate"],
  amount: ["amount", "total", "total amount", "total price", "value", "line total", "extended", "extended price", "total value", "bid amount", "price total"],
};

/** Looser matches, for labels like "Description of Works / الوصف" or "Unit Rate in SAR". Lower strength than an exact name. */
const CONTAINS: Record<BoqField, RegExp> = {
  item_no: /^(item|sl|sr|serial|bill)\b.*\b(no|number|ref)\b/,
  narration: /narration/,
  description: /description|particulars|scope of/,
  uom: /\bunit of\b|\buom\b/,
  qty: /\bqty\b|quantit|\bq ty\b/,
  cost_code: /cost code|master ?format|\bcsi\b|\bwbs\b|spec(ification)? (section|ref)/,
  rate: /\brate\b|unit price/,
  amount: /\bamount\b|total price|total value/,
};

type Hit = { field: BoqField; strength: number };

/** A column named Item beats a serial number (Sr, Sl, S no): a client file often carries both, and the item number is the one a revised file matches by. */
const ITEM_NAMES = new Set(["item", "item no", "item number", "item ref", "item reference", "boq item"]);

/** What a header label could be: item names score 3, other exact names 2, looser matches 1. */
export function classifyLabel(raw: string): Hit[] {
  const label = normaliseLabel(raw);
  if (!label) return [];
  const hits: Hit[] = [];
  for (const f of BOQ_FIELDS) {
    if (f === "item_no" && ITEM_NAMES.has(label)) hits.push({ field: f, strength: 3 });
    else if (EXACT[f].includes(label)) hits.push({ field: f, strength: 2 });
    else if (CONTAINS[f].test(label)) hits.push({ field: f, strength: 1 });
  }
  // "Total qty" is a quantity, "Unit rate" a rate: when a label is exactly known for one field, looser matches elsewhere are noise.
  const exact = hits.filter((h) => h.strength >= 2);
  return exact.length > 0 ? exact : hits;
}

export type ColumnMatch = { map: ColumnMap; score: number };

/** The best field for each column of a header row, each field used once (the strongest, then the leftmost column wins). */
export function detectColumns(headerCells: readonly Cell[]): ColumnMatch {
  const options: { col: number; field: BoqField; strength: number }[] = [];
  headerCells.slice(0, BOQ_LIMITS.maxColumns).forEach((cell, i) => {
    for (const h of classifyLabel(cellText(cell))) options.push({ col: i + 1, field: h.field, strength: h.strength });
  });
  options.sort((a, b) => b.strength - a.strength || a.col - b.col);
  const map: ColumnMap = {};
  const usedCols = new Set<number>();
  let score = 0;
  for (const o of options) {
    if (map[o.field] != null || usedCols.has(o.col)) continue;
    map[o.field] = o.col;
    usedCols.add(o.col);
    score += o.strength;
  }
  // A sheet whose only text column is called Narration reads it as the description.
  if (map.narration != null && map.description == null) { map.description = map.narration; delete map.narration; }
  return { map, score };
}

export type Layout = {
  /** 1-based spreadsheet row number, or null when no row looked like a header. */
  headerRow: number | null;
  map: ColumnMap;
  /** The header row's cell texts (for remembering the layout). */
  labels: string[];
};

const hasRequired = (m: ColumnMap) => m.description != null && (m.qty != null || m.uom != null || m.rate != null);

/** Find the header row (the one carrying the most known column names) and map its columns. Title rows and notes score nothing. */
export function detectLayout(grid: Grid): Layout {
  let best: { row: number; match: ColumnMatch } | null = null;
  const limit = Math.min(grid.length, BOQ_LIMITS.headerSearchRows);
  for (let r = 0; r < limit; r++) {
    const match = detectColumns(grid[r] ?? []);
    if (!hasRequired(match.map)) continue;
    if (!best || match.score > best.match.score) best = { row: r + 1, match };
  }
  if (!best) return { headerRow: null, map: {}, labels: [] };
  return { headerRow: best.row, map: best.match.map, labels: (grid[best.row - 1] ?? []).map(cellText) };
}

/** The same layout as before? Same header texts in the saved header row means the saved map still applies to this sheet. */
export function sameLayout(grid: Grid, headerRow: number, labels: readonly string[]): boolean {
  const cells = (grid[headerRow - 1] ?? []).map(cellText);
  const had = labels.map((l) => normaliseLabel(l));
  const nonEmpty = had.filter(Boolean).length;
  if (nonEmpty < 2) return false;
  return had.every((l, i) => !l || normaliseLabel(cells[i] ?? "") === l);
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Client columns kept as the client wrote them: header label -> cell text. */
export type ClientData = Record<string, string>;

export type BoqLine = {
  /** 1-based spreadsheet row. */
  row_no: number;
  item_no: string | null;
  /** The line's NAME: the Narration when the file has one, else the Description. */
  description: string;
  /** The long Description when the file also carries a Narration; line breaks kept. Null for a Description-only file. */
  details?: string | null;
  /** Every other column of the file that has a value on this row (Sr #, Bill #, Section, Page #, Revision #, Boq #...). */
  client_data?: ClientData | null;
  uom: string | null;
  qty: number;
  cost_code: string | null;
  /** The rate the client's file already carried (> 0), if any. */
  file_rate: number | null;
  /** The matching key of a re-upload. */
  key: string;
};

export type SkippedRow = { row_no: number; reason: string; text: string };

/** The title block above the table: the client's project code and name, and a tender number or client when the sheet names one. */
export type HeaderInfo = { project_code?: string; project_name?: string; tender_no?: string; client?: string };

export type ParsedBoq = {
  lines: BoqLine[];
  /** Labels of the file's columns kept as client data (not mapped to a field). */
  client_columns: string[];
  header_info: HeaderInfo;
  skipped: SkippedRow[];
  /** The client's own total row (1-based), when the sheet has one. */
  total_row: number | null;
  truncated: boolean;
};

// A label that makes a row a total, not an item: "Total", "Grand Total", "Total Amount", "Sub-total", "Carried forward". "Total station
// survey" is an item and does not match.
const TOTAL_LABEL = /^(grand\s+)?total\s*([:\-]|$)|^(grand\s+)?total\s+(amount|bid|price|sar|for|of|carried|to)\b|^sub[\s-]?total\b|carried\s+(forward|over)|brought\s+(forward|over)|^summary\s+of\b/i;
const GRAND_TOTAL = /^(grand\s+total|total(\s+(amount|bid\s+price|price|sar))?)\s*([:\-]|$)/i;

const normDesc = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The matching key of a line: its item number when it has one, else its description and unit. Repeats are told apart by assignKeys. */
export function baseKey(itemNo: string | null, description: string, uom: string | null): string {
  const n = (itemNo ?? "").trim().toLowerCase().replace(/[\s.]+$/g, "").replace(/\s+/g, "");
  return n ? `n:${n}` : `d:${normDesc(description)}|${normDesc(uom ?? "")}`;
}

/** Give every line its key; a key seen twice gets #2, #3 in order, so a repeat in the file still matches the same repeat next time. */
export function assignKeys<T extends { item_no: string | null; description: string; uom: string | null }>(lines: readonly T[]): (T & { key: string })[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = baseKey(l.item_no, l.description, l.uom);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...l, key: n === 1 ? base : `${base}#${n}` };
  });
}

export const DETAILS_MAX = 4000;
const CLIENT_VALUE_MAX = 300;
const CLIENT_COLUMNS_MAX = 24;

/** Text with its line breaks kept (a spec written over several lines), tidied: no trailing spaces, no run of blank lines. */
export function multilineText(s: string): string {
  return s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, DETAILS_MAX);
}
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The header cells that are not mapped to a field and have a label: kept as client data. A repeated label gets (2), (3). */
export function clientColumnsOf(header: readonly Cell[], map: ColumnMap): { col: number; label: string }[] {
  const mapped = new Set(Object.values(map).filter((v): v is number => !!v));
  const seen = new Map<string, number>();
  const out: { col: number; label: string }[] = [];
  header.slice(0, BOQ_LIMITS.maxColumns).forEach((cell, i) => {
    const text = oneLine(cellText(cell)).slice(0, 60);
    if (!text || mapped.has(i + 1) || out.length >= CLIENT_COLUMNS_MAX) return;
    const n = (seen.get(text.toLowerCase()) ?? 0) + 1;
    seen.set(text.toLowerCase(), n);
    out.push({ col: i + 1, label: n === 1 ? text : `${text} (${n})` });
  });
  return out;
}

const TITLE_LABELS: [RegExp, keyof HeaderInfo][] = [
  [/^project (code|no|number|id|ref|reference)$/, "project_code"],
  [/^project( (name|title|description))?$/, "project_name"],
  [/^(tender|rfq|bid) ?(no|number|ref|reference)?$/, "tender_no"],
  [/^(client|employer|owner|customer)( name)?$/, "client"],
];
const titleKind = (label: string): keyof HeaderInfo | null => {
  const l = normaliseLabel(label);
  return TITLE_LABELS.find(([re]) => re.test(l))?.[1] ?? null;
};

/** Project Code / Project Name (and Tender no / Client) from the rows above the header: "Label | value", "Label: value", or the value under the label. */
export function readHeaderInfo(grid: Grid, headerRow: number): HeaderInfo {
  const info: HeaderInfo = {};
  const put = (kind: keyof HeaderInfo, value: string) => {
    const v = oneLine(value).slice(0, 200);
    if (v && !info[kind] && !titleKind(v)) info[kind] = v;
  };
  for (let r = 0; r < Math.min(headerRow - 1, grid.length); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const text = cellText(row[c]);
      if (!text) continue;
      const colon = text.indexOf(":");
      const inline = colon > 0 ? titleKind(text.slice(0, colon)) : null;
      if (inline && text.slice(colon + 1).trim()) { put(inline, text.slice(colon + 1)); continue; }
      const kind = titleKind(text.replace(/[:\-]+$/, ""));
      if (!kind) continue;
      const right = row.slice(c + 1).map(cellText).find((t) => t !== "");
      if (right && !titleKind(right)) { put(kind, right); continue; }
      const below = cellText((grid[r + 1] ?? [])[c]);
      if (below && r + 1 < headerRow - 1) put(kind, below);
    }
  }
  return info;
}

/** Read the item rows below the header. Section headings, subtotals, blank rows and the grand total are skipped (and reported). */
export function extractLines(grid: Grid, headerRow: number, map: ColumnMap): ParsedBoq {
  const out: Omit<BoqLine, "key">[] = [];
  const skipped: SkippedRow[] = [];
  let totalRow: number | null = null;
  let truncated = false;
  const at = (row: Cell[], field: BoqField): Cell => (map[field] != null ? row[map[field]! - 1] ?? null : null);
  const clientCols = clientColumnsOf(grid[headerRow - 1] ?? [], map);

  for (let r = headerRow; r < Math.min(grid.length, BOQ_LIMITS.maxRows); r++) {
    const row = grid[r] ?? [];
    const rowNo = r + 1;
    if (row.every((c) => cellText(c) === "")) continue;
    const longText = cellText(at(row, "description"));
    const narration = cellText(at(row, "narration"));
    // With both columns the Narration is the line's name and the Description its details; with one, that one is the name.
    const desc = narration || longText;
    const itemNo = cellText(at(row, "item_no"));
    // The label of a total can sit in a column that is not the description (a merged "Total" cell to the left of it).
    const firstText = row.map(cellText).find((t) => t !== "" && parseNumber(t) == null) ?? "";
    const totalLabel = [desc, itemNo, firstText].find((t) => t && TOTAL_LABEL.test(t));
    if (totalLabel) {
      // The client's own total cell: remember the last row that is a total (not a subtotal) so the priced file can fill it.
      if (GRAND_TOTAL.test(totalLabel)) totalRow = rowNo;
      skipped.push({ row_no: rowNo, reason: "Total row", text: totalLabel.slice(0, 80) });
      continue;
    }
    const qty = parseNumber(at(row, "qty"));
    if (qty == null) {
      if (desc) skipped.push({ row_no: rowNo, reason: "Heading (no quantity)", text: desc.slice(0, 80) });
      else skipped.push({ row_no: rowNo, reason: "Not a line", text: row.map(cellText).filter(Boolean).join(" ").slice(0, 80) });
      continue;
    }
    if (!desc) { skipped.push({ row_no: rowNo, reason: "Quantity without a description", text: itemNo || `row ${rowNo}` }); continue; }
    if (qty < 0 || qty > 9_999_999_999) { skipped.push({ row_no: rowNo, reason: "Quantity out of range", text: desc.slice(0, 80) }); continue; }
    if (out.length >= BOQ_LIMITS.maxLines) { truncated = true; skipped.push({ row_no: rowNo, reason: `Only the first ${BOQ_LIMITS.maxLines} lines are read`, text: desc.slice(0, 80) }); continue; }

    const rate = parseNumber(at(row, "rate"));
    const client: ClientData = {};
    for (const cc of clientCols) {
      const t = cellText(row[cc.col - 1]);
      if (t) client[cc.label] = t.slice(0, CLIENT_VALUE_MAX);
    }
    out.push({
      row_no: rowNo,
      item_no: itemNo || null,
      description: oneLine(desc).slice(0, 1000),
      details: narration && longText && oneLine(longText) !== oneLine(narration) ? multilineText(longText) : null,
      client_data: Object.keys(client).length > 0 ? client : null,
      uom: cellText(at(row, "uom")) || null,
      qty,
      cost_code: cellText(at(row, "cost_code")) || null,
      file_rate: rate != null && rate > 0 ? rate : null,
    });
  }
  return { lines: assignKeys(out), skipped, total_row: totalRow, truncated, client_columns: clientCols.map((x) => x.label), header_info: readHeaderInfo(grid, headerRow) };
}

// ── Lines that did not come from a workbook ─────────────────────────────────────────────────────────────────────────

/** The Client columns cell of a Data Workbench file: a JSON object of label -> text (what an export writes). Null when it is not one. */
export function parseClientColumns(raw: string | undefined): { ok: true; data: ClientData | null } | { ok: false } {
  const t = (raw ?? "").trim();
  if (!t) return { ok: true, data: null };
  let parsed: unknown;
  try { parsed = JSON.parse(t); } catch { return { ok: false }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
  const data: ClientData = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const label = oneLine(k).slice(0, 60);
    const text = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    if (label && text && Object.keys(data).length < CLIENT_COLUMNS_MAX) data[label] = text.slice(0, CLIENT_VALUE_MAX);
  }
  return { ok: true, data: Object.keys(data).length > 0 ? data : null };
}

/** Data Workbench rows of ONE tender -> BOQ lines. The spreadsheet row number is the file's own row (header = row 1). */
export function linesFromRows(rows: readonly { rowNum: number; values: Record<string, string> }[]): { lines: BoqLine[]; failed: RowOutcome[] } {
  const out: Omit<BoqLine, "key">[] = [];
  const failed: RowOutcome[] = [];
  for (const { rowNum, values } of rows) {
    const fail = (reason: string) => failed.push({ rowNum, status: "failed", reason });
    // The same rule as the Excel upload: with a Narration column it is the name and the Description is the details.
    const narration = oneLine(values.narration ?? "");
    const longText = (values.details ?? "").trim() || (narration ? (values.description ?? "").trim() : "");
    const description = (narration || oneLine(values.description ?? "")).slice(0, 1000);
    if (!description) { fail("Description is required"); continue; }
    const qty = parseNumber(values.quantity);
    if (qty == null) { fail("Quantity must be a number"); continue; }
    if (qty < 0 || qty > 9_999_999_999) { fail("Quantity out of range"); continue; }
    const client = parseClientColumns(values.client_columns);
    if (!client.ok) { fail("Client columns must be a JSON object of column name and text, or empty"); continue; }
    if (out.length >= BOQ_LIMITS.maxLines) { fail(`Only the first ${BOQ_LIMITS.maxLines.toLocaleString("en-US")} lines of a tender are read`); continue; }
    const rate = parseNumber(values.rate);
    out.push({
      row_no: rowNum,
      item_no: cellText(values.item_no) || null,
      description,
      details: longText && oneLine(longText) !== description ? multilineText(longText) : null,
      client_data: client.data,
      uom: cellText(values.unit) || null,
      qty,
      cost_code: cellText(values.cost_code) || null,
      file_rate: rate != null && rate > 0 ? rate : null,
    });
  }
  return { lines: assignKeys(out), failed };
}

// ── Where the priced file writes ────────────────────────────────────────────────────────────────────────────────────

export type ColumnPlan = {
  rate_col: number;
  amount_col: number;
  /** The client's file had no rate and/or amount column, so the missing ones sit after the last used column. */
  added: boolean;
};

/** The columns the priced workbook writes the unit rate and the amount into: the client's own, else new ones to the right. */
export function planColumns(grid: Grid, headerRow: number, map: ColumnMap): ColumnPlan {
  const header = grid[headerRow - 1] ?? [];
  let last = 0;
  header.forEach((c, i) => { if (cellText(c) !== "") last = Math.max(last, i + 1); });
  for (const v of Object.values(map)) if (v) last = Math.max(last, v);
  let next = last;
  const rate_col = map.rate ?? ++next;
  const amount_col = map.amount ?? ++next;
  return { rate_col, amount_col, added: map.rate == null || map.amount == null };
}

/** 1 -> A, 27 -> AA */
export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** A map from the request body: only known fields, column numbers 1..maxColumns, each column once. Null when it is not usable. */
export function parseColumnMap(input: unknown): ColumnMap | null {
  if (!input || typeof input !== "object") return null;
  const map: ColumnMap = {};
  const used = new Set<number>();
  for (const f of BOQ_FIELDS) {
    const v = (input as Record<string, unknown>)[f];
    if (v == null || v === "" || v === 0) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > BOQ_LIMITS.maxColumns || used.has(n)) return null;
    map[f] = n;
    used.add(n);
  }
  if (map.narration != null && map.description == null) { map.description = map.narration; delete map.narration; }
  return REQUIRED_FIELDS.every((f) => map[f] != null) ? map : null;
}
