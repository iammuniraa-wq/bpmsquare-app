import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptAccount } from "@/lib/encryption";
import { pushToWebhook } from "@/lib/webhookPush";
import { resolveErpEndpointForAccount } from "@/lib/coverage/resolve";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import type { Account } from "@/lib/types";

export type AccountPushResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * On-demand push of one account to the tenant's configured external endpoint
 * (lib/webhookPush.ts). Shared by the account page's "Push to ERP" route and the
 * integration middleware's "Send a record". The account is read with the
 * tenant filter whichever client is passed.
 */
export async function pushAccountToErp(supabase: SupabaseClient, tenantId: string, id: string): Promise<AccountPushResult> {
  const [{ data: account }, { data: tenantRow }] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("tenants").select("config, features").eq("id", tenantId).maybeSingle(),
  ]);

  if (!account) return { ok: false, status: 404, error: "Account not found" };

  const decrypted = decryptAccount(account as Account);
  let config = tenantRow?.config as TenantConfig | null;
  const features = tenantRow?.features as TenantFeatures | null;

  // Multi-ERP routing (Coverage) -- an owner coverage can name a specific
  // configured endpoint for its accounts; falls back to the tenant's single
  // default pair, unchanged, when no coverage matches or none is set.
  if (features?.coverage_model) {
    const endpoint = await resolveErpEndpointForAccount(tenantId, decrypted, config?.integration_push);
    if (endpoint) {
      config = { ...(config ?? {}), integration_push: { ...config?.integration_push, webhook_url: endpoint.webhook_url, webhook_secret: endpoint.webhook_secret } } as TenantConfig;
    }
  }

  const result = await pushToWebhook(config, "account.pushed", decrypted);
  if (!result.ok) return { ok: false, status: 502, error: result.error };
  return { ok: true };
}
