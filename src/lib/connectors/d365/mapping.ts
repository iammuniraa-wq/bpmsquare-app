// Pure transforms between a Dynamics row and a BPMSquare record -- no
// server imports, unit-tested (d365.test.ts). The sync engine (sync.ts) does
// the I/O; everything that decides WHAT gets written lives here.

import type { D365EntityConfig, D365EntityKey, D365Product } from "./types";

export type MappedPull = {
  /** The id a link is stored under: for Finance & Operations scoped by the
   *  row's legal entity (`usmf|C0100`), else the bare id. */
  externalId: string;
  /** The id as Dynamics shows it, unscoped. */
  rawId: string;
  /** F&O legal entity (lower case) of the row, when it carries one. */
  area: string | null;
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

/**
 * F&O customer, vendor and project numbers are only unique inside a legal
 * entity (dataAreaId): CustomerAccount "C0100" exists in several companies. A
 * link keyed by the bare number would map the second company's customer onto
 * the first one's record, so for F&O the external id carries the company.
 * Links written before this (bare ids) are still honoured: the pull loop
 * looks the scoped id up first and the bare one second.
 */
export function scopedExternalId(product: D365Product | undefined, area: string | null | undefined, rawId: string): string {
  return product === "fo" && area ? `${area.toLowerCase()}|${rawId}` : rawId;
}

/** The company and bare id inside an external id (bare ids have no company). */
export function splitExternalId(externalId: string): { area: string | null; id: string } {
  const m = externalId.match(/^([a-z0-9]{1,8})\|(.+)$/);
  return m ? { area: m[1], id: m[2] } : { area: null, id: externalId };
}

/** Lower-case keys a customer link may be stored under, scoped form first. */
export function accountLookupKeys(area: string | null, accountId: string): string[] {
  const id = accountId.toLowerCase();
  return area ? [`${area.toLowerCase()}|${id}`, id] : [id];
}

function areaOf(product: D365Product | undefined, row: Record<string, unknown>): string | null {
  if (product !== "fo") return null;
  const a = row.dataAreaId;
  return typeof a === "string" && a.trim() ? a.trim().toLowerCase() : null;
}

export function mapPullRow(entity: Exclude<D365EntityKey, "fence_projects">, cfg: D365EntityConfig, row: Record<string, unknown>, product?: D365Product): MappedPull | { error: string } {
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
  const raw = String(rawId).trim();
  const area = areaOf(product, row);
  return {
    externalId: scopedExternalId(product, area, raw),
    rawId: raw,
    area,
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

/** Incremental filter: rows modified at or after the last run's watermark.
 *  `ge`, not `gt`: the watermark is held at the first row a run could not
 *  apply (so it is read again), and a run that stops at a cap in the middle of
 *  one second must not lose the rest of that second. Rows already applied come
 *  back as "unchanged" through their content fingerprint. */
export function modifiedSinceFilter(field: string, watermark: string | null, base?: string): string | undefined {
  const parts: string[] = [];
  if (base?.trim()) parts.push(`(${base.trim()})`);
  if (watermark && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(watermark) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) parts.push(`${field} ge ${watermark}`);
  return parts.length ? parts.join(" and ") : undefined;
}

// ── Watermarks and cursors ───────────────────────────────────────────────────

/** A modified-on value as the watermark form (whole seconds, UTC), or null. */
export function normalizeModified(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.replace(/\.\d+Z$/, "Z") : null;
}

/**
 * Where the next incremental run starts, for an entity with a modified field
 * (rows are read in ascending order).
 *
 *  - `maxSeen`   the newest modified value this run read
 *  - `firstHold` the modified value of the first row the run could not apply
 *                (a failure, or a contact whose customer isn't synced yet)
 *
 * The watermark never moves past `firstHold`, so that row is read again next
 * run instead of being lost until it happens to change in Dynamics. One
 * exception: if the run stopped early (row cap or time) and holding would not
 * advance at all, the watermark moves on to `maxSeen` -- otherwise a row that
 * can never be applied would pin every run to the same stretch and nothing
 * after it would ever sync. That row is then only retried when it changes or
 * on a full sync, and the run's issues say so.
 */
export function nextModifiedWatermark(a: { start: string | null; firstSeen: string | null; maxSeen: string | null; firstHold: string | null; stoppedEarly: boolean }): { watermark: string | null; held: boolean; releasedStall: boolean } {
  const { start, firstSeen, maxSeen, firstHold, stoppedEarly } = a;
  if (!firstHold || (maxSeen && firstHold > maxSeen)) return { watermark: maxSeen, held: false, releasedStall: false };
  const baseline = start ?? firstSeen;
  if (stoppedEarly && (!baseline || firstHold <= baseline)) return { watermark: maxSeen, held: false, releasedStall: true };
  return { watermark: firstHold, held: true, releasedStall: false };
}

/**
 * Cursor for an entity with NO modified field (Finance & Operations): rows are
 * read in id order and the cursor is the last id reached. It is stored in the
 * run's `watermark` as `k|<company>|<last id>`; an empty id means the whole
 * table was read, so the next run starts again from the top (that is how
 * changes are found when there is nothing to ask "changed since"). The company
 * is part of the cursor so changing it on the connector restarts the scan
 * instead of resuming inside the wrong legal entity.
 */
export function formatCursor(company: string | undefined, lastId: string | null): string {
  return `k|${(company ?? "").toLowerCase()}|${lastId ?? ""}`;
}

export function parseCursor(watermark: string | null, company: string | undefined): { lastId: string | null } {
  if (!watermark?.startsWith("k|")) return { lastId: null };
  const rest = watermark.slice(2);
  const bar = rest.indexOf("|");
  if (bar < 0 || rest.slice(0, bar) !== (company ?? "").toLowerCase()) return { lastId: null };
  return { lastId: rest.slice(bar + 1) || null };
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `IdField gt 'last'` (a GUID is written bare, anything else as a string). */
export function keysetFilter(idField: string, lastId: string | null, base?: string): string | undefined {
  const parts: string[] = [];
  if (base?.trim()) parts.push(`(${base.trim()})`);
  if (lastId && /^[A-Za-z_][A-Za-z0-9_]*$/.test(idField)) parts.push(`${idField} gt ${GUID_RE.test(lastId) ? lastId : odataString(lastId)}`);
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

/** F&O creates a record in the app user's default company unless told which:
 *  add the legal entity to a push body (the admin's own field map wins). */
export function withDataArea(product: D365Product, body: Record<string, string>, fieldMap: Record<string, string>, area: string | null | undefined): Record<string, string> {
  if (product !== "fo" || !area || "dataAreaId" in fieldMap || "dataAreaId" in body || !/^[A-Za-z0-9]{1,8}$/.test(area)) return body;
  return { ...body, dataAreaId: area.toLowerCase() };
}

// ── $select ──────────────────────────────────────────────────────────────────

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The columns a pull needs: the mapped sources, the id/key/modified fields and
 * (F&O) the legal entity. CustomersV3 alone has hundreds of columns; reading
 * them all for every row wastes the throttling budget. Undefined (= read
 * everything, as before) when any source is not a plain column name, e.g. a
 * dotted path into a nested object.
 */
export function selectFields(entity: Exclude<D365EntityKey, "fence_projects">, cfg: D365EntityConfig, product?: D365Product): string[] | undefined {
  const allowed = TARGET_FIELDS[entity];
  const cols = new Set<string>();
  const add = (c: string | undefined): boolean => {
    if (c === undefined) return true;
    if (!IDENT_RE.test(c)) return false;
    cols.add(c);
    return true;
  };
  if (!add(cfg.id_field) || !add(cfg.key_field) || !add(cfg.modified_field)) return undefined;
  for (const [target, source] of Object.entries(cfg.field_map ?? {})) {
    if (!(target in allowed) && target !== "account_external_id") continue;
    if (!add(source)) return undefined;
  }
  if (product === "fo") cols.add("dataAreaId");
  return [...cols];
}

// ── Cron fairness ────────────────────────────────────────────────────────────

/** The list starting `offset` places in, wrapping round. The hourly cron
 *  walks tenants in order until its time budget runs out; starting at a
 *  different tenant each hour means one slow tenant can only starve the
 *  others some of the time. */
export function rotateStart<T>(items: T[], offset: number): T[] {
  if (items.length < 2) return items;
  const k = ((Math.floor(offset) % items.length) + items.length) % items.length;
  return [...items.slice(k), ...items.slice(0, k)];
}
