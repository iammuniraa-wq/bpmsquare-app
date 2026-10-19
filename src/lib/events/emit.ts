import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { isSchemaPending } from "@/lib/marketing/pending";
import { EVENT_SOURCES, isKnownEvent, type EventName, type EventSource } from "./catalog";

// The one writer of domain_event (0137). The table has select-only RLS, so
// this runs on the service-role client, from server code, after the write
// that caused the event has already succeeded. It must never break the route
// that calls it: every failure is swallowed (and a missing table is silent).

export type EmitInput = {
  name: EventName;
  object_type: string;
  object_id?: string | null;
  actor_id?: string | null;
  source?: EventSource;
  // Who it is about, so scoring can aggregate per person and per company.
  contact_id?: string | null;
  account_id?: string | null;
  lead_id?: string | null;
  visitor_id?: string | null;
  // Common fields shared by every email event (Newsletter Studio 12.1).
  campaign_id?: string | null;
  newsletter_id?: string | null;
  newsletter_version_id?: string | null;
  lang?: string | null;
  topic?: string | null;
  /** For a recipient who is not a contact. Already a hash, never an address. */
  email_hash?: string | null;
  /** A summary of what happened. Ids and numbers, never PII: this table feeds scores and webhooks. */
  payload?: Record<string, unknown>;
  /** Loop guard: an action run by a rule or journey emits with depth + 1. */
  depth?: number;
  /** When it happened, if different from now (provider webhooks arrive late). */
  occurred_at?: string;
  /**
   * What makes this occurrence unique, e.g. "<id>:<from>-><to>". A retry of the
   * same request passes the same key and records nothing twice. Without one the
   * key falls back to the minute the event occurred in.
   */
  key?: string;
};

const MAX_PAYLOAD_CHARS = 16_000;

export function eventDedupeKey(ev: Pick<EmitInput, "name" | "object_type" | "object_id" | "key" | "occurred_at">): string {
  const discriminator = ev.key ?? (ev.occurred_at ?? new Date().toISOString()).slice(0, 16);
  return [ev.name, ev.object_type, ev.object_id ?? "-", discriminator].join("|");
}

export function buildEventRow(tenantId: string, ev: EmitInput): Record<string, unknown> {
  let payload: Record<string, unknown> = ev.payload ?? {};
  try {
    if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) payload = { truncated: true };
  } catch {
    payload = { truncated: true };
  }
  const source = ev.source && EVENT_SOURCES.includes(ev.source) ? ev.source : "app";
  return {
    tenant_id: tenantId,
    name: ev.name,
    object_type: ev.object_type,
    object_id: ev.object_id ?? null,
    actor_id: ev.actor_id ?? null,
    source,
    contact_id: ev.contact_id ?? null,
    account_id: ev.account_id ?? null,
    lead_id: ev.lead_id ?? null,
    visitor_id: ev.visitor_id ?? null,
    campaign_id: ev.campaign_id ?? null,
    newsletter_id: ev.newsletter_id ?? null,
    newsletter_version_id: ev.newsletter_version_id ?? null,
    lang: ev.lang ?? null,
    topic: ev.topic ?? null,
    email_hash: ev.email_hash ?? null,
    payload,
    depth: Math.max(0, Math.floor(ev.depth ?? 0)),
    ...(ev.occurred_at ? { occurred_at: ev.occurred_at } : {}),
    dedupe_key: eventDedupeKey(ev),
  };
}

/**
 * Records one event for a tenant. Returns true when the write was attempted
 * and accepted (a duplicate key counts: it is already recorded), false when
 * it was refused or failed. Never throws.
 */
export async function emitEvent(tenantId: string, ev: EmitInput, client?: SupabaseClient): Promise<boolean> {
  try {
    if (!tenantId) return false;
    if (!isKnownEvent(ev.name)) {
      console.error(`[events] refused unknown event name "${String(ev.name)}"`);
      return false;
    }
    const admin = client ?? createAdminSupabase();
    // ignoreDuplicates: ON CONFLICT DO NOTHING on the natural key, so a
    // retried request cannot emit twice.
    const { error } = await admin
      .from("domain_event")
      .upsert(buildEventRow(tenantId, ev), { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true });
    if (error) {
      if (!isSchemaPending(error)) console.error(`[events] ${ev.name} not recorded: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[events] ${ev?.name ?? "event"} not recorded`, e);
    return false;
  }
}
