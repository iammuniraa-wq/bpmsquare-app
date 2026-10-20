import "server-only";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";
import { decrypt, encrypt } from "@/lib/encryption";
import { isSchemaPending } from "@/lib/marketing/pending";
import { normalisePhone, maskPhone } from "./phone";
import { DEFAULT_PROVIDER, getProvider, type ProviderIdentity } from "./provider";

// The workspace's WhatsApp identity (0186): which provider adapter sends for it, the number customers see and
// the adapter's credentials. Every value that is a secret or a number is encrypted before it is written; the
// row has no RLS policy, so only this code (service-role client, tenant on every query) can read it.

export const whatsappEnabled = (f: Partial<TenantFeatures> | null | undefined): boolean => f?.marketing === true && f?.whatsapp_marketing === true;

export type IdentityRow = {
  id: string;
  tenant_id: string;
  provider: string;
  display_number: string | null;
  credentials: Record<string, string>;
  webhook_key: string;
  status: "active" | "disabled";
  updated_at: string;
};

export const WEBHOOK_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const newKey = () => randomBytes(18).toString("base64url");
const newSecret = () => randomBytes(32).toString("hex");

export async function loadIdentity(admin: SupabaseClient, tenantId: string): Promise<{ row: IdentityRow | null; missing: boolean }> {
  const { data, error } = await admin.from("whatsapp_identities").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) return { row: null, missing: isSchemaPending(error) };
  return { row: (data as IdentityRow | null) ?? null, missing: false };
}

export async function loadIdentityByKey(admin: SupabaseClient, key: string): Promise<IdentityRow | null> {
  if (!WEBHOOK_KEY_PATTERN.test(key)) return null;
  const { data, error } = await admin.from("whatsapp_identities").select("*").eq("webhook_key", key).maybeSingle();
  return error ? null : ((data as IdentityRow | null) ?? null);
}

/** What the adapter is handed: decrypted, in memory only for the length of one call. */
export function providerIdentity(row: IdentityRow): ProviderIdentity {
  const credentials: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.credentials ?? {})) credentials[k] = decrypt(v) ?? "";
  return { tenantId: row.tenant_id, displayNumber: decrypt(row.display_number), credentials };
}

export type IdentityView = {
  provider: string;
  providerLabel: string;
  status: "active" | "disabled";
  maskedNumber: string;
  webhookKey: string;
  hasWebhookSecret: boolean;
  /** Provider credential fields that are filled in (never their values). */
  filled: string[];
};

export function viewOf(row: IdentityRow): IdentityView {
  const p = getProvider(row.provider);
  return {
    provider: row.provider, providerLabel: p?.label ?? row.provider, status: row.status,
    maskedNumber: maskPhone(decrypt(row.display_number)), webhookKey: row.webhook_key,
    hasWebhookSecret: !!row.credentials?.webhook_secret,
    filled: Object.keys(row.credentials ?? {}).filter((k) => k !== "webhook_secret" && !!row.credentials[k]),
  };
}

export type SaveIdentityInput = {
  provider?: string;
  displayNumber?: string | null;
  /** Provider credential values by key. A blank value means "unchanged", never "clear". */
  credentials?: Record<string, string>;
  status?: "active" | "disabled";
  /** Make a new webhook secret (shown once, in the result). */
  rotateSecret?: boolean;
};

export type SaveIdentityResult =
  | { ok: true; secret: string | null; view: IdentityView }
  | { ok: false; error: string; missing?: boolean };

export async function saveIdentity(admin: SupabaseClient, tenantId: string, userId: string | null, input: SaveIdentityInput, country?: string | null): Promise<SaveIdentityResult> {
  const { row, missing } = await loadIdentity(admin, tenantId);
  if (missing) return { ok: false, error: "WhatsApp is waiting for a database update.", missing: true };

  const providerId = input.provider ?? row?.provider ?? DEFAULT_PROVIDER;
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: "Choose one of the providers on the list." };

  let displayNumber = row?.display_number ?? null;
  if (input.displayNumber !== undefined) {
    if (input.displayNumber === null || input.displayNumber.trim() === "") displayNumber = null;
    else {
      const n = normalisePhone(input.displayNumber, country);
      if (!n) return { ok: false, error: "Write the number with its country code, for example +966 5X XXX XXXX." };
      displayNumber = encrypt(n);
    }
  }

  const credentials: Record<string, string> = { ...(row?.credentials ?? {}) };
  for (const f of provider.credentialFields) {
    const v = input.credentials?.[f.key];
    if (typeof v === "string" && v.trim()) credentials[f.key] = encrypt(v.trim()) ?? "";
  }
  let secret: string | null = null;
  if (!credentials.webhook_secret || input.rotateSecret) {
    secret = newSecret();
    credentials.webhook_secret = encrypt(secret) ?? "";
  }

  const now = new Date().toISOString();
  const fields = { provider: providerId, display_number: displayNumber, credentials, status: input.status ?? row?.status ?? "active", updated_at: now };
  const write = row
    ? await admin.from("whatsapp_identities").update(fields).eq("id", row.id).eq("tenant_id", tenantId).select("*").single()
    : await admin.from("whatsapp_identities").insert({ tenant_id: tenantId, webhook_key: newKey(), created_by: userId, ...fields }).select("*").single();
  if (write.error || !write.data) {
    if (write.error && isSchemaPending(write.error)) return { ok: false, error: "WhatsApp is waiting for a database update.", missing: true };
    return { ok: false, error: "Could not save the number." };
  }
  return { ok: true, secret, view: viewOf(write.data as IdentityRow) };
}
