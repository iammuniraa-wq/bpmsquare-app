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
