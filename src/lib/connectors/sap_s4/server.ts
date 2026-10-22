import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/encryption";
import { assertSafeHttpsUrl, fetchPublic } from "@/lib/net/safeHost";
import { insertWithMasterRef, type MasterRefTable } from "@/lib/masterRef";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";
import { isSchemaPending } from "@/lib/marketing/pending";
import { fingerprint, buildTargetRecord } from "@/lib/connectors/d365/mapping";
import { hasScope, scopeSignature, scopeSummary, scopeWords, SCOPE_CHANGED_LINE, type ScopeAttribute } from "@/lib/connectors/d365/scope";
import { describeSelection, parseSelection } from "@/lib/connectors/d365/selection";
import type { EntityScope, ScopeCondition } from "@/lib/connectors/d365/types";
import { recordConnectorRun } from "@/lib/middleware/messages";
import { fieldsFromSampleRow, parseODataMetadata, type ErpField } from "@/lib/middleware/metadata";
import { REQUIRED_TABLES, schemaRows } from "@/lib/middleware/health";
import type { ErpAdapter } from "@/lib/connectors/adapter";
import { ALREADY_RUNNING, RUN_BUDGET_MS, fetchLinks, finishRun, lastWatermark, startRun, type RunCounts } from "@/lib/connectors/runs";
import {
  SAP_ADDRESS_EXTRAS, SAP_FIELD_RE, SAP_PRESETS, SAP_PREFIX_SETS, effectiveEntities, entityConfig, isSandbox, sapOrigin, sapServiceBase, scheduleOf,
} from "./catalog";
import {
  EMPTY_POSITION, changedSinceFilter, cleanFieldMap, idVariants, idsFilters, keysetFilter, mapSapRow, needsExpand, nextPosition, parsePosition, selectFields,
  SAP_TARGET_LABELS, flattenRow,
} from "./mapping";
import { SapClient, SapError, type FetchLike } from "./odata";
import { buildSapScopeFilter, cleanSapScope, sapScopeAttributes, sapScopeOptions } from "./scope";
import {
  SAP_AUTH_MODES, SAP_CONNECTOR_ID, SAP_ENTITY_KEYS, SAP_ENTITY_LABEL, SAP_ENTITY_TARGET, SAP_ENTITY_WORD, SAP_NAME, SAP_SANDBOX_HOST, SAP_SCENARIO,
  type SapAuthMode, type SapConfig, type SapEntityConfig, type SapEntityKey, type SapPublicState, type SapSchedule,
} from "./types";

// SAP S/4HANA connector, server side. Everything here runs on the service-role client (connector rows and sync
// tables are admin plumbing), so EVERY query names the tenant explicitly. The password / API key lives encrypted in
// tenant_connectors.credentials and is never returned, logged or put in a message. Every call to SAP goes through
// fetchPublic() (a public host only, re-checked on each redirect hop), and a pull never follows a server link to
// another address.

type Creds = { password?: string; api_key?: string };
type Loaded = { cfg: SapConfig; creds: Creds; status: string; last_error: string | null };

export class SapSaveError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// ── The stored connection ───────────────────────────────────────────────────

export async function loadSap(admin: SupabaseClient, tenantId: string): Promise<Loaded | null> {
  const { data } = await admin.from("tenant_connectors").select("config, credentials, status, last_error")
    .eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID).maybeSingle();
  if (!data) return null;
  const c = data.config as Partial<SapConfig> | null;
  if (!c || (c.auth_mode !== "basic" && c.auth_mode !== "api_key")) return null;
  const raw = (data.credentials ?? {}) as Record<string, string>;
  const creds: Creds = {};
  if (raw.password) creds.password = decrypt(raw.password) ?? "";
  if (raw.api_key) creds.api_key = decrypt(raw.api_key) ?? "";
  const cfg: SapConfig = {
    auth_mode: c.auth_mode, api_host: String(c.api_host ?? ""), username: String(c.username ?? ""),
    schedule: c.schedule === "hourly" || c.schedule === "daily" ? c.schedule : "off", entities: c.entities ?? {},
  };
  return { cfg, creds, status: data.status as string, last_error: (data.last_error as string | null) ?? null };
}

export function publicState(row: Loaded | null): SapPublicState {
  if (!row) return { config: null, secrets: { password: false, api_key: false }, status: "not_connected", last_error: null };
  return {
    config: { ...row.cfg, entities: effectiveEntities(row.cfg), environment_url: sapOrigin(row.cfg), sandbox: isSandbox(row.cfg) },
    secrets: { password: !!row.creds.password, api_key: !!row.creds.api_key },
    status: row.status === "connected" ? "connected" : "error",
    last_error: row.last_error,
  };
}

export async function markStatus(admin: SupabaseClient, tenantId: string, ok: boolean, error?: string | null): Promise<void> {
  await admin.from("tenant_connectors").update({ status: ok ? "connected" : "error", last_error: ok ? null : (error ?? "").slice(0, 500), updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID);
}

async function writeConfig(admin: SupabaseClient, tenantId: string, cfg: SapConfig): Promise<string | null> {
  const { error } = await admin.from("tenant_connectors").update({ config: cfg as unknown as Record<string, string>, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID);
  return error ? error.message : null;
}

/** "my426318-api.s4hana.cloud.sap", "https://my426318-api.s4hana.cloud.sap/" and the like, to the bare host. */
export function normalizeHost(input: unknown): string {
  const t = typeof input === "string" ? input.trim() : "";
  if (!t) throw new SapSaveError(422, "Enter the API host, such as my426318-api.s4hana.cloud.sap.");
  if (/^http:\/\//i.test(t)) throw new SapSaveError(422, "The address must use https.");
  let u: URL;
  try { u = new URL(/^https:\/\//i.test(t) ? t : `https://${t}`); } catch { throw new SapSaveError(422, "That isn't a valid address."); }
  if (u.username || u.password) throw new SapSaveError(422, "Leave the user name out of the address; it has its own field.");
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) throw new SapSaveError(422, "Enter the host only, without a path.");
  return u.host.toLowerCase();
}

export type SapSaveBody = { config?: Record<string, unknown>; secrets?: Record<string, unknown> };

function cleanEntities(raw: unknown, prev: SapConfig["entities"]): SapConfig["entities"] {
  const out: SapConfig["entities"] = {};
  const src = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  for (const key of SAP_ENTITY_KEYS) {
    const e = src?.[key] as Partial<SapEntityConfig> | undefined;
    const before = prev[key];
    if (!e || typeof e !== "object") { if (before) out[key] = before; continue; }
    const { map, problems } = cleanFieldMap(key, e.field_map);
    if (problems.length) throw new SapSaveError(422, `${SAP_ENTITY_WORD[key]}: ${problems[0].message}`);
    const sched = e.schedule === "off" || e.schedule === "hourly" || e.schedule === "daily" ? e.schedule : before?.schedule;
    out[key] = {
      enabled: e.enabled === true,
      field_map: Object.keys(map).length ? map : (before?.field_map ?? {}),
      ...(sched ? { schedule: sched } : {}),
      // The scope has its own route; a connection save keeps it exactly as stored.
      ...(before?.scope ? { scope: before.scope } : {}),
    };
  }
  return out;
}

/** Validate and store a connection; returns the public state (never a secret). A blank secret means "unchanged". */
export async function saveSapConnection(admin: SupabaseClient, tenantId: string, userId: string, body: SapSaveBody | null): Promise<SapPublicState> {
  const c = body?.config;
  if (!c) throw new SapSaveError(422, "config is required");
  const prev = await loadSap(admin, tenantId);
  const mode = (c.auth_mode ?? prev?.cfg.auth_mode ?? "basic") as SapAuthMode;
  if (!SAP_AUTH_MODES.includes(mode)) throw new SapSaveError(422, "Choose a login type.");

  const host = mode === "api_key" ? SAP_SANDBOX_HOST : normalizeHost(c.api_host ?? c.environment_url ?? prev?.cfg.api_host);
  await assertSafeHttpsUrl(`https://${host}`).catch((e: Error) => { throw new SapSaveError(422, e.message); });

  const username = mode === "basic" ? (typeof c.username === "string" ? c.username.trim().slice(0, 200) : prev?.cfg.username ?? "") : "";
  if (mode === "basic" && !username) throw new SapSaveError(422, "Enter the Communication user.");

  const secrets = body?.secrets ?? {};
  const given = (k: "password" | "api_key") => (typeof secrets[k] === "string" ? (secrets[k] as string).trim().slice(0, 4000) : "");
  const { data: row } = await admin.from("tenant_connectors").select("credentials").eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID).maybeSingle();
  const creds = { ...((row?.credentials ?? {}) as Record<string, string>) };
  if (given("password")) creds.password = encrypt(given("password")) ?? "";
  if (given("api_key")) creds.api_key = encrypt(given("api_key")) ?? "";
  if (mode === "basic" && !creds.password) throw new SapSaveError(422, "Enter the password of the Communication user.");
  if (mode === "api_key" && !creds.api_key) throw new SapSaveError(422, "Paste the API key from the SAP Business Accelerator Hub.");

  const cfg: SapConfig = {
    auth_mode: mode, api_host: host, username,
    schedule: c.schedule === "hourly" || c.schedule === "daily" ? c.schedule : "off",
    entities: cleanEntities(c.entities, prev?.cfg.entities ?? {}),
  };
  const p = prev?.cfg;
  const identityChanged = !p || p.auth_mode !== cfg.auth_mode || p.api_host !== cfg.api_host || p.username !== cfg.username || !!given("password") || !!given("api_key");

  const { error } = await admin.from("tenant_connectors").upsert({
    tenant_id: tenantId, connector_id: SAP_CONNECTOR_ID, status: identityChanged ? "error" : (prev?.status ?? "error"),
    last_error: identityChanged ? "Not tested yet — press Test." : prev?.last_error ?? null,
    config: cfg as unknown as Record<string, string>, credentials: creds, connected_by: userId,
    connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,connector_id" });
  if (error) throw new SapSaveError(500, error.message);
  return publicState(await loadSap(admin, tenantId));
}

export async function disconnectSap(admin: SupabaseClient, tenantId: string): Promise<void> {
  await admin.from("tenant_connectors").delete().eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID);
}

// ── The client ──────────────────────────────────────────────────────────────

export function authHeaders(cfg: SapConfig, creds: Creds): Record<string, string> {
  if (cfg.auth_mode === "api_key") {
    if (!creds.api_key) throw new SapError("The API key is missing. Paste it under Edit.", 400);
    return { APIKey: creds.api_key };
  }
  if (!cfg.username || !creds.password) throw new SapError("The Communication user and its password are required.", 400);
  return { Authorization: `Basic ${Buffer.from(`${cfg.username}:${creds.password}`).toString("base64")}` };
}

export type SapDeps = { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> };

async function clientFor(cfg: SapConfig, creds: Creds, service: "API_BUSINESS_PARTNER" | "API_PRODUCT_SRV", deps: SapDeps = {}): Promise<SapClient> {
  const base = sapServiceBase(cfg, service);
  await assertSafeHttpsUrl(base);
  const scenario = service === "API_PRODUCT_SRV" ? SAP_SCENARIO.product : SAP_SCENARIO.businessPartner;
  return new SapClient(base, async () => authHeaders(cfg, creds), {
    fetch: deps.fetch ?? ((u, init) => fetchPublic(u, init)), sleep: deps.sleep, scenario, sandbox: isSandbox(cfg), hostWord: isSandbox(cfg) ? SAP_SANDBOX_HOST : cfg.api_host,
  });
}

// ── Test ────────────────────────────────────────────────────────────────────

export type TestAnswer = { ok: boolean; line: string; failures: { label: string; fix: string }[]; status: number; message?: string; error?: string };

/** One authenticated call per scenario, told in plain words. Business partners decide "connected"; a missing Product
 *  scenario is a thing to fix, not a broken connection. */
export async function testSap(admin: SupabaseClient, tenantId: string, deps: SapDeps = {}): Promise<TestAnswer> {
  const row = await loadSap(admin, tenantId);
  if (!row) return { ok: false, line: "Save the connection first.", failures: [{ label: "Connection", fix: "Save the connection first." }], status: 400, error: "Save the connection first." };
  const { cfg, creds } = row;
  const sandbox = isSandbox(cfg);
  try {
    const bp = await clientFor(cfg, creds, "API_BUSINESS_PARTNER", deps);
    await bp.get("A_BusinessPartner", { $top: "1" });
    let fieldList = true;
    await bp.metadata().catch(() => { fieldList = false; });
    await markStatus(admin, tenantId, true);

    const failures: { label: string; fix: string }[] = [];
    try {
      await (await clientFor(cfg, creds, "API_PRODUCT_SRV", deps)).get("A_Product", { $top: "1" });
    } catch (e) {
      failures.push({ label: sandbox ? "Products" : `Products (${SAP_SCENARIO.product.id})`, fix: (e as Error).message });
    }
    const where = sandbox ? "Sandbox (sample data) answers" : "SAP answers";
    if (failures.length) return { ok: false, line: `Connected, but products can not be read. ${where} for business partners.`, failures, status: 200, message: `${where}.` };
    const line = `Connected. ${where} for business partners and products${fieldList ? "" : "; the field list ($metadata) could not be read, so Mapping lists sample fields"}.`;
    return { ok: true, line, failures: [], status: 200, message: line };
  } catch (e) {
    const msg = (e as Error).message || "Test failed";
    await markStatus(admin, tenantId, false, msg);
    return { ok: false, line: msg, failures: [{ label: sandbox ? "Business partners" : `Business partners (${SAP_SCENARIO.businessPartner.id})`, fix: msg }], status: 400, error: msg };
  }
}

// ── Health ──────────────────────────────────────────────────────────────────

export async function sapHealth(admin: SupabaseClient, tenantId: string) {
  const exists: Record<string, boolean> = {};
  await Promise.all(REQUIRED_TABLES.map(async ({ table }) => {
    const { error } = await admin.from(table).select("tenant_id").eq("tenant_id", tenantId).limit(1);
    exists[table] = !isSchemaPending(error);
  }));
  const schema = schemaRows(exists);
  const state = publicState(exists.tenant_connectors ? await loadSap(admin, tenantId) : null);
  const problems: { kind: "database" | "connection" | "secret"; message: string; bundle?: string }[] = [];
  const missing = schema.filter((r) => !r.exists);
  for (const bundle of [...new Set(missing.map((r) => r.bundle).filter((b): b is string => !!b))]) {
    problems.push({ kind: "database", message: `A database update is needed (${missing.filter((r) => r.bundle === bundle).map((r) => r.label).join(", ")}).`, bundle });
  }
  if (state.config && state.status === "error") problems.push({ kind: "connection", message: state.last_error || "The connection needs attention. Press Test." });
  return { problems, connection: { connected: state.status === "connected", product: state.config ? { key: SAP_CONNECTOR_ID, name: SAP_NAME } : null } };
}

// ── Field lists (Mapping, Scope) ────────────────────────────────────────────

const humanize = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

export type SapFields = { main: ErpField[]; extra: ErpField[]; source: "metadata" | "sample"; fetchedAt: string };

async function fetchFields(row: Loaded, key: SapEntityKey, deps: SapDeps): Promise<SapFields> {
  const p = SAP_PRESETS[key];
  const client = await clientFor(row.cfg, row.creds, p.service, deps);
  const dotted = (prefix: string, fields: ErpField[], label: string): ErpField[] => fields.map((f) => ({ ...f, name: `${prefix}.${f.name}`, label: `${label} · ${f.label}`, required: false }));
  try {
    const xml = await client.metadata();
    const main = parseODataMetadata(xml, p.entity_set).map((f) => ({ ...f, required: false }));
    if (main.length) {
      const set = SAP_PREFIX_SETS[p.prefix].sets[0];
      let extra = parseODataMetadata(xml, set.set).filter((f) => !set.only || set.only.includes(f.name));
      extra = dotted(p.prefix, extra, p.prefix === "address" ? "Address" : "Description");
      if (p.prefix === "address") extra.push(...SAP_ADDRESS_EXTRAS.map((f) => ({ name: f.name, label: f.label, type: f.type, required: false, creatable: true })));
      return { main, extra, source: "metadata", fetchedAt: new Date().toISOString() };
    }
  } catch {
    // Too large or refused: a sample row is used below.
  }
  const sample = await client.get(p.entity_set, { $top: "1" });
  const main = fieldsFromSampleRow(sample.results[0]).filter((f) => !f.name.startsWith("to_") && !f.name.startsWith("__"));
  const extra: ErpField[] = Object.values(p.field_map).filter((s) => s.includes(".")).map((s) => ({ name: s, label: humanize(s.replace(".", " ")), type: "String", required: false, creatable: true }));
  return { main, extra, source: "sample", fetchedAt: new Date().toISOString() };
}

export type SapFieldsResult = ({ ok: true } & SapFields) | { ok: false; state: "not_connected" | "error"; message: string };

export async function getSapFields(admin: SupabaseClient, tenantId: string, key: SapEntityKey, opts: { refresh?: boolean } & SapDeps = {}): Promise<SapFieldsResult> {
  const row = await loadSap(admin, tenantId);
  if (!row) return { ok: false, state: "not_connected", message: "No ERP is connected yet. Connect one under Connections." };
  const tag = `mw-sap-metadata:${tenantId}`;
  if (opts.refresh) revalidateTag(tag, { expire: 0 });
  try {
    const run = unstable_cache(() => fetchFields(row, key, opts), ["mw-sap-metadata", tenantId, row.cfg.auth_mode, row.cfg.api_host, SAP_PRESETS[key].entity_set], { revalidate: 300, tags: [tag] });
    return { ok: true, ...(await run()) };
  } catch (e) {
    return { ok: false, state: "error", message: (e as Error).message || "SAP did not return its field list." };
  }
}

// ── Mapping ─────────────────────────────────────────────────────────────────

export const SAP_MAP_DOCS = ["customers", "vendors", "products"] as const;
export const isSapMapDoc = (v: unknown): v is SapEntityKey => typeof v === "string" && (SAP_MAP_DOCS as readonly string[]).includes(v);

type Side = { label: string; name: string };

export function buildSapMappingView(key: SapEntityKey, cfg: Pick<SapConfig, "entities">, fields: { main: ErpField[]; extra: ErpField[] } | null) {
  const p = SAP_PRESETS[key];
  const eff = entityConfig(cfg, key).field_map;
  const known: Side[] = [...(fields?.extra ?? []), ...(fields?.main ?? [])].map((f) => ({ label: f.label, name: f.name }));
  const withLabel = (name: string): Side => known.find((f) => f.name === name) ?? { label: name, name };
  const rows = p.fields.map((f) => ({
    id: f, bpm: { label: SAP_TARGET_LABELS[f] ?? f, name: f }, erp: eff[f] ? withLabel(eff[f]) : null, standard: (eff[f] ?? null) === (p.field_map[f] ?? null),
  }));
  const header = [...known];
  for (const r of rows) if (r.erp && !header.some((h) => h.name === r.erp!.name)) header.push(r.erp);
  const sorted = (m: Record<string, string>) => JSON.stringify(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
  return {
    document: { key, label: SAP_ENTITY_WORD[key], targetLabel: `${SAP_NAME} ${SAP_ENTITY_WORD[key]}` },
    sections: [{ key: "header", label: "Fields", rows }],
    erpFields: { header, lines: [] as Side[] },
    usingStandard: sorted(eff) === sorted(p.field_map),
    missingRequired: [] as string[],
    settings: null,
  };
}

export async function getSapMapping(admin: SupabaseClient, tenantId: string, key: SapEntityKey, deps: SapDeps = {}) {
  const row = await loadSap(admin, tenantId);
  if (!row) return { connected: false as const };
  const f = await getSapFields(admin, tenantId, key, deps);
  return buildSapMappingView(key, row.cfg, f.ok ? f : null);
}

export type SapMapResult = { ok: true; view: ReturnType<typeof buildSapMappingView> } | { ok: false; status: number; error: string; errors?: { id: string; message: string }[] };

export async function saveSapMapping(admin: SupabaseClient, tenantId: string, body: unknown, deps: SapDeps = {}): Promise<SapMapResult> {
  const b = (body && typeof body === "object" ? body : {}) as { document?: unknown; section?: unknown; rows?: unknown };
  if (!isSapMapDoc(b.document)) return { ok: false, status: 422, error: "Choose which mapping to save." };
  if (b.section !== "header") return { ok: false, status: 422, error: "section must be header." };
  if (!Array.isArray(b.rows) || b.rows.length > 50) return { ok: false, status: 422, error: "Send the rows to save." };
  const key = b.document;
  const row = await loadSap(admin, tenantId);
  if (!row) return { ok: false, status: 400, error: "Connect your ERP first." };
  const f = await getSapFields(admin, tenantId, key, deps);
  const known = f.ok ? new Set([...f.main, ...f.extra].map((x) => x.name)) : null;
  const preset = SAP_PRESETS[key];
  const map = { ...entityConfig(row.cfg, key).field_map };
  const errors: { id: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const r of b.rows as { id?: unknown; erp?: unknown }[]) {
    const id = typeof r?.id === "string" ? r.id : "";
    if (!preset.fields.includes(id)) { errors.push({ id: id || "?", message: "This row is not part of the mapping." }); continue; }
    if (seen.has(id)) { errors.push({ id, message: "This row was sent twice." }); continue; }
    seen.add(id);
    const label = SAP_TARGET_LABELS[id] ?? id;
    if (r.erp === null || r.erp === undefined) { delete map[id]; continue; }
    const name = typeof r.erp === "string" ? r.erp.trim() : "";
    if (!SAP_FIELD_RE.test(name) || name.length > 120) { errors.push({ id, message: `${label}: that is not a valid SAP field name.` }); continue; }
    if (known && known.size && !known.has(name)) { errors.push({ id, message: `${label}: ${name} is not a field in SAP.` }); continue; }
    map[id] = name;
  }
  if (errors.length) return { ok: false, status: 422, error: errors[0].message, errors };
  if (!Object.keys(map).length) return { ok: false, status: 422, error: "Keep at least one field mapped.", errors: [{ id: "rows", message: "Keep at least one field mapped." }] };
  const own = row.cfg.entities[key] ?? { enabled: entityConfig(row.cfg, key).enabled, field_map: {} };
  const cfg: SapConfig = { ...row.cfg, entities: { ...row.cfg.entities, [key]: { ...own, field_map: map } } };
  const err = await writeConfig(admin, tenantId, cfg);
  if (err) return { ok: false, status: 500, error: err };
  return { ok: true, view: buildSapMappingView(key, cfg, f.ok ? f : null) };
}

export async function resetSapMapping(admin: SupabaseClient, tenantId: string, body: unknown, deps: SapDeps = {}): Promise<SapMapResult> {
  const key = (body as { document?: unknown } | null)?.document;
  if (!isSapMapDoc(key)) return { ok: false, status: 422, error: "Choose which mapping to reset." };
  const row = await loadSap(admin, tenantId);
  if (!row) return { ok: false, status: 400, error: "Connect your ERP first." };
  const own = row.cfg.entities[key];
  const cfg: SapConfig = own ? { ...row.cfg, entities: { ...row.cfg.entities, [key]: { ...own, field_map: { ...SAP_PRESETS[key].field_map } } } } : row.cfg;
  if (own) { const err = await writeConfig(admin, tenantId, cfg); if (err) return { ok: false, status: 500, error: err }; }
  const f = await getSapFields(admin, tenantId, key, deps);
  return { ok: true, view: buildSapMappingView(key, cfg, f.ok ? f : null) };
}

// ── Scope ───────────────────────────────────────────────────────────────────

type Fail = { error: string; status: number };

export type SapScopeView = {
  entity: SapEntityKey; label: string; conditions: ScopeCondition[]; summary: string; needs_full: boolean; attributes: ScopeAttribute[]; source: "system" | "presets";
};

const PLURAL: Record<SapEntityKey, string> = { customers: "customers", vendors: "suppliers", products: "products" };

const scopeView = (key: SapEntityKey, scope: EntityScope | undefined, attributes: ScopeAttribute[], source: "system" | "presets"): SapScopeView => ({
  entity: key, label: SAP_ENTITY_LABEL[key], conditions: scope?.conditions ?? [], summary: scopeSummary(scope, PLURAL[key]),
  needs_full: scope?.needs_full === true && hasScope(scope), attributes, source,
});

async function attributesOf(admin: SupabaseClient, tenantId: string, key: SapEntityKey, deps: SapDeps) {
  const f = await getSapFields(admin, tenantId, key, deps);
  return { attributes: sapScopeAttributes(key, f.ok ? f.main : null), source: f.ok ? ("system" as const) : ("presets" as const) };
}

export async function getSapScope(admin: SupabaseClient, tenantId: string, key: SapEntityKey, deps: SapDeps = {}): Promise<SapScopeView | Fail> {
  const row = await loadSap(admin, tenantId);
  if (!row) return { error: "Connect your ERP first.", status: 400 };
  const { attributes, source } = await attributesOf(admin, tenantId, key, deps);
  return scopeView(key, entityConfig(row.cfg, key).scope, attributes, source);
}

export async function saveSapScope(admin: SupabaseClient, tenantId: string, key: SapEntityKey, body: unknown, deps: SapDeps = {}): Promise<SapScopeView | Fail> {
  const row = await loadSap(admin, tenantId);
  if (!row) return { error: "Connect your ERP first.", status: 400 };
  const first = cleanSapScope((body as { conditions?: unknown } | null)?.conditions ?? []);
  if (!first.ok) return { error: first.error, status: 422 };
  const { attributes, source } = await attributesOf(admin, tenantId, key, deps);
  const byId = new Map(attributes.map((a) => [a.id, a]));
  const bound: ScopeCondition[] = [];
  for (const c of first.scope.conditions) {
    const a = byId.get(c.attribute);
    if (!a) return { error: `"${c.attribute_label || c.attribute}" is not an attribute of ${PLURAL[key]} in this system.`, status: 422 };
    // The system decides what an attribute is; the request only says which one and which values.
    bound.push({ ...c, kind: a.kind, attribute_label: a.label });
  }
  const checked = cleanSapScope(bound);
  if (!checked.ok) return { error: checked.error, status: 422 };
  const ec = entityConfig(row.cfg, key);
  const prev = ec.scope;
  const changed = scopeSignature(prev) !== scopeSignature(checked.scope);
  // The incremental position covers the OLD scope. Narrowing from "all" is safe; anything else needs a Full resync.
  const needsFull = prev?.needs_full === true || (hasScope(prev) && changed);
  const scope: EntityScope | undefined = checked.scope.conditions.length || needsFull ? { conditions: checked.scope.conditions, ...(needsFull ? { needs_full: true } : {}) } : undefined;
  const own = { ...(row.cfg.entities[key] ?? { enabled: ec.enabled, field_map: ec.field_map }) };
  delete own.scope;
  const cfg: SapConfig = { ...row.cfg, entities: { ...row.cfg.entities, [key]: { ...own, ...(scope ? { scope } : {}) } } };
  const err = await writeConfig(admin, tenantId, cfg);
  if (err) return { error: err, status: 500 };
  return scopeView(key, scope, attributes, source);
}

export type SapScopeValues = { kind: ScopeAttribute["kind"]; typed: boolean; values: { value: string; label: string }[]; more: boolean };

export async function getSapScopeValues(admin: SupabaseClient, tenantId: string, key: SapEntityKey, attributeId: string, deps: SapDeps = {}): Promise<SapScopeValues | Fail> {
  const row = await loadSap(admin, tenantId);
  if (!row) return { error: "Connect your ERP first.", status: 400 };
  const { attributes } = await attributesOf(admin, tenantId, key, deps);
  const a = attributes.find((x) => x.id === attributeId);
  if (!a) return { error: "That attribute is not available.", status: 422 };
  const options = sapScopeOptions(key, a.name);
  if (options) return { kind: "option", typed: false, values: options, more: false };
  if (a.kind === "boolean") return { kind: a.kind, typed: false, values: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }], more: false };
  return { kind: a.kind, typed: true, values: [], more: false };
}

// ── Schedule, overview, preview ─────────────────────────────────────────────

export async function setSapSchedule(admin: SupabaseClient, tenantId: string, key: SapEntityKey, schedule: SapSchedule): Promise<{ ok: true; schedule: SapSchedule } | { ok: false; error: string; status: number }> {
  const row = await loadSap(admin, tenantId);
  if (!row) return { ok: false, error: "Connect your ERP first.", status: 400 };
  const ec = entityConfig(row.cfg, key);
  const own = row.cfg.entities[key] ?? { enabled: ec.enabled, field_map: ec.field_map };
  const err = await writeConfig(admin, tenantId, { ...row.cfg, entities: { ...row.cfg.entities, [key]: { ...own, schedule } } });
  return err ? { ok: false, error: err, status: 500 } : { ok: true, schedule };
}

export async function sapSyncOverview(admin: SupabaseClient, tenantId: string) {
  const row = await loadSap(admin, tenantId);
  if (!row) return { connected: false as const, entities: [] };
  const { cfg } = row;
  const { data: runs, error } = await admin.from("connector_sync_runs").select("entity, status, trigger, started_at, finished_at, counts, error")
    .eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID).order("started_at", { ascending: false }).limit(200);
  const latest = new Map<string, Record<string, unknown>>();
  const running = new Set<string>();
  for (const r of (runs ?? []) as Record<string, unknown>[]) {
    const e = String(r.entity);
    if (!latest.has(e)) latest.set(e, r);
    if (r.status === "running") running.add(e);
  }
  const entities = await Promise.all(SAP_ENTITY_KEYS.map(async (key) => {
    const ec = entityConfig(cfg, key);
    const { count } = await admin.from("connector_links").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID).eq("entity", key);
    const run = latest.get(key) ?? null;
    return {
      key, label: SAP_ENTITY_LABEL[key], direction: "pull" as const, enabled: ec.enabled, entity_set: ec.entity_set,
      schedule: scheduleOf(cfg, key), schedule_source: cfg.entities?.[key]?.schedule ? ("entity" as const) : ("connector" as const),
      running: running.has(key), linked: count ?? 0, filters: { numbers: true },
      scope: { summary: scopeSummary(ec.scope, PLURAL[key]), narrowed: hasScope(ec.scope), needs_full: hasScope(ec.scope) && ec.scope?.needs_full === true },
      last_run: run ? { status: run.status, trigger: run.trigger, started_at: run.started_at, finished_at: run.finished_at, counts: run.counts, error: run.error } : null,
    };
  }));
  return { connected: true as const, product: { key: SAP_CONNECTOR_ID, name: SAP_NAME }, pending_migration: !!error, entities };
}

export async function previewSapEntity(admin: SupabaseClient, tenantId: string, key: SapEntityKey, deps: SapDeps = {}): Promise<{ rows: Record<string, unknown>[] } | Fail> {
  const row = await loadSap(admin, tenantId);
  if (!row) return { error: "Connect your ERP first.", status: 400 };
  const p = SAP_PRESETS[key];
  const map = entityConfig(row.cfg, key).field_map;
  try {
    const client = await clientFor(row.cfg, row.creds, p.service, deps);
    const rows: Record<string, unknown>[] = [];
    for await (const r of client.list(p.entity_set, { filter: p.filter, orderby: `${p.id_field} asc`, expand: needsExpand(key, map) ? [...p.expand] : undefined, pageSize: 5, maxRows: 5 })) {
      const flat = flattenRow(key, r);
      const slim: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(flat)) {
        if (k.startsWith("__") || k.startsWith("to_") || (v && typeof v === "object")) continue;
        slim[k] = typeof v === "string" ? v.slice(0, 120) : v;
      }
      for (const src of Object.values(map)) {
        if (!src.includes(".")) continue;
        const [a, b] = src.split(".");
        const v = (flat[a] as Record<string, unknown> | undefined)?.[b];
        if (v !== undefined) slim[src] = typeof v === "string" ? v.slice(0, 120) : v;
      }
      rows.push(slim);
    }
    return { rows };
  } catch (e) {
    return { error: (e as Error).message ?? "Preview failed", status: 400 };
  }
}

// ── Pull ────────────────────────────────────────────────────────────────────

const REF_TABLES = new Set<string>(["accounts", "suppliers", "products"]);
const MAX_ROWS_PER_RUN = 5000;
const PAGE_SIZE = 200;

export type PullResult = { runId: string | null; counts: RunCounts; issues: string[]; error: string | null; unsupported?: string[] };

export type PullOptions = SapDeps & {
  trigger: "manual" | "schedule"; userId: string | null; full?: boolean;
  /** epoch ms after which no new row is started */ deadline?: number;
  /** rows per run (tests lower it) */ maxRows?: number; pageSize?: number;
  /** Read only these records (numbers). Such a run ignores the scope and never moves the incremental position. */
  ids?: string[];
};

async function settleScope(admin: SupabaseClient, tenantId: string, key: SapEntityKey): Promise<void> {
  const row = await loadSap(admin, tenantId);
  const own = row?.cfg.entities?.[key];
  if (!row || !own?.scope?.needs_full) return;
  await writeConfig(admin, tenantId, { ...row.cfg, entities: { ...row.cfg.entities, [key]: { ...own, scope: { conditions: own.scope.conditions } } } });
}

/**
 * Pull one entity from SAP into BPMSquare. Creates what is new, updates only the mapped fields of what it created
 * before (found through connector_links by the SAP key), never deletes, never touches a field the map does not own.
 * Rows are read in key order; the position of an incremental pull is "changed since <day>" (mapping.ts).
 */
export async function runSapPull(admin: SupabaseClient, tenantId: string, key: SapEntityKey, opts: PullOptions): Promise<PullResult> {
  const deadline = opts.deadline ?? Date.now() + RUN_BUDGET_MS;
  const maxRows = opts.maxRows ?? MAX_ROWS_PER_RUN;
  const counts: RunCounts = { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const issues: string[] = [];
  const loaded = await loadSap(admin, tenantId);
  if (!loaded) return { runId: null, counts, issues, error: `${SAP_NAME} isn't connected.` };
  const { cfg, creds } = loaded;
  const ec = entityConfig(cfg, key);
  const p = SAP_PRESETS[key];
  const target = SAP_ENTITY_TARGET[key];
  if (!ec.enabled) return { runId: null, counts, issues, error: "This entity is switched off." };
  const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  if (!(t?.features as TenantFeatures | undefined)?.[target.feature as keyof TenantFeatures]) {
    return { runId: null, counts, issues, error: `The ${target.table} module isn't enabled for this workspace.` };
  }
  // SAP is configured only on the Integration middleware screens; a workspace without that module has no way to see or stop a schedule.
  if (opts.trigger === "schedule" && (t?.features as TenantFeatures | undefined)?.integration_middleware !== true) {
    return { runId: null, counts, issues, error: "Integration middleware isn't enabled for this workspace." };
  }

  // A selection is checked before the run opens: a refused request must not leave a run row (or a lock) behind.
  let selectedIds: string[] | null = null;
  if (opts.ids?.length) {
    const parsed = parseSelection({ ids: opts.ids });
    if (!parsed.ok) return { runId: null, counts, issues, error: parsed.error };
    selectedIds = (parsed.select?.ids ?? []).flatMap(idVariants);
    if (!selectedIds.length) return { runId: null, counts, issues, error: "Nothing matches that selection." };
  }
  const filtered = selectedIds !== null;

  const scopeOn = !filtered && hasScope(ec.scope);
  const builtScope = scopeOn ? buildSapScopeFilter(ec.scope) : { ok: true as const, filter: undefined };
  if (!builtScope.ok) return { runId: null, counts, issues, error: `The saved scope cannot be used: ${builtScope.error} Open Scope and fix it.` };
  const scopeWord = scopeOn ? scopeWords(ec.scope) : null;

  const started = await startRun(admin, tenantId, SAP_CONNECTOR_ID, key, "pull", opts.trigger, opts.userId);
  if (started.locked) return { runId: null, counts, issues, error: ALREADY_RUNNING };
  const runId = started.runId;
  if (filtered) counts.filtered = 1;
  const selectionWord = filtered ? describeSelection({ ids: opts.ids }) : null;
  const mw = (t?.features as TenantFeatures | undefined)?.integration_middleware === true;
  const startedAtMs = Date.now();
  const capture = (t?.config as { integration_middleware?: { payload_capture?: boolean } } | null)?.integration_middleware?.payload_capture === true;
  const note = (error: string | null) => mw ? recordConnectorRun(admin, tenantId, {
    runId, connectorId: SAP_CONNECTOR_ID, entity: key, direction: "pull", trigger: opts.trigger, counts: { ...counts }, issues, error, startedAtMs, entitySet: p.entity_set, capture, selection: selectionWord, scope: scopeWord,
  }) : Promise.resolve();
  let stoppedEarly = false;
  try {
    const pos = opts.full || filtered ? EMPTY_POSITION : parsePosition(await lastWatermark(admin, tenantId, SAP_CONNECTOR_ID, key));
    const client = await clientFor(cfg, creds, p.service, opts);
    const links = await fetchLinks<{ external_id: string; object_id: string; content_hash: string | null }>(admin, tenantId, SAP_CONNECTOR_ID, key, "external_id, object_id, content_hash");
    const linkOf = new Map(links.map((l) => [l.external_id, l]));
    const changeRows: ChangeLogEntryParams[] = [];
    const columns = selectFields(key, ec.field_map);
    const expand = needsExpand(key, ec.field_map) ? [...p.expand] : undefined;
    const base = [p.filter, builtScope.filter].filter(Boolean).map((f) => `(${f})`);
    const requests: (string | undefined)[] = filtered
      ? idsFilters(key, selectedIds!).map((f) => [...base, f].join(" and "))
      : [[...base, changedSinceFilter(p.modified_field, pos.from), keysetFilter(p.id_field, pos.lastKey)].filter(Boolean).join(" and ") || undefined];

    async function* readAll() {
      for (const f of requests) {
        if (counts.read >= maxRows) return;
        yield* client.list(p.entity_set, { select: columns, filter: f, orderby: `${p.id_field} asc`, expand, pageSize: opts.pageSize ?? PAGE_SIZE, maxRows: maxRows - counts.read });
      }
    }

    let seenLinked = 0;
    let newest: string | null = null;
    let hold: string | null = null;
    let lastKey: string | null = pos.lastKey;
    for await (const row of readAll()) {
      if (Date.now() > deadline) { stoppedEarly = true; break; }
      counts.read++;
      const m = mapSapRow(key, ec.field_map, row);
      if ("error" in m) { counts.skipped++; if (issues.length < 25) issues.push(`Skipped a row: ${m.error}`); continue; }
      lastKey = m.externalId;
      if (m.changed && (!newest || m.changed > newest)) newest = m.changed;
      // A row this run could not apply keeps the position from moving past it, so it is read again.
      const holdRow = () => { if (m.changed && (!hold || m.changed < hold)) hold = m.changed; };
      const values: Record<string, string | number | null> = { ...m.values };
      const hash = fingerprint(values);
      const link = linkOf.get(m.externalId);
      try {
        if (link) {
          seenLinked++;
          if (link.content_hash === hash) { counts.unchanged++; continue; }
          const rec = buildTargetRecord(target.table, values, false, encrypt);
          const { data: upd, error } = await admin.from(target.table).update(rec).eq("id", link.object_id).eq("tenant_id", tenantId).select("id");
          if (error) throw error;
          if (!upd?.length) {
            // The BPMSquare record was deleted since: forget the link so the next run creates it again.
            await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID).eq("entity", key).eq("external_id", link.external_id);
            linkOf.delete(link.external_id);
            holdRow();
            counts.skipped++;
            continue;
          }
          await admin.from("connector_links").update({ content_hash: hash, synced_at: new Date().toISOString(), external_key: m.externalKey })
            .eq("tenant_id", tenantId).eq("connector_id", SAP_CONNECTOR_ID).eq("entity", key).eq("external_id", link.external_id);
          link.content_hash = hash;
          counts.updated++;
          changeRows.push({ tenantId, objectType: target.table, objectId: link.object_id, objectLabel: String(values.name ?? ""), action: "update", actorId: opts.userId, actorEmail: null, changes: [{ field: `synced from ${SAP_NAME}`, from: null, to: m.externalKey ?? m.externalId }] });
        } else {
          const rec = { tenant_id: tenantId, ...buildTargetRecord(target.table, values, true, encrypt) };
          const ins = REF_TABLES.has(target.table)
            ? await insertWithMasterRef<{ id: string }>(admin, target.table as MasterRefTable, tenantId, rec, "id")
            : await admin.from(target.table).insert(rec).select("id").single();
          if (ins.error || !ins.data) throw ins.error ?? new Error("insert failed");
          const id = (ins.data as { id: string }).id;
          const { error: linkErr } = await admin.from("connector_links").insert({
            tenant_id: tenantId, connector_id: SAP_CONNECTOR_ID, entity: key, object_type: target.table, object_id: id,
            external_id: m.externalId, external_key: m.externalKey, direction: "pull", content_hash: hash,
          });
          if (linkErr) {
            // A record without its link would be created again by every run: take it back out and report the row as failed.
            const { error: undoErr } = await admin.from(target.table).delete().eq("id", id).eq("tenant_id", tenantId);
            if (undoErr) throw new Error(`could not link the new record (${linkErr.message}) and could not remove it (${undoErr.message}) — remove the duplicate by hand`);
            throw new Error(`could not link the new record (${linkErr.message}); it was removed and will be retried`);
          }
          linkOf.set(m.externalId, { external_id: m.externalId, object_id: id, content_hash: hash });
          counts.created++;
          changeRows.push({ tenantId, objectType: target.table, objectId: id, objectLabel: String(values.name ?? ""), action: "create", actorId: opts.userId, actorEmail: null, changes: [{ field: `created from ${SAP_NAME}`, from: null, to: m.externalKey ?? m.externalId }] });
        }
      } catch (e) {
        holdRow();
        counts.failed++;
        if (issues.length < 25) issues.push(`${m.values.name ?? m.externalId}: ${(e as { message?: string }).message ?? "failed"}`);
      }
      if (changeRows.length >= 200) await logChangeBatch(admin, changeRows.splice(0));
    }
    if (changeRows.length) await logChangeBatch(admin, changeRows);

    const incomplete = stoppedEarly || counts.read >= maxRows;
    let watermark: string | null = null;
    if (!filtered) watermark = nextPosition(pos, { newest, hold, lastKey }, !incomplete);
    if (filtered) {
      if (stoppedEarly) issues.push("Stopped at this run's time limit — run it again.");
      const asked = opts.ids?.length ?? 0;
      if (asked && !incomplete && counts.read < asked) issues.push(`${asked - counts.read} of ${asked} ${asked === 1 ? "record was" : "records were"} not found in SAP.`);
    } else if (stoppedEarly) issues.push("Stopped at this run's time limit — the next run continues from here.");
    else if (incomplete) issues.push(`Stopped at ${maxRows} rows — the next run continues from here.`);
    if (scopeOn) {
      // Records that fell out of the scope since they were linked are left exactly as they are: never deleted, never unlinked.
      if (opts.full && !incomplete) {
        const outside = Math.max(0, links.length - seenLinked);
        if (outside > 0) counts.outside_scope = outside;
      }
      if (!opts.full && ec.scope?.needs_full) issues.push(SCOPE_CHANGED_LINE);
    }
    await markStatus(admin, tenantId, true);
    await finishRun(admin, tenantId, runId, counts, issues, null, watermark);
    if (opts.full && !filtered && ec.scope?.needs_full && !incomplete) await settleScope(admin, tenantId, key);
    await note(null);
    return { runId, counts, issues, error: null };
  } catch (e) {
    const raw = (e as Error).message ?? "Sync failed";
    const msg = scopeOn && e instanceof SapError && e.status === 400
      ? `SAP did not accept the saved scope (${raw.slice(0, 200)}). Open Scope for ${PLURAL[key]} and remove or change the condition that no longer exists.`
      : raw;
    await markStatus(admin, tenantId, false, msg);
    await finishRun(admin, tenantId, runId, counts, issues, msg, null);
    await note(msg);
    return { runId, counts, issues, error: msg };
  }
}

// ── The adapter ─────────────────────────────────────────────────────────────

/** SAP S/4HANA described to the middleware frame. The routes call the functions above; this is the contract they satisfy. */
export function sapAdapter(admin: SupabaseClient): ErpAdapter {
  return {
    id: SAP_CONNECTOR_ID,
    label: SAP_NAME,
    authModes: SAP_AUTH_MODES,
    capabilities: { pull: SAP_ENTITY_KEYS, pushQuote: false, pushProject: false, metadata: true, pickLists: [] },
    async testConnection(tenantId) {
      const r = await testSap(admin, tenantId);
      return { ok: r.ok, line: r.line, failures: r.failures };
    },
    async metadata(tenantId, entity, opts) {
      if (!(SAP_ENTITY_KEYS as readonly string[]).includes(entity)) return { error: "Unknown entity." };
      const r = await getSapFields(admin, tenantId, entity as SapEntityKey, opts);
      return r.ok ? { fields: [...r.main, ...r.extra], source: r.source } : { error: r.message };
    },
    async preview(tenantId, entity) {
      if (!(SAP_ENTITY_KEYS as readonly string[]).includes(entity)) return { error: "Unknown entity.", status: 422 };
      return previewSapEntity(admin, tenantId, entity as SapEntityKey);
    },
    async pull(tenantId, entity, opts) {
      if (!(SAP_ENTITY_KEYS as readonly string[]).includes(entity)) return { runId: null, counts: { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 }, issues: [], error: "Unknown entity." };
      return runSapPull(admin, tenantId, entity as SapEntityKey, opts);
    },
    readableKey(entity, row) {
      const p = (SAP_PRESETS as Record<string, (typeof SAP_PRESETS)[SapEntityKey]>)[entity];
      const v = p ? row[p.key_field] : null;
      return v === null || v === undefined ? null : String(v).trim() || null;
    },
    presets: Object.fromEntries(SAP_ENTITY_KEYS.map((k) => [k, { ...SAP_PRESETS[k].field_map }])),
  };
}
