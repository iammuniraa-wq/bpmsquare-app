import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS, type EventName } from "@/lib/events/catalog";
import { addSuppression, recordConsent } from "./consentWrite";
import { emailBlindIndex } from "./blindIndex";
import { nextHealth, isEmailStatus, type EmailStatus, type HealthSignal } from "./emailHealth";
import { isSchemaPending } from "./pending";
import { notifyOwnerOfBounce } from "./bounceNotice";
import { isUuid, type DeliveryKind, type NormalisedDelivery } from "./resendEvents";

// What a verified Resend delivery event does (POST /api/webhooks/resend):
//   1. finds the stored recipient row the message belongs to -- by our own
//      recipient_id tag, or the provider message id we stored -- and takes the
//      TENANT from that row. Nothing in the payload names a tenant;
//   2. ignores a delivery it has already processed (the provider's event id);
//   3. emits email.delivered / email.bounced / email.complained, records what
//      happened on the recipient row, and moves the CONTACT's email health;
//   4. a hard bounce or complaint also suppresses the address, so canContact()
//      refuses it from then on; a complaint also withdraws email consent.
// Everything is on the service-role client, so every query below names the tenant
// except the one lookup that FINDS it.

export type DeliveryOutcome =
  | { status: "processed"; tenantId: string; contactStatus: EmailStatus | null }
  | { status: "duplicate" }
  | { status: "unmatched"; reason: "no_row" | "id_mismatch" | "unavailable" };

type RecipientRow = {
  id: string; tenant_id: string; campaign_id: string; account_id: string | null; contact_id: string | null;
  email: string | null; manual_email: string | null; lang: string | null;
  resend_id?: string | null; delivery_status?: string | null;
};

const EVENT_FOR: Record<DeliveryKind, EventName> = {
  delivered: EVENTS.EMAIL_DELIVERED,
  bounced_hard: EVENTS.EMAIL_BOUNCED,
  bounced_soft: EVENTS.EMAIL_BOUNCED,
  delayed: EVENTS.EMAIL_BOUNCED,
  complained: EVENTS.EMAIL_COMPLAINED,
};
const BOUNCE_TYPE: Partial<Record<DeliveryKind, string>> = { bounced_hard: "hard", bounced_soft: "soft", delayed: "delayed" };
const DELIVERY_STATUS: Record<DeliveryKind, string> = {
  delivered: "delivered", bounced_hard: "bounced", bounced_soft: "soft_bounced", delayed: "delayed", complained: "complained",
};
// A later, milder status never overwrites an earlier, worse one (events can arrive out of order).
const RANK: Record<string, number> = { delayed: 1, delivered: 2, soft_bounced: 3, bounced: 4, complained: 5 };

const FULL_COLS = "id, tenant_id, campaign_id, account_id, contact_id, email, manual_email, lang, resend_id, delivery_status";
const BASE_COLS = "id, tenant_id, campaign_id, account_id, contact_id, email, manual_email, lang";

async function findRecipient(admin: SupabaseClient, d: NormalisedDelivery): Promise<RecipientRow | null | "unavailable"> {
  // The one query with no tenant filter: it is how the tenant is found. The key is a
  // random uuid we generated (the tag) or the provider's id for a message WE sent.
  const attempt = async (cols: string): Promise<{ row: RecipientRow | null; error: { code?: string; message?: string } | null }> => {
    const q = admin.from("marketing_campaign_recipients").select(cols);
    const res = d.recipientTag && isUuid(d.recipientTag)
      ? await q.eq("id", d.recipientTag).maybeSingle()
      : d.emailId ? await q.eq("resend_id", d.emailId).maybeSingle() : { data: null, error: null };
    return { row: (res.data as unknown as RecipientRow | null) ?? null, error: res.error };
  };
  let r = await attempt(FULL_COLS);
  if (r.error && isSchemaPending(r.error)) {
    // 0144 not applied: without resend_id only the tag can find the row.
    if (!(d.recipientTag && isUuid(d.recipientTag))) return null;
    r = await attempt(BASE_COLS);
  }
  if (r.error) return "unavailable";
  return r.row;
}

const safeHash = (email: string | null | undefined): string | null => {
  try { return emailBlindIndex(email); } catch { return null; }
};

export async function processDelivery(
  admin: SupabaseClient,
  d: NormalisedDelivery,
  providerEventId: string,
  now: () => Date = () => new Date(),
): Promise<DeliveryOutcome> {
  const found = await findRecipient(admin, d);
  if (found === "unavailable") return { status: "unmatched", reason: "unavailable" };
  if (!found) return { status: "unmatched", reason: "no_row" };
  const row = found;
  // A stored provider id that differs from the event's means this event is about some other message.
  if (row.resend_id && d.emailId && row.resend_id !== d.emailId) return { status: "unmatched", reason: "id_mismatch" };

  const tenantId = row.tenant_id;

  const seen = await admin.from("email_provider_events").select("id").eq("tenant_id", tenantId).eq("provider", "resend").eq("provider_event_id", providerEventId).maybeSingle();
  if (seen.data) return { status: "duplicate" };

  const occurredAt = d.occurredAt ?? now().toISOString();

  // Campaign and design, for the event's common fields.
  type CampaignRow = { id: string; name?: string; topic?: string | null; newsletter_version_id?: string | null };
  let campaign: CampaignRow | null = null;
  {
    let res = await admin.from("marketing_campaigns").select("id, name, topic, newsletter_version_id").eq("id", row.campaign_id).eq("tenant_id", tenantId).maybeSingle();
    if (res.error && isSchemaPending(res.error)) res = await admin.from("marketing_campaigns").select("id, name").eq("id", row.campaign_id).eq("tenant_id", tenantId).maybeSingle();
    campaign = (res.data as CampaignRow | null) ?? null;
  }
  let newsletterId: string | null = null;
  if (campaign?.newsletter_version_id) {
    const v = await admin.from("newsletter_versions").select("newsletter_id").eq("id", campaign.newsletter_version_id).eq("tenant_id", tenantId).maybeSingle();
    newsletterId = (v.data as { newsletter_id?: string } | null)?.newsletter_id ?? null;
  }

  // Who it is about. The contact comes from OUR row, verified against this tenant.
  const addressHeld = row.email ?? row.manual_email;
  const heldHash = safeHash(addressHeld);
  const toHashes = d.to.map((t) => safeHash(t)).filter((h): h is string => !!h);
  // A demo workspace redirects every message, so the provider's `to` is not the address we hold:
  // such an event must never touch a real contact or suppress a real address.
  const toOurAddress = !!heldHash && toHashes.includes(heldHash);

  type ContactRow = { id: string; name?: string | null; account_id: string; email_hash: string | null; email_status?: string | null; email_status_at?: string | null };
  let contact: ContactRow | null = null;
  let healthColumns = true;
  if (row.contact_id) {
    let res = await admin.from("contacts").select("id, name, account_id, email_hash, email_status, email_status_at").eq("id", row.contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (res.error && isSchemaPending(res.error)) {
      healthColumns = false;
      res = await admin.from("contacts").select("id, name, account_id, email_hash").eq("id", row.contact_id).eq("tenant_id", tenantId).maybeSingle();
    }
    contact = (res.data as ContactRow | null) ?? null;
  }
  const contactIsThisAddress = !!contact && !!heldHash && contact.email_hash === heldHash;

  await emitEvent(tenantId, {
    name: EVENT_FOR[d.kind],
    object_type: "marketing_campaign", object_id: row.campaign_id, source: "provider_webhook",
    contact_id: contact?.id ?? null, account_id: contact?.account_id ?? row.account_id ?? null,
    campaign_id: row.campaign_id, newsletter_id: newsletterId, newsletter_version_id: campaign?.newsletter_version_id ?? null,
    lang: row.lang, topic: campaign?.topic ?? null,
    email_hash: contact ? null : heldHash,
    occurred_at: occurredAt,
    // The provider's own event id: a retried delivery records nothing twice.
    key: providerEventId,
    payload: { resend_id: d.emailId, ...(BOUNCE_TYPE[d.kind] ? { bounce_type: BOUNCE_TYPE[d.kind] } : {}) },
  }, admin);

  // What happened to this message.
  const nextDelivery = DELIVERY_STATUS[d.kind];
  if ((RANK[nextDelivery] ?? 0) >= (RANK[row.delivery_status ?? ""] ?? 0)) {
    const { error } = await admin.from("marketing_campaign_recipients")
      .update({ delivery_status: nextDelivery, delivery_at: occurredAt })
      .eq("id", row.id).eq("tenant_id", tenantId);
    if (error && !isSchemaPending(error)) console.error(`[resend webhook] recipient not updated: ${error.message}`);
  }

  let contactStatus: EmailStatus | null = null;
  if (toOurAddress && heldHash) {
    if (d.kind === "bounced_hard") await addSuppression(tenantId, { channel: "email", addressHash: heldHash, reason: "bounced_hard" }, admin);
    if (d.kind === "complained") await addSuppression(tenantId, { channel: "email", addressHash: heldHash, reason: "complained" }, admin);

    if (contact && contactIsThisAddress && healthColumns) {
      const signal: HealthSignal | null =
        d.kind === "delivered" ? { kind: "delivered" }
        : d.kind === "bounced_hard" ? { kind: "bounced", reason: d.reason ?? undefined }
        : d.kind === "bounced_soft" ? { kind: "soft_bounce", reason: d.reason ?? undefined }
        : d.kind === "complained" ? { kind: "complained", reason: d.reason ?? undefined }
        : null; // delayed: informational, the provider is still trying
      const current = { status: isEmailStatus(contact.email_status) ? contact.email_status : ("unknown" as EmailStatus), at: contact.email_status_at ?? null };
      const change = signal ? nextHealth(current, signal, occurredAt) : null;
      if (change) {
        const { error } = await admin.from("contacts")
          .update({ email_status: change.status, email_status_at: occurredAt, email_status_reason: change.reason })
          .eq("id", contact.id).eq("tenant_id", tenantId);
        if (error) { if (!isSchemaPending(error)) console.error(`[resend webhook] contact health not updated: ${error.message}`); }
        else {
          contactStatus = change.status;
          // A newly bounced address: tell the account owner (Nova inbox) so it gets fixed.
          if (change.status === "bounced") await notifyOwnerOfBounce(admin, tenantId, { contactId: contact.id, accountId: contact.account_id, contactName: contact.name });
        }
      }

      if (d.kind === "complained") {
        // A complaint withdraws every topic for email -- once.
        const { data: existing } = await admin.from("consent_state").select("status").eq("tenant_id", tenantId).eq("contact_id", contact.id).eq("channel", "email").eq("topic", "").maybeSingle();
        if ((existing as { status?: string } | null)?.status !== "withdrawn") {
          await recordConsent(tenantId, {
            contactId: contact.id, channel: "email", topic: null, status: "withdrawn", basis: "consent", source: "provider_webhook",
            evidence: { reason: "complaint", campaign_id: row.campaign_id },
          }, admin);
        }
      }
    }
  }

  const { error: recErr } = await admin.from("email_provider_events").insert({
    tenant_id: tenantId, provider: "resend", provider_event_id: providerEventId, event_type: EVENT_FOR[d.kind], recipient_id: row.id,
  });
  if (recErr && !isSchemaPending(recErr) && recErr.code !== "23505") console.error(`[resend webhook] event not recorded: ${recErr.message}`);

  return { status: "processed", tenantId, contactStatus };
}
