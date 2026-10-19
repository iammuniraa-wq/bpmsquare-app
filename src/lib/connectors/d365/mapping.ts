// Pure transforms between a Dynamics row and a BPMSquare record -- no
// server imports, unit-tested (d365.test.ts). The sync engine (sync.ts) does
// the I/O; everything that decides WHAT gets written lives here.

import type { D365EntityConfig, D365EntityKey } from "./types";

export type MappedPull = {
  externalId: string;
  externalKey: string | null;
  accountExternalId: string | null;
  values: Record<string, string | number | null>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The fields each BPMSquare target accepts from a sync, and how. Anything
 *  else in a field map is ignored -- a map can never write a column the
 *  sync didn't mean to own (status, ref, custom data, tenant_id...). */
const TARGET_FIELDS: Record<Exclude<D365EntityKey, "fence_projects">, Record<string, "text" | "email" | "number">> = {
  customers: { name: "text", city: "text", phone: "text", email: "email" },
  contacts: { name: "text", phone: "text", email: "email", role: "text" },
  vendors: { name: "text", city: "text", phone: "text", email: "email" },
  products: { name: "text", sku: "text", uom: "text", list_price: "number", description: "text" },
  projects: { name: "text", code: "text" },
};

function read(row: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = row;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function clean(kind: "text" | "email" | "number", v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (kind === "number") {
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (kind === "email") {
    const e = s.toLowerCase().slice(0, 254);
    return EMAIL_RE.test(e) ? e : null;
  }
  return s.slice(0, 500);
}

export function mapPullRow(entity: Exclude<D365EntityKey, "fence_projects">, cfg: D365EntityConfig, row: Record<string, unknown>): MappedPull | { error: string } {
  const rawId = read(row, cfg.id_field);
  if (rawId === null || rawId === undefined || String(rawId).trim() === "") return { error: `no ${cfg.id_field}` };
  const allowed = TARGET_FIELDS[entity];
  const values: Record<string, string | number | null> = {};
  for (const [target, source] of Object.entries(cfg.field_map ?? {})) {
    if (!(target in allowed)) continue;
    values[target] = clean(allowed[target], read(row, source));
  }
  if (!values.name) {
    // A name is the one thing every target needs; fall back to the key so a
    // nameless record is still recognisable rather than dropped.
    const key = cfg.key_field ? read(row, cfg.key_field) : null;
    if (key === null || key === undefined || String(key).trim() === "") return { error: "no name" };
    values.name = String(key).trim().slice(0, 500);
  }
  const acc = cfg.field_map?.account_external_id ? read(row, cfg.field_map.account_external_id) : null;
  const key = cfg.key_field ? read(row, cfg.key_field) : null;
  return {
    externalId: String(rawId).trim(),
    externalKey: key === null || key === undefined ? null : String(key).trim().slice(0, 200) || null,
    accountExternalId: acc === null || acc === undefined || String(acc).trim() === "" ? null : String(acc).trim(),
    values,
  };
}

/** Stable fingerprint of what a sync would write -- equal fingerprints mean
 *  nothing changed and the update is skipped. */
export function fingerprint(values: Record<string, unknown>): string {
  const keys = Object.keys(values).sort();
  const s = JSON.stringify(keys.map((k) => [k, values[k] ?? null]));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + ":" + s.length;
}

/** Fill "{name} · {ref}" from vars. Returns null when any placeholder in
 *  the template is empty, so the caller drops the field. */
export function renderPushTemplate(template: string, vars: Record<string, string | number | null | undefined>): string | null {
  let missing = false;
  const out = template.replace(/\{([a-z_]+)\}/g, (_m, k: string) => {
    const v = vars[k];
    if (v === null || v === undefined || String(v).trim() === "") { missing = true; return ""; }
    return String(v);
  });
  return missing ? null : out;
}

/** Body for creating the external record. Keys are external field names
 *  (or an `@odata.bind` navigation); values are templates. */
export function buildPushBody(fieldMap: Record<string, string>, vars: Record<string, string | number | null | undefined>): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [field, template] of Object.entries(fieldMap)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*(@odata\.bind)?$/.test(field)) continue;
    const v = renderPushTemplate(template, vars);
    if (v !== null) body[field] = v.slice(0, 2000);
  }
  return body;
}

/** An OData string literal ('O''Brien'). */
export function odataString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** Incremental filter: rows modified after the last run's watermark. */
export function modifiedSinceFilter(field: string, watermark: string | null, base?: string): string | undefined {
  const parts: string[] = [];
  if (base?.trim()) parts.push(`(${base.trim()})`);
  if (watermark && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(watermark) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) parts.push(`${field} gt ${watermark}`);
  return parts.length ? parts.join(" and ") : undefined;
}

/** Tables a pull writes that carry an `updated_at` column. suppliers,
 *  accounts and contacts have none (0000_baseline) -- setting it there makes
 *  every update of that object fail. */
const HAS_UPDATED_AT = new Set(["products", "wfm_projects"]);
const PII_TABLES = new Set(["accounts", "contacts"]);

/** The row a pull inserts or updates. `encryptPii` is the server's
 *  encrypt() (injected so this stays pure and testable). */
export function buildTargetRecord(
  table: string,
  values: Record<string, string | number | null>,
  isInsert: boolean,
  encryptPii: (v: string | null) => string | null,
  nowIso: string = new Date().toISOString(),
): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null && !isInsert) continue; // a blank in Dynamics never wipes a value here
    rec[k] = PII_TABLES.has(table) && (k === "phone" || k === "email") ? encryptPii(v === null ? null : String(v)) : v;
  }
  if (isInsert) {
    if (table === "accounts") rec.type = "direct";
    if (table === "suppliers") { rec.type = "vendor"; rec.status = "active"; }
    if (table === "products") rec.status = "active";
    if (table === "wfm_projects") rec.status = "active";
  } else if (HAS_UPDATED_AT.has(table)) {
    rec.updated_at = nowIso;
  }
  return rec;
}
