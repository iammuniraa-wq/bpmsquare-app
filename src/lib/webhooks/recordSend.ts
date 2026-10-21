import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { decryptAccount } from "@/lib/encryption";
import type { Account } from "@/lib/types";
import { resolveWebhookForAccount } from "@/lib/coverage/resolve";
import { fireWebhook, type FireResult } from "./sender";

// "Send this record to a webhook": the account button (header overflow menu) and the
// middleware's "Send a record" both land here. Which webhook is decided on the server
// from the record itself -- the owning Coverage row first, then the button chosen under
// Settings > Webhooks -- never from the request. The account is read with its tenant.

export type AccountSendOutcome =
  | { kind: "not_found" }
  | { kind: "none" }
  | { kind: "fired"; webhookId: string; result: FireResult };

export const webhooksLibraryOn = (features: TenantFeatures | null | undefined): boolean => features?.webhooks_library === true;

export async function sendAccountViaWebhook(
  admin: SupabaseClient, tenantId: string, userId: string | null, accountId: string,
): Promise<AccountSendOutcome> {
  const [{ data: account }, { data: tenantRow }] = await Promise.all([
    admin.from("accounts").select("*").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("config, features").eq("id", tenantId).maybeSingle(),
  ]);
  if (!account) return { kind: "not_found" };
  const config = (tenantRow?.config ?? null) as TenantConfig | null;
  const features = (tenantRow?.features ?? null) as TenantFeatures | null;
  const button = config?.webhooks_library?.record_buttons?.accounts ?? null;

  let webhookId: string | null = button;
  let trigger: "button" | "coverage" = "button";
  if (features?.coverage_model) {
    const hit = await resolveWebhookForAccount(tenantId, decryptAccount(account as Account), button);
    if (hit) { webhookId = hit.webhook_id; trigger = hit.source === "coverage" ? "coverage" : "button"; }
  }
  if (!webhookId) return { kind: "none" };
  const result = await fireWebhook(admin, { tenantId, webhookId, objectType: "accounts", objectId: accountId, trigger, userId });
  return { kind: "fired", webhookId, result };
}
