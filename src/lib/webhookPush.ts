import "server-only";
import { createHmac } from "crypto";
import type { TenantConfig } from "@/lib/constants";

export type PushResult = { ok: true } | { ok: false; error: string };

/**
 * On-demand push of a single record to the tenant's configured external
 * endpoint (their ERP's webhook receiver) -- triggered by a rep clicking
 * "Push to ERP" on a record, not an automatic event trigger (that's the
 * separate, still-unbuilt Webhooks integration in Settings). Signs the body
 * with HMAC-SHA256 so the receiver can verify the push actually came from
 * BPMSquare and reject anything else hitting their endpoint.
 */
export async function pushToWebhook(
  config: TenantConfig | null | undefined,
  event: string,
  data: unknown
): Promise<PushResult> {
  const url = config?.integration_push?.webhook_url;
  if (!url) return { ok: false, error: "No push URL configured for this tenant (Settings → Integrations)." };

  const body = JSON.stringify({ event, data, sent_at: new Date().toISOString() });
  const secret = config?.integration_push?.webhook_secret;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["X-BPMSquare-Signature"] = createHmac("sha256", secret).update(body).digest("hex");

  try {
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) return { ok: false, error: `Receiving endpoint returned HTTP ${res.status}` };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the configured URL" };
  }
}
