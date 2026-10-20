import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { topicsOf } from "../config";
import { recordConsent } from "../consentWrite";
import { isSchemaPending } from "../pending";
import { cleanText } from "./sanitize";

// The preference centre (docs/marketing-platform-architecture.md 5.5): the person's own view
// of the consent ledger. Reached by a signed per-contact link; the link proves we issued it,
// and the tenant is then the CONTACT ROW's own tenant - never anything in the URL or body.
// A page load changes nothing (mail scanners open links); only a POST does, and every change
// goes through recordConsent() as a new ledger row with source "preference_centre".

export type StateRow = { topic: string; status: "granted" | "withdrawn"; since: string };

/**
 * Is this person subscribed to this topic right now? The latest answer that applies to the
 * topic wins (a row for every topic counts too); on a tie a withdrawal wins. No answer = off.
 * Same rule as decideContact() in consent.ts, without the basis fallbacks: this page shows
 * what the person chose, not what the workspace may assume.
 */
export function topicOn(states: StateRow[], topic: string): boolean {
  const applicable = states.filter((s) => s.topic === "" || s.topic === topic);
  if (applicable.length === 0) return false;
  const latest = [...applicable].sort((a, b) => {
    const d = Date.parse(b.since) - Date.parse(a.since);
    if (d !== 0) return d;
    return (a.status === "withdrawn" ? 0 : 1) - (b.status === "withdrawn" ? 0 : 1);
  })[0];
  return latest.status === "granted";
}

export type PreferenceView = {
  brand: { name: string; logoUrl: string | null };
  firstName: string;
  topics: { key: string; label: string; hint: string; on: boolean }[];
  /** Why the switches cannot be turned on from this page, if they cannot. */
  blocked: null | "do_not_contact" | "opted_out";
  history: { when: string; text: string }[];
};

type Loaded = { tenantId: string; contactId: string; accountId: string; view: PreferenceView };

const WORDS: Record<string, string> = { granted: "Agreed to", withdrawn: "Stopped" };

export async function loadPreferences(admin: SupabaseClient, contactId: string): Promise<Loaded | null> {
  let c = await admin.from("contacts").select("id, tenant_id, account_id, name, do_not_contact").eq("id", contactId).maybeSingle();
  if (c.error && isSchemaPending(c.error)) c = await admin.from("contacts").select("id, tenant_id, account_id, name").eq("id", contactId).maybeSingle();
  if (c.error || !c.data) return null;
  const contact = c.data as { id: string; tenant_id: string; account_id: string; name: string | null; do_not_contact?: boolean };
  const tenantId = contact.tenant_id;

  const { data: t } = await admin.from("tenants").select("name, logo_url, features, config").eq("id", tenantId).maybeSingle();
  const tenant = t as { name: string; logo_url: string | null; features: Partial<TenantFeatures> | null; config: Partial<TenantConfig> | null } | null;
  if (!tenant || tenant.features?.marketing !== true || tenant.features?.marketing_forms !== true) return null;

  const [{ data: acct }, { data: st, error: stErr }, { data: ev }] = await Promise.all([
    admin.from("accounts").select("marketing_opt_out").eq("id", contact.account_id).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("consent_state").select("topic, status, since").eq("tenant_id", tenantId).eq("contact_id", contactId).eq("channel", "email"),
    admin.from("consent_events").select("topic, status, created_at").eq("tenant_id", tenantId).eq("contact_id", contactId).eq("channel", "email").order("created_at", { ascending: false }).limit(6),
  ]);
  // A ledger that is not there yet (migration pending) means there is nothing to show or to change.
  if (stErr && isSchemaPending(stErr)) return null;

  const states = ((st ?? []) as { topic: string | null; status: "granted" | "withdrawn"; since: string }[]).map((r) => ({ topic: r.topic ?? "", status: r.status, since: r.since }));
  const topicList = topicsOf(tenant.config);
  const label = new Map(topicList.map((x) => [x.key, x.label]));
  const blocked: PreferenceView["blocked"] = contact.do_not_contact === true ? "do_not_contact" : (acct as { marketing_opt_out?: boolean } | null)?.marketing_opt_out === true ? "opted_out" : null;

  return {
    tenantId, contactId, accountId: contact.account_id,
    view: {
      brand: { name: tenant.name, logoUrl: tenant.logo_url },
      firstName: cleanText(contact.name ?? "", 60).split(" ")[0] ?? "",
      topics: topicList.map((x) => ({ key: x.key, label: x.label, hint: x.hint ?? "", on: blocked ? false : topicOn(states, x.key) })),
      blocked,
      history: ((ev ?? []) as { topic: string | null; status: string; created_at: string }[]).map((r) => ({
        when: r.created_at,
        text: `${WORDS[r.status] ?? r.status} ${r.topic ? (label.get(r.topic) ?? r.topic) : "all topics"}`,
      })),
    },
  };
}

export type PreferenceChange = { topic: string | null; on: boolean };

export type ApplyResult = { ok: true; changed: number } | { ok: false; status: number; error: string };

export function parseChanges(body: unknown): PreferenceChange[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).changes;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null;
  const out: PreferenceChange[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    if (typeof o.on !== "boolean") return null;
    if (o.topic !== null && typeof o.topic !== "string") return null;
    out.push({ topic: (o.topic as string | null) ?? null, on: o.on });
  }
  return out;
}

export async function applyPreferenceChanges(
  admin: SupabaseClient, loaded: Loaded, changes: PreferenceChange[], meta: { ipHash: string | null; uaFamily: string },
): Promise<ApplyResult> {
  const { tenantId, contactId, accountId, view } = loaded;
  const known = new Map(view.topics.map((x) => [x.key, x.on]));
  let changed = 0;
  let withdrewAll = false;

  for (const ch of changes) {
    if (ch.topic !== null && !known.has(ch.topic)) return { ok: false, status: 422, error: "Unknown topic" };
    // A person who asked to hear nothing, or whom the team marked do-not-contact, cannot be switched back on from a link.
    if (ch.on && view.blocked) return { ok: false, status: 403, error: "Please contact us to start receiving emails again." };
    const currentlyOn = ch.topic === null ? [...known.values()].some(Boolean) : known.get(ch.topic) === true;
    // "Unsubscribe from all" is always recorded, even if nothing is on, so it outranks any older grant.
    if (ch.on === currentlyOn && ch.topic !== null) continue;
    if (ch.topic === null && ch.on) return { ok: false, status: 422, error: "Choose the topics you want" };

    const r = await recordConsent(tenantId, {
      contactId, channel: "email", topic: ch.topic, status: ch.on ? "granted" : "withdrawn", basis: "consent", source: "preference_centre",
      evidence: { via: "preference_centre", ip_hash: meta.ipHash, ua_family: meta.uaFamily },
    }, admin);
    if (!r.ok) return { ok: false, status: r.pending ? 503 : 500, error: "We could not save that. Please try again." };
    changed++;
    if (ch.topic === null && !ch.on) withdrewAll = true;
  }

  if (withdrewAll) {
    await mirrorLegacyOptOut(admin, tenantId, accountId);
    await emitEvent(tenantId, {
      name: EVENTS.EMAIL_UNSUBSCRIBED, object_type: "contact", object_id: contactId, source: "public_link", contact_id: contactId, account_id: accountId,
      key: `${contactId}:pref:${new Date().toISOString().slice(0, 16)}`, payload: { via: "preference_centre" },
    }, admin);
  }
  return { ok: true, changed };
}

/**
 * accounts.marketing_opt_out is the legacy flag today's campaign send still reads. The design keeps it as a
 * mirror: set it when every contact of the account has withdrawn from all topics by email, so a legacy send
 * honours what the person just did.
 */
export async function mirrorLegacyOptOut(admin: SupabaseClient, tenantId: string, accountId: string): Promise<void> {
  try {
    const { data: contacts } = await admin.from("contacts").select("id").eq("tenant_id", tenantId).eq("account_id", accountId);
    const ids = ((contacts ?? []) as { id: string }[]).map((x) => x.id);
    if (ids.length === 0) return;
    const { data: states } = await admin
      .from("consent_state").select("contact_id, topic, status").eq("tenant_id", tenantId).eq("channel", "email").in("contact_id", ids);
    const out = new Set(((states ?? []) as { contact_id: string; topic: string | null; status: string }[])
      .filter((s) => (s.topic ?? "") === "" && s.status === "withdrawn").map((s) => s.contact_id));
    if (ids.every((id) => out.has(id))) {
      await admin.from("accounts").update({ marketing_opt_out: true }).eq("id", accountId).eq("tenant_id", tenantId);
    }
  } catch (e) {
    console.error("[forms] legacy opt-out mirror failed", e);
  }
}
