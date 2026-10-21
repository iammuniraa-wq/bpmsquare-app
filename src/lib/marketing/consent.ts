import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";
import { consentDefaultsOf } from "./config";
import { effectiveBasis, jurisdictionForCountry, type ConsentBasisSetting, type JurisdictionCode } from "./jurisdictions";
import { isSchemaPending } from "./pending";

// canContact() is the ONE gate every sender calls at the moment of sending
// (docs/marketing-platform-architecture.md 1.3): the campaign send route, the
// journey runner, the WhatsApp sender, the Growth agent. It decides from the
// ledger, never from a flag a caller passes in, and it loads the contact
// itself by id AND tenant, so a contact id from another tenant is simply "not
// found". It fails CLOSED: if it cannot read what it needs, the answer is no.
//
// Existing data keeps working: accounts.marketing_opt_out (0040), the flag the
// unsubscribe link sets today, is read as a legacy mirror and still refuses
// email. Nothing here changes that link or the campaign send route.

export const CONSENT_CHANNELS = ["email", "whatsapp", "sms", "phone", "web_tracking"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export type ContactReason =
  | "do_not_contact"
  | "suppressed"
  | "account_opted_out"
  | "withdrawn"
  | "no_consent"
  | "consented"
  | "existing_customer"
  | "contact_not_found"
  | "unavailable";

export type ContactDecision = {
  ok: boolean;
  reason: ContactReason;
  /** For a refusal by suppression: why the address is suppressed. */
  detail?: string;
};

export type ConsentStateRow = {
  topic: string; // '' = every topic
  /** "pending" never occurs in consent_state (0197 puts it in the append-only ledger only); it is tolerated and ignored. */
  status: "granted" | "withdrawn" | "pending";
  since: string;
};

export type DecideInput = {
  channel: ConsentChannel;
  /** A key from config.marketing.topics, or null for "not about any one topic". */
  topic: string | null;
  doNotContact: boolean;
  suppression: { reason: string } | null;
  /** The legacy accounts.marketing_opt_out flag. Applies to email only. */
  accountOptedOut: boolean;
  states: ConsentStateRow[];
  jurisdiction: JurisdictionCode;
  /** The tenant's choice for people with no ledger entry, per jurisdiction. */
  tenantDefaults: Partial<Record<JurisdictionCode, ConsentBasisSetting>>;
  isExistingCustomer: boolean;
};

/** The decision itself, pure. canContact() loads the inputs and calls this. */
export function decideContact(i: DecideInput): ContactDecision {
  if (i.doNotContact) return { ok: false, reason: "do_not_contact" };
  if (i.suppression) return { ok: false, reason: "suppressed", detail: i.suppression.reason };
  // A legacy opt-out wins over any grant: the flag carries no date, so there
  // is no way to know a grant is newer, and the safe reading is to refuse.
  if (i.channel === "email" && i.accountOptedOut) return { ok: false, reason: "account_opted_out" };

  const topic = i.topic ?? "";
  // A pending answer (double opt-in, not yet confirmed) is not an answer: it can neither grant nor cover an earlier real one.
  const applicable = i.states.filter((s) => s.status !== "pending" && (s.topic === "" || s.topic === topic));
  if (applicable.length > 0) {
    // The most recent answer wins; on a tie a withdrawal wins.
    const latest = [...applicable].sort((a, b) => {
      const d = Date.parse(b.since) - Date.parse(a.since);
      if (d !== 0) return d;
      return (a.status === "withdrawn" ? 0 : 1) - (b.status === "withdrawn" ? 0 : 1);
    })[0];
    return latest.status === "granted" ? { ok: true, reason: "consented" } : { ok: false, reason: "withdrawn" };
  }

  if (effectiveBasis(i.jurisdiction, i.tenantDefaults) === "existing_customer" && i.isExistingCustomer) {
    return { ok: true, reason: "existing_customer" };
  }
  return { ok: false, reason: "no_consent" };
}

/**
 * May this tenant contact this person on this channel about this topic, right
 * now? `client` is for tests; production uses the service-role client, so every
 * query below names the tenant.
 */
export async function canContact(
  tenantId: string,
  contactId: string,
  channel: ConsentChannel,
  topic: string | null,
  client?: SupabaseClient,
): Promise<ContactDecision> {
  try {
    if (!tenantId || !contactId || !CONSENT_CHANNELS.includes(channel)) return { ok: false, reason: "unavailable" };
    const db = client ?? createAdminSupabase();

    const { data: contact, error: cErr } = await db
      .from("contacts")
      .select("id, account_id, do_not_contact, email_hash, country")
      .eq("id", contactId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (cErr) return { ok: false, reason: "unavailable" };
    if (!contact) return { ok: false, reason: "contact_not_found" };

    const [{ data: account, error: aErr }, { data: tenant }] = await Promise.all([
      db.from("accounts").select("id, type, country, marketing_opt_out").eq("id", contact.account_id).eq("tenant_id", tenantId).maybeSingle(),
      db.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
    ]);
    if (aErr) return { ok: false, reason: "unavailable" };

    const { data: stateRows, error: sErr } = await db
      .from("consent_state")
      .select("topic, status, since")
      .eq("tenant_id", tenantId)
      .eq("contact_id", contactId)
      .eq("channel", channel);
    // A missing ledger (migration pending) reads as "no entries": strict by default.
    if (sErr && !isSchemaPending(sErr)) return { ok: false, reason: "unavailable" };

    let suppression: { reason: string } | null = null;
    const addressHash = (contact as { email_hash?: string | null }).email_hash;
    if (channel === "email" && addressHash) {
      const { data: sup, error: supErr } = await db
        .from("suppressions")
        .select("reason")
        .eq("tenant_id", tenantId)
        .eq("channel", "email")
        .eq("address_hash", addressHash)
        .maybeSingle();
      if (supErr && !isSchemaPending(supErr)) return { ok: false, reason: "unavailable" };
      suppression = (sup as { reason: string } | null) ?? null;
    }

    const country = (contact as { country?: string | null }).country || (account as { country?: string | null } | null)?.country;
    return decideContact({
      channel,
      topic,
      doNotContact: (contact as { do_not_contact?: boolean }).do_not_contact === true,
      suppression,
      accountOptedOut: (account as { marketing_opt_out?: boolean } | null)?.marketing_opt_out === true,
      states: ((stateRows ?? []) as ConsentStateRow[]).map((r) => ({ topic: r.topic ?? "", status: r.status, since: r.since })),
      jurisdiction: jurisdictionForCountry(country),
      tenantDefaults: consentDefaultsOf((tenant?.config ?? null) as Partial<TenantConfig> | null),
      isExistingCustomer: !!account && (account as { type?: string }).type !== "prospect",
    });
  } catch (e) {
    console.error("[consent] canContact failed closed", e);
    return { ok: false, reason: "unavailable" };
  }
}
