import { verifyGeneric } from "@/lib/mail/webhookSignature";

// The one place a WhatsApp provider plugs in. The provider is NOT chosen yet (Meta Cloud API direct,
// Twilio, or a GCC business solution provider), so nothing outside this folder knows how any of them
// work, and the shell ships with a sandbox that logs what would be sent and calls nothing.
//
// TO ADD A REAL PROVIDER (docs/shells/whatsapp-shell.md):
//   1. Write a file here implementing WhatsAppProvider. sendTemplate/sendSession make the provider's HTTP
//      call using `identity.credentials` (already decrypted, server-side only; never log them);
//      verifyWebhook checks that provider's signature scheme over the RAW body (Meta: X-Hub-Signature-256
//      with the app secret; Twilio: X-Twilio-Signature over the URL and params); parseWebhook turns its
//      payload into InboundItem[].
//   2. Declare `credentialFields` so the setup page knows what to ask the admin for; secret fields are
//      encrypted before storage.
//   3. Add it to PROVIDERS below. Nothing else changes: the consent gate, the window rule, the demo
//      redirect, events and the journey step all sit above this interface.

export type ProviderIdentity = {
  tenantId: string;
  /** The business number customers see, normalised "+...". */
  displayNumber: string | null;
  /** Decrypted values, by the keys the provider declared in credentialFields. */
  credentials: Record<string, string>;
};

export type ProviderSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

export type InboundItem =
  | { kind: "message"; providerMessageId: string; from: string; text: string; at: string }
  | { kind: "status"; providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; at: string; error?: string };

export type HeaderReader = { get(name: string): string | null };

export interface WhatsAppProvider {
  id: string;
  label: string;
  /** False when the provider never calls anything outside (the sandbox): every send is a logged dry run. */
  live: boolean;
  credentialFields: { key: string; label: string; secret: boolean }[];
  sendTemplate(identity: ProviderIdentity, m: { to: string; templateName: string; language: string; params: string[]; clientRef: string }): Promise<ProviderSendResult>;
  sendSession(identity: ProviderIdentity, m: { to: string; text: string; clientRef: string }): Promise<ProviderSendResult>;
  /** True only when the request is genuinely from the provider. `secret` is the stored webhook secret. */
  verifyWebhook(headers: HeaderReader, rawBody: string, secret: string): boolean;
  parseWebhook(rawBody: string): InboundItem[];
}

/**
 * The sandbox. It sends nothing anywhere: a send returns at once and the caller records a dry run. Its webhook
 * is a plain signed JSON format so the whole inbound path (signature, tenant from the stored row, STOP and
 * START, replies as events) can be exercised end to end with curl or the demo script:
 *   header  X-BPMSquare-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>" with the webhook secret>
 *   body    { "messages": [{ "id", "from", "text", "timestamp" }], "statuses": [{ "id", "status", "timestamp" }] }
 */
export const sandboxProvider: WhatsAppProvider = {
  id: "sandbox",
  label: "Sandbox (logs only, sends nothing)",
  live: false,
  credentialFields: [],
  async sendTemplate(_i, m) {
    return { ok: true, providerMessageId: `sandbox-${m.clientRef}` };
  },
  async sendSession(_i, m) {
    return { ok: true, providerMessageId: `sandbox-${m.clientRef}` };
  },
  verifyWebhook(headers, rawBody, secret) {
    return verifyGeneric(secret, headers.get("x-bpmsquare-signature"), rawBody);
  },
  parseWebhook(rawBody) {
    const body = JSON.parse(rawBody) as { messages?: unknown; statuses?: unknown };
    const iso = (t: unknown): string => {
      const n = typeof t === "number" ? t : typeof t === "string" && /^\d+$/.test(t) ? Number(t) : NaN;
      if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
      const d = typeof t === "string" ? new Date(t) : null;
      return d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
    };
    const out: InboundItem[] = [];
    for (const m of Array.isArray(body.messages) ? body.messages : []) {
      const o = m as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.from === "string" && typeof o.text === "string") {
        out.push({ kind: "message", providerMessageId: o.id.slice(0, 120), from: o.from.slice(0, 40), text: o.text.slice(0, 2000), at: iso(o.timestamp) });
      }
    }
    for (const s of Array.isArray(body.statuses) ? body.statuses : []) {
      const o = s as Record<string, unknown>;
      if (typeof o.id === "string" && (o.status === "sent" || o.status === "delivered" || o.status === "read" || o.status === "failed")) {
        out.push({ kind: "status", providerMessageId: o.id.slice(0, 120), status: o.status, at: iso(o.timestamp), error: typeof o.error === "string" ? o.error.slice(0, 200) : undefined });
      }
    }
    return out;
  },
};

export const PROVIDERS: Record<string, WhatsAppProvider> = { sandbox: sandboxProvider };
export const DEFAULT_PROVIDER = "sandbox";

export function getProvider(id: string | null | undefined): WhatsAppProvider | null {
  return id && Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}
