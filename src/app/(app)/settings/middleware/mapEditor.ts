import type { D365EntityKey } from "@/lib/connectors/d365/types";
import type { ErpField, FieldMap, MapKind, Suggestion } from "./api";

// The map editor's pure parts. A map is a list of rows the person edits; the
// screen turns it back into a plain field map to save, after these checks (the
// server runs the same ones, so a message here is never a surprise there).
//
// Two directions share one row shape:
//   outbound  field = the ERP's own field, value = a template over BPMSquare's
//             fields ("{ref} · {description}")
//   inbound   field = a BPMSquare field, value = the ERP column that fills it

export type MapMode = "outbound" | "inbound";
export type MapRow = { key: string; field: string; value: string };

let counter = 0;
const nextKey = () => `r${++counter}`;

export function mapToRows(map: FieldMap | undefined | null): MapRow[] {
  return Object.entries(map ?? {}).map(([field, value]) => ({ key: nextKey(), field, value }));
}

export const emptyRow = (): MapRow => ({ key: nextKey(), field: "", value: "" });

/** Rows to the map that is saved. A half-empty row is left out; the last duplicate wins (validation reports duplicates first). */
export function rowsToMap(rows: readonly MapRow[]): FieldMap {
  const out: FieldMap = {};
  for (const r of rows) {
    const f = r.field.trim();
    const v = r.value.trim();
    if (f && v) out[f] = v;
  }
  return out;
}

/** Has the person changed the map since it was loaded? Order does not matter. */
export function sameMap(a: FieldMap, b: FieldMap): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

// ── Checks ──────────────────────────────────────────────────────────────────

const OUT_FIELD = /^[A-Za-z_][A-Za-z0-9_]*(@odata\.bind)?$/;
const IN_COLUMN = /^[A-Za-z_][A-Za-z0-9_.]*(@odata\.bind)?$/;

export type RowIssue = { row: number; part: "field" | "value"; message: string };

/**
 * What stops a save. `allowed` is the list of BPMSquare fields the map may use:
 * placeholders for an outbound template, BPMSquare field names for an inbound one.
 */
export function validateRows(mode: MapMode, kind: MapKind | "inbound", rows: readonly MapRow[], allowed: readonly string[]): RowIssue[] {
  const issues: RowIssue[] = [];
  const ok = new Set(allowed);
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const f = r.field.trim();
    const v = r.value.trim();
    if (!f && !v) return; // an empty row is simply not saved
    if (!f) { issues.push({ row: i, part: "field", message: mode === "outbound" ? "Choose the field in the ERP." : "Choose the BPMSquare field." }); return; }
    if (!v) { issues.push({ row: i, part: "value", message: mode === "outbound" ? "Give the field a value or a {field}." : "Choose the column in the ERP." }); return; }
    const dupe = seen.get(f.toLowerCase());
    if (dupe !== undefined) { issues.push({ row: i, part: "field", message: `${f} is already used in row ${dupe + 1}.` }); return; }
    seen.set(f.toLowerCase(), i);

    if (mode === "outbound") {
      if (f.length > 120 || !OUT_FIELD.test(f)) { issues.push({ row: i, part: "field", message: "That is not a valid field name." }); return; }
      if (v.length > 300) { issues.push({ row: i, part: "value", message: "That value is too long." }); return; }
      if (kind === "quote_line" && f.toLowerCase() === "uomid") { issues.push({ row: i, part: "field", message: "A write-in line must not carry a unit of measure; Dynamics refuses it." }); return; }
      const bad = [...v.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((p) => !ok.has(p));
      if (bad.length) { issues.push({ row: i, part: "value", message: `Unknown ${bad.map((b) => `{${b}}`).join(", ")}. Choose from the list.` }); return; }
      if (/\{[^{}]*$/.test(v) || /^[^{]*\}/.test(v)) issues.push({ row: i, part: "value", message: "A { } is not closed." });
    } else {
      if (!ok.has(f)) { issues.push({ row: i, part: "field", message: "That BPMSquare field is not offered here." }); return; }
      if (v.length > 300 || !IN_COLUMN.test(v)) issues.push({ row: i, part: "value", message: "That is not a valid column name." });
    }
  });
  return issues;
}

/** Fields the engine sets itself whatever the map says, so they are never reported as missing. */
export const ENGINE_SETS: Record<MapKind, readonly string[]> = {
  quote: ["name", "customerid", "pricelevelid", "transactioncurrencyid"],
  quote_line: ["quoteid"],
  project: [],
};

const stripBind = (f: string) => f.replace(/@odata\.bind$/, "").toLowerCase();

/** True when `mapped` (maybe `customerid_account@odata.bind`) fills the ERP field `name`. */
export const fills = (mapped: string, name: string): boolean => {
  const m = stripBind(mapped);
  const n = name.toLowerCase();
  return m === n || m.startsWith(`${n}_`);
};

/** Required, creatable ERP fields nothing in the map fills: shown before save, never silently dropped. */
export function missingRequired(erp: readonly ErpField[], rows: readonly MapRow[], kind: MapKind): ErpField[] {
  const mapped = rows.filter((r) => r.field.trim() && r.value.trim()).map((r) => r.field.trim());
  const always = ENGINE_SETS[kind];
  return erp.filter((f) => f.required && f.creatable && ![...mapped, ...always].some((m) => fills(m, f.name)));
}

/** The label a pick-list shows for an ERP field: display name, technical name, type, and a required mark. */
export function fieldOptionLabel(f: ErpField): string {
  return `${f.label} (${f.name}) · ${f.type}${f.required ? " · required" : ""}`;
}

// ── Suggest mapping ─────────────────────────────────────────────────────────

/** New rows from "Suggest mapping". A field already in the map is never overwritten. */
export function applySuggestions(rows: readonly MapRow[], suggestions: readonly Suggestion[], mode: MapMode): { rows: MapRow[]; added: number } {
  const next = rows.filter((r) => r.field.trim() || r.value.trim());
  let added = 0;
  for (const s of suggestions) {
    if (mode === "outbound") {
      if (next.some((r) => r.field.trim().toLowerCase() === s.erp.toLowerCase())) continue;
      next.push({ key: nextKey(), field: s.erp, value: `{${s.bpm}}` });
    } else {
      if (next.some((r) => r.field.trim() === s.bpm)) continue;
      next.push({ key: nextKey(), field: s.bpm, value: s.erp });
    }
    added++;
  }
  return { rows: next, added };
}

// ── What BPMSquare offers an inbound map ────────────────────────────────────

const PEOPLE = ["name", "city", "phone", "email"];
export const INBOUND_FIELDS: Partial<Record<D365EntityKey, readonly string[]>> = {
  customers: PEOPLE,
  vendors: PEOPLE,
  contacts: ["name", "email", "phone", "role", "account_external_id"],
  products: ["name", "sku", "uom", "list_price", "description"],
  projects: ["name", "code", "account_external_id"],
};

export const INBOUND_ENTITIES = ["customers", "contacts", "vendors", "products", "projects"] as const satisfies readonly D365EntityKey[];

const WORDS: Record<string, string> = {
  ref: "Quote number", qty: "Quantity", uom: "Unit", sl_no: "Line number", net_rate: "Rate after discount", discount_pct: "Discount %",
  account_external_id: "Customer's id in the ERP", list_price: "List price", valid_until: "Valid until", customer_name: "Customer name",
};
/** A plain name for a BPMSquare field in a pick-list. */
export const bpmFieldLabel = (k: string): string => WORDS[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Insert `{field}` at the end of a template, with a space when it follows other text. */
export const appendPlaceholder = (value: string, key: string): string => `${value}${value && !/\s$/.test(value) ? " " : ""}{${key}}`;
