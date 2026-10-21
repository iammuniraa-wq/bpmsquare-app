import "server-only";
import { createHmac } from "crypto";
import type { TenantConfig } from "@/lib/constants";
import { sealSecret, unsealSecret } from "@/lib/encryption";
import { fetchPublic } from "@/lib/net/safeHost";

export type PushResult = { ok: true } | { ok: false; error: string };

type IntegrationPush = NonNullable<TenantConfig["integration_push"]>;

/** The signing secrets of the ERP push, encrypted for storage. tenants.config is readable by
 *  every member of the workspace through PostgREST (audit 2026-10-21), so a signing key must
 *  not be kept there in the clear. Idempotent. */
export function sealIntegrationPush(push: IntegrationPush): IntegrationPush {
  return {
    ...push,
    ...(push.webhook_secret ? { webhook_secret: sealSecret(push.webhook_secret) } : {}),
    ...(push.endpoints ? { endpoints: push.endpoints.map((e) => ({ ...e, webhook_secret: sealSecret(e.webhook_secret) ?? "" })) } : {}),
  };
}

/** The inverse, for the admin who is shown the secret. Legacy plaintext passes through. */
export function unsealIntegrationPush(push: IntegrationPush): IntegrationPush {
  return {
    ...push,
    ...(push.webhook_secret ? { webhook_secret: unsealSecret(push.webhook_secret) } : {}),
    ...(push.endpoints ? { endpoints: push.endpoints.map((e) => ({ ...e, webhook_secret: unsealSecret(e.webhook_secret) ?? "" })) } : {}),
  };
}

/**
 * On-demand push of a single record to the tenant's configured external
 * endpoint (their ERP's webhook receiver) -- triggered by a rep clicking
 * "Push to ERP" on a record, not an automatic event trigger (that's the
 * separate, still-unbuilt Webhooks integration in Settings). Signs the body
 * with HMAC-SHA256 so the receiver can verify the push actually came from
 * BPMSquare and reject anything else hitting their endpoint.
 *
 * The URL is typed by a tenant admin and fetched by OUR server, so it goes
 * through fetchPublic(): a private, loopback or link-local address is refused
 * (and so is a redirect to one).
 */
export async function pushToWebhook(
  config: TenantConfig | null | undefined,
  event: string,
  data: unknown
): Promise<PushResult> {
  const url = config?.integration_push?.webhook_url;
  if (!url) return { ok: false, error: "No push URL configured for this tenant (Settings → Integrations)." };

  const body = JSON.stringify({ event, data, sent_at: new Date().toISOString() });
  const secret = unsealSecret(config?.integration_push?.webhook_secret);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["X-BPMSquare-Signature"] = createHmac("sha256", secret).update(body).digest("hex");

  try {
    const res = await fetchPublic(url, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, error: `Receiving endpoint returned HTTP ${res.status}` };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the configured URL" };
  }
}
