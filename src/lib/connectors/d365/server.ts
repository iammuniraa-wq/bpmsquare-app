import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/encryption";
import { assertSafeHttpsUrl } from "@/lib/net/safeHost";
import { insertWithMasterRef, type MasterRefTable } from "@/lib/masterRef";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";
import { D365Client, D365Error } from "./odata";
import { buildClientAssertion, certDerFromPem, tokenUrl, validDirectory } from "./jwt";
import { entityConfig, apiBase, resourceFor, allowedHost } from "./catalog";
import { mapPullRow, fingerprint, buildPushBody, modifiedSinceFilter, odataString } from "./mapping";
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
export async function exchangeAuthCode(admin: SupabaseClient, tenantId: string, cfg: D365Config, creds: Creds, code: string, redirectUri: string): Promise<void> {
  const tok = await tokenRequest(cfg.directory_id!, {
    client_id: cfg.client_id!, grant_type: "authorization_code", code, redirect_uri: redirectUri,
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
  return new D365Client(base, () => authHeaderFor(admin, tenantId, cfg, creds));
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
  for await (const row of c.list(ec.entity_set, { filter: [ec.filter, q.filter].filter(Boolean).map((f) => `(${f})`).join(" and ") || undefined, maxRows: 5, pageSize: 5, extraQuery: q.extraQuery })) {
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

const REF_TABLES = new Set<string>(["accounts", "contacts", "suppliers", "products", "wfm_projects"]);
const PII_TABLES = new Set(["accounts", "contacts"]);
const MAX_ROWS_PER_RUN = 5000;

export type RunCounts = { read: number; created: number; updated: number; unchanged: number; skipped: number; failed: number };

async function startRun(admin: SupabaseClient, tenantId: string, entity: string, direction: "pull" | "push", trigger: "manual" | "schedule", userId: string | null) {
  const { data } = await admin.from("connector_sync_runs").insert({ tenant_id: tenantId, connector_id: CONNECTOR_ID, entity, direction, trigger, started_by: userId }).select("id").single();
  return (data?.id as string | undefined) ?? null;
}

async function finishRun(admin: SupabaseClient, tenantId: string, runId: string | null, counts: RunCounts, issues: string[], error: string | null, watermark: string | null) {
  if (!runId) return;
  const status = error ? "failed" : counts.failed > 0 ? "partial" : "succeeded";
  await admin.from("connector_sync_runs").update({
    status, finished_at: new Date().toISOString(), counts, issues: issues.slice(0, 25), error: error?.slice(0, 1000) ?? null, watermark,
  }).eq("id", runId).eq("tenant_id", tenantId);
}

async function lastWatermark(admin: SupabaseClient, tenantId: string, entity: string): Promise<string | null> {
  const { data } = await admin.from("connector_sync_runs").select("watermark").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .eq("entity", entity).eq("direction", "pull").in("status", ["succeeded", "partial"]).not("watermark", "is", null)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.watermark as string | null) ?? null;
}

function toRecord(table: string, values: Record<string, string | number | null>, isInsert: boolean): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null && !isInsert) continue; // a blank in Dynamics never wipes a value here
    rec[k] = PII_TABLES.has(table) && (k === "phone" || k === "email") ? encrypt(v === null ? null : String(v)) : v;
  }
  if (isInsert) {
    if (table === "accounts") rec.type = "direct";
    if (table === "suppliers") { rec.type = "vendor"; rec.status = "active"; }
    if (table === "products") rec.status = "active";
    if (table === "wfm_projects") rec.status = "active";
  }
  return rec;
}

/**
 * Pull one entity from Dynamics into BPMSquare. Creates what's new, updates
 * only the mapped fields of what it created before (found through
 * connector_links by the external id), never deletes, never touches a field
 * the map doesn't own. Incremental where the entity has a modified field.
 */
export async function runPull(admin: SupabaseClient, tenantId: string, key: Exclude<D365EntityKey, "fence_projects">, opts: { trigger: "manual" | "schedule"; userId: string | null; full?: boolean }): Promise<{ runId: string | null; counts: RunCounts; issues: string[]; error: string | null }> {
  const counts: RunCounts = { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const issues: string[] = [];
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { runId: null, counts, issues, error: "Dynamics 365 isn't connected." };
  const { cfg, creds } = loaded;
  const ec = entityConfig(cfg, key);
  const target = D365_ENTITY_TARGET[key];
  if (!ec?.enabled) return { runId: null, counts, issues, error: "This entity is switched off." };
  const { data: t } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if (!(t?.features as TenantFeatures | undefined)?.[target.feature as keyof TenantFeatures]) {
    return { runId: null, counts, issues, error: `The ${target.table} module isn't enabled for this workspace.` };
  }

  const runId = await startRun(admin, tenantId, key, "pull", opts.trigger, opts.userId);
  let watermark: string | null = opts.full ? null : await lastWatermark(admin, tenantId, key);
  let maxSeen = watermark;
  try {
    const client = await clientFor(admin, tenantId, cfg, creds);
    const q = foCompanyQuery(cfg);
    const baseFilter = [ec.filter, q.filter].filter(Boolean).map((f) => `(${f})`).join(" and ") || undefined;
    const filter = ec.modified_field ? modifiedSinceFilter(ec.modified_field, watermark, baseFilter) : baseFilter;

    // Existing links for this entity, and the account links contacts and
    // projects resolve their customer through.
    const { data: links } = await admin.from("connector_links").select("external_id, object_id, content_hash")
      .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", key);
    const linkOf = new Map(((links ?? []) as { external_id: string; object_id: string; content_hash: string | null }[]).map((l) => [l.external_id, l]));
    let accountOf = new Map<string, string>();
    if (key === "contacts" || key === "projects") {
      const { data: acc } = await admin.from("connector_links").select("external_id, object_id")
        .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "customers");
      accountOf = new Map(((acc ?? []) as { external_id: string; object_id: string }[]).map((l) => [l.external_id.toLowerCase(), l.object_id]));
    }

    const changeRows: ChangeLogEntryParams[] = [];
    for await (const row of client.list(ec.entity_set, {
      filter, orderby: ec.modified_field && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ec.modified_field) ? `${ec.modified_field} asc` : undefined,
      maxRows: MAX_ROWS_PER_RUN, extraQuery: q.extraQuery,
    })) {
      counts.read++;
      const m = mapPullRow(key, ec, row);
      if ("error" in m) { counts.skipped++; if (issues.length < 25) issues.push(`Skipped a row: ${m.error}`); continue; }
      if (ec.modified_field) {
        const mod = row[ec.modified_field];
        if (typeof mod === "string" && /^\d{4}-\d{2}-\d{2}T/.test(mod) && (!maxSeen || mod > maxSeen)) maxSeen = mod.replace(/\.\d+Z$/, "Z");
      }
      const values: Record<string, string | number | null> = { ...m.values };
      if (key === "contacts" || key === "projects") {
        const accId = m.accountExternalId ? accountOf.get(m.accountExternalId.toLowerCase()) : undefined;
        if (key === "contacts" && !accId) { counts.skipped++; if (issues.length < 25) issues.push(`${m.values.name}: its customer hasn't been synced yet — sync Customers first`); continue; }
        if (accId) (values as Record<string, unknown>).account_id = accId;
      }
      const hash = fingerprint(values);
      const link = linkOf.get(m.externalId);
      try {
        if (link) {
          if (link.content_hash === hash) { counts.unchanged++; continue; }
          const rec = toRecord(target.table, values, false);
          if (target.table !== "accounts" && target.table !== "contacts") rec.updated_at = new Date().toISOString();
          const { data: upd, error } = await admin.from(target.table).update(rec).eq("id", link.object_id).eq("tenant_id", tenantId).select("id");
          if (error) throw error;
          if (!upd?.length) {
            // The BPMSquare record was deleted since: forget the link so the
            // next run creates it again rather than failing forever.
            await admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", key).eq("external_id", m.externalId);
            counts.skipped++;
            continue;
          }
          await admin.from("connector_links").update({ content_hash: hash, synced_at: new Date().toISOString(), external_key: m.externalKey })
            .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", key).eq("external_id", m.externalId);
          counts.updated++;
          changeRows.push({ tenantId, objectType: target.table, objectId: link.object_id, objectLabel: String(values.name ?? ""), action: "update", actorId: opts.userId, actorEmail: null, changes: [{ field: "synced from Dynamics 365", from: null, to: m.externalKey ?? m.externalId }] });
        } else {
          const rec = { tenant_id: tenantId, ...toRecord(target.table, values, true) };
          const ins = REF_TABLES.has(target.table)
            ? await insertWithMasterRef<{ id: string }>(admin, target.table as MasterRefTable, tenantId, rec, "id")
            : await admin.from(target.table).insert(rec).select("id").single();
          if (ins.error || !ins.data) throw ins.error ?? new Error("insert failed");
          const id = (ins.data as { id: string }).id;
          await admin.from("connector_links").insert({
            tenant_id: tenantId, connector_id: CONNECTOR_ID, entity: key, object_type: target.table, object_id: id,
            external_id: m.externalId, external_key: m.externalKey, direction: "pull", content_hash: hash,
          });
          linkOf.set(m.externalId, { external_id: m.externalId, object_id: id, content_hash: hash });
          counts.created++;
          changeRows.push({ tenantId, objectType: target.table, objectId: id, objectLabel: String(values.name ?? ""), action: "create", actorId: opts.userId, actorEmail: null, changes: [{ field: "created from Dynamics 365", from: null, to: m.externalKey ?? m.externalId }] });
        }
      } catch (e) {
        counts.failed++;
        if (issues.length < 25) issues.push(`${m.values.name ?? m.externalId}: ${(e as { message?: string }).message ?? "failed"}`);
      }
      if (changeRows.length >= 200) await logChangeBatch(admin, changeRows.splice(0));
    }
    if (changeRows.length) await logChangeBatch(admin, changeRows);
    watermark = maxSeen;
    await markStatus(admin, tenantId, true);
    await finishRun(admin, tenantId, runId, counts, issues, null, watermark);
    if (counts.read >= MAX_ROWS_PER_RUN) issues.push(`Stopped at ${MAX_ROWS_PER_RUN} rows — the next run continues from here.`);
    return { runId, counts, issues, error: null };
  } catch (e) {
    const msg = (e as Error).message ?? "Sync failed";
    await markStatus(admin, tenantId, false, msg);
    await finishRun(admin, tenantId, runId, counts, issues, msg, null);
    return { runId, counts, issues, error: msg };
  }
}

// ── Push: fence projects -> Dynamics projects ──────────────────────────────

/**
 * Create a project in Dynamics for each fence project not pushed before
 * (or the given ids). The fence project's customer is bound when that
 * account came from Dynamics. Idempotent through connector_links: a fence
 * project is pushed at most once; re-pushing is a deliberate "unlink" away.
 */
export async function runPushFenceProjects(admin: SupabaseClient, tenantId: string, opts: { trigger: "manual" | "schedule"; userId: string | null; ids?: string[]; statuses?: string[] }): Promise<{ runId: string | null; counts: RunCounts; issues: string[]; error: string | null }> {
  const counts: RunCounts = { read: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const issues: string[] = [];
  const loaded = await loadD365(admin, tenantId);
  if (!loaded) return { runId: null, counts, issues, error: "Dynamics 365 isn't connected." };
  const { cfg, creds } = loaded;
  const ec = entityConfig(cfg, "fence_projects");
  if (!ec?.enabled || !ec.entity_set) return { runId: null, counts, issues, error: "Pushing fence projects is switched off for this product — set the target entity and field map first." };
  const { data: t } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if (!(t?.features as TenantFeatures | undefined)?.fence_projects) return { runId: null, counts, issues, error: "Fence projects aren't enabled for this workspace." };

  const runId = await startRun(admin, tenantId, "fence_projects", "push", opts.trigger, opts.userId);
  try {
    let q = admin.from("fence_projects").select("id, ref, name, status, total_length_m, layout, account_id").eq("tenant_id", tenantId).limit(500);
    if (opts.ids?.length) q = q.in("id", opts.ids);
    else q = q.in("status", opts.statuses?.length ? opts.statuses : ["won"]);
    const { data: projects, error } = await q;
    if (error) throw error;
    const { data: pushed } = await admin.from("connector_links").select("object_id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "fence_projects");
    const already = new Set(((pushed ?? []) as { object_id: string }[]).map((p) => p.object_id));
    const { data: accLinks } = await admin.from("connector_links").select("object_id, external_id").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", "customers");
    const extAccount = new Map(((accLinks ?? []) as { object_id: string; external_id: string }[]).map((l) => [l.object_id, l.external_id]));
    const client = await clientFor(admin, tenantId, cfg, creds);
    const changeRows: ChangeLogEntryParams[] = [];

    for (const p of (projects ?? []) as { id: string; ref: string | null; name: string; status: string; total_length_m: number; layout: string; account_id: string | null }[]) {
      counts.read++;
      if (already.has(p.id)) { counts.unchanged++; continue; }
      const vars = {
        name: p.name, ref: p.ref, status: p.status, total_length_m: p.total_length_m,
        summary: `${p.layout === "open_run" ? "Open run" : "Closed perimeter"}, ${Number(p.total_length_m)} m`,
        account_external_id: p.account_id ? extAccount.get(p.account_id) ?? null : null,
      };
      const body = buildPushBody(ec.field_map, vars);
      if (!Object.keys(body).length) { counts.skipped++; issues.push(`${p.name}: nothing to send — check the field map`); continue; }
      try {
        const created = await client.create(ec.entity_set, body);
        const extId = created[ec.id_field] ?? created.id;
        if (!extId) throw new Error("Dynamics didn't return the new project's id");
        await admin.from("connector_links").insert({
          tenant_id: tenantId, connector_id: CONNECTOR_ID, entity: "fence_projects", object_type: "fence_projects", object_id: p.id,
          external_id: String(extId), external_key: (created.msdyn_subject ?? created.number ?? created.ProjectID ?? null) as string | null, direction: "push",
        });
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
    return { runId, counts, issues, error: null };
  } catch (e) {
    const msg = (e as Error).message ?? "Push failed";
    await markStatus(admin, tenantId, false, msg);
    await finishRun(admin, tenantId, runId, counts, issues, msg, null);
    return { runId, counts, issues, error: msg };
  }
}
