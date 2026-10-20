import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { AssetType } from "./models";

// The touches ledger is a READ MODEL of the domain_event stream: this file turns events into touches and
// nothing else writes marketing_touches. Reading is by a per-workspace keyset cursor (created_at, id), the same
// idea as the journey runner's, and a touch is unique on (source event, asset kind), so reading an event twice
// writes it once.

export type EventForTouch = {
  id: string;
  name: string;
  object_type: string | null;
  object_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  lead_id?: string | null;
  campaign_id: string | null;
  newsletter_id: string | null;
  occurred_at: string;
  created_at: string;
  payload: Record<string, unknown> | null;
};

export type TouchDraft = { asset_type: AssetType; asset_id: string; strength: "engaged" | "reached" };

/** The events that are touches. Each says what kind of thing touched the person and whether they DID something. */
export const TOUCH_EVENTS = [
  "email.clicked", "email.interest", "email.sent", "form.submitted", "journey.entered",
  "whatsapp.sent", "whatsapp.read", "whatsapp.replied", "event.registered", "event.attended",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

/** Pure. One event gives zero, one or two touches (an email click touches both the campaign and its newsletter). */
export function touchesFromEvent(ev: EventForTouch): TouchDraft[] {
  const out: TouchDraft[] = [];
  const p = ev.payload ?? {};
  // A dry run (the WhatsApp sandbox, a demo workspace) reached nobody.
  if (p.dry_run === true) return out;
  const push = (asset_type: AssetType, asset_id: string | null, strength: TouchDraft["strength"]) => { if (asset_id) out.push({ asset_type, asset_id, strength }); };
  switch (ev.name) {
    case "email.clicked":
    case "email.interest":
      push("campaign", id(ev.campaign_id), "engaged");
      push("newsletter", id(ev.newsletter_id), "engaged");
      break;
    case "email.sent":
      push("campaign", id(ev.campaign_id), "reached");
      push("newsletter", id(ev.newsletter_id), "reached");
      break;
    case "form.submitted":
      push("form", id(p.form_id) ?? id(ev.object_id), "engaged");
      break;
    case "journey.entered":
      push("journey", id(ev.object_id), "reached");
      break;
    case "whatsapp.sent":
      push("whatsapp", id(ev.object_id), "reached");
      break;
    case "whatsapp.read":
      push("whatsapp", id(ev.object_id), "engaged");
      break;
    case "whatsapp.replied":
      push("whatsapp", id(p.template_id), "engaged");
      break;
    case "event.registered":
    case "event.attended":
      push("event", id(ev.object_id), "engaged");
      break;
  }
  return out;
}

export type IngestResult = { read: number; written: number; done: boolean; missing: boolean; last: { created_at: string; id: string } | null };

const BATCH = 1000;

/**
 * Reads the next slice of events after `after` and writes their touches. The caller owns the cursor and the lock.
 * Every query names the tenant; a person is the event's contact and company, and a contact-only event is given its
 * company from the contact (looked up in this tenant only).
 */
export async function ingestTouches(admin: SupabaseClient, tenantId: string, after: { created_at: string; id: string } | null, limit = BATCH): Promise<IngestResult> {
  let q = admin.from("domain_event")
    .select("id, name, object_type, object_id, contact_id, account_id, lead_id, campaign_id, newsletter_id, occurred_at, created_at, payload")
    .eq("tenant_id", tenantId).in("name", [...TOUCH_EVENTS])
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
  if (after) q = q.gte("created_at", after.created_at);
  const { data, error } = await q;
  if (error) return { read: 0, written: 0, done: true, missing: isSchemaPending(error), last: null };

  // Compared as instants (the database writes "+00:00", code writes "Z"), and strictly after the cursor.
  const c = after ? Date.parse(after.created_at) : -Infinity;
  const events = ((data ?? []) as EventForTouch[]).filter((e) => {
    if (!after) return true;
    const t = Date.parse(e.created_at);
    return t > c || (t === c && e.id > after.id);
  });
  if (events.length === 0) return { read: 0, written: 0, done: true, missing: false, last: null };

  const needAccount = [...new Set(events.filter((e) => !e.account_id && e.contact_id).map((e) => e.contact_id as string))];
  const accountOf = new Map<string, string>();
  if (needAccount.length) {
    const { data: cs } = await admin.from("contacts").select("id, account_id").eq("tenant_id", tenantId).in("id", needAccount);
    for (const r of (cs ?? []) as { id: string; account_id: string }[]) accountOf.set(r.id, r.account_id);
  }

  const rows: Record<string, unknown>[] = [];
  for (const ev of events) {
    const accountId = ev.account_id ?? (ev.contact_id ? accountOf.get(ev.contact_id) ?? null : null);
    if (!accountId) continue;
    for (const t of touchesFromEvent(ev)) {
      rows.push({
        tenant_id: tenantId, source_event_id: ev.id, asset_type: t.asset_type, asset_id: t.asset_id, strength: t.strength,
        account_id: accountId, contact_id: ev.contact_id, lead_id: ev.lead_id ?? null, occurred_at: ev.occurred_at,
      });
    }
  }
  let written = 0;
  if (rows.length) {
    const { error: wErr } = await admin.from("marketing_touches").upsert(rows, { onConflict: "tenant_id,source_event_id,asset_type", ignoreDuplicates: true });
    if (wErr) return { read: events.length, written: 0, done: true, missing: isSchemaPending(wErr), last: null };
    written = rows.length;
  }
  const lastEv = events[events.length - 1];
  return { read: events.length, written, done: events.length < limit, missing: false, last: { created_at: lastEv.created_at, id: lastEv.id } };
}
