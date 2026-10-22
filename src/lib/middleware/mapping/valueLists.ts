import { parseDelimited } from "@/lib/import/parse";
import { csvCell } from "@/lib/import/template";
import {
  MAX_CUSTOM_LISTS, MAX_LIST_ROWS, STANDARD_LIST_KINDS, STANDARD_LIST_LABEL,
  type MapRow, type MappingDocument, type StandardListKind, type ValueList, type ValueListRow,
} from "./types";

// Value lists (spec section 5): one per kind of value, per connection, used outbound and (reversed) inbound.
// Pure: validation, CSV, the counters, the unknown-code book-keeping. The store is valueListStore.ts.

export const CUSTOM_KIND_RE = /^custom:[a-z0-9_]{1,40}$/;
export const isListKind = (v: unknown): v is string => typeof v === "string" && ((STANDARD_LIST_KINDS as readonly string[]).includes(v) || CUSTOM_KIND_RE.test(v));
export const isStandardKind = (v: string): v is StandardListKind => (STANDARD_LIST_KINDS as readonly string[]).includes(v);

export const MAX_VALUE_LEN = 200;
export const MAX_UNKNOWN_IN = 50;

export const kindLabel = (kind: string): string =>
  isStandardKind(kind) ? STANDARD_LIST_LABEL[kind] : kind.replace(/^custom:/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export type ListRowError = { row: number | null; message: string };
type Validated = { ok: true; rows: ValueListRow[]; default_in: string | null } | { ok: false; errors: ListRowError[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The rows a person saved. One BPMSquare value is one row (outbound is a lookup); an ERP code may come from several rows
 * (many to one) but exactly one of them is the answer when that code comes back (`inbound`). A single row for a code is
 * that answer when the flag was not sent. An empty ERP code is allowed (the row is shown red "needs a code"): it
 * blocks the send of that value, not the save of the list.
 */
export function validateListInput(rawRows: unknown, rawDefault: unknown): Validated {
  const errors: ListRowError[] = [];
  if (!Array.isArray(rawRows)) return { ok: false, errors: [{ row: null, message: "Send the rows as a list." }] };
  if (rawRows.length > MAX_LIST_ROWS) return { ok: false, errors: [{ row: null, message: `A list holds at most ${MAX_LIST_ROWS} rows.` }] };
  let def: string | null = null;
  if (rawDefault !== undefined && rawDefault !== null && rawDefault !== "") {
    if (typeof rawDefault !== "string" || rawDefault.trim().length > MAX_VALUE_LEN) errors.push({ row: null, message: "The default for an unknown inbound code is a BPMSquare value." });
    else def = rawDefault.trim();
  }
  const rows: ValueListRow[] = [];
  const seen = new Map<string, number>();
  rawRows.forEach((r, i) => {
    if (!isObj(r)) { errors.push({ row: i, message: "Each row has a BPMSquare value and an ERP code." }); return; }
    const bpm = typeof r.bpm === "string" ? r.bpm.trim() : "";
    const erp = r.erp === undefined || r.erp === null ? "" : typeof r.erp === "string" || typeof r.erp === "number" ? String(r.erp).trim() : null;
    if (!bpm || bpm.length > MAX_VALUE_LEN) { errors.push({ row: i, message: "Give the BPMSquare value (up to 200 characters)." }); return; }
    if (erp === null || erp.length > MAX_VALUE_LEN) { errors.push({ row: i, message: "The ERP code is text of up to 200 characters." }); return; }
    if (r.inbound !== undefined && typeof r.inbound !== "boolean") { errors.push({ row: i, message: "In is on or off." }); return; }
    const key = bpm.toLowerCase();
    if (seen.has(key)) { errors.push({ row: i, message: `'${bpm}' is already on row ${seen.get(key)! + 1}: one BPMSquare value has one ERP code.` }); return; }
    seen.set(key, i);
    rows.push({ bpm, erp, inbound: r.inbound === true });
  });
  if (errors.length) return { ok: false, errors };

  const byCode = new Map<string, number[]>();
  rows.forEach((r, i) => { if (r.erp) byCode.set(r.erp.toLowerCase(), [...(byCode.get(r.erp.toLowerCase()) ?? []), i]); });
  for (const [code, idx] of byCode) {
    if (idx.length === 1) {
      // A lone row is the answer for its code, marked or not.
      rows[idx[0]].inbound = true;
      continue;
    }
    const marked = idx.filter((i) => rows[i].inbound);
    if (marked.length !== 1) {
      errors.push({ row: marked.length ? marked[1] : idx[0], message: `${marked.length ? "Two rows" : "No row"} for the ERP code '${rows.find((r) => r.erp.toLowerCase() === code)!.erp}' ${marked.length ? "are" : "is"} marked In: choose exactly one.` });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows, default_in: def };
}

// ── Counters ─────────────────────────────────────────────────────────────────

/** Every value-list kind a mapping document's rows go through. */
export function listKindsUsed(doc: Pick<MappingDocument, "header" | "lines">): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [block, rows] of [["header", doc.header], ["lines", doc.lines]] as const) {
    for (const r of rows) {
      if (r.convert?.kind === "value_list") out.set(r.convert.list, [...(out.get(r.convert.list) ?? []), `${block}:${r.target}`]);
    }
  }
  return out;
}

/** Rows whose BPMSquare value no field row references. A list used by no row at all has every row unused. */
export function unusedCount(list: ValueList, usedKinds: Set<string>): number {
  return usedKinds.has(list.kind) ? 0 : list.rows.length;
}

export type ListUse = { document: string; field: string };

/** Where a list is referenced, over the active documents of a connection. */
export function listUsedBy(kind: string, docs: { document: string; doc: Pick<MappingDocument, "header" | "lines"> }[]): ListUse[] {
  const out: ListUse[] = [];
  for (const d of docs) {
    for (const r of [...d.doc.header, ...d.doc.lines] as MapRow[]) {
      if (r.convert?.kind === "value_list" && r.convert.list === kind) out.push({ document: d.document, field: r.target });
    }
  }
  return out;
}

/** The unmapped inbound codes after a pull: distinct, newest kept, capped at 50. */
export function mergeUnknownIn(prev: string[], seen: string[]): string[] {
  const out = prev.filter((c) => !seen.includes(c));
  out.push(...seen);
  return [...new Set(out)].slice(-MAX_UNKNOWN_IN);
}

/** Codes no row of the list answers any more: a code that was added since is no longer "unknown". */
export function stillUnknown(list: Pick<ValueList, "rows" | "unknown_in">): string[] {
  const known = new Set(list.rows.map((r) => r.erp.toLowerCase()).filter(Boolean));
  return list.unknown_in.filter((c) => !known.has(c.toLowerCase()));
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export const CSV_HEADER = "bpm_value,erp_code,inbound";

export function listToCsv(list: Pick<ValueList, "rows">): string {
  return [CSV_HEADER, ...list.rows.map((r) => [csvCell(r.bpm), csvCell(r.erp), r.inbound ? "yes" : "no"].join(","))].join("\n") + "\n";
}

/** csvCell prefixes a quote to a cell that would run as a formula; the same cell read back drops it again. */
const unquoteGuard = (v: string) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

export function parseListCsv(text: string): { ok: true; rows: { bpm: string; erp: string; inbound?: boolean }[] } | { ok: false; errors: ListRowError[] } {
  if (typeof text !== "string" || !text.trim()) return { ok: false, errors: [{ row: null, message: "The file is empty." }] };
  let grid: string[][];
  try {
    grid = parseDelimited(text);
  } catch {
    return { ok: false, errors: [{ row: null, message: "That file could not be read as CSV." }] };
  }
  const head = (grid[0] ?? []).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const iBpm = head.findIndex((h) => ["bpm_value", "bpm", "bpmsquare_value"].includes(h));
  const iErp = head.findIndex((h) => ["erp_code", "erp", "code"].includes(h));
  const iIn = head.findIndex((h) => ["inbound", "in"].includes(h));
  if (iBpm < 0 || iErp < 0) return { ok: false, errors: [{ row: null, message: "The first row must name the columns: bpm_value, erp_code and (optional) inbound." }] };
  const body = grid.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (body.length > MAX_LIST_ROWS) return { ok: false, errors: [{ row: null, message: `Import at most ${MAX_LIST_ROWS} rows.` }] };
  const rows = body.map((r) => {
    const base = { bpm: unquoteGuard((r[iBpm] ?? "").trim()), erp: unquoteGuard((r[iErp] ?? "").trim()) };
    if (iIn < 0) return base;
    return { ...base, inbound: ["yes", "true", "1", "y", "x"].includes((r[iIn] ?? "").trim().toLowerCase()) };
  });
  return { ok: true, rows };
}

/** The import preview: what the file would add, change and remove, before it replaces the list. */
export function diffRows(before: ValueListRow[], after: ValueListRow[]): { added: number; changed: number; removed: number } {
  const b = new Map(before.map((r) => [r.bpm.toLowerCase(), r]));
  const a = new Map(after.map((r) => [r.bpm.toLowerCase(), r]));
  let added = 0, changed = 0, removed = 0;
  for (const [k, r] of a) {
    const old = b.get(k);
    if (!old) added++;
    else if (old.erp !== r.erp || old.inbound !== r.inbound) changed++;
  }
  for (const k of b.keys()) if (!a.has(k)) removed++;
  return { added, changed, removed };
}

export function customCount(kinds: string[]): number {
  return kinds.filter((k) => CUSTOM_KIND_RE.test(k)).length;
}
export const canAddCustom = (kinds: string[]): boolean => customCount(kinds) < MAX_CUSTOM_LISTS;

/** A custom kind from a label the person typed: `custom:site_type`. */
export function customKindFromLabel(label: string): string | null {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return slug ? `custom:${slug}` : null;
}
