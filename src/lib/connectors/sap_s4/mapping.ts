// Pure transforms between a SAP OData V2 row and a BPMSquare record -- no server imports, unit-tested
// (sap.test.ts). The server half (server.ts) does the I/O; everything that decides WHAT gets written lives here.

import { odataString } from "@/lib/connectors/d365/mapping";
import { SAP_FIELD_RE, SAP_PRESETS } from "./catalog";
import type { SapBpKey } from "./types";

// ── What each BPMSquare record accepts from a pull ──────────────────────────

type Kind = "text" | "email";

/** The fields a map may fill, per entity. Anything else in a stored map is ignored: a map can never write a column
 *  the sync did not mean to own (status, ref, custom data, tenant_id ...). */
const TARGET_FIELDS: Record<SapBpKey, Record<string, Kind>> = {
  customers: { name: "text", address_line1: "text", city: "text", postal_code: "text", country: "text", phone: "text", email: "email" },
  vendors: { name: "text", city: "text", phone: "text", email: "email" },
  products: { name: "text", sku: "text", uom: "text", description: "text" },
};

export const SAP_TARGET_LABELS: Record<string, string> = {
  name: "Name", address_line1: "Street", city: "City", postal_code: "Postal code", country: "Country", phone: "Phone", email: "Email",
  sku: "SKU", uom: "Unit", description: "Description",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(kind: Kind, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (kind === "email") {
    const e = s.toLowerCase().slice(0, 254);
    return EMAIL_RE.test(e) ? e : null;
  }
  return s.slice(0, 500);
}

function read(row: Record<string, unknown>, path: string): unknown {
  let cur: unknown = row;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** An Edm.DateTime as V2 JSON writes it (`/Date(1696118400000)/`, optionally with an offset) or as ISO text, to `YYYY-MM-DD`. */
export function sapDay(v: unknown): string | null {
  if (typeof v === "string") {
    const m = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(v);
    if (m) {
      const d = new Date(Number(m[1]));
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
    if (iso) return iso[1];
  }
  return null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `LastChangeDate ge datetime'2026-10-01T00:00:00'`: the V2 literal. Day granularity on purpose -- a run reads the
 *  whole last day again, and rows it already applied come back as "unchanged" through their content fingerprint. */
export function changedSinceFilter(field: string, day: string | null): string | undefined {
  if (!day || !DAY_RE.test(day) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) return undefined;
  return `${field} ge datetime'${day}T00:00:00'`;
}

export function keysetFilter(idField: string, lastKey: string | null): string | undefined {
  return lastKey && /^[A-Za-z_][A-Za-z0-9_]*$/.test(idField) ? `${idField} gt ${odataString(lastKey)}` : undefined;
}

// ── Position of an incremental pull ─────────────────────────────────────────
// Rows are read in key order (stable paging), so "the newest change seen" can not be a cursor by itself:
//   d|<day>                         a finished scan: the next run asks for rows changed since <day>.
//   k|<from>|<newest>|<hold>|<key>  a scan that stopped (row cap or time): continue after <key>, same <from>;
//                                   <newest> is the newest change seen so far, <hold> the oldest change of a row
//                                   that could not be applied (it is read again when the scan finishes).
export type SapPosition = { from: string | null; newest: string | null; hold: string | null; lastKey: string | null };

export const EMPTY_POSITION: SapPosition = { from: null, newest: null, hold: null, lastKey: null };

export function parsePosition(w: string | null | undefined): SapPosition {
  if (!w) return EMPTY_POSITION;
  const day = (s: string | undefined) => (s && DAY_RE.test(s) ? s : null);
  if (w.startsWith("d|")) return { ...EMPTY_POSITION, from: day(w.slice(2)) };
  if (w.startsWith("k|")) {
    const parts = w.slice(2).split("|");
    const key = parts.slice(3).join("|");
    return { from: day(parts[0]), newest: day(parts[1]), hold: day(parts[2]), lastKey: key || null };
  }
  return EMPTY_POSITION;
}

const minDay = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b);
const maxDay = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);
export { minDay, maxDay };

/** The position to store after a run. `complete`: the scan reached the end. */
export function nextPosition(p: SapPosition, seen: { newest: string | null; hold: string | null; lastKey: string | null }, complete: boolean): string | null {
  const newest = maxDay(p.newest, seen.newest);
  const hold = minDay(p.hold, seen.hold);
  if (!complete) return `k|${p.from ?? ""}|${newest ?? ""}|${hold ?? ""}|${seen.lastKey ?? ""}`;
  const next = hold && newest && hold < newest ? hold : newest ?? hold ?? p.from;
  return next ? `d|${next}` : null;
}

// ── Flattening the expanded parts ───────────────────────────────────────────

const results = (v: unknown): Record<string, unknown>[] => {
  const r = Array.isArray(v) ? v : (v as { results?: unknown } | null)?.results;
  return Array.isArray(r) ? (r.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
};
const strip = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k, val]) => k !== "__metadata" && !(val && typeof val === "object")));

/** The first address (its default e-mail and phone) as `address.*`; the English description as `description.*`.
 *  Nothing is written for a part the row does not carry. */
export function flattenRow(key: SapBpKey, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (SAP_PRESETS[key].prefix === "address") {
    const a = results(row.to_BusinessPartnerAddress)[0];
    if (a) {
      const address: Record<string, unknown> = strip(a);
      const emails = results(a.to_EmailAddress);
      const e = emails.find((x) => x.IsDefaultEmailAddress === true) ?? emails[0];
      if (e && typeof e.EmailAddress === "string") address.EmailAddress = e.EmailAddress;
      const phones = results(a.to_PhoneNumber);
      const p = phones.find((x) => x.IsDefaultPhoneNumber === true) ?? phones[0];
      if (p) {
        const num = [p.InternationalPhoneNumber, p.PhoneNumber].find((x) => typeof x === "string" && x.trim());
        if (typeof num === "string") address.PhoneNumber = num.trim();
      }
      out.address = address;
    }
  } else {
    const ds = results(row.to_Description);
    const d = ds.find((x) => String(x.Language ?? "").toUpperCase() === "EN") ?? ds[0];
    if (d) out.description = strip(d);
  }
  return out;
}

export type MappedSapRow = {
  externalId: string;
  externalKey: string | null;
  values: Record<string, string | null>;
  /** The day the row last changed in SAP, when it says. */
  changed: string | null;
};

export function mapSapRow(key: SapBpKey, fieldMap: Record<string, string>, raw: Record<string, unknown>): MappedSapRow | { error: string } {
  const p = SAP_PRESETS[key];
  const row = flattenRow(key, raw);
  const rawId = row[p.id_field];
  if (rawId === null || rawId === undefined || String(rawId).trim() === "") return { error: `no ${p.id_field}` };
  const externalId = String(rawId).trim();
  const allowed = TARGET_FIELDS[key];
  const values: Record<string, string | null> = {};
  for (const [target, source] of Object.entries(fieldMap)) {
    if (!(target in allowed) || !SAP_FIELD_RE.test(source)) continue;
    values[target] = clean(allowed[target], read(row, source));
  }
  const k = row[p.key_field];
  const externalKey = k === null || k === undefined ? externalId : String(k).trim().slice(0, 200) || externalId;
  // A name is the one thing every target needs; the readable number keeps a nameless record recognisable.
  if (!values.name) values.name = externalKey;
  return { externalId, externalKey, values, changed: sapDay(row[p.modified_field]) };
}

/** Does this map read anything from the expanded part? Only then is the (heavier) expansion asked for. */
export function needsExpand(key: SapBpKey, fieldMap: Record<string, string>): boolean {
  const prefix = `${SAP_PRESETS[key].prefix}.`;
  return Object.values(fieldMap).some((s) => s.startsWith(prefix));
}

/** The columns a pull needs. Undefined (read everything) when a source is not a plain name, as the system would refuse
 *  the rest -- and whenever the map reads an expanded part: how SAP Gateway combines $select with a nested $expand
 *  (to_BusinessPartnerAddress/to_EmailAddress) differs between releases, and a dropped expansion would silently leave
 *  every address blank. Whole rows cost bandwidth only; a missing part costs data. */
export function selectFields(key: SapBpKey, fieldMap: Record<string, string>): string[] | undefined {
  const p = SAP_PRESETS[key];
  if (needsExpand(key, fieldMap)) return undefined;
  const cols = new Set<string>([p.id_field, p.key_field, p.modified_field]);
  for (const s of Object.values(fieldMap)) {
    if (!SAP_FIELD_RE.test(s) || s.includes(".")) return undefined;
    cols.add(s);
  }
  return [...cols];
}

/** `(Key eq 'a' or Key eq 'b')` groups of at most `per` ids; ids are matched by the key, never the name. */
export function idsFilters(key: SapBpKey, ids: readonly string[], per = 20): string[] {
  const col = SAP_PRESETS[key].id_field;
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += per) out.push(`(${ids.slice(i, i + per).map((id) => `${col} eq ${odataString(id)}`).join(" or ")})`);
  return out;
}

/** Zero-padded numbers: a person types 1000, SAP stores 0000001000. Both are tried. */
export function idVariants(id: string): string[] {
  return /^\d{1,9}$/.test(id) ? [id, id.padStart(10, "0")].filter((v, i, a) => a.indexOf(v) === i) : [id];
}

/** Validate a stored or submitted map: known BPMSquare fields, plain SAP names. Returns the cleaned map and the problems. */
export function cleanFieldMap(key: SapBpKey, raw: unknown): { map: Record<string, string>; problems: { field: string; message: string }[] } {
  const map: Record<string, string> = {};
  const problems: { field: string; message: string }[] = [];
  const allowed = TARGET_FIELDS[key];
  for (const [k, v] of Object.entries((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>)) {
    if (!(k in allowed)) { problems.push({ field: k, message: "This field is not part of the mapping." }); continue; }
    if (typeof v !== "string" || !v.trim()) continue;
    if (!SAP_FIELD_RE.test(v.trim()) || v.length > 120) { problems.push({ field: k, message: `${v.slice(0, 40)} is not a valid SAP field name.` }); continue; }
    map[k] = v.trim();
  }
  return { map, problems };
}

export const SAP_TARGET_KEYS = (key: SapBpKey): string[] => Object.keys(TARGET_FIELDS[key]);
