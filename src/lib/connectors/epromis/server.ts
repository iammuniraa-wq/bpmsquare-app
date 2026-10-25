import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sealSecret, unsealSecret } from "@/lib/encryption";
import { assertSafeHttpsUrl } from "@/lib/net/safeHost";
import type { ErpAdapter } from "@/lib/connectors/adapter";
import { fieldsFromSampleRow } from "@/lib/middleware/metadata";
import { type Creds, type EpromisDeps, definition, send } from "./client";
import { cleanEndpointMap } from "./endpointMap";
import { getPath } from "./jsonPath";
import {
  createProject, getProject, pullMasters, sendBudget, testConnection,
  type Connection,
} from "./operations";
import { redactSecrets } from "./redact";
import preset from "./presets/epromis.default.json";
import {
  EPROMIS_AUTH_TYPES, EPROMIS_CONNECTOR_ID, EPROMIS_NAME, MASTER_KINDS, MASTER_OPERATION,
  type BudgetPayload, type CreateResult, type EpResult, type EpromisAuthType, type EpromisConfig, type EpromisPublicState, type MasterKind, type MasterPull,
  type ProjectInfo, type ProjectPayload, type CompanyPlacement,
} from "./types";

// ePROMIS connector, server side. Runs on the service-role client (connector rows are admin plumbing), so EVERY query
// names the tenant explicitly. The credential is sealed in tenant_connectors.credentials, written only through
// saveEpromisConnection, read only here to attach to a request, and never returned, logged or put in a message.

export class EpromisSaveError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type Loaded = { cfg: EpromisConfig; creds: Creds; status: string; last_error: string | null };

// ── The stored connection ───────────────────────────────────────────────────

/** A stored config read defensively: whatever is in the row, the result has the right shape and a cleaned endpoint map. */
export function readConfig(raw: unknown): EpromisConfig | null {
  const c = (raw && typeof raw === "object" ? raw : null) as Partial<EpromisConfig> | null;
  if (!c || typeof c.base_url !== "string" || !c.base_url) return null;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
  const auth = (EPROMIS_AUTH_TYPES as readonly string[]).includes(c.auth_type as string) ? (c.auth_type as EpromisAuthType) : "api_key";
  const { map, problem } = cleanEndpointMap(c.endpoints);
  return {
    base_url: str(c.base_url, 300), auth_type: auth, key_header: str(c.key_header, 64), username: str(c.username),
    company_name: str(c.company_name, 64), company_value: str(c.company_value), company_in: c.company_in === "query" ? "query" : "header",
    endpoints: problem ? {} : map,
  };
}

export async function loadEpromis(admin: SupabaseClient, tenantId: string): Promise<Loaded | null> {
  const { data } = await admin.from("tenant_connectors").select("config, credentials, status, last_error")
    .eq("tenant_id", tenantId).eq("connector_id", EPROMIS_CONNECTOR_ID).maybeSingle();
  if (!data) return null;
  const cfg = readConfig(data.config);
  if (!cfg) return null;
  const raw = (data.credentials ?? {}) as Record<string, string>;
  return { cfg, creds: { secret: unsealSecret(raw.secret) }, status: data.status as string, last_error: (data.last_error as string | null) ?? null };
}

/** What a screen may see: the configuration and WHETHER a credential is stored. Never the credential. */
export function publicState(row: Loaded | null): EpromisPublicState {
  if (!row) return { config: null, secret_stored: false, status: "not_connected", last_error: null };
  return { config: row.cfg, secret_stored: !!row.creds.secret, status: row.status === "connected" ? "connected" : "error", last_error: row.last_error };
}

export async function markStatus(admin: SupabaseClient, tenantId: string, ok: boolean, error?: string | null): Promise<void> {
  await admin.from("tenant_connectors")
    .update({ status: ok ? "connected" : "error", last_error: ok ? null : (error ?? "").slice(0, 500), updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("connector_id", EPROMIS_CONNECTOR_ID);
}

// ── Save ────────────────────────────────────────────────────────────────────

const CONTROL = /[\u0000-\u001f\u007f]/;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const QUERY_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "content-type", "accept", "connection", "transfer-encoding", "upgrade", "cookie", "expect", "te"]);

/** "https://erp.example.com/api/", "erp.example.com" and the like, to https://erp.example.com/api. */
export function normalizeBaseUrl(input: unknown): string {
  const t = typeof input === "string" ? input.trim() : "";
  if (!t) throw new EpromisSaveError(422, "Enter the ePROMIS base URL, such as https://erp.example.com/api.");
  if (/^http:\/\//i.test(t)) throw new EpromisSaveError(422, "The address must use https.");
  if (CONTROL.test(t) || /\s/.test(t)) throw new EpromisSaveError(422, "That isn't a valid address.");
  let u: URL;
  try { u = new URL(/^https:\/\//i.test(t) ? t : `https://${t}`); } catch { throw new EpromisSaveError(422, "That isn't a valid address."); }
  if (u.username || u.password) throw new EpromisSaveError(422, "Leave the user name and password out of the address; they have their own fields.");
  if (u.search || u.hash) throw new EpromisSaveError(422, "Enter the address without a query or a #.");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

function text(v: unknown, label: string, max: number): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new EpromisSaveError(422, `${label} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new EpromisSaveError(422, `${label} is too long.`);
  if (CONTROL.test(t)) throw new EpromisSaveError(422, `${label} may not contain line breaks or control characters.`);
  return t;
}

export type EpromisSaveBody = { config?: Record<string, unknown>; secrets?: Record<string, unknown> };

/**
 * Validate and store the connection; returns the public state. A blank credential means "unchanged" -- except that a
 * credential stored for another address or another sign-in type is not carried over: it must be entered again, so
 * repointing the connection can never send the old credential somewhere new.
 */
export async function saveEpromisConnection(admin: SupabaseClient, tenantId: string, userId: string, body: EpromisSaveBody | null): Promise<EpromisPublicState> {
  const c = body?.config;
  if (!c) throw new EpromisSaveError(422, "config is required");
  const prev = await loadEpromis(admin, tenantId);

  const base_url = normalizeBaseUrl(c.base_url ?? prev?.cfg.base_url);
  await assertSafeHttpsUrl(base_url).catch((e: Error) => { throw new EpromisSaveError(422, e.message); });

  const authRaw = c.auth_type ?? prev?.cfg.auth_type ?? "api_key";
  if (!(EPROMIS_AUTH_TYPES as readonly unknown[]).includes(authRaw)) throw new EpromisSaveError(422, "Choose how ePROMIS signs requests in.");
  const auth_type = authRaw as EpromisAuthType;

  let key_header = "";
  if (auth_type === "api_key") {
    key_header = text(c.key_header ?? prev?.cfg.key_header, "The header name", 64);
    if (!key_header) throw new EpromisSaveError(422, "Enter the name of the header that carries the API key.");
    if (!HEADER_NAME.test(key_header) || FORBIDDEN_HEADERS.has(key_header.toLowerCase())) throw new EpromisSaveError(422, "That header name can't be used for the API key.");
  }
  let username = "";
  if (auth_type === "basic") {
    username = text(c.username ?? prev?.cfg.username, "The user name", 200);
    if (!username) throw new EpromisSaveError(422, "Enter the user name.");
  }

  const company_value = text(c.company_value ?? prev?.cfg.company_value, "The company code", 200);
  const company_in: CompanyPlacement = (c.company_in ?? prev?.cfg.company_in) === "query" ? "query" : "header";
  let company_name = text(c.company_name ?? prev?.cfg.company_name, "The company code name", 64);
  if (company_value && !company_name) throw new EpromisSaveError(422, "Enter the name that carries the company code (a header or a query parameter name).");
  if (!company_value) company_name = "";
  if (company_name) {
    const ok = company_in === "header" ? HEADER_NAME.test(company_name) && !FORBIDDEN_HEADERS.has(company_name.toLowerCase()) : QUERY_NAME.test(company_name);
    if (!ok) throw new EpromisSaveError(422, `That isn't a valid ${company_in === "header" ? "header" : "query parameter"} name.`);
  }

  let endpoints = prev?.cfg.endpoints ?? {};
  if (c.endpoints !== undefined) {
    const { map, problem } = cleanEndpointMap(c.endpoints);
    if (problem) throw new EpromisSaveError(422, problem);
    endpoints = map;
  }

  const given = typeof body?.secrets?.secret === "string" ? body.secrets.secret.trim().slice(0, 4000) : "";
  if (given && CONTROL.test(given)) throw new EpromisSaveError(422, "The credential may not contain line breaks.");
  const p = prev?.cfg;
  const carried = !!p && p.auth_type === auth_type && new URL(p.base_url).origin === new URL(base_url).origin;
  const sealed = given ? sealSecret(given) : carried ? (await storedSecret(admin, tenantId)) : undefined;
  if (!sealed) {
    throw new EpromisSaveError(422, p && !carried && !given ? "Enter the credential again: the stored one belongs to another address or sign-in type." : "Enter the credential.");
  }

  const cfg: EpromisConfig = { base_url, auth_type, key_header, username, company_name, company_value, company_in, endpoints };
  const identityChanged = !p || !carried || !!given || p.key_header !== key_header || p.username !== username
    || p.company_name !== company_name || p.company_value !== company_value || p.company_in !== company_in;

  const { error } = await admin.from("tenant_connectors").upsert({
    tenant_id: tenantId, connector_id: EPROMIS_CONNECTOR_ID,
    status: identityChanged ? "error" : (prev?.status ?? "error"),
    last_error: identityChanged ? "Not tested yet. Press Test." : prev?.last_error ?? null,
    config: cfg as unknown as Record<string, string>, credentials: { secret: sealed }, connected_by: userId,
    connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,connector_id" });
  if (error) throw new EpromisSaveError(500, "Could not save the connection.");
  return publicState(await loadEpromis(admin, tenantId));
}

async function storedSecret(admin: SupabaseClient, tenantId: string): Promise<string | undefined> {
  const { data } = await admin.from("tenant_connectors").select("credentials").eq("tenant_id", tenantId).eq("connector_id", EPROMIS_CONNECTOR_ID).maybeSingle();
  const v = (data?.credentials as Record<string, string> | undefined)?.secret;
  return v ? v : undefined;
}

export async function disconnectEpromis(admin: SupabaseClient, tenantId: string): Promise<void> {
  await admin.from("tenant_connectors").delete().eq("tenant_id", tenantId).eq("connector_id", EPROMIS_CONNECTOR_ID);
}

// ── Test ────────────────────────────────────────────────────────────────────

export type TestAnswer = { ok: boolean; line: string; failures: { label: string; fix: string | null }[]; verified: boolean; status: number; error?: string };

export async function testEpromis(admin: SupabaseClient, tenantId: string, deps: EpromisDeps = {}): Promise<TestAnswer> {
  const row = await loadEpromis(admin, tenantId);
  if (!row) return { ok: false, verified: false, line: "Save the connection first.", failures: [{ label: "Connection", fix: "Save the connection first." }], status: 400, error: "Save the connection first." };
  const r = await testConnection({ cfg: row.cfg, creds: row.creds }, deps);
  await markStatus(admin, tenantId, r.ok, r.ok ? null : r.line);
  return { ...r, status: r.ok ? 200 : 400, ...(r.ok ? {} : { error: r.line }) };
}

// ── What the rest of BPMSquare calls ────────────────────────────────────────

const notConnected = { ok: false as const, state: "not_connected" as const, message: "ePROMIS is not connected. Connect it in Settings > Connectors." };

async function connection(admin: SupabaseClient, tenantId: string): Promise<Connection | null> {
  const row = await loadEpromis(admin, tenantId);
  return row ? { cfg: row.cfg, creds: row.creds } : null;
}

export async function pullEpromisMasters(admin: SupabaseClient, tenantId: string, kind: MasterKind, deps: EpromisDeps = {}): Promise<EpResult<MasterPull>> {
  const c = await connection(admin, tenantId);
  return c ? pullMasters(c, kind, deps) : notConnected;
}
export async function readEpromisProject(admin: SupabaseClient, tenantId: string, code: string, deps: EpromisDeps = {}): Promise<EpResult<ProjectInfo | null>> {
  const c = await connection(admin, tenantId);
  return c ? getProject(c, code, deps) : notConnected;
}
export async function createEpromisProject(admin: SupabaseClient, tenantId: string, payload: ProjectPayload, deps: EpromisDeps = {}): Promise<EpResult<CreateResult>> {
  const c = await connection(admin, tenantId);
  return c ? createProject(c, payload, deps) : notConnected;
}
export async function sendEpromisBudget(admin: SupabaseClient, tenantId: string, payload: BudgetPayload, deps: EpromisDeps = {}): Promise<EpResult<CreateResult>> {
  const c = await connection(admin, tenantId);
  return c ? sendBudget(c, payload, deps) : notConnected;
}

// ── The adapter ─────────────────────────────────────────────────────────────

const ZERO = { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };

/** The shipped field maps of the (unverified) default preset, per list: empty until a verified preset exists. */
export const PRESET_FIELD_MAPS: Record<string, Record<string, string>> = Object.fromEntries(
  MASTER_KINDS.map((k) => [k, { ...((preset.endpoints as Record<string, { fields?: Record<string, string> }>)[MASTER_OPERATION[k]]?.fields ?? {}) }]),
);

/**
 * ePROMIS described to the middleware frame. Reading the lists into BPMSquare tables is not part of this adapter yet
 * (the masters table belongs to the contract-project work), so `pull` says so; `preview` and `metadata` do read the
 * vendor's first rows so a mapping can be written against real data.
 */
export function epromisAdapter(admin: SupabaseClient, deps: EpromisDeps = {}): ErpAdapter {
  const kindOf = (entity: string): MasterKind | null => ((MASTER_KINDS as readonly string[]).includes(entity) ? (entity as MasterKind) : null);

  async function firstRows(tenantId: string, kind: MasterKind): Promise<{ rows: Record<string, unknown>[] } | { error: string; status: number }> {
    const row = await loadEpromis(admin, tenantId);
    if (!row) return { error: notConnected.message, status: 400 };
    const def = definition(row.cfg, MASTER_OPERATION[kind]);
    if (!def) return { error: `Not configured: the ${kind.replace("_", " ")} list address is not set.`, status: 422 };
    try {
      const r = await send(row.cfg, row.creds, { method: def.method, path: def.path }, deps);
      const raw = def.rows_path ? getPath(r.json, def.rows_path) : r.json;
      const rows = (Array.isArray(raw) ? raw : []).slice(0, 5).filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
      return { rows };
    } catch (e) {
      return { error: redactSecrets((e as Error).message ?? "Could not read ePROMIS.", [row.creds.secret]).slice(0, 300), status: 400 };
    }
  }

  return {
    id: EPROMIS_CONNECTOR_ID,
    label: EPROMIS_NAME,
    authModes: ["api_key", "bearer", "basic"],
    capabilities: { pull: MASTER_KINDS, pushQuote: false, pushProject: true, pushOrder: false, metadata: true, pickLists: [] },
    async testConnection(tenantId) {
      const r = await testEpromis(admin, tenantId, deps);
      return { ok: r.ok, line: r.line, failures: r.failures.map((f) => ({ label: f.label, fix: f.fix })) };
    },
    async metadata(tenantId, entity) {
      const kind = kindOf(entity);
      if (!kind) return { error: "Unknown entity." };
      const r = await firstRows(tenantId, kind);
      if ("error" in r) return { error: r.error };
      return { fields: fieldsFromSampleRow(r.rows[0] ?? null), source: "sample" };
    },
    async preview(tenantId, entity) {
      const kind = kindOf(entity);
      if (!kind) return { error: "Unknown entity.", status: 422 };
      return firstRows(tenantId, kind);
    },
    async pull() {
      return { runId: null, counts: { ...ZERO }, issues: [], error: "Storing ePROMIS lists in BPMSquare comes with the contract-project work. The lists can already be read." };
    },
    readableKey(entity, row) {
      const v = row[(PRESET_FIELD_MAPS[entity]?.code || "code").replace(/^\$\.?/, "")];
      return v === null || v === undefined ? null : String(v).trim() || null;
    },
    presets: PRESET_FIELD_MAPS,
  };
}
