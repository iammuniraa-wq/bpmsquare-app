import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { sealSecret } from "@/lib/encryption";
import { assertSafeHttpsUrl } from "@/lib/net/safeHost";
import { SQL_BUNDLES } from "@/lib/middleware/types";
import { addressForLog, validateUrlTemplate, type FieldError } from "./render";
import { CALL_OBJECTS, isCallObject, tokenSpecs, type CallObject } from "./tokens";
import {
  WEBHOOK_COLUMNS, toApiWebhook, validateDefinition,
  type ApiWebhook, type DefinitionPatch, type StoredHeader, type UsedBy, type WebhookRow,
} from "./validate";
import type { TenantConfig } from "@/lib/constants";
import { getActive, getActiveById } from "@/lib/middleware/mapping/mappingStore";

// The library behind Settings > Webhooks: list, create, change, delete. Every query
// names the tenant (the admin client skips RLS) and every id that points at another
// record -- the webhook of a Link, a Coverage row or a record button -- is resolved
// with the tenant, the kind and the object before it is stored. Secrets (the signing
// secret and header values) are sealed on write and never read back out.

export const NEEDS_UPDATE = { needsDatabaseUpdate: true as const, bundle: SQL_BUNDLES.webhooks };

const MAPPING_UPDATE = `A database update is needed first: run ${SQL_BUNDLES.mapping} once.`;

/**
 * `mapping_id` and `response_key_path` live in columns migration 0203 adds. They are read in a query of their own, so a database
 * that has not run it yet still lists, creates and changes webhooks exactly as before.
 */
export async function withMappingColumns(admin: SupabaseClient, tenantId: string, rows: WebhookRow[]): Promise<WebhookRow[]> {
  if (!rows.length) return rows;
  const { data, error } = await admin.from("webhooks").select("id, mapping_id, response_key_path").eq("tenant_id", tenantId).in("id", rows.map((r) => r.id));
  if (error) return rows;
  const by = new Map(((data ?? []) as { id: string; mapping_id: string | null; response_key_path: string | null }[]).map((r) => [r.id, r]));
  return rows.map((r) => ({ ...r, mapping_id: by.get(r.id)?.mapping_id ?? null, response_key_path: by.get(r.id)?.response_key_path ?? null }));
}

export type LibraryResult<T> = { ok: true; value: T } | { ok: false; status: number; errors?: FieldError[]; error?: string; pending?: true; usedBy?: UsedBy[] };

const unprocessable = (errors: FieldError[]): { ok: false; status: number; errors: FieldError[]; error: string } =>
  ({ ok: false, status: 422, errors, error: errors[0]?.message ?? "Check the form." });
const serverError = (m: string): { ok: false; status: number; error: string } => ({ ok: false, status: 500, error: m });

export const newSecret = (): string => `whsec_${randomBytes(24).toString("hex")}`;

type Tenant = { config: TenantConfig | null };

async function loadConfig(admin: SupabaseClient, tenantId: string): Promise<TenantConfig> {
  const { data } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  return ((data as Tenant | null)?.config ?? {}) as TenantConfig;
}

export async function libraryFlagOn(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  return (data?.features as { webhooks_library?: boolean } | null)?.webhooks_library === true;
}

/** The webhook id a Coverage row may store: null clears it; anything else must be a Call webhook for Accounts of this workspace. */
export async function resolveCoverageWebhook(admin: SupabaseClient, tenantId: string, raw: unknown): Promise<{ ok: true; value: string | null } | { ok: false; message: string }> {
  if (raw === null || raw === "") return { ok: true, value: null };
  if (!(await libraryFlagOn(admin, tenantId))) return { ok: false, message: "Webhooks are not switched on for this workspace." };
  const hit = await verifyCallWebhook(admin, tenantId, raw, "accounts");
  return hit ? { ok: true, value: hit.id } : { ok: false, message: "Choose a webhook for Accounts from the list." };
}

// ── who uses a webhook ──────────────────────────────────────────────────────

export async function usedByMap(admin: SupabaseClient, tenantId: string, config: TenantConfig): Promise<Map<string, UsedBy[]>> {
  const map = new Map<string, UsedBy[]>();
  const add = (id: string | null | undefined, u: UsedBy) => { if (id) map.set(id, [...(map.get(id) ?? []), u]); };

  const doc = config.integration_middleware?.documents?.quote;
  if (doc?.target === "webhook") add(doc.webhook_id, { kind: "link", label: "Links: Quote" });
  add(config.webhooks_library?.record_buttons?.accounts, { kind: "button", label: "Button: Accounts" });

  const { data, error } = await admin.from("coverages").select("id, role, webhook_id, teams(name)").eq("tenant_id", tenantId).not("webhook_id", "is", null);
  if (!error) {
    for (const c of (data ?? []) as unknown as { webhook_id: string; role: string; teams: { name?: string } | { name?: string }[] | null }[]) {
      const team = Array.isArray(c.teams) ? c.teams[0]?.name : c.teams?.name;
      add(c.webhook_id, { kind: "coverage", label: `Coverage: ${team ?? c.role}` });
    }
  }
  return map;
}

// ── list ────────────────────────────────────────────────────────────────────

export type LibraryList = {
  webhooks: ApiWebhook[];
  recordButtons: { accounts: string | null };
  objects: { key: string; label: string }[];
};

export async function listLibrary(admin: SupabaseClient, tenantId: string): Promise<LibraryResult<LibraryList>> {
  const { data, error } = await admin.from("webhooks").select(WEBHOOK_COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: true });
  if (isSchemaPending(error)) return { ok: false, status: 200, pending: true };
  if (error) return serverError(error.message);
  const config = await loadConfig(admin, tenantId);
  const used = await usedByMap(admin, tenantId, config);
  return {
    ok: true,
    value: {
      webhooks: (await withMappingColumns(admin, tenantId, (data ?? []) as WebhookRow[])).map((r) => toApiWebhook(r, used.get(r.id) ?? [])),
      recordButtons: { accounts: config.webhooks_library?.record_buttons?.accounts ?? null },
      objects: CALL_OBJECTS.map((o) => ({ key: o.key, label: o.label })),
    },
  };
}

export async function getWebhookRow(admin: SupabaseClient, tenantId: string, id: string): Promise<{ row: WebhookRow | null; pending: boolean }> {
  const { data, error } = await admin.from("webhooks").select(WEBHOOK_COLUMNS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (isSchemaPending(error)) return { row: null, pending: true };
  const row = (data as WebhookRow | null) ?? null;
  return { row: row ? (await withMappingColumns(admin, tenantId, [row]))[0] : null, pending: false };
}

async function oneApi(admin: SupabaseClient, tenantId: string, row: WebhookRow): Promise<ApiWebhook> {
  const config = await loadConfig(admin, tenantId);
  const used = await usedByMap(admin, tenantId, config);
  return toApiWebhook(row, used.get(row.id) ?? []);
}

// ── references ──────────────────────────────────────────────────────────────

/** A Call webhook of this tenant for this object, or null. Used before an id is stored anywhere (Links, Coverage, a button). */
export async function verifyCallWebhook(admin: SupabaseClient, tenantId: string, id: unknown, objectType: CallObject): Promise<{ id: string; name: string } | null> {
  if (typeof id !== "string") return null;
  const { data } = await admin.from("webhooks").select("id, name").eq("id", id).eq("tenant_id", tenantId).eq("kind", "call").eq("object_type", objectType).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

/** The active Call webhooks for an object, for the pickers (Links, Coverage). Empty when the library is not installed yet. */
export async function listCallWebhooks(admin: SupabaseClient, tenantId: string, objectType: CallObject): Promise<{ id: string; name: string }[]> {
  const { data, error } = await admin.from("webhooks").select("id, name").eq("tenant_id", tenantId).eq("kind", "call").eq("object_type", objectType).eq("active", true).order("name");
  return error ? [] : ((data ?? []) as { id: string; name: string }[]);
}

async function setRecordButton(admin: SupabaseClient, tenantId: string, object: "accounts", webhookId: string | null): Promise<void> {
  const config = await loadConfig(admin, tenantId);
  const next: TenantConfig = { ...config, webhooks_library: { ...config.webhooks_library, record_buttons: { ...config.webhooks_library?.record_buttons, [object]: webhookId } } };
  await admin.from("tenants").update({ config: next }).eq("id", tenantId);
}

// ── headers ─────────────────────────────────────────────────────────────────

/** The stored list for a typed one: a value left blank keeps what was stored under that name; omitting a name removes it. */
export function mergeHeaders(typed: { name: string; value: string | null }[], stored: StoredHeader[]): { ok: true; value: StoredHeader[] } | { ok: false; errors: FieldError[] } {
  const out: StoredHeader[] = [];
  for (const h of typed) {
    if (h.value === null) {
      const keep = stored.find((s) => s.name.toLowerCase() === h.name.toLowerCase());
      if (!keep) return { ok: false, errors: [{ field: "headers", message: `${h.name}: enter a value.` }] };
      out.push({ name: h.name, value: keep.value });
    } else {
      const sealed = sealSecret(h.value);
      if (!sealed) return { ok: false, errors: [{ field: "headers", message: `${h.name}: enter a value.` }] };
      out.push({ name: h.name, value: sealed });
    }
  }
  return { ok: true, value: out };
}

// ── the address ─────────────────────────────────────────────────────────────

/** Host checks on a typed address: DNS resolved, private ranges refused. Tokens are replaced by a placeholder first. */
export async function checkAddress(url: string, objectType: CallObject | null): Promise<FieldError[]> {
  const v = validateUrlTemplate(url, objectType);
  if (!v.ok) return v.errors;
  try {
    await assertSafeHttpsUrl(v.value.sample);
  } catch (e) {
    return [{ field: "url", message: (e as Error).message }];
  }
  return [];
}

// ── create ──────────────────────────────────────────────────────────────────

async function nameTaken(admin: SupabaseClient, tenantId: string, name: string, exceptId?: string): Promise<boolean> {
  const { data } = await admin.from("webhooks").select("id, name").eq("tenant_id", tenantId).ilike("name", name.replace(/[%_\\]/g, "\\$&"));
  return ((data ?? []) as { id: string; name: string }[]).some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());
}

export async function createWebhook(admin: SupabaseClient, tenantId: string, userId: string, body: unknown): Promise<LibraryResult<{ webhook: ApiWebhook; secret: string; row: WebhookRow }>> {
  const v = validateDefinition(body, "create");
  if (!v.ok) return unprocessable(v.errors);
  const d = v.value;
  const addr = await checkAddress(d.url!, d.kind === "call" ? d.object_type ?? null : null);
  if (addr.length) return unprocessable(addr);
  if (await nameTaken(admin, tenantId, d.name!)) return unprocessable([{ field: "name", message: "Another webhook already has that name." }]);

  let headers: StoredHeader[] = [];
  if (d.headers) {
    const m = mergeHeaders(d.headers, []);
    if (!m.ok) return unprocessable(m.errors);
    headers = m.value;
  }

  const secret = newSecret();
  const insert: Record<string, unknown> = {
    tenant_id: tenantId, kind: d.kind, name: d.name, url: d.url, secret: sealSecret(secret), created_by: userId, headers,
    timeout_ms: d.timeout_ms ?? 15000, active: d.active ?? true,
  };
  if (d.kind === "call") {
    Object.assign(insert, {
      object_type: d.object_type, method: d.method ?? "POST", payload_mode: d.payload_mode ?? "standard",
      template: d.template ?? null, allow_personal_data: d.allow_personal_data === true,
    });
  } else {
    insert.object_types = d.object_types ?? ["*"];
    // Only changes after the registration are delivered: the cursor starts at the current tip of the feed.
    const { data: tip } = await admin.from("change_log").select("id, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
    insert.cursor_ts = (tip as { created_at?: string } | null)?.created_at ?? null;
    insert.cursor_id = (tip as { id?: string } | null)?.id ?? null;
  }

  const { data, error } = await admin.from("webhooks").insert(insert).select(WEBHOOK_COLUMNS).single();
  if (isSchemaPending(error)) return { ok: false, status: 200, pending: true };
  if (error) return serverError(error.message);
  const row = data as WebhookRow;
  if (d.button_on === "accounts") await setRecordButton(admin, tenantId, "accounts", row.id);
  return { ok: true, value: { webhook: await oneApi(admin, tenantId, row), secret, row } };
}

// ── update ──────────────────────────────────────────────────────────────────

export async function updateWebhook(admin: SupabaseClient, tenantId: string, id: string, body: unknown): Promise<LibraryResult<{ webhook: ApiWebhook; before: WebhookRow; after: WebhookRow; patch: Record<string, unknown>; secret?: string }>> {
  const { row, pending } = await getWebhookRow(admin, tenantId, id);
  if (pending) return { ok: false, status: 200, pending: true };
  if (!row) return { ok: false, status: 404, error: "Not found" };
  const before: WebhookRow = { ...row };
  const v = validateDefinition(body, "update", row);
  if (!v.ok) return unprocessable(v.errors);
  const d: DefinitionPatch = v.value;

  const objectType = isCallObject(row.object_type) ? row.object_type : null;
  if (d.url !== undefined) {
    const addr = await checkAddress(d.url, row.kind === "call" ? objectType : null);
    if (addr.length) return unprocessable(addr);
  }
  if (d.name !== undefined && (await nameTaken(admin, tenantId, d.name, id))) return unprocessable([{ field: "name", message: "Another webhook already has that name." }]);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "url", "method", "object_types", "payload_mode", "template", "allow_personal_data", "timeout_ms"] as const) {
    if (d[k] !== undefined) patch[k] = d[k];
  }
  // A mapping pointer from a request body is resolved against the tenant and THIS webhook before it is stored.
  const mappingPatch: Record<string, unknown> = {};
  if (d.mapping_id !== undefined) {
    if (d.mapping_id === null) mappingPatch.mapping_id = null;
    else {
      const hit = await getActiveById(admin, tenantId, d.mapping_id, `webhook:${id}`);
      if (!hit) return unprocessable([{ field: "mapping_id", message: "Choose a mapping saved for this webhook." }]);
      mappingPatch.mapping_id = hit.id;
    }
  }
  if (d.response_key_path !== undefined) mappingPatch.response_key_path = d.response_key_path;
  if (d.payload_mode === "mapping" && mappingPatch.mapping_id === undefined && !row.mapping_id) {
    const active = await getActive(admin, tenantId, `webhook:${id}`, "quote");
    if (active.pending) return { ok: false, status: 409, error: MAPPING_UPDATE };
    if (!active.value) return unprocessable([{ field: "payload_mode", message: "Build this webhook's body in Mapping and save it, then choose Mapping here." }]);
    mappingPatch.mapping_id = active.value.id;
  }
  if (d.headers) {
    const m = mergeHeaders(d.headers, Array.isArray(row.headers) ? row.headers : []);
    if (!m.ok) return unprocessable(m.errors);
    patch.headers = m.value;
  }
  let secret: string | undefined;
  if (d.regenerate_secret) {
    secret = newSecret();
    patch.secret = sealSecret(secret);
  }
  if (d.active !== undefined) {
    patch.active = d.active;
    // Switching a paused webhook on again is "Resume": the counter and the reason reset.
    if (d.active) { patch.paused_reason = null; patch.failure_count = 0; }
  }

  const { data, error } = await admin.from("webhooks").update(patch).eq("id", id).eq("tenant_id", tenantId).select(WEBHOOK_COLUMNS).single();
  if (isSchemaPending(error)) return { ok: false, status: 200, pending: true };
  // The payload_mode check only allows "mapping" once 0203 has run.
  if (error?.code === "23514" && d.payload_mode === "mapping") return { ok: false, status: 409, error: MAPPING_UPDATE };
  if (error) return serverError(error.message);
  let after = data as WebhookRow;
  if (Object.keys(mappingPatch).length) {
    const m = await admin.from("webhooks").update(mappingPatch).eq("id", id).eq("tenant_id", tenantId);
    if (m.error) return isSchemaPending(m.error) ? { ok: false, status: 409, error: MAPPING_UPDATE } : serverError(m.error.message);
    Object.assign(patch, mappingPatch);
  }
  after = (await withMappingColumns(admin, tenantId, [after]))[0];

  if (d.button_on !== undefined) {
    const config = await loadConfig(admin, tenantId);
    const current = config.webhooks_library?.record_buttons?.accounts ?? null;
    if (d.button_on === "accounts") await setRecordButton(admin, tenantId, "accounts", id);
    else if (current === id) await setRecordButton(admin, tenantId, "accounts", null);
  }
  return { ok: true, value: { webhook: await oneApi(admin, tenantId, after), before, after, patch, ...(secret ? { secret } : {}) } };
}

// ── delete ──────────────────────────────────────────────────────────────────

export async function deleteWebhook(admin: SupabaseClient, tenantId: string, id: string): Promise<LibraryResult<{ row: WebhookRow }>> {
  const { row, pending } = await getWebhookRow(admin, tenantId, id);
  if (pending) return { ok: false, status: 200, pending: true };
  if (!row) return { ok: false, status: 404, error: "Not found" };
  const used = (await usedByMap(admin, tenantId, await loadConfig(admin, tenantId))).get(id) ?? [];
  if (used.length) return { ok: false, status: 409, error: `It is still used by ${used.map((u) => u.label).join(", ")}. Choose another there first.`, usedBy: used };
  const { error } = await admin.from("webhooks").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return serverError(error.message);
  return { ok: true, value: { row } };
}

// ── tokens ──────────────────────────────────────────────────────────────────

export function tokensFor(objectType: unknown): { token: string; label: string; pii: boolean; kind: string }[] | null {
  return isCallObject(objectType) ? tokenSpecs(objectType) : null;
}

/** Change-log entries for an update: the fields that moved, never a secret or a header value. */
export function changeEntries(before: WebhookRow, patch: Record<string, unknown>): { field: string; from: unknown; to: unknown }[] {
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const [k, to] of Object.entries(patch)) {
    if (k === "updated_at" || k === "secret") continue;
    if (k === "headers") {
      const names = (h: unknown) => (Array.isArray(h) ? (h as StoredHeader[]).map((x) => x.name).join(", ") : "");
      if (names(before.headers) !== names(to)) out.push({ field: "headers", from: names(before.headers), to: names(to) });
      continue;
    }
    const from = (before as unknown as Record<string, unknown>)[k] ?? null;
    if (k === "url") {
      // change_log is readable by every member; an address can hold a credential, so history shows host and path only.
      if (from === to) continue;
      const shownFrom = addressForLog(String(from ?? ""));
      const shownTo = addressForLog(String(to ?? ""));
      out.push({ field: "url", from: shownFrom, to: shownFrom === shownTo ? `${shownTo} (address changed)` : shownTo });
      continue;
    }
    if (JSON.stringify(from) !== JSON.stringify(to ?? null)) out.push({ field: k, from, to: to ?? null });
  }
  if ("secret" in patch) out.push({ field: "signing secret", from: null, to: "regenerated" });
  return out;
}
