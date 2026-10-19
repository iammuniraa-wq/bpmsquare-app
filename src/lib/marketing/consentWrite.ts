import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { CONSENT_CHANNELS, type ConsentChannel } from "./consent";
import { topicsOf } from "./config";
import { isJurisdictionCode, jurisdictionForCountry, type JurisdictionCode } from "./jurisdictions";
import { isSchemaPending } from "./pending";

// The only writer of consent_events / consent_state / suppressions (0139).
// Those tables are select-only to members, so this runs on the service-role
// client from server code, and every query names the tenant.

export const CONSENT_BASES = ["consent", "existing_customer", "contract", "legitimate_interest"] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];
export const CONSENT_SOURCES = ["form", "preference_centre", "unsubscribe_link", "import", "rep", "api", "provider_webhook"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export type RecordConsentInput = {
  /** The person. Must belong to this tenant; looked up here, never trusted. */
  contactId: string;
  channel: ConsentChannel;
  /** A key from the tenant's topics, or null for every topic. */
  topic: string | null;
  status: "granted" | "withdrawn";
  basis?: ConsentBasis;
  source: ConsentSource;
  /** Overrides the jurisdiction derived from the contact's country. */
  jurisdiction?: JurisdictionCode;
  /** What proves how it was given. Keep it small; never put a raw IP in it. */
  evidence?: Record<string, unknown>;
  actorId?: string | null;
};

export type RecordConsentResult = { ok: true } | { ok: false; error: string; pending?: boolean };

export async function recordConsent(tenantId: string, input: RecordConsentInput, client?: SupabaseClient): Promise<RecordConsentResult> {
  try {
    if (!CONSENT_CHANNELS.includes(input.channel)) return { ok: false, error: "Unknown channel" };
    if (input.status !== "granted" && input.status !== "withdrawn") return { ok: false, error: "Unknown status" };
    if (!CONSENT_SOURCES.includes(input.source)) return { ok: false, error: "Unknown source" };
    const basis: ConsentBasis = input.basis ?? "consent";
    if (!CONSENT_BASES.includes(basis)) return { ok: false, error: "Unknown basis" };
    const db = client ?? createAdminSupabase();

    const { data: contact, error: cErr } = await db
      .from("contacts").select("id, account_id, country").eq("id", input.contactId).eq("tenant_id", tenantId).maybeSingle();
    if (cErr) return { ok: false, error: cErr.message };
    if (!contact) return { ok: false, error: "Contact not found" };

    const [{ data: account }, { data: tenant }] = await Promise.all([
      db.from("accounts").select("country").eq("id", contact.account_id).eq("tenant_id", tenantId).maybeSingle(),
      db.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
    ]);

    if (input.topic !== null) {
      const known = topicsOf((tenant?.config ?? null) as Partial<TenantConfig> | null).some((t) => t.key === input.topic);
      if (!known) return { ok: false, error: "Unknown topic" };
    }

    const jurisdiction: JurisdictionCode = input.jurisdiction && isJurisdictionCode(input.jurisdiction)
      ? input.jurisdiction
      : jurisdictionForCountry((contact as { country?: string | null }).country || (account as { country?: string | null } | null)?.country);

    const { error: eErr } = await db.from("consent_events").insert({
      tenant_id: tenantId,
      contact_id: contact.id,
      account_id: contact.account_id,
      channel: input.channel,
      topic: input.topic,
      status: input.status,
      basis,
      jurisdiction,
      source: input.source,
      evidence: input.evidence ?? {},
      created_by: input.actorId ?? null,
    });
    if (eErr) return { ok: false, error: eErr.message, pending: isSchemaPending(eErr) };

    const now = new Date().toISOString();
    const { error: sErr } = await db.from("consent_state").upsert(
      { tenant_id: tenantId, contact_id: contact.id, channel: input.channel, topic: input.topic ?? "", status: input.status, basis, jurisdiction, since: now, updated_at: now },
      { onConflict: "tenant_id,contact_id,channel,topic" },
    );
    if (sErr) return { ok: false, error: sErr.message, pending: isSchemaPending(sErr) };

    await emitEvent(tenantId, {
      name: input.status === "granted" ? EVENTS.CONSENT_GRANTED : EVENTS.CONSENT_WITHDRAWN,
      object_type: "contact", object_id: contact.id, actor_id: input.actorId,
      contact_id: contact.id, account_id: contact.account_id, topic: input.topic,
      key: `${contact.id}:${input.channel}:${input.topic ?? "*"}:${input.status}:${now}`,
      payload: { channel: input.channel, basis, jurisdiction, source: input.source },
    }, db);
    return { ok: true };
  } catch (e) {
    console.error("[consent] recordConsent failed", e);
    return { ok: false, error: "Could not record consent" };
  }
}

export type SuppressionReason = "bounced_hard" | "complained" | "invalid" | "manual";

/** Suppresses an address (by blind-index hash) on a channel. Idempotent. */
export async function addSuppression(
  tenantId: string,
  p: { channel: "email" | "whatsapp" | "sms" | "phone"; addressHash: string; reason: SuppressionReason },
  client?: SupabaseClient,
): Promise<boolean> {
  try {
    if (!tenantId || !p.addressHash) return false;
    const db = client ?? createAdminSupabase();
    const { error } = await db.from("suppressions").upsert(
      { tenant_id: tenantId, channel: p.channel, address_hash: p.addressHash, reason: p.reason },
      { onConflict: "tenant_id,channel,address_hash", ignoreDuplicates: true },
    );
    if (error) {
      if (!isSchemaPending(error)) console.error(`[consent] suppression not recorded: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[consent] addSuppression failed", e);
    return false;
  }
}
