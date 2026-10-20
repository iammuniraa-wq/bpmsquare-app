import { bounceReason } from "./emailHealth";

// Reading a Resend webhook body (Svix-signed, verified before this runs). Pure.
//
// Nothing in the body is trusted to say WHICH TENANT or WHICH PERSON an event is
// about: the only thing used to find the stored recipient row is the tag we put on
// the message ourselves (recipient_id), or the provider's message id we stored. The
// `to` list is used for one thing only -- to notice that a message did not go to the
// address we hold (a demo workspace redirects), so a redirected bounce never marks a
// real contact.

export const RECIPIENT_TAG = "recipient_id";

export type DeliveryKind = "delivered" | "bounced_hard" | "bounced_soft" | "complained" | "delayed";

export type NormalisedDelivery = {
  kind: DeliveryKind;
  /** The provider's message id. */
  emailId: string | null;
  /** The value of our recipient_id tag, when the message carried one. */
  recipientTag: string | null;
  /** Where the provider says it was delivered (lower-cased). */
  to: string[];
  occurredAt: string | null;
  /** A short plain sentence, never the provider's own text. */
  reason: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

function tagValue(tags: unknown, name: string): string | null {
  // Webhook payloads carry tags as an object {name: value}; the send API takes a list. Accept both.
  if (Array.isArray(tags)) {
    const hit = tags.find((t) => t && typeof t === "object" && (t as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof hit?.value === "string" ? hit.value : null;
  }
  if (tags && typeof tags === "object") {
    const v = (tags as Record<string, unknown>)[name];
    return typeof v === "string" ? v : null;
  }
  return null;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** The delivery events we act on; everything else (sent, opened, clicked, ...) returns null. */
export function normaliseResendEvent(body: unknown): NormalisedDelivery | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { type?: unknown; created_at?: unknown; data?: unknown };
  if (typeof b.type !== "string" || !b.data || typeof b.data !== "object") return null;
  const d = b.data as { email_id?: unknown; to?: unknown; tags?: unknown; created_at?: unknown; bounce?: unknown };

  let kind: DeliveryKind;
  let reason: string | null = null;
  switch (b.type) {
    case "email.delivered": kind = "delivered"; break;
    case "email.complained": kind = "complained"; reason = "The person marked an email as spam."; break;
    case "email.delivery_delayed": kind = "delayed"; reason = "Delivery is delayed; the email service is still trying."; break;
    case "email.bounced": {
      const bounce = (d.bounce && typeof d.bounce === "object" ? d.bounce : {}) as { type?: unknown; subType?: unknown };
      // Permanent is a hard bounce. Transient and Undetermined are not proof the address is dead.
      const hard = typeof bounce.type === "string" && bounce.type.toLowerCase() === "permanent";
      kind = hard ? "bounced_hard" : "bounced_soft";
      reason = bounceReason(hard, typeof bounce.subType === "string" ? bounce.subType : null);
      break;
    }
    default: return null;
  }

  const to = (Array.isArray(d.to) ? d.to : typeof d.to === "string" ? [d.to] : [])
    .filter((x): x is string => typeof x === "string")
    .map((x) => (x.match(/<([^>]+)>/)?.[1] ?? x).trim().toLowerCase());

  return {
    kind,
    emailId: typeof d.email_id === "string" ? d.email_id : null,
    recipientTag: tagValue(d.tags, RECIPIENT_TAG),
    to,
    occurredAt: isoOrNull(d.created_at) ?? isoOrNull(b.created_at),
    reason,
  };
}
