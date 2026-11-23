import type { NewElement } from "./types";

// Route B of the design (docs/design/pcbs-drawing-register.md section 6): the elements a revision declares are read from a FILE a person
// drops in. Today that is an Excel or CSV schedule (a Revit schedule export, or a Tekla/Allplan report). The reader sits behind the
// ElementReader interface so a model reader can be added without touching the routes: an IFC reader needs one open-source library and
// the owner has not approved a new dependency yet, so it is registered below as NOT available, with the reason.
// Pure apart from the Excel decoding (a dynamic import of exceljs, already installed): no database, no request.

export const MAX_SCHEDULE_ROWS = 20000;
export const DEFAULT_DENSITY_T_M3 = 2.5;

export const ELEMENT_FIELDS = ["model_uid", "element_code", "element_type", "building", "level", "qty", "unit", "volume_m3", "area_m2", "length_m", "weight_t"] as const;
export type ElementField = (typeof ELEMENT_FIELDS)[number];
export const ELEMENT_FIELD_LABEL: Record<ElementField, string> = {
  model_uid: "Model id (IFC GlobalId, Revit UniqueId)", element_code: "Element code (Mark)", element_type: "Element type", building: "Building", level: "Level",
  qty: "Number of pieces", unit: "Unit", volume_m3: "Volume per piece", area_m2: "Area per piece", length_m: "Length per piece", weight_t: "Weight per piece",
};
export const NUMERIC_FIELDS: readonly ElementField[] = ["qty", "volume_m3", "area_m2", "length_m", "weight_t"];

/** The saved map of a drawing type (and what a person confirms on first read): which column of the file is which field. */
export type ScheduleMap = {
  /** field -> the column's header text exactly as it appears in the file. */
  columns: Partial<Record<ElementField, string>>;
  /** The worksheet to read (default: the first that has data). */
  sheet?: string;
  /** Units the file uses, when its headers do not say (otherwise detected from the header). */
  units?: Partial<Record<Quantity, string>>;
  /** Weight is volume x this when the file carries none. */
  density_t_m3?: number;
};

export type Quantity = "volume" | "area" | "length" | "weight";
const QUANTITY_OF: Partial<Record<ElementField, Quantity>> = { volume_m3: "volume", area_m2: "area", length_m: "length", weight_t: "weight" };

// unit token -> factor to the stored unit (m3, m2, m, t)
const UNIT_FACTORS: Record<Quantity, Record<string, number>> = {
  volume: { m3: 1, "m³": 1, cum: 1, mm3: 1e-9, "mm³": 1e-9, cm3: 1e-6, ft3: 0.0283168, "ft³": 0.0283168, l: 0.001, litre: 0.001, liter: 0.001 },
  area: { m2: 1, "m²": 1, sqm: 1, mm2: 1e-6, "mm²": 1e-6, ft2: 0.092903, "ft²": 0.092903, sqft: 0.092903 },
  length: { m: 1, mm: 0.001, cm: 0.01, ft: 0.3048 },
  weight: { t: 1, tonne: 1, ton: 1, tons: 1, tonnes: 1, kg: 0.001, lb: 0.000453592, lbs: 0.000453592 },
};
const DEFAULT_UNIT: Record<Quantity, string> = { volume: "m3", area: "m2", length: "m", weight: "t" };
export const UNIT_CHOICES: Record<Quantity, string[]> = {
  volume: ["m3", "mm3", "cm3", "ft3", "l"], area: ["m2", "mm2", "ft2"], length: ["m", "mm", "cm", "ft"], weight: ["t", "kg", "lb"],
};

const SYNONYMS: Record<ElementField, string[]> = {
  model_uid: ["globalid", "global id", "uniqueid", "unique id", "guid", "model id", "ifc id", "element id"],
  element_code: ["element code", "mark", "type mark", "piece mark", "code", "item code", "tag", "id"],
  element_type: ["element type", "type", "family and type", "family", "category", "description", "piece type", "name"],
  building: ["building", "block", "zone", "structure"],
  level: ["level", "floor", "storey", "story"],
  qty: ["count", "qty", "quantity", "no", "nos", "number", "pieces"],
  unit: ["unit", "uom"],
  volume_m3: ["volume", "vol", "concrete volume", "net volume"],
  area_m2: ["area", "surface area", "net area"],
  length_m: ["length", "span"],
  weight_t: ["weight", "mass", "wt"],
};

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^a-z0-9³² ]+/g, " ").replace(/\s+/g, " ").trim();

/** A map suggested from the header row: the first header whose words match, in the order of the synonyms (most specific first). */
export function suggestMap(headers: readonly string[]): ScheduleMap["columns"] {
  const cols: ScheduleMap["columns"] = {};
  const used = new Set<number>();
  for (const field of ELEMENT_FIELDS) {
    for (const syn of SYNONYMS[field]) {
      const idx = headers.findIndex((h, i) => !used.has(i) && norm(h) === syn);
      if (idx >= 0) { cols[field] = headers[idx]; used.add(idx); break; }
    }
  }
  // looser pass: a header that starts with a synonym ("Volume (m3)" is caught by the strip above, "Total volume" here)
  for (const field of ELEMENT_FIELDS) {
    if (cols[field]) continue;
    for (const syn of SYNONYMS[field]) {
      const idx = headers.findIndex((h, i) => !used.has(i) && (` ${norm(h)} `).includes(` ${syn} `));
      if (idx >= 0) { cols[field] = headers[idx]; used.add(idx); break; }
    }
  }
  return cols;
}

/** The unit written in a header, e.g. "Volume (m³)" -> "m³", "Weight [kg]" -> "kg", "Length mm" -> "mm". null = not stated. */
export function unitInHeader(header: string, q: Quantity): string | null {
  const bracket = /[([]\s*([^)\]]+?)\s*[)\]]/.exec(header)?.[1]?.toLowerCase().replace(/\s+/g, "");
  if (bracket && UNIT_FACTORS[q][bracket] !== undefined) return bracket;
  const tail = header.trim().toLowerCase().split(/\s+/).pop() ?? "";
  if (tail && UNIT_FACTORS[q][tail] !== undefined && header.trim().split(/\s+/).length > 1) return tail;
  return null;
}

const toNumber = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/ /g, " ");
  if (!s) return null;
  s = s.replace(/[^\d.,\-+eE]/g, "");
  if (!s || s === "-" || s === "+") return null;
  if (/^[-+]?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const s = (typeof v === "object" ? "" : String(v)).replace(/[\u0000-\u001f]/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

// ── The grid ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type Grid = { rows: unknown[][]; sheet: string; sheets: string[] };

/** A small RFC 4180 reader: quotes, doubled quotes, embedded newlines; the delimiter is the commonest of , ; tab in the first lines. */
export function parseCsv(textIn: string): unknown[][] {
  const t = textIn.replace(/^﻿/, "");
  const head = t.split(/\r?\n/).slice(0, 5).join("\n");
  const count = (c: string) => head.split(c).length - 1;
  const delim = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const cellValue = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.result !== undefined) return cellValue(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (typeof o.text === "string") return o.text;
    return null;
  }
  return v;
};

export async function readGrid(name: string, bytes: Uint8Array, sheet?: string): Promise<{ ok: true; grid: Grid } | { ok: false; error: string }> {
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith(".csv")) {
      const rows = parseCsv(Buffer.from(bytes).toString("utf8")).slice(0, MAX_SCHEDULE_ROWS + 25);
      return { ok: true, grid: { rows, sheet: "csv", sheets: ["csv"] } };
    }
    if (!lower.endsWith(".xlsx")) return { ok: false, error: "A schedule is an Excel (.xlsx) or CSV file" };
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    const sheets = wb.worksheets.map((w) => w.name);
    const ws = (sheet ? wb.worksheets.find((w) => w.name === sheet) : undefined) ?? wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) return { ok: false, error: "The workbook has no data" };
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length > MAX_SCHEDULE_ROWS + 25) return;
      const cells: unknown[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(cellValue(row.getCell(c).value));
      rows.push(cells);
    });
    return { ok: true, grid: { rows, sheet: ws.name, sheets } };
  } catch {
    return { ok: false, error: "This file could not be read as a schedule" };
  }
}

/** The header row: within the first 25 rows, the one whose cells match the most known words (ties: the earlier). */
export function findHeaderRow(rows: readonly unknown[][]): number {
  let best = -1, bestScore = 0;
  rows.slice(0, 25).forEach((r, i) => {
    const cells = r.map((c) => (c == null ? "" : String(c)));
    if (cells.filter((c) => c.trim()).length < 2) return;
    const score = Object.keys(suggestMap(cells)).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

// ── Reading ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ReadWarning = { row?: number; message: string };
export type ReadResult =
  | { ok: true; elements: NewElement[]; warnings: ReadWarning[]; map: ScheduleMap["columns"]; headers: string[]; sheet: string; sheets: string[];
      units: Record<Quantity, { unit: string; assumed: boolean }>; skipped: number }
  | { ok: false; error: string };

export type ReaderInput = { name: string; bytes: Uint8Array; map?: ScheduleMap };

export interface ElementReader {
  id: "schedule" | "ifc";
  label: string;
  extensions: string[];
  available: boolean;
  /** Why it is not offered (shown to the person, never hidden). */
  unavailableReason?: string;
  read(input: ReaderInput): Promise<ReadResult>;
}

const TOTAL_WORD = /^(grand\s+)?total(s)?\b/i;

export const scheduleReader: ElementReader = {
  id: "schedule",
  label: "Excel or CSV schedule",
  extensions: ["xlsx", "csv"],
  available: true,
  async read({ name, bytes, map }) {
    const g = await readGrid(name, bytes, map?.sheet);
    if (!g.ok) return g;
    const { rows, sheet, sheets } = g.grid;
    const h = findHeaderRow(rows);
    if (h < 0) return { ok: false, error: "No header row was found. The first rows need column names such as Mark, Type, Count, Volume" };
    const headers = rows[h].map((c) => (c == null ? "" : String(c).trim()));
    const columns = { ...suggestMap(headers), ...(map?.columns ?? {}) };
    const index = new Map<ElementField, number>();
    for (const f of ELEMENT_FIELDS) {
      const header = columns[f];
      if (!header) continue;
      const i = headers.findIndex((x) => x === header);
      if (i >= 0) index.set(f, i);
    }
    if (!index.has("element_code") && !index.has("model_uid")) return { ok: false, error: "A column for the element code (Mark) or the model id is needed to follow elements from one revision to the next" };

    const units = {} as Record<Quantity, { unit: string; assumed: boolean }>;
    for (const q of ["volume", "area", "length", "weight"] as Quantity[]) {
      const field = (Object.keys(QUANTITY_OF) as ElementField[]).find((f) => QUANTITY_OF[f] === q)!;
      const chosen = map?.units?.[q]?.toLowerCase();
      const fromHeader = index.has(field) ? unitInHeader(headers[index.get(field)!], q) : null;
      const unit = chosen && UNIT_FACTORS[q][chosen] !== undefined ? chosen : fromHeader ?? DEFAULT_UNIT[q];
      units[q] = { unit, assumed: !chosen && !fromHeader };
    }
    const factor = (q: Quantity) => UNIT_FACTORS[q][units[q].unit] ?? 1;
    const density = map?.density_t_m3 && map.density_t_m3 > 0 ? map.density_t_m3 : DEFAULT_DENSITY_T_M3;

    const warnings: ReadWarning[] = [];
    const out: NewElement[] = [];
    const seenUid = new Set<string>();
    const seenCode = new Set<string>();
    let skipped = 0;
    const body = rows.slice(h + 1);
    if (body.length > MAX_SCHEDULE_ROWS) return { ok: false, error: `The schedule has more than ${MAX_SCHEDULE_ROWS} rows. Split it by building` };

    body.forEach((r, k) => {
      const rowNo = h + 2 + k;
      if (!r.some((c) => c != null && String(c).trim() !== "")) return;
      const get = (f: ElementField) => (index.has(f) ? r[index.get(f)!] : null);
      const code = text(get("element_code"), 120), uid = text(get("model_uid"), 120), type = text(get("element_type"), 120);
      if ((code && TOTAL_WORD.test(code)) || (!code && !uid && type && TOTAL_WORD.test(type))) { skipped++; return; }
      if (!code && !uid) { skipped++; warnings.push({ row: rowNo, message: "No element code or model id: row skipped" }); return; }
      if (uid) { if (seenUid.has(uid)) { skipped++; warnings.push({ row: rowNo, message: `Model id ${uid} appears twice: the second row was skipped` }); return; } seenUid.add(uid); }
      if (code && !uid) { if (seenCode.has(code)) warnings.push({ row: rowNo, message: `Element code ${code} appears more than once: a revision follows elements by code, so keep one row per code` }); seenCode.add(code); }
      let qty = 1;
      if (index.has("qty")) {
        const n = toNumber(get("qty"));
        if (n === null || n <= 0) { skipped++; warnings.push({ row: rowNo, message: "The number of pieces is empty or not above zero: row skipped" }); return; }
        qty = n;
      }
      const q = (f: ElementField, quantity: Quantity): number | null => { const n = toNumber(get(f)); return n === null ? null : Math.round(n * factor(quantity) * 1e6) / 1e6; };
      const volume = q("volume_m3", "volume");
      const area = q("area_m2", "area");
      const length = q("length_m", "length");
      let weight = q("weight_t", "weight");
      let calculated = false;
      if (weight === null && volume !== null) { weight = Math.round(volume * density * 1e6) / 1e6; calculated = true; }
      out.push({
        model_uid: uid, element_code: code, element_type: type, building: text(get("building"), 120), level: text(get("level"), 80),
        qty, unit: text(get("unit"), 20), volume_m3: volume, area_m2: area, length_m: length, weight_t: weight, weight_calculated: calculated, attrs: {},
      });
    });
    if (out.length === 0) return { ok: false, error: "No element rows were found under the header" };
    return { ok: true, elements: out, warnings: warnings.slice(0, 50), map: columns, headers, sheet, sheets, units, skipped };
  },
};

/** The quantities this file carries a column for but states no unit for: a person confirms these before the file is loaded (the DXF $INSUNITS rule). */
export function unitsToConfirm(r: Extract<ReadResult, { ok: true }>): Quantity[] {
  const out: Quantity[] = [];
  for (const f of ["volume_m3", "area_m2", "length_m", "weight_t"] as ElementField[]) {
    const q = QUANTITY_OF[f]!;
    if (r.map[f] && r.units[q].assumed) out.push(q);
  }
  return out;
}

/** IFC (IFC2x3 / IFC4 from Revit): designed behind the same interface, deliberately NOT built yet. It needs one open-source reader
 * library (web-ifc, WASM) and the owner has not approved a new dependency. Until then a .ifc file is stored as an attachment. */
export const ifcReader: ElementReader = {
  id: "ifc",
  label: "IFC model",
  extensions: ["ifc"],
  available: false,
  unavailableReason: "Reading IFC models is a later step. Export a schedule from the model for now.",
  async read() { return { ok: false, error: "Reading IFC models is a later step. Export a schedule from the model for now." }; },
};

export const ELEMENT_READERS: readonly ElementReader[] = [scheduleReader, ifcReader];
export const readerFor = (name: string): ElementReader | null => {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ELEMENT_READERS.find((r) => r.extensions.includes(ext)) ?? null;
};
