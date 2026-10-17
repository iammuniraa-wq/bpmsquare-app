// Element-schedule import (docs/estimator-architecture.md §2, way 2): the path
// for quantities that come out of a BIM or detailing tool saved as a
// spreadsheet, instead of from the configurator form.
//
// DOCUMENTED COLUMNS (one row per element type + mark; a header row is
// required, column order is free, names are case-insensitive and spaces or
// units in brackets are ignored, e.g. "Length (m)" reads as length_m):
//
//   element_type  required. Must match an element type the template declares
//                 (a rule's `element_type`), e.g. wall_panel.
//   mark          the drawing mark / piece mark, kept as the line's element_ref.
//   count         how many identical pieces (whole number, default 1).
//   length_m      length of ONE piece, metres.
//   width_m       width of ONE piece, metres (for a wall panel: its height).
//   thickness_m   thickness of ONE piece, metres. "height_m" is accepted as an
//                 alias for the third dimension; if both are given thickness wins.
//   weight_t      optional weight of ONE piece, tonnes. When absent the weight
//                 is volume * the template's density rate (key ending
//                 density_t_m3), falling back to 2.4 t/m3.
//
// Volume of a row = count * length * width * thickness; area = count * length *
// width; running length = count * length. The quantity a row contributes to its
// template line depends on that line's unit: m3 -> volume, t -> weight,
// m2 -> area, m -> length, nr -> count.
//
// Hard limits (an uploaded file is untrusted input): 5 MB, 2000 data rows,
// 60-character marks, dimensions up to 100 m, weights up to 1000 t, counts up
// to 10000. Problems are reported per row (with the sheet row number) so a user
// can fix the file; good rows are still returned alongside the errors.

import { parseDelimited } from "@/lib/import/parse";
import { roundHalfAway } from "./formula";
import type { ScheduleQty } from "./compute";
import type { EstimateTemplateBody, TemplateRule } from "./types";

export const MAX_SCHEDULE_BYTES = 5 * 1024 * 1024;
export const MAX_SCHEDULE_ROWS = 2000;
const MAX_MARK_LENGTH = 60;
const MAX_DIM_M = 100;
const MAX_WEIGHT_T = 1000;
const MAX_COUNT = 10_000;
const DEFAULT_DENSITY = 2.4;
const HEADER_SCAN_ROWS = 10;

export const SCHEDULE_COLUMNS = [
  { key: "element_type", header: "element_type", required: true, help: "Element type from the list on the 'Element types' sheet" },
  { key: "mark", header: "mark", required: false, help: "Piece or drawing mark, e.g. W-101" },
  { key: "count", header: "count", required: false, help: "Number of identical pieces (default 1)" },
  { key: "length_m", header: "length_m", required: false, help: "Length of one piece, metres" },
  { key: "width_m", header: "width_m", required: false, help: "Width of one piece, metres (a wall panel's height)" },
  { key: "thickness_m", header: "thickness_m", required: false, help: "Thickness of one piece, metres (height_m also accepted)" },
  { key: "weight_t", header: "weight_t", required: false, help: "Weight of one piece, tonnes (optional)" },
] as const;

type ColumnKey = (typeof SCHEDULE_COLUMNS)[number]["key"] | "height_m";

const ALIASES: Record<string, ColumnKey> = {
  element_type: "element_type", type: "element_type", element: "element_type", elementtype: "element_type",
  mark: "mark", piece_mark: "mark", id: "mark", ref: "mark",
  count: "count", qty: "count", quantity: "count", nr: "count", pieces: "count",
  length_m: "length_m", length: "length_m",
  width_m: "width_m", width: "width_m",
  thickness_m: "thickness_m", thickness: "thickness_m", depth: "thickness_m", depth_m: "thickness_m",
  height_m: "height_m", height: "height_m",
  weight_t: "weight_t", weight: "weight_t",
};

export type ScheduleRowIssue = {
  /** 1-based row number in the uploaded sheet. */
  row: number;
  field?: string;
  message: string;
};

export type ScheduleRow = {
  row: number;
  element_type: string;
  mark: string | null;
  count: number;
  length_m: number | null;
  width_m: number | null;
  thickness_m: number | null;
  /** Totals for the whole row (count already applied). */
  volume_m3: number | null;
  area_m2: number | null;
  run_length_m: number | null;
  weight_t: number | null;
  /** The template rule this row feeds. */
  rule_code: string;
};

export type ScheduleParseResult = {
  /** True when no row had an error (warnings do not count). */
  ok: boolean;
  rows: ScheduleRow[];
  /** Ready for computeEstimate({ schedule }). */
  quantities: ScheduleQty[];
  errors: ScheduleRowIssue[];
  warnings: ScheduleRowIssue[];
  /** Per element type totals of the accepted rows. */
  totals: { element_type: string; rule_code: string; rows: number; pieces: number; volume_m3: number; weight_t: number }[];
  /** The sheet row of the header, 1-based (0 when none was found). */
  header_row: number;
};

export type ScheduleParseOptions = {
  template: EstimateTemplateBody;
  /** Overrides the density taken from the template (t/m3). */
  density_t_m3?: number;
};

const norm = (s: string): string =>
  s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Element type as typed in a file -> the key form a template declares. */
export const normaliseElementType = (s: string): string => norm(s);

function cellString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return "";
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
    if (typeof o.text === "string") return o.text.trim();
    if (o.result !== undefined && o.result !== null) return cellString(o.result);
  }
  return "";
}

/** Parse a number cell; null when blank, NaN when present but not a number. */
function parseNum(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : Number.NaN;
  const s = cellString(raw).replace(/\s+/g, "");
  if (s === "") return null;
  // "2,5" (decimal comma) but not "1,200.5" or "1,200".
  const t = /^-?\d+,\d+$/.test(s) && !/^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return Number.NaN;
  return Number(t);
}

type Basis = "volume" | "weight" | "area" | "length" | "count";

/** The quantity a unit of measure asks of a schedule row, or null if the unit
 *  cannot be fed from a schedule. */
export function basisForUom(uom: string): Basis | null {
  const u = uom.toLowerCase().replace(/³/g, "3").replace(/²/g, "2").replace(/[^a-z0-9]/g, "");
  if (["m3", "cum", "cbm"].includes(u)) return "volume";
  if (["t", "ton", "tons", "tonne", "tonnes", "mt"].includes(u)) return "weight";
  if (["m2", "sqm"].includes(u)) return "area";
  if (["m", "lm", "rm"].includes(u)) return "length";
  if (["nr", "no", "nos", "ea", "each", "pc", "pcs", "unit", "units", "piece", "pieces"].includes(u)) return "count";
  return null;
}

function densityOf(template: EstimateTemplateBody, override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) return override;
  const rate = template.rates.find((r) => /density_t_m3$/.test(r.key));
  return rate && Number.isFinite(rate.value) && rate.value > 0 ? rate.value : DEFAULT_DENSITY;
}

const r3 = (x: number) => roundHalfAway(x, 3);

/**
 * Parse a table of cells (already read from CSV or XLSX) into schedule rows
 * and template quantities. Never throws on bad data.
 */
export function parseScheduleRows(table: readonly (readonly unknown[])[], opts: ScheduleParseOptions): ScheduleParseResult {
  const result: ScheduleParseResult = { ok: false, rows: [], quantities: [], errors: [], warnings: [], totals: [], header_row: 0 };
  const rulesByType = new Map<string, TemplateRule>();
  for (const rule of opts.template.rules) if (rule.element_type) rulesByType.set(rule.element_type, rule);
  if (rulesByType.size === 0) {
    result.errors.push({ row: 0, message: "This template declares no element types, so a schedule cannot be matched to it." });
    return result;
  }
  const density = densityOf(opts.template, opts.density_t_m3);

  // Header row: the first of the first few rows that names element_type.
  let headerIdx = -1;
  let columns = new Map<ColumnKey, number>();
  for (let i = 0; i < Math.min(table.length, HEADER_SCAN_ROWS); i++) {
    const map = new Map<ColumnKey, number>();
    table[i].forEach((c, ci) => {
      const name = norm(cellString(c));
      const key = Object.prototype.hasOwnProperty.call(ALIASES, name) ? ALIASES[name] : undefined;
      if (key && !map.has(key)) map.set(key, ci);
    });
    if (map.has("element_type")) { headerIdx = i; columns = map; break; }
  }
  if (headerIdx < 0) {
    result.errors.push({ row: 0, message: 'No header row found. The first rows must include a column named "element_type" (see the template file for the columns).' });
    return result;
  }
  result.header_row = headerIdx + 1;

  const hasDims = columns.has("length_m") || columns.has("width_m") || columns.has("thickness_m") || columns.has("height_m") || columns.has("weight_t");
  if (!hasDims) {
    result.errors.push({ row: result.header_row, message: "The sheet has no dimension or weight columns (length_m, width_m, thickness_m, weight_t)." });
    return result;
  }

  const dataRows = table.slice(headerIdx + 1);
  if (dataRows.length > MAX_SCHEDULE_ROWS) {
    result.errors.push({ row: 0, message: `The schedule has ${dataRows.length} rows; the limit is ${MAX_SCHEDULE_ROWS}. Split it into several files.` });
    return result;
  }

  const get = (row: readonly unknown[], key: ColumnKey): unknown => {
    const ci = columns.get(key);
    return ci === undefined ? undefined : row[ci];
  };
  const seenMarks = new Map<string, number>();
  const totals = new Map<string, ScheduleParseResult["totals"][number]>();

  dataRows.forEach((cells, di) => {
    const rowNo = headerIdx + 2 + di;
    if (cells.every((c) => cellString(c) === "")) return;
    const errBefore = result.errors.length;
    const err = (field: string, message: string) => result.errors.push({ row: rowNo, field, message });
    const warn = (field: string | undefined, message: string) => result.warnings.push({ row: rowNo, field, message });

    const typeRaw = cellString(get(cells, "element_type"));
    const type = norm(typeRaw);
    if (!type) { err("element_type", "element_type is empty."); return; }
    const rule = rulesByType.get(type);
    if (!rule) {
      err("element_type", `Unknown element type "${typeRaw.slice(0, 40)}". This template accepts: ${[...rulesByType.keys()].join(", ")}.`);
      return;
    }

    const mark = cellString(get(cells, "mark"));
    if (mark.length > MAX_MARK_LENGTH) err("mark", `mark is longer than ${MAX_MARK_LENGTH} characters.`);

    let count = 1;
    const countRaw = parseNum(get(cells, "count"));
    if (countRaw !== null) {
      if (Number.isNaN(countRaw) || !Number.isInteger(countRaw) || countRaw < 1 || countRaw > MAX_COUNT) {
        err("count", `count must be a whole number from 1 to ${MAX_COUNT}.`);
      } else count = countRaw;
    }

    const dim = (key: ColumnKey, label: string): number | null => {
      const v = parseNum(get(cells, key));
      if (v === null) return null;
      if (Number.isNaN(v) || v <= 0 || v > MAX_DIM_M) { err(key, `${label} must be a number above 0 and up to ${MAX_DIM_M}.`); return null; }
      return v;
    };
    const length = dim("length_m", "length_m");
    const width = dim("width_m", "width_m");
    let thickness = dim("thickness_m", "thickness_m");
    const height = dim("height_m", "height_m");
    if (thickness === null && height !== null) thickness = height;
    else if (thickness !== null && height !== null) warn("height_m", "Both thickness_m and height_m are given; height_m is ignored.");

    let weightEach: number | null = null;
    const wRaw = parseNum(get(cells, "weight_t"));
    if (wRaw !== null) {
      if (Number.isNaN(wRaw) || wRaw <= 0 || wRaw > MAX_WEIGHT_T) err("weight_t", `weight_t must be a number above 0 and up to ${MAX_WEIGHT_T}.`);
      else weightEach = wRaw;
    }

    if (result.errors.length > errBefore) return; // report everything wrong with the row, then skip it

    const volumeEach = length !== null && width !== null && thickness !== null ? length * width * thickness : null;
    const areaEach = length !== null && width !== null ? length * width : null;
    if (volumeEach === null && weightEach === null && areaEach === null && length === null) {
      err("length_m", "The row has no dimensions or weight to measure.");
      return;
    }
    const totalWeight = weightEach !== null ? weightEach * count : volumeEach !== null ? volumeEach * density * count : null;
    const basis = basisForUom(rule.uom);
    if (!basis) {
      err("element_type", `The template line "${rule.code}" is measured in "${rule.uom}", which a schedule cannot feed. Use m3, t, m2, m or nr.`);
      return;
    }
    const values: Record<Basis, number | null> = {
      volume: volumeEach === null ? null : volumeEach * count,
      weight: totalWeight,
      area: areaEach === null ? null : areaEach * count,
      length: length === null ? null : length * count,
      count,
    };
    const qty = values[basis];
    if (qty === null) {
      err("element_type", `This row cannot give ${basis}, which line "${rule.code}" (${rule.uom}) needs; add the missing dimensions.`);
      return;
    }

    if (mark) {
      const prev = seenMarks.get(`${type}|${mark}`);
      if (prev !== undefined) warn("mark", `Mark "${mark}" already appears in row ${prev} for this element type.`);
      else seenMarks.set(`${type}|${mark}`, rowNo);
    }

    const row: ScheduleRow = {
      row: rowNo,
      element_type: type,
      mark: mark || null,
      count,
      length_m: length,
      width_m: width,
      thickness_m: thickness,
      volume_m3: values.volume === null ? null : r3(values.volume),
      area_m2: values.area === null ? null : r3(values.area),
      run_length_m: values.length === null ? null : r3(values.length),
      weight_t: totalWeight === null ? null : r3(totalWeight),
      rule_code: rule.code,
    };
    result.rows.push(row);
    result.quantities.push({ rule_code: rule.code, qty: r3(qty), element_ref: mark || null, label: mark || null });

    const t = totals.get(type) ?? { element_type: type, rule_code: rule.code, rows: 0, pieces: 0, volume_m3: 0, weight_t: 0 };
    t.rows++;
    t.pieces += count;
    t.volume_m3 = r3(t.volume_m3 + (row.volume_m3 ?? 0));
    t.weight_t = r3(t.weight_t + (row.weight_t ?? 0));
    totals.set(type, t);
  });

  result.totals = [...totals.values()];
  if (result.rows.length === 0 && result.errors.length === 0) {
    result.errors.push({ row: 0, message: "The schedule has no data rows." });
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ── Files ────────────────────────────────────────────────────────────────────

export class ScheduleFileError extends Error {}

/** Read a CSV or XLSX upload into a table of cells. */
export async function readScheduleTable(data: Uint8Array, filename: string): Promise<unknown[][]> {
  if (data.byteLength > MAX_SCHEDULE_BYTES) {
    throw new ScheduleFileError(`The file is ${(data.byteLength / 1048576).toFixed(1)} MB; the limit is ${MAX_SCHEDULE_BYTES / 1048576} MB.`);
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return parseDelimited(new TextDecoder("utf-8").decode(data));
  }
  if (lower.endsWith(".xlsx")) {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(data as unknown as ArrayBuffer);
    } catch {
      throw new ScheduleFileError("The file could not be read as an Excel workbook.");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new ScheduleFileError("The workbook has no sheets.");
    const out: unknown[][] = [];
    const cap = MAX_SCHEDULE_ROWS + HEADER_SCAN_ROWS + 5;
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      if (n > cap) return;
      const cells: unknown[] = [];
      const width = Math.min(row.cellCount, 30);
      for (let c = 1; c <= width; c++) cells.push(row.getCell(c).value);
      out.push(cells);
    });
    if (ws.rowCount > cap) {
      throw new ScheduleFileError(`The sheet has more than ${MAX_SCHEDULE_ROWS} data rows; split it into several files.`);
    }
    return out;
  }
  throw new ScheduleFileError("Upload a .csv or .xlsx file.");
}

export async function parseScheduleFile(data: Uint8Array, filename: string, opts: ScheduleParseOptions): Promise<ScheduleParseResult> {
  return parseScheduleRows(await readScheduleTable(data, filename), opts);
}

// ── Downloadable template ────────────────────────────────────────────────────

/** Element types the template accepts, with the unit each feeds. */
export function templateElementTypes(template: EstimateTemplateBody): { element_type: string; rule_code: string; description: string; uom: string; basis: string }[] {
  return template.rules
    .filter((r) => r.element_type)
    .map((r) => ({
      element_type: r.element_type!,
      rule_code: r.code,
      description: r.description,
      uom: r.uom,
      basis: basisForUom(r.uom) ?? "unsupported unit",
    }));
}

const SAMPLE_ROW: Record<string, string | number> = {
  mark: "W-101", count: 4, length_m: 6, width_m: 3, thickness_m: 0.2, weight_t: "",
};

export function buildScheduleTemplateCsv(template: EstimateTemplateBody): string {
  const first = templateElementTypes(template)[0]?.element_type ?? "element_type_here";
  const header = SCHEDULE_COLUMNS.map((c) => c.header).join(",");
  const sample = SCHEDULE_COLUMNS.map((c) => (c.key === "element_type" ? first : SAMPLE_ROW[c.key] ?? "")).join(",");
  return `${header}\r\n${sample}\r\n`;
}

/** The downloadable workbook: a Schedule sheet with the header and one sample
 *  row, and an Element types sheet listing what the template accepts. */
export async function buildScheduleTemplateWorkbook(template: EstimateTemplateBody): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Schedule");
  ws.columns = SCHEDULE_COLUMNS.map((c) => ({ key: c.key, width: c.key === "element_type" ? 22 : 14 }));
  const header = ws.addRow(SCHEDULE_COLUMNS.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E8C" } }; });
  const types = templateElementTypes(template);
  ws.addRow(SCHEDULE_COLUMNS.map((c) => (c.key === "element_type" ? types[0]?.element_type ?? "" : SAMPLE_ROW[c.key] ?? "")));
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const info = wb.addWorksheet("Element types");
  info.columns = [{ width: 22 }, { width: 44 }, { width: 10 }, { width: 14 }];
  const ih = info.addRow(["element_type", "Feeds template line", "Unit", "Measured as"]);
  ih.font = { bold: true };
  for (const t of types) info.addRow([t.element_type, t.description, t.uom, t.basis]);
  info.addRow([]);
  info.addRow(["Columns"]).font = { bold: true };
  for (const c of SCHEDULE_COLUMNS) info.addRow([c.header, c.help, c.required ? "required" : "optional"]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
