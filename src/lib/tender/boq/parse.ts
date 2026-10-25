// Reading a client's BOQ sheet (GCC tender deals, slice 3a). PURE: it works on a grid of plain cell values, so the header
// and column detection is unit-tested without a workbook. The workbook itself is turned into a grid by workbook.ts.
//
// AI-free on purpose: a client's BOQ has a title block (often merged cells), then a header row, then item rows, section
// headings, subtotals and a grand total. We find the header row by how many known column names it carries, map the columns
// from those names, and read the rows below it. The "fix the mapping" panel lets a person correct any of it; nothing here
// is trusted beyond what the person confirms.

export type Cell = string | number | null;
/** grid[r][c], both 0-based. Spreadsheet row 1 is grid[0]. Merged cells carry their text in the top-left cell only. */
export type Grid = Cell[][];

export const BOQ_FIELDS = ["item_no", "description", "uom", "qty", "cost_code", "rate", "amount"] as const;
export type BoqField = (typeof BOQ_FIELDS)[number];
/** field -> 1-based column number. */
export type ColumnMap = Partial<Record<BoqField, number>>;

export const FIELD_LABEL: Record<BoqField, string> = {
  item_no: "Item no.", description: "Description", uom: "Unit", qty: "Quantity", cost_code: "Cost code", rate: "Unit rate", amount: "Amount",
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

const EXACT: Record<BoqField, string[]> = {
  item_no: ["item", "item no", "item number", "item ref", "no", "sl", "sl no", "s no", "sr", "sr no", "serial", "serial no", "serial number", "bill no", "bill ref", "bill item", "ref", "reference", "pos", "position", "clause", "clause no", "sn", "s n", "number", "bq no", "boq no", "boq item"],
  description: ["description", "item description", "description of work", "description of works", "description of item", "description of items", "work description", "material description", "particulars", "scope", "scope of work", "scope of works", "work item", "details", "activity"],
  uom: ["unit", "units", "uom", "u o m", "um", "unit of measure", "unit of measurement", "measure"],
  qty: ["qty", "quantity", "quantities", "q ty", "qnty", "total qty", "total quantity", "boq qty", "boq quantity", "est qty", "estimated quantity", "no of units"],
  cost_code: ["cost code", "cost code no", "csi", "csi code", "masterformat", "master format", "masterformat code", "master format code", "division", "wbs", "wbs code", "spec section", "specification section", "spec ref", "section", "section no", "code", "item code", "spec no"],
  rate: ["rate", "unit rate", "unit price", "price", "rate per unit", "contractor rate", "bid rate", "quoted rate"],
  amount: ["amount", "total", "total amount", "total price", "value", "line total", "extended", "extended price", "total value", "bid amount", "price total"],
};

/** Looser matches, for labels like "Description of Works / الوصف" or "Unit Rate in SAR". Lower strength than an exact name. */
const CONTAINS: Record<BoqField, RegExp> = {
  item_no: /^(item|sl|sr|serial|bill)\b.*\b(no|number|ref)\b/,
  description: /description|particulars|scope of/,
  uom: /\bunit of\b|\buom\b/,
  qty: /\bqty\b|quantit|\bq ty\b/,
  cost_code: /cost code|master ?format|\bcsi\b|\bwbs\b|spec(ification)? (section|ref)/,
  rate: /\brate\b|unit price/,
  amount: /\bamount\b|total price|total value/,
};

type Hit = { field: BoqField; strength: number };

/** What a header label could be: exact names score 2, looser matches 1. */
export function classifyLabel(raw: string): Hit[] {
  const label = normaliseLabel(raw);
  if (!label) return [];
  const hits: Hit[] = [];
  for (const f of BOQ_FIELDS) {
    if (EXACT[f].includes(label)) hits.push({ field: f, strength: 2 });
    else if (CONTAINS[f].test(label)) hits.push({ field: f, strength: 1 });
  }
  // "Total qty" is a quantity, "Unit rate" a rate: when a label is exactly known for one field, looser matches elsewhere are noise.
  const exact = hits.filter((h) => h.strength === 2);
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

export type BoqLine = {
  /** 1-based spreadsheet row. */
  row_no: number;
  item_no: string | null;
  description: string;
  uom: string | null;
  qty: number;
  cost_code: string | null;
  /** The rate the client's file already carried (> 0), if any. */
  file_rate: number | null;
  /** The matching key of a re-upload. */
  key: string;
};

export type SkippedRow = { row_no: number; reason: string; text: string };

export type ParsedBoq = {
  lines: BoqLine[];
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

/** Read the item rows below the header. Section headings, subtotals, blank rows and the grand total are skipped (and reported). */
export function extractLines(grid: Grid, headerRow: number, map: ColumnMap): ParsedBoq {
  const out: Omit<BoqLine, "key">[] = [];
  const skipped: SkippedRow[] = [];
  let totalRow: number | null = null;
  let truncated = false;
  const at = (row: Cell[], field: BoqField): Cell => (map[field] != null ? row[map[field]! - 1] ?? null : null);

  for (let r = headerRow; r < Math.min(grid.length, BOQ_LIMITS.maxRows); r++) {
    const row = grid[r] ?? [];
    const rowNo = r + 1;
    if (row.every((c) => cellText(c) === "")) continue;
    const desc = cellText(at(row, "description"));
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
    out.push({
      row_no: rowNo,
      item_no: itemNo || null,
      description: desc.replace(/\s+/g, " ").slice(0, 1000),
      uom: cellText(at(row, "uom")) || null,
      qty,
      cost_code: cellText(at(row, "cost_code")) || null,
      file_rate: rate != null && rate > 0 ? rate : null,
    });
  }
  return { lines: assignKeys(out), skipped, total_row: totalRow, truncated };
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
  return REQUIRED_FIELDS.every((f) => map[f] != null) ? map : null;
}
