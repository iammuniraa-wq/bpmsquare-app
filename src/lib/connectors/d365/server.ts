import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/encryption";
import { assertSafeHttpsUrl } from "@/lib/net/safeHost";
import { insertWithMasterRef, type MasterRefTable } from "@/lib/masterRef";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";
import { stampContactEmailHash } from "@/lib/marketing/contactEmailHash";
import { recordConnectorRun } from "@/lib/middleware/messages";
import { loadInbound } from "@/lib/middleware/mapping/engineServer";
import { recordUnknownInbound } from "@/lib/middleware/mapping/valueListStore";
import { isMappingDoc } from "@/lib/middleware/mappingDoc";
import { D365Client, D365Error } from "./odata";
import { buildClientAssertion, certDerFromPem, tokenUrl, validDirectory } from "./jwt";
import { entityConfig, apiBase, resourceFor, allowedHost, sovereignHost } from "./catalog";
import { buildSelection, describeSelection, type RunSelection } from "./selection";
import { SCOPE_CHANGED_LINE, buildScopeFilter, hasScope, scopeWords } from "./scope";
import {
  mapPullRow, fingerprint, buildPushBody, modifiedSinceFilter, odataString, buildTargetRecord, normalizeModified, nextModifiedWatermark,
  formatCursor, parseCursor, keysetFilter, accountLookupKeys, selectFields, scopedExternalId, splitExternalId, withDataArea,
} from "./mapping";
import {
  D365_AUTH_FOR_PRODUCT, D365_ENTITY_TARGET,
  type D365Config, type D365EntityKey, type D365PublicState,
} from "./types";

// Dynamics 365 connector, server side. Everything here runs on the
// service-role client (connector rows and sync tables are admin plumbing),
// so EVERY query names the tenant explicitly.
//
// Secrets live encrypted in tenant_connectors.credentials (client_secret,
// certificate, private_key, password, refresh_token, access_token); the
// non-secret setup in tenant_connectors.config. The access token is cached
// there too, with its expiry, so a sync doesn't ask Entra for a token per
// request -- and never in a module-level variable (guardrails: no tenant
// data in process memory across requests).

export const CONNECTOR_ID = "dynamics365";

type Creds = Record<string, string>;

export async function loadD365(admin: SupabaseClient, tenantId: string): Promise<{ cfg: D365Config; creds: Creds; status: string; last_error: string | null } | null> {
  const { data } = await admin.from("tenant_connectors").select("config, credentials, status, last_error")
    .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).maybeSingle();
  if (!data) return null;
  const cfg = data.config as unknown as D365Config;
  if (!cfg?.product) return null;
  const raw = (data.credentials ?? {}) as Record<string, string>;
  const creds: Creds = {};
  for (const [k, v] of Object.entries(raw)) creds[k] = k === "expires_at" ? v : decrypt(v) ?? "";
  return { cfg, creds, status: data.status as string, last_error: (data.last_error as string | null) ?? null };
}

export function publicState(row: Awaited<ReturnType<typeof loadD365>>): D365PublicState {
  if (!row) return { config: null, secrets: { client_secret: false, certificate: false, private_key: false, password: false, refresh_token: false }, status: "not_connected", last_error: null };
  const has = (k: string) => !!row.creds[k];
  return {
    config: row.cfg,
    secrets: { client_secret: has("client_secret"), certificate: has("certificate"), private_key: has("private_key"), password: has("password"), refresh_token: has("refresh_token") },
    status: row.status === "connected" ? "connected" : "error",
    last_error: row.last_error,
  };
}

/** Validate a config before it is stored. Throws {status, message}. */
export async function validateConfig(cfg: D365Config): Promise<void> {
  if (!D365_AUTH_FOR_PRODUCT[cfg.product]?.includes(cfg.auth_mode)) {
    throw { status: 422, message: cfg.auth_mode === "basic" ? "Basic login only works with Business Central on-premises — Microsoft turned it off for every Dynamics 365 online API." : "That login type doesn't apply to this product." };
  }
  if (cfg.auth_mode !== "basic") {
    if (!validDirectory(cfg.directory_id)) throw { status: 422, message: "Enter the Entra ID directory (tenant) ID — a GUID — or your domain, e.g. contoso.onmicrosoft.com." };
    if (!cfg.client_id || !/^[0-9a-f-]{36}$/i.test(cfg.client_id)) throw { status: 422, message: "Enter the app registration's Application (client) ID." };
  }
  if (cfg.product === "bc" && cfg.auth_mode !== "basic") {
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(cfg.environment_url.trim())) throw { status: 422, message: "For Business Central online, enter the environment name (e.g. Production)." };
  } else {
    const url = await assertSafeHttpsUrl(cfg.environment_url.trim()).catch((e: Error) => { throw { status: 422, message: e.message }; });
    if (cfg.auth_mode !== "basic" && sovereignHost(url.hostname)) throw { status: 422, message: `${url.hostname} is in a US Government or China cloud. This connector signs in through the commercial Microsoft cloud only, so it can't connect there yet.` };
    if (!allowedHost(cfg, url.hostname)) throw { status: 422, message: `That isn't a Dynamics 365 address (${url.hostname}). Use your environment URL, e.g. https://yourorg.crm.dynamics.com.` };
  }
  if (cfg.product === "bc" && cfg.company && !/^[0-9a-f-]{36}$/i.test(cfg.company)) throw { status: 422, message: "Business Central company must be the company's id (a GUID) — Test connection lists them." };
  if (cfg.product === "fo" && cfg.company && !/^[A-Za-z0-9]{1,8}$/.test(cfg.company)) throw { status: 422, message: "Finance & Operations company is the legal entity code, e.g. USMF." };
}

async function saveCreds(admin: SupabaseClient, tenantId: string, patch: Creds) {
  const { data } = await admin.from("tenant_connectors").select("credentials").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).maybeSingle();
  const current = (data?.credentials ?? {}) as Record<string, string>;
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) next[k] = k === "expires_at" ? v : encrypt(v) ?? "";
  await admin.from("tenant_connectors").update({ credentials: next, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
}

export async function markStatus(admin: SupabaseClient, tenantId: string, ok: boolean, error?: string | null) {
  await admin.from("tenant_connectors").update({ status: ok ? "connected" : "error", last_error: ok ? null : (error ?? "").slice(0, 500), updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
}

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string };

async function tokenRequest(directory: string, form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(tokenUrl(directory), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  }).catch((e: Error) => {
    throw new D365Error(e.name === "TimeoutError" || e.name === "AbortError" ? "Microsoft sign-in did not answer in time" : `Could not reach Microsoft sign-in: ${e.message}`, 0);
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    const desc = (json.error_description ?? "").split("\r\n")[0].split("\n")[0];
    throw new D365Error(`Microsoft sign-in failed: ${json.error ?? res.status}${desc ? ` — ${desc}` : ""}`, 401, json.error);
  }
  return json;
}

/** Client authentication for the token endpoint: a secret or a signed
 *  certificate assertion. */
function clientAuth(cfg: D365Config, creds: Creds): Record<string, string> {
  if (cfg.auth_mode === "certificate") {
    if (!creds.certificate || !creds.private_key) throw new D365Error("The certificate or its private key is missing — upload both.", 400);
    return {
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: buildClientAssertion({ clientId: cfg.client_id!, tokenUrl: tokenUrl(cfg.directory_id!), certDer: certDerFromPem(creds.certificate), privateKeyPem: creds.private_key }),
    };
  }
  if (!creds.client_secret) throw new D365Error("The client secret is missing.", 400);
  return { client_secret: creds.client_secret };
}

/** The Authorization header value for this tenant's Dynamics, fetching or
 *  refreshing a token only when the cached one is about to expire. */
export async function authHeaderFor(admin: SupabaseClient, tenantId: string, cfg: D365Config, creds: Creds): Promise<string> {
  if (cfg.auth_mode === "basic") {
    if (!cfg.username || !creds.password) throw new D365Error("Username and password are required.", 400);
    return `Basic ${Buffer.from(`${cfg.username}:${creds.password}`).toString("base64")}`;
  }
  const expires = Number(creds.expires_at ?? 0);
  if (creds.access_token && Date.now() < expires - 120_000) return `Bearer ${creds.access_token}`;

  const scope = `${resourceFor(cfg)}/.default`;
  let tok: TokenResponse;
  if (cfg.auth_mode === "authorization_code") {
    if (!creds.refresh_token) throw new D365Error("Sign in to Microsoft first (Connect with Microsoft).", 401);
    tok = await tokenRequest(cfg.directory_id!, {
      client_id: cfg.client_id!, grant_type: "refresh_token", refresh_token: creds.refresh_token, scope: `${scope} offline_access`,
      ...(creds.client_secret ? { client_secret: creds.client_secret } : clientAuth({ ...cfg, auth_mode: "certificate" }, creds)),
    });
  } else {
    tok = await tokenRequest(cfg.directory_id!, { client_id: cfg.client_id!, grant_type: "client_credentials", scope, ...clientAuth(cfg, creds) });
  }
  const patch: Creds = { access_token: tok.access_token!, expires_at: String(Date.now() + (tok.expires_in ?? 3600) * 1000) };
  if (tok.refresh_token) patch.refresh_token = tok.refresh_token;
  await saveCreds(admin, tenantId, patch);
  creds.access_token = tok.access_token!;
  creds.expires_at = patch.expires_at;
  return `Bearer ${tok.access_token}`;
}

/** Exchange an authorization code (delegated sign-in) and keep the tokens. */
export async function exchangeAuthCode(admin: SupabaseClient, tenantId: string, cfg: D365Config, creds: Creds, code: string, redirectUri: string, codeVerifier: string): Promise<void> {
  const tok = await tokenRequest(cfg.directory_id!, {
    client_id: cfg.client_id!, grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier,
    scope: `${resourceFor(cfg)}/.default offline_access`,
    ...(creds.client_secret ? { client_secret: creds.client_secret } : clientAuth({ ...cfg, auth_mode: "certificate" }, creds)),
  });
  if (!tok.refresh_token) throw new D365Error("Microsoft didn't return a refresh token — make sure offline access is allowed for the app.", 400);
  await saveCreds(admin, tenantId, { access_token: tok.access_token!, refresh_token: tok.refresh_token, expires_at: String(Date.now() + (tok.expires_in ?? 3600) * 1000) });
}

export async function clientFor(admin: SupabaseClient, tenantId: string, cfg: D365Config, creds: Creds): Promise<D365Client> {
  const base = apiBase(cfg);
  const url = await assertSafeHttpsUrl(base);
  if (!allowedHost(cfg, url.hostname)) throw new D365Error("Environment URL isn't a Dynamics 365 address.", 400);
  return new D365Client(base, () => authHeaderFor(admin, tenantId, cfg, creds), {
    onUnauthorized: async () => { delete creds.access_token; delete creds.expires_at; },
  });
}

/** F&O reads one legal entity unless told otherwise; cross-company plus a
 *  dataAreaId filter is how a specific company is chosen. */
function foCompanyQuery(cfg: D365Config): { extraQuery?: Record<string, string>; filter?: string } {
  if (cfg.product !== "fo" || !cfg.company) return {};
  return { extraQuery: { "cross-company": "true" }, filter: `dataAreaId eq ${odataString(cfg.company.toLowerCase())}` };
}

/** Connection test: a real, cheap, authenticated call per product. */
export async function testConnection(admin: SupabaseClient, tenantId: string, cfg: D365Config, creds: Creds): Promise<string> {
  if (cfg.product === "dataverse") {
    const c = await clientFor(admin, tenantId, cfg, creds);
    const who = (await c.get("WhoAmI")) as { UserId?: string; OrganizationId?: string };
    return `Connected to Dataverse — signed in as user ${who.UserId ?? "?"} in organisation ${who.OrganizationId ?? "?"}.`;
  }
  if (cfg.product === "bc") {
    // Companies live one level above a company-scoped base.
    const c = await clientFor(admin, tenantId, { ...cfg, company: undefined }, creds);
    const list = (await c.get("companies", { $select: "id,name" })) as { value?: { id: string; name: string }[] };
    const names = (list.value ?? []).map((x) => `${x.name} (${x.id})`).slice(0, 5).join(", ");
    return `Connected to Business Central — companies: ${names || "none visible to this login"}.${cfg.company ? "" : " Paste the company id into Company to sync."}`;
  }
  const c = await clientFor(admin, tenantId, cfg, creds);
  const q = foCompanyQuery(cfg);
  const page = (await c.get("CustomersV3", { $top: "1", $select: "CustomerAccount", ...(q.extraQuery ?? {}), $filter: q.filter })) as { value?: unknown[] };
  return `Connected to Finance & Operations — data entities answer${cfg.company ? ` for ${cfg.company.toUpperCase()}` : ""} (${(page.value ?? []).length ? "customers readable" : "no customers visible"}).`;
}

/** First rows of an entity, raw, so an admin can check field names before
 *  the first sync. Values are trimmed; nothing is written. */
export async function previewEntity(admin: SupabaseClient, tenantId: string, cfg: D365Config, creds: Creds, key: D365EntityKey): Promise<Record<string, unknown>[]> {
  const ec = entityConfig(cfg, key);
  if (!ec?.entity_set) throw new D365Error("No entity configured.", 400);
  const c = await clientFor(admin, tenantId, cfg, creds);
  const q = foCompanyQuery(cfg);
  const out: Record<string, unknown>[] = [];
  for await (const row of c.list(ec.entity_set, { filter: [ec.filter, q.filter].filter(Boolean).map((f) => `(${f})`).join(" and ") || undefined, maxRows: 5, pageSize: 5, top: 5, extraQuery: q.extraQuery })) {
    const slim: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith("@odata.") || k.includes("@OData.Community")) continue;
      slim[k] = typeof v === "string" ? v.slice(0, 120) : v;
    }
    out.push(slim);
  }
  return out;
}

// ── Pull ────────────────────────────────────────────────────────────────────

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REF_TABLES = new Set<string>(["accounts", "contacts", "suppliers", "products", "wfm_projects"]);
const MAX_ROWS_PER_RUN = 5000;

export type RunCounts = {
  read: number; created: number; updated: number; unchanged: number; skipped: number; failed: number;
  /** 1 on a run that read a selection of ids: its marker in the history. */ filtered?: number;
  /** Full run under a scope: linked records the scope no longer reaches. They are left as they are, never deleted or unlinked. */ outside_scope?: number;
  /** A saved mapping's value list met ERP codes it has no row for: kept as they came and counted, never a failure. */ unknown_codes?: number;
};
export type PullResult = { runId: string | null; counts: RunCounts; issues: string[]; error: string | null; /** Ids that were asked for and could not be looked up. */ unsupported?: string[] };

/** The scope was changed after a run had moved the incremental position; a finished Full resync settles it. */
async function settleScope(admin: SupabaseClient, tenantId: string, key: D365EntityKey): Promise<void> {
  const loaded = await loadD365(admin, tenantId);
  const own = loaded?.cfg.entities?.[key];
  if (!loaded || !own?.scope?.needs_full) return;
  const entities = { ...loaded.cfg.entities, [key]: { ...own, scope: { conditions: own.scope.conditions } } };
  await admin.from("tenant_connectors").update({ config: { ...loaded.cfg, entities } as unknown as Record<string, string>, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
}

/** A run older than this cannot still be alive: the routes stop at 300 s. */
export const STALE_RUN_MS = 10 * 60 * 1000;
/** How long one run may keep starting new work. The route's function limit is
 *  300 s; the rest is for the last page in flight and the closing writes. */
export const RUN_BUDGET_MS = 240_000;
export const ALREADY_RUNNING = "A sync of this entity is already running — try again in a few minutes.";

/**
 * Open a run row, which doubles as the per-entity lock. Runs a killed
 * function left in 'running' are closed first (otherwise one timeout would
 * block the entity for good); then, if a live run exists, this one does not
 * start. Migration 0136's partial unique index makes the check atomic; until
 * it is applied the select below still catches every non-simultaneous start.
 */
export async function startRun(admin: SupabaseClient, tenantId: string, entity: string, direction: "pull" | "push", trigger: "manual" | "schedule", userId: string | null): Promise<{ runId: string | null; locked: boolean }> {
  const now = Date.now();
  await admin.from("connector_sync_runs").update({
    status: "failed", finished_at: new Date(now).toISOString(),
    error: "The run did not finish (the server stopped it). The next run continues.",
  }).eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("status", "running").lt("started_at", new Date(now - STALE_RUN_MS).toISOString());
  const { data: live } = await admin.from("connector_sync_runs").select("id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", entity).eq("status", "running").limit(1);
  if (live?.length) return { runId: null, locked: true };
  const { data, error } = await admin.from("connector_sync_runs").insert({ tenant_id: tenantId, connector_id: CONNECTOR_ID, entity, direction, trigger, started_by: userId }).select("id").single();
  if (error?.code === "23505") return { runId: null, locked: true };
  return { runId: (data?.id as string | undefined) ?? null, locked: false };
}

export async function finishRun(admin: SupabaseClient, tenantId: string, runId: string | null, counts: RunCounts, issues: string[], error: string | null, watermark: string | null) {
  if (!runId) return;
  const status = error ? "failed" : counts.failed > 0 ? "partial" : "succeeded";
  await admin.from("connector_sync_runs").update({
    status, finished_at: new Date().toISOString(), counts, issues: issues.slice(0, 25), error: error?.slice(0, 1000) ?? null, watermark,
  }).eq("id", runId).eq("tenant_id", tenantId);
}

export async function lastWatermark(admin: SupabaseClient, tenantId: string, entity: string): Promise<string | null> {
  const { data } = await admin.from("connector_sync_runs").select("watermark").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", entity).eq("direction", "pull").in("status", ["succeeded", "partial"]).not("watermark", "is", null)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.watermark as string | null) ?? null;
}

const LINK_PAGE = 1000;

/** Every link of one entity. PostgREST answers at most 1000 rows to a plain
 *  select; a partial map would make a pull re-create records it already has
 *  and a push re-send projects it already sent. */
export async function fetchLinks<T>(admin: SupabaseClient, tenantId: string, entity: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += LINK_PAGE) {
    const { data, error } = await admin.from("connector_links").select(cols)
      .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", entity).order("id").range(from, from + LINK_PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
    if ((data?.length ?? 0) < LINK_PAGE) break;
  }
  return out;
}

const toRecord = (table: string, values: Record<string, string | number | null>, isInsert: boolean) => buildTargetRecord(table, values, isInsert, encrypt);

/**
 * Pull one entity from Dynamics into BPMSquare. Creates what's new, updates
 * only the mapped fields of what it created before (found through
 * connector_links by the external id), never deletes, never touches a field
 * the map doesn't own. Incremental where the entity has a modified field.
 */
export async function runPull(admin: SupabaseClient, tenantId: string, key: Exclude<D365EntityKey, "fence_projects">, opts: {
  trigger: "manual" | "schedule"; userId: string | null; full?: boolean; /** epoch ms after which no new row is started */ deadline?: number; /** rows per run (tests lower it) */ maxRows?: number;
  /** Read only these records (filters and/or ids). Such a run never moves the incremental position. */
  select?: RunSelection;
}): Promise<PullResult> {
  // Sales orders have a header, lines and invoices rather than a field map: they have their own reader (orders.ts).
  // Imported on use so the two files never import each other at load time.
  if (key === "sales_orders") {
    const { runPullSalesOrders } = await import("./orders");
    return runPullSalesOrders(admin, tenantId, opts);
  }
  const deadline = opts.deadline ?? Date.now() + RUN_BUDGET_MS;
  const maxRows = opts.maxRows ?? MAX_ROWS_PER_RUN;
  const counts: RunCounts = { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const issues: string[] = [];
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { runId: null, counts, issues, error: "Dynamics 365 isn't connected." };
  const { cfg, creds } = loaded;
  const ec = entityConfig(cfg, key);
  const target = D365_ENTITY_TARGET[key];
  if (!ec?.enabled) return { runId: null, counts, issues, error: "This entity is switched off." };
  const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  if (!(t?.features as TenantFeatures | undefined)?.[target.feature as keyof TenantFeatures]) {
    return { runId: null, counts, issues, error: `The ${target.table} module isn't enabled for this workspace.` };
  }
  // A saved mapping document for this entity reads the rows through its reverse converters; without one the older field map does, as before.
  const inbound = isMappingDoc(key) ? await loadInbound(admin, tenantId, CONNECTOR_ID, key) : null;
  const ecRun = inbound ? { ...ec, field_map: inbound.fieldMap } : ec;

  // A selection is planned before the run is opened: when none of it can be applied there is nothing
  // to read, and a refused request must not leave a run row (or a lock) behind.
  const sel = opts.select && Object.keys(opts.select).length ? opts.select : undefined;
  const planned = sel ? buildSelection(cfg.product, ec, sel) : null;
  if (sel && planned?.nothingUsable) {
    return { runId: null, counts, issues, error: planned.unsupported.join(" ") || "Nothing matches that selection.", unsupported: planned.unsupported };
  }

  // The saved scope narrows every ordinary run. A run for named ids is an explicit ask and ignores it.
  const scopeOn = !planned && hasScope(ec.scope);
  const builtScope = scopeOn ? buildScopeFilter(cfg.product, ec.scope, key) : { ok: true as const, filter: undefined };
  if (!builtScope.ok) return { runId: null, counts, issues, error: `The saved scope cannot be used: ${builtScope.error} Open Scope and fix it.` };
  const scopeWord = scopeOn ? scopeWords(ec.scope) : null;

  const started = await startRun(admin, tenantId, key, "pull", opts.trigger, opts.userId);
  if (started.locked) return { runId: null, counts, issues, error: ALREADY_RUNNING };
  const runId = started.runId;
  const filtered = !!planned;
  if (filtered) counts.filtered = 1;
  const selectionWord = sel ? describeSelection(sel) : null;
  // Integration middleware: one message per run, only for a workspace that has
  // the flag (read from the features row this function already loaded).
  const mw = (t?.features as TenantFeatures | undefined)?.integration_middleware === true;
  const startedAtMs = Date.now();
  const capture = (t?.config as { integration_middleware?: { payload_capture?: boolean } } | null)?.integration_middleware?.payload_capture === true;
  const note = (error: string | null) => mw ? recordConnectorRun(admin, tenantId, { runId, entity: key, direction: "pull", trigger: opts.trigger, counts: { ...counts }, issues, error, startedAtMs, entitySet: ec.entity_set, capture, selection: selectionWord, scope: scopeWord }) : Promise.resolve();
  let stoppedEarly = false;
  try {
    // A filtered run is a one-off look at some records: it neither starts from the incremental
    // position nor leaves a new one, or the records it skipped would never be read by the next run.
    const startMark: string | null = opts.full || filtered ? null : await lastWatermark(admin, tenantId, key);
    const client = await clientFor(admin, tenantId, cfg, creds);
    const q = foCompanyQuery(cfg);
    const entityFilter = [ec.filter, q.filter].filter(Boolean).map((f) => `(${f})`).join(" and ") || undefined;
    const baseFilter = [entityFilter, builtScope.filter ? `(${builtScope.filter})` : undefined].filter(Boolean).join(" and ") || undefined;
    // Two ways to continue where the last run stopped. An entity with a
    // modified field asks for what changed since; one without (Finance &
    // Operations) is read in id order from a cursor, and a finished scan
    // restarts from the top.
    const modifiedMode = !!ec.modified_field && IDENT_RE.test(ec.modified_field);
    const keysetMode = !modifiedMode && IDENT_RE.test(ec.id_field);
    const cursorStart = keysetMode ? parseCursor(startMark, cfg.company).lastId : null;
    const startIso = modifiedMode && startMark && /^\d{4}-/.test(startMark) ? startMark : null;
    const filter = modifiedMode ? modifiedSinceFilter(ec.modified_field!, startIso, baseFilter)
      : keysetMode ? keysetFilter(ec.id_field, cursorStart, baseFilter) : baseFilter;
    const requests = planned ? planned.filters.map((f) => (entityFilter ? `${entityFilter} and ${f}` : f)) : [filter];
    const orderby = modifiedMode ? `${ec.modified_field} asc` : keysetMode ? `${ec.id_field} asc` : undefined;
    let maxSeen: string | null = startIso;
    let firstSeen: string | null = null;
    let firstHold: string | null = null;
    let lastId: string | null = cursorStart;
    let seenLinked = 0;

    // Existing links for this entity, and the account links contacts and
    // projects resolve their customer through.
    const links = await fetchLinks<{ external_id: string; object_id: string; content_hash: string | null }>(admin, tenantId, key, "external_id, object_id, content_hash");
    const linkOf = new Map(links.map((l) => [l.external_id, l]));
    let accountOf = new Map<string, string>();
    if (key === "contacts" || key === "projects") {
      const acc = await fetchLinks<{ external_id: string; object_id: string }>(admin, tenantId, "customers", "external_id, object_id");
      accountOf = new Map(acc.map((l) => [l.external_id.toLowerCase(), l.object_id]));
    }

    const changeRows: ChangeLogEntryParams[] = [];
    // F&O links written before ids were scoped by company are bare. A bare
    // link is adopted by the first company whose row matches it (and re-keyed
    // to the scoped form on the spot, one link at a time), so a second
    // company's identical number can never be mapped onto the same record.
    const legacyClaimed = new Set<string>();
    const columns = selectFields(key, ecRun, cfg.product);
    const entitySet = ec.entity_set;
    async function* readAll() {
      for (const f of requests) {
        if (counts.read >= maxRows) return;
        yield* client.list(entitySet, { select: columns, filter: f, orderby, maxRows: maxRows - counts.read, extraQuery: q.extraQuery });
      }
    }
    for await (const row of readAll()) {
      if (Date.now() > deadline) { stoppedEarly = true; break; }
      counts.read++;
      const m = mapPullRow(key, ecRun, row, cfg.product, inbound?.transform);
      const mod = modifiedMode ? normalizeModified(row[ec.modified_field!]) : null;
      if (mod) {
        firstSeen ??= mod;
        if (!maxSeen || mod > maxSeen) maxSeen = mod;
      }
      // A row this run could not apply keeps the watermark from moving past
      // it, so it is read again instead of waiting for it to change.
      const hold = () => { if (mod && firstHold === null) firstHold = mod; };
      if ("error" in m) { counts.skipped++; if (issues.length < 25) issues.push(`Skipped a row: ${m.error}`); continue; }
      if (keysetMode) lastId = m.rawId;
      const values: Record<string, string | number | null> = { ...m.values };
      if (key === "contacts" || key === "projects") {
        const accId = m.accountExternalId ? accountLookupKeys(m.area, m.accountExternalId).map((k) => accountOf.get(k)).find(Boolean) : undefined;
        if (key === "contacts" && !accId) { hold(); counts.skipped++; if (issues.length < 25) issues.push(`${m.values.name}: its customer hasn't been synced yet — sync Customers first`); continue; }
        if (accId) (values as Record<string, unknown>).account_id = accId;
      }
      const hash = fingerprint(values);
      let link = linkOf.get(m.externalId);
      try {
        if (!link && m.externalId !== m.rawId && !legacyClaimed.has(m.rawId)) {
          const old = linkOf.get(m.rawId);
          if (old) {
            legacyClaimed.add(m.rawId);
            const { error: rekeyErr } = await admin.from("connector_links").update({ external_id: m.externalId })
              .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", key).eq("external_id", m.rawId);
            if (rekeyErr) {
              link = old;
            } else {
              linkOf.delete(m.rawId);
              link = { ...old, external_id: m.externalId };
              linkOf.set(m.externalId, link);
            }
          }
        }
        if (link) {
          seenLinked++;
          if (link.content_hash === hash) { counts.unchanged++; continue; }
          const rec = toRecord(target.table, values, false);
          const { data: upd, error } = await admin.from(target.table).update(rec).eq("id", link.object_id).eq("tenant_id", tenantId).select("id");
          if (error) throw error;
          if (!upd?.length) {
            // The BPMSquare record was deleted since: forget the link so the
            // next run creates it again rather than failing forever.
            await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", key).eq("external_id", link.external_id);
            linkOf.delete(link.external_id);
            hold();
            counts.skipped++;
            continue;
          }
          await admin.from("connector_links").update({ content_hash: hash, synced_at: new Date().toISOString(), external_key: m.externalKey })
            .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", key).eq("external_id", link.external_id);
          link.content_hash = hash;
          counts.updated++;
          if (target.table === "contacts" && typeof values.email === "string") await stampContactEmailHash(admin, tenantId, link.object_id, values.email);
          changeRows.push({ tenantId, objectType: target.table, objectId: link.object_id, objectLabel: String(values.name ?? ""), action: "update", actorId: opts.userId, actorEmail: null, changes: [{ field: "synced from Dynamics 365", from: null, to: m.externalKey ?? m.externalId }] });
        } else {
          const rec = { tenant_id: tenantId, ...toRecord(target.table, values, true) };
          const ins = REF_TABLES.has(target.table)
            ? await insertWithMasterRef<{ id: string }>(admin, target.table as MasterRefTable, tenantId, rec, "id")
            : await admin.from(target.table).insert(rec).select("id").single();
          if (ins.error || !ins.data) throw ins.error ?? new Error("insert failed");
          const id = (ins.data as { id: string }).id;
          const { error: linkErr } = await admin.from("connector_links").insert({
            tenant_id: tenantId, connector_id: CONNECTOR_ID, entity: key, object_type: target.table, object_id: id,
            external_id: m.externalId, external_key: m.externalKey, direction: "pull", content_hash: hash,
          });
          if (linkErr) {
            // A record without its link would be created again by every run.
            // Take it back out (a concurrent run that won the race keeps its
            // own record and link) and report the row as failed.
            const { error: undoErr } = await admin.from(target.table).delete().eq("id", id).eq("tenant_id", tenantId);
            if (undoErr) throw new Error(`could not link the new record (${linkErr.message}) and could not remove it (${undoErr.message}) — remove the duplicate by hand`);
            throw new Error(`could not link the new record (${linkErr.message}); it was removed and will be retried`);
          }
          linkOf.set(m.externalId, { external_id: m.externalId, object_id: id, content_hash: hash });
          counts.created++;
          if (target.table === "contacts" && typeof values.email === "string") await stampContactEmailHash(admin, tenantId, id, values.email);
          changeRows.push({ tenantId, objectType: target.table, objectId: id, objectLabel: String(values.name ?? ""), action: "create", actorId: opts.userId, actorEmail: null, changes: [{ field: "created from Dynamics 365", from: null, to: m.externalKey ?? m.externalId }] });
        }
      } catch (e) {
        hold();
        counts.failed++;
        if (issues.length < 25) issues.push(`${m.values.name ?? m.externalId}: ${(e as { message?: string }).message ?? "failed"}`);
      }
      if (changeRows.length >= 200) await logChangeBatch(admin, changeRows.splice(0));
    }
    if (changeRows.length) await logChangeBatch(admin, changeRows);
    if (inbound?.unknown.length) {
      counts.unknown_codes = inbound.unknown.length;
      await recordUnknownInbound(admin, tenantId, CONNECTOR_ID, inbound.unknown);
    }

    const capHit = counts.read >= maxRows;
    const incomplete = stoppedEarly || capHit;
    let watermark: string | null = null;
    if (filtered) {
      // Left empty on purpose: lastWatermark() skips runs without one, so the next incremental run
      // carries on from where the last unfiltered run stopped.
    } else if (modifiedMode) {
      const next = nextModifiedWatermark({ start: startIso, firstSeen, maxSeen, firstHold, stoppedEarly: incomplete });
      watermark = next.watermark;
      if (next.releasedStall) issues.push("Some rows could not be applied and were passed over so the sync could move on; they are tried again only when they change in Dynamics or on a full sync.");
    } else if (keysetMode) {
      watermark = formatCursor(cfg.company, incomplete ? lastId : null);
    }
    if (filtered) {
      if (stoppedEarly) issues.push("Stopped at this run's time limit — run it again.");
      const asked = sel?.ids?.length ?? 0;
      if (asked && !planned?.unsupported.length && !incomplete && counts.read < asked) {
        issues.push(`${asked - counts.read} of ${asked} ${asked === 1 ? "record was" : "records were"} not found in the ERP.`);
      }
    } else if (stoppedEarly) issues.push("Stopped at this run's time limit — the next run continues from here.");
    else if (capHit) issues.push(`Stopped at ${maxRows} rows — the next run continues from here.`);
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
    if (opts.full && !filtered && ec.scope?.needs_full) await settleScope(admin, tenantId, key);
    await note(null);
    return { runId, counts, issues, error: null, ...(planned?.unsupported.length ? { unsupported: planned.unsupported } : {}) };
  } catch (e) {
    const raw = (e as Error).message ?? "Sync failed";
    // The ERP refusing the request while a scope is set almost always means an attribute the system no longer has.
    const msg = scopeOn && e instanceof D365Error && e.status === 400
      ? `The system did not accept the saved scope (${raw.slice(0, 200)}). Open Scope for ${key} and remove or change the condition that no longer exists.`
      : raw;
    await markStatus(admin, tenantId, false, msg);
    await finishRun(admin, tenantId, runId, counts, issues, msg, null);
    await note(msg);
    return { runId, counts, issues, error: msg, ...(planned?.unsupported.length ? { unsupported: planned.unsupported } : {}) };
  }
}

// ── Push: fence projects -> Dynamics projects ──────────────────────────────

/**
 * Create a project in Dynamics for each fence project not pushed before
 * (or the given ids). The fence project's customer is bound when that
 * account came from Dynamics. Idempotent through connector_links: a fence
 * project is pushed at most once; re-pushing is a deliberate "unlink" away.
 */
export async function runPushFenceProjects(admin: SupabaseClient, tenantId: string, opts: { trigger: "manual" | "schedule"; userId: string | null; ids?: string[]; statuses?: string[]; deadline?: number }): Promise<{ runId: string | null; counts: RunCounts; issues: string[]; error: string | null }> {
  const deadline = opts.deadline ?? Date.now() + RUN_BUDGET_MS;
  const counts: RunCounts = { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const issues: string[] = [];
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { runId: null, counts, issues, error: "Dynamics 365 isn't connected." };
  const { cfg, creds } = loaded;
  const ec = entityConfig(cfg, "fence_projects");
  if (!ec?.enabled || !ec.entity_set) return { runId: null, counts, issues, error: "Pushing fence projects is switched off for this product — set the target entity and field map first." };
  const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  if (!(t?.features as TenantFeatures | undefined)?.fence_projects) return { runId: null, counts, issues, error: "Fence projects aren't enabled for this workspace." };

  const started = await startRun(admin, tenantId, "fence_projects", "push", opts.trigger, opts.userId);
  if (started.locked) return { runId: null, counts, issues, error: ALREADY_RUNNING };
  const runId = started.runId;
  const mw = (t?.features as TenantFeatures | undefined)?.integration_middleware === true;
  const startedAtMs = Date.now();
  const capture = (t?.config as { integration_middleware?: { payload_capture?: boolean } } | null)?.integration_middleware?.payload_capture === true;
  const note = (error: string | null) => mw ? recordConnectorRun(admin, tenantId, { runId, entity: "fence_projects", direction: "push", trigger: opts.trigger, counts: { ...counts }, issues, error, startedAtMs, entitySet: ec.entity_set, capture }) : Promise.resolve();
  try {
    let q = admin.from("fence_projects").select("id, ref, name, status, total_length_m, layout, account_id").eq("tenant_id", tenantId).limit(500);
    if (opts.ids?.length) q = q.in("id", opts.ids);
    else q = q.in("status", opts.statuses?.length ? opts.statuses : ["won"]);
    const { data: projects, error } = await q;
    if (error) throw error;
    const pushed = await fetchLinks<{ object_id: string }>(admin, tenantId, "fence_projects", "object_id");
    const already = new Set(pushed.map((p) => p.object_id));
    const accLinks = await fetchLinks<{ object_id: string; external_id: string }>(admin, tenantId, "customers", "object_id, external_id");
    const extAccount = new Map(accLinks.map((l) => [l.object_id, l.external_id]));
    const client = await clientFor(admin, tenantId, cfg, creds);
    const changeRows: ChangeLogEntryParams[] = [];

    for (const p of (projects ?? []) as { id: string; ref: string | null; name: string; status: string; total_length_m: number; layout: string; account_id: string | null }[]) {
      if (Date.now() > deadline) { issues.push("Stopped at this run's time limit — the next run continues from here."); break; }
      counts.read++;
      if (already.has(p.id)) { counts.unchanged++; continue; }
      // An F&O customer link may carry its company (usmf|C0100): the field map
      // is given the bare account number, and the company is sent as
      // dataAreaId -- otherwise F&O creates the project in the app user's
      // default company, which is not necessarily the customer's.
      const accExt = p.account_id ? extAccount.get(p.account_id) ?? null : null;
      const acc = accExt && cfg.product === "fo" ? splitExternalId(accExt) : { area: null, id: accExt };
      const vars = {
        name: p.name, ref: p.ref, status: p.status, total_length_m: p.total_length_m,
        summary: `${p.layout === "open_run" ? "Open run" : "Closed perimeter"}, ${Number(p.total_length_m)} m`,
        account_external_id: acc.id,
      };
      const built = buildPushBody(ec.field_map, vars);
      if (!Object.keys(built).length) { counts.skipped++; issues.push(`${p.name}: nothing to send — check the field map`); continue; }
      const body = withDataArea(cfg.product, built, ec.field_map, cfg.company ?? acc.area);
      try {
        const { row: created, entityId } = await client.create(ec.entity_set, body);
        const rawExt = created[ec.id_field] ?? created.id ?? entityId;
        if (!rawExt) throw new Error("Dynamics didn't return the new project's id");
        // Same id form a pull of Projects would store for it (company-scoped on F&O).
        const createdArea = typeof created.dataAreaId === "string" ? created.dataAreaId : body.dataAreaId ?? null;
        const extId = typeof rawExt === "string" && rawExt.includes("=") ? rawExt : scopedExternalId(cfg.product, createdArea, String(rawExt));
        const linkRow = {
          tenant_id: tenantId, connector_id: CONNECTOR_ID, entity: "fence_projects", object_type: "fence_projects", object_id: p.id,
          external_id: String(extId), external_key: (created.msdyn_subject ?? created.number ?? created.ProjectID ?? null) as string | null, direction: "push",
        };
        let { error: linkErr } = await admin.from("connector_links").insert(linkRow);
        if (linkErr) ({ error: linkErr } = await admin.from("connector_links").insert(linkRow));
        // The project now exists in the customer's ERP and cannot be taken
        // back from here: say so, so nobody pushes it a second time.
        if (linkErr) throw new Error(`created in Dynamics 365 as ${String(extId)} but could not be recorded (${linkErr.message}) — do not push it again`);
        counts.created++;
        changeRows.push({ tenantId, objectType: "fence_projects", objectId: p.id, objectLabel: p.ref ?? p.name, action: "update", actorId: opts.userId, actorEmail: null, changes: [{ field: "pushed to Dynamics 365", from: null, to: String(extId) }] });
      } catch (e) {
        counts.failed++;
        issues.push(`${p.name}: ${(e as Error).message}`);
      }
    }
    if (changeRows.length) await logChangeBatch(admin, changeRows);
    await markStatus(admin, tenantId, true);
    await finishRun(admin, tenantId, runId, counts, issues, null, null);
    await note(null);
    return { runId, counts, issues, error: null };
  } catch (e) {
    const msg = (e as Error).message ?? "Push failed";
    await markStatus(admin, tenantId, false, msg);
    await finishRun(admin, tenantId, runId, counts, issues, msg, null);
    await note(msg);
    return { runId, counts, issues, error: msg };
  }
}
