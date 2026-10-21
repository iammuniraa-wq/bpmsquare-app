import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { topicsOf } from "../config";
import { recordConsent } from "../consentWrite";
import { isSchemaPending } from "../pending";
import { cleanText } from "./sanitize";

// Double opt-in, step two: the person opens the link in the thank-you email and presses the button.
// Only a POST changes anything (mail scanners open links). Everything is keyed on ONE contact; the
// tenant is that contact row's own, and every query below names it, so a link made for a contact of
// workspace A can never touch a row of workspace B (the token binds the contact id, and the contact
// id binds the tenant).

export type LedgerRow = { id: string; topic: string | null; status: string; created_at: string; evidence?: Record<string, unknown> | null };

/**
 * The pending answers still waiting: the newest pending row per topic, unless a later granted or
 * withdrawn answer for the same topic (or for all topics) has closed it. A person who unsubscribed
 * after ticking the box is not switched back on by an old link.
 */
export function openPending(rows: LedgerRow[]): LedgerRow[] {
  const answers = rows.filter((r) => r.status === "granted" || r.status === "withdrawn");
  const newestPerTopic = new Map<string, LedgerRow>();
  for (const r of rows.filter((x) => x.status === "pending")) {
    const key = r.topic ?? "";
    const seen = newestPerTopic.get(key);
    if (!seen || r.created_at > seen.created_at) newestPerTopic.set(key, r);
  }
  return [...newestPerTopic.values()].filter((p) => !answers.some((a) => a.created_at > p.created_at && (a.topic === null || a.topic === p.topic)));
}

export type ConfirmView = {
  tenantId: string;
  contactId: string;
  brand: { name: string; logoUrl: string | null };
  firstName: string;
  /** The topic names waiting for the person's yes; empty when nothing is waiting. */
  waiting: string[];
  /** True when nothing is waiting and the person has already said yes to something. */
  alreadyConfirmed: boolean;
};

type ContactRow = { id: string; tenant_id: string; name: string | null };

async function loadContactAndTenant(admin: SupabaseClient, contactId: string) {
  const { data: c, error } = await admin.from("contacts").select("id, tenant_id, name").eq("id", contactId).maybeSingle();
  if (error || !c) return null;
  const contact = c as ContactRow;
  const { data: t } = await admin.from("tenants").select("name, logo_url, features, config").eq("id", contact.tenant_id).maybeSingle();
  const tenant = t as { name: string; logo_url: string | null; features: Partial<TenantFeatures> | null; config: Partial<TenantConfig> | null } | null;
  if (!tenant || tenant.features?.marketing !== true || tenant.features?.marketing_forms !== true) return null;
  return { contact, tenant };
}

async function loadLedger(admin: SupabaseClient, tenantId: string, contactId: string, since: string): Promise<LedgerRow[] | null> {
  const { data, error } = await admin
    .from("consent_events").select("id, topic, status, created_at, evidence")
    .eq("tenant_id", tenantId).eq("contact_id", contactId).eq("channel", "email")
    .in("status", ["pending", "granted", "withdrawn"]).gte("created_at", since).limit(200);
  if (error) {
    if (!isSchemaPending(error)) console.error(`[forms] confirm ledger not read: ${error.message}`);
    return null;
  }
  return (data ?? []) as LedgerRow[];
}

/** What the confirm page shows. Null = the link leads nowhere (unknown contact, flag off, ledger missing). */
export async function loadConfirmView(admin: SupabaseClient, contactId: string, windowStart: string): Promise<ConfirmView | null> {
  const base = await loadContactAndTenant(admin, contactId);
  if (!base) return null;
  const { contact, tenant } = base;
  const ledger = await loadLedger(admin, contact.tenant_id, contactId, windowStart);
  if (!ledger) return null;
  const label = new Map(topicsOf(tenant.config).map((t) => [t.key, t.label]));
  const waiting = openPending(ledger).map((p) => (p.topic ? (label.get(p.topic) ?? p.topic) : "Everything we send"));
  return {
    tenantId: contact.tenant_id, contactId,
    brand: { name: tenant.name, logoUrl: tenant.logo_url },
    firstName: cleanText(contact.name ?? "", 60).split(" ")[0] ?? "",
    waiting,
    alreadyConfirmed: waiting.length === 0 && ledger.some((r) => r.status === "granted"),
  };
}

export type ConfirmResult = { ok: true; confirmed: number } | { ok: false; status: number; error: string };

export async function confirmPendingConsent(
  admin: SupabaseClient, tenantId: string, contactId: string, windowStart: string, meta: { ipHash: string | null; uaFamily: string },
): Promise<ConfirmResult> {
  const { data: contact, error: cErr } = await admin.from("contacts").select("id, account_id").eq("id", contactId).eq("tenant_id", tenantId).maybeSingle();
  if (cErr) return { ok: false, status: 500, error: "We could not save that. Please try again." };
  if (!contact) return { ok: false, status: 404, error: "This link is not valid." };

  const ledger = await loadLedger(admin, tenantId, contactId, windowStart);
  if (!ledger) return { ok: false, status: 503, error: "We could not save that. Please try again." };

  let confirmed = 0;
  for (const p of openPending(ledger)) {
    const prior = (p.evidence ?? {}) as Record<string, unknown>;
    const r = await recordConsent(tenantId, {
      contactId, channel: "email", topic: p.topic, status: "granted", basis: "consent", source: "form",
      evidence: {
        via: "double_opt_in", confirmed_pending_event: p.id, pending_since: p.created_at,
        form_id: prior.form_id ?? null, form_ref: prior.form_ref ?? null, text: prior.text ?? null,
        ip_hash: meta.ipHash, ua_family: meta.uaFamily,
      },
    }, admin);
    if (!r.ok) {
      console.error(`[forms] confirmation not recorded: ${r.error}`);
      return { ok: false, status: r.pending ? 503 : 500, error: "We could not save that. Please try again." };
    }
    confirmed++;
    await emitEvent(tenantId, {
      name: EVENTS.CONSENT_CONFIRMED, object_type: "contact", object_id: contactId, source: "public_link",
      contact_id: contactId, account_id: (contact as { account_id: string }).account_id, topic: p.topic,
      key: `${contactId}:${p.topic ?? "*"}:confirmed:${p.id}`, payload: { channel: "email", form_id: prior.form_id ?? null },
    }, admin);
  }
  return { ok: true, confirmed };
}
