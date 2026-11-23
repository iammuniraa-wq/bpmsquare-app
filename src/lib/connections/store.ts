import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange, type ChangeEntry } from "@/lib/changeLog";
import { sealSecret, unsealSecret } from "@/lib/encryption";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { LiveConnection, Token, TokenStore } from "./request";
import {
  SECRET_FOR_AUTH, SECRET_KEYS, type ConnectionConfig, type ConnectionFamily, type ConnectionSecrets, type ParsedConnection, type PublicConnection, type SecretKey, type TestResult,
} from "./spec";

// The reads and writes of integration_connections (0250). The table has RLS and NO policy at all: it holds credentials, so a member
// must never reach it with their own session (MULTI_TENANT_GUARDRAILS, the 2026-10-21 lesson). Every query below is the
// service-role client with the tenant named. A missing table (42P01 / PGRST205) is "an update is needed", never a crash.

export const CONNECTIONS_TABLE = "integration_connections";
export const ENDPOINTS_TABLE = "integration_endpoints";
export const CONNECTIONS_BUNDLE = "scripts/run-bundle-conn-0250-2026-11-23.sql";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export type StoreCtx = { supabase: SupabaseClient; admin: SupabaseClient; tenantId: string; userId: string };

type Row = {
  id: string;
  name: string;
  family: ConnectionFamily;
  config: ConnectionConfig;
  secrets: Record<string, string> | null;
  token_cache?: string | null;
  last_test_status: "ok" | "failed" | null;
  last_test_at: string | null;
  last_test_message: string | null;
};

const COLUMNS = "id, name, family, config, secrets, last_test_status, last_test_at, last_test_message";

const flags = (secrets: Record<string, string> | null): Partial<Record<SecretKey, boolean>> => {
  const out: Partial<Record<SecretKey, boolean>> = {};
  for (const k of SECRET_KEYS) if (secrets?.[k]) out[k] = true;
  return out;
};

/** The row as the screen may see it: which secrets exist, never their value. */
export function toPublic(row: Row, endpointCount = 0): PublicConnection {
  return {
    id: row.id, name: row.name, family: row.family, config: row.config, secretsSet: flags(row.secrets),
    status: row.last_test_status ?? "untested", lastTestAt: row.last_test_at, lastTestMessage: row.last_test_message, endpointCount,
  };
}

export async function listConnections(admin: SupabaseClient, tenantId: string): Promise<{ pending: boolean; items: PublicConnection[] }> {
  const { data, error } = await admin.from(CONNECTIONS_TABLE).select(COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: true });
  if (isSchemaPending(error)) return { pending: true, items: [] };
  if (error) throw new Error("Could not read the connections.");
  const rows = (data ?? []) as Row[];
  const counts = new Map<string, number>();
  if (rows.length) {
    const { data: eps, error: e2 } = await admin.from(ENDPOINTS_TABLE).select("connection_id").eq("tenant_id", tenantId);
    if (!e2) for (const e of (eps ?? []) as { connection_id: string }[]) counts.set(e.connection_id, (counts.get(e.connection_id) ?? 0) + 1);
  }
  return { pending: false, items: rows.map((r) => toPublic(r, counts.get(r.id) ?? 0)) };
}

export async function getRow(admin: SupabaseClient, tenantId: string, id: string): Promise<{ pending: boolean; row: Row | null }> {
  if (!isUuid(id)) return { pending: false, row: null };
  const { data, error } = await admin.from(CONNECTIONS_TABLE).select(`${COLUMNS}, token_cache`).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (isSchemaPending(error)) return { pending: true, row: null };
  return { pending: false, row: (data as Row | null) ?? null };
}

/** The connection with its secrets unsealed, for one call. The caller must not log it or return any part of `secrets`. */
export function toLive(tenantId: string, row: Row): LiveConnection & { family: ConnectionFamily } {
  const secrets: ConnectionSecrets = {};
  for (const k of SECRET_KEYS) {
    const v = unsealSecret(row.secrets?.[k]);
    if (v) secrets[k] = v;
  }
  return { id: row.id, tenantId, family: row.family, config: row.config, secrets };
}

export async function loadLive(admin: SupabaseClient, tenantId: string, id: string): Promise<{ pending: boolean; live: (LiveConnection & { family: ConnectionFamily }) | null; row: Row | null }> {
  const { pending, row } = await getRow(admin, tenantId, id);
  return { pending, row, live: row ? toLive(tenantId, row) : null };
}

/** The access token of an OAuth 2 connection, kept sealed on its own row until it expires. */
export function tokenStore(admin: SupabaseClient, tenantId: string, id: string): TokenStore {
  return {
    async get() {
      const { data } = await admin.from(CONNECTIONS_TABLE).select("token_cache").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      const raw = unsealSecret((data as { token_cache?: string | null } | null)?.token_cache);
      if (!raw) return null;
      try {
        const t = JSON.parse(raw) as Token;
        return typeof t.token === "string" && typeof t.exp === "number" ? t : null;
      } catch { return null; }
    },
    async set(t) { await admin.from(CONNECTIONS_TABLE).update({ token_cache: sealSecret(JSON.stringify(t)) ?? null }).eq("id", id).eq("tenant_id", tenantId); },
    async clear() { await admin.from(CONNECTIONS_TABLE).update({ token_cache: null }).eq("id", id).eq("tenant_id", tenantId); },
  };
}

export type SaveOutcome = { ok: true; connection: PublicConnection } | { ok: false; status: number; error: string; field?: string };

function sealed(parsed: Extract<ParsedConnection, { ok: true }>, previous: Record<string, string> | null): Record<string, string> {
  const keep = SECRET_FOR_AUTH[parsed.config.auth];
  const out: Record<string, string> = {};
  if (keep && previous?.[keep]) out[keep] = previous[keep];
  for (const k of SECRET_KEYS) {
    const v = parsed.secrets[k];
    if (v) out[k] = sealSecret(v) ?? "";
  }
  return out;
}

const SAFE_FIELDS = ["name", "family", "base_url", "auth", "test_path", "key_name", "key_in", "username", "oauth_provider", "directory_id", "token_url", "client_id", "scope"] as const;

function diff(before: Row | null, parsed: Extract<ParsedConnection, { ok: true }>, secretReplaced: boolean): ChangeEntry[] {
  const a: Record<string, unknown> = before ? { name: before.name, family: before.family, ...before.config } : {};
  const b: Record<string, unknown> = { name: parsed.name, family: parsed.family, ...parsed.config };
  const out: ChangeEntry[] = [];
  for (const f of SAFE_FIELDS) if (JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null)) out.push({ field: f, from: a[f] ?? null, to: b[f] ?? null });
  if (secretReplaced) out.push({ field: "secret", from: before ? "stored" : null, to: "replaced", redacted: true });
  return out;
}

export async function createConnection(ctx: StoreCtx, parsed: Extract<ParsedConnection, { ok: true }>): Promise<SaveOutcome> {
  const { data, error } = await ctx.admin.from(CONNECTIONS_TABLE).insert({
    tenant_id: ctx.tenantId, name: parsed.name, family: parsed.family, config: parsed.config, secrets: sealed(parsed, null),
    created_by: ctx.userId, updated_by: ctx.userId,
  }).select(COLUMNS).single();
  if (isSchemaPending(error)) return { ok: false, status: 503, error: "An update is needed before connections can be added. Ask your BPMSquare administrator to run it." };
  if (error) {
    if (error.code === "23505") return { ok: false, status: 422, error: "A connection with that name already exists.", field: "name" };
    return { ok: false, status: 500, error: "Could not save the connection." };
  }
  const row = data as Row;
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "integration_connection", objectId: row.id, objectLabel: row.name, action: "create", actorId: ctx.userId, changes: diff(null, parsed, Object.keys(parsed.secrets).length > 0) });
  return { ok: true, connection: toPublic(row) };
}

export async function updateConnection(ctx: StoreCtx, before: Row, parsed: Extract<ParsedConnection, { ok: true }>): Promise<SaveOutcome> {
  const changes = diff(before, parsed, Object.keys(parsed.secrets).length > 0);
  const { data, error } = await ctx.admin.from(CONNECTIONS_TABLE).update({
    name: parsed.name, family: parsed.family, config: parsed.config, secrets: sealed(parsed, before.secrets),
    // Anything about how it signs in may have changed: the old token and the old test no longer say anything.
    token_cache: null, last_test_status: null, last_test_at: null, last_test_message: null,
    updated_by: ctx.userId, updated_at: new Date().toISOString(),
  }).eq("id", before.id).eq("tenant_id", ctx.tenantId).select(COLUMNS).maybeSingle();
  if (error) {
    if (error.code === "23505") return { ok: false, status: 422, error: "A connection with that name already exists.", field: "name" };
    return { ok: false, status: 500, error: "Could not save the connection." };
  }
  if (!data) return { ok: false, status: 404, error: "Connection not found." };
  const row = data as Row;
  if (changes.length) await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "integration_connection", objectId: row.id, objectLabel: row.name, action: "update", actorId: ctx.userId, changes });
  return { ok: true, connection: toPublic(row) };
}

export async function deleteConnection(ctx: StoreCtx, row: Row): Promise<void> {
  await ctx.admin.from(CONNECTIONS_TABLE).delete().eq("id", row.id).eq("tenant_id", ctx.tenantId);
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "integration_connection", objectId: row.id, objectLabel: row.name, action: "delete", actorId: ctx.userId, changes: [] });
}

export async function saveTestResult(admin: SupabaseClient, tenantId: string, id: string, r: TestResult): Promise<void> {
  await admin.from(CONNECTIONS_TABLE).update({
    last_test_status: r.ok ? "ok" : "failed", last_test_at: new Date().toISOString(), last_test_message: r.message.slice(0, 300),
  }).eq("id", id).eq("tenant_id", tenantId);
}
