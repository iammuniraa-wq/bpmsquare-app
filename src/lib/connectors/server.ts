import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/encryption";
import { getConnectorDef } from "./registry";
import type { TenantConnectorRow } from "./types";

/** Every connector row this tenant has configured, non-secret fields only --
 * safe to return straight to the client (credentials never leave the server). */
export async function listTenantConnectors(supabase: SupabaseClient, tenantId: string): Promise<TenantConnectorRow[]> {
  const { data } = await supabase
    .from("tenant_connectors")
    .select("connector_id, status, config, last_error, connected_at")
    .eq("tenant_id", tenantId);
  return (data ?? []) as TenantConnectorRow[];
}

/** Encrypts every field the connector's definition marks `secret`, upserts
 * the row. Non-secret fields (e.g. a target URL with no credential value)
 * are stored as given in `config`, not `credentials`. */
export async function connectTenant(
  supabase: SupabaseClient,
  tenantId: string,
  connectorId: string,
  userId: string,
  values: Record<string, string>
): Promise<{ error?: string }> {
  const def = getConnectorDef(connectorId);
  if (!def) return { error: "Unknown connector" };

  const credentials: Record<string, string> = {};
  const config: Record<string, string> = {};
  for (const field of def.fields) {
    const v = values[field.key]?.trim();
    if (!v) return { error: `${field.label} is required` };
    if (field.secret) credentials[field.key] = encrypt(v) ?? "";
    else config[field.key] = v;
  }

  const { error } = await supabase.from("tenant_connectors").upsert(
    {
      tenant_id: tenantId,
      connector_id: connectorId,
      status: "connected",
      credentials,
      config,
      last_error: null,
      connected_by: userId,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,connector_id" }
  );
  if (error) return { error: error.message };
  return {};
}

export async function disconnectTenant(supabase: SupabaseClient, tenantId: string, connectorId: string): Promise<void> {
  await supabase.from("tenant_connectors").delete().eq("tenant_id", tenantId).eq("connector_id", connectorId);
}

/** Decrypted credentials for one tenant+connector, or null if not connected.
 * Only ever called server-side, immediately before using them to call out. */
export async function getDecryptedCredentials(
  supabase: SupabaseClient,
  tenantId: string,
  connectorId: string
): Promise<Record<string, string> | null> {
  const { data } = await supabase
    .from("tenant_connectors")
    .select("credentials")
    .eq("tenant_id", tenantId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  if (!data) return null;
  const raw = data.credentials as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = decrypt(v) ?? "";
  return out;
}

/** Called once, right after the OAuth callback exchanges a code for tokens.
 * expires_at is stored as a plain (unencrypted) timestamp -- it's not a
 * credential, just bookkeeping for when to refresh. Google only returns a
 * refresh_token on a user's very first-ever consent for an app+scope
 * combination; on a reconnect it's typically omitted, so an existing one is
 * preserved rather than silently dropped (which would otherwise strand the
 * connector the moment the short-lived access_token expired). */
export async function storeOAuthTokens(
  supabase: SupabaseClient,
  tenantId: string,
  connectorId: string,
  userId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in: number }
): Promise<void> {
  const credentials: Record<string, string> = {
    access_token: encrypt(tokens.access_token) ?? "",
    expires_at: String(Date.now() + tokens.expires_in * 1000),
  };
  if (tokens.refresh_token) {
    credentials.refresh_token = encrypt(tokens.refresh_token) ?? "";
  } else {
    const { data } = await supabase
      .from("tenant_connectors")
      .select("credentials")
      .eq("tenant_id", tenantId)
      .eq("connector_id", connectorId)
      .maybeSingle();
    const prevRefresh = (data?.credentials as Record<string, string> | undefined)?.refresh_token;
    if (prevRefresh) credentials.refresh_token = prevRefresh;
  }

  await supabase.from("tenant_connectors").upsert(
    {
      tenant_id: tenantId,
      connector_id: connectorId,
      status: "connected",
      credentials,
      config: {},
      last_error: null,
      connected_by: userId,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,connector_id" }
  );
}

/** A ready-to-use access token, refreshing first if it's expired (or about
 * to, within a minute). Returns null if not connected or the refresh fails
 * (e.g. the user revoked access at Google's end) -- callers should treat
 * that as "reconnect required," not retry. */
export async function getValidAccessToken(
  supabase: SupabaseClient,
  tenantId: string,
  connectorId: string
): Promise<string | null> {
  const def = getConnectorDef(connectorId);
  if (!def?.oauth) return null;

  const { data } = await supabase
    .from("tenant_connectors")
    .select("credentials")
    .eq("tenant_id", tenantId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  if (!data) return null;

  const creds = data.credentials as Record<string, string>;
  const expiresAt = Number(creds.expires_at ?? 0);
  if (Date.now() < expiresAt - 60_000) return decrypt(creds.access_token);

  const refreshToken = creds.refresh_token ? decrypt(creds.refresh_token) : null;
  if (!refreshToken) return null;

  const clientId = process.env[def.oauth.provider.clientIdEnv];
  const clientSecret = process.env[def.oauth.provider.clientSecretEnv];
  if (!clientId || !clientSecret) return null;

  const res = await fetch(def.oauth.provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token: string; expires_in: number };

  await supabase
    .from("tenant_connectors")
    .update({
      credentials: { ...creds, access_token: encrypt(json.access_token) ?? "", expires_at: String(Date.now() + json.expires_in * 1000) },
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("connector_id", connectorId);

  return json.access_token;
}
