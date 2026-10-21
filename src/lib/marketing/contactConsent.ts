import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChangeEntry } from "@/lib/changeLog";
import type { TenantConfig } from "@/lib/constants";
import { consentDefaultsOf, topicsOf } from "./config";
import { recordConsent } from "./consentWrite";
import { JURISDICTION_RULES, jurisdictionForCountry, type JurisdictionCode } from "./jurisdictions";
import { isSchemaPending } from "./pending";
import { checkStaffConsent, offeredBases, type StaffBasis, type StaffConsentContext } from "./staffConsent";
import { openPending } from "./forms/confirm";
import { CONFIRM_DAYS } from "./forms/confirmToken";

// The contact's Consent card: what this person has agreed to, per channel and topic,
// and the two things a person in sales can do -- record that they agreed, or that
// they withdrew. Both only APPEND to the ledger (consent_events) through recordConsent;
// nothing here edits or deletes history.

export type ConsentRow = {
  channel: string;
  /** '' = every topic. */
  topic: string;
  status: "granted" | "withdrawn";
  since: string;
  basis: string;
  source: string | null;
  note: string | null;
};

export type ConsentHistoryRow = {
  channel: string; topic: string | null; status: "granted" | "withdrawn" | "pending"; basis: string; source: string; note: string | null; at: string;
};

/** A yes the person was asked to confirm by email (double opt-in). "expired" = the seven days passed without it. */
export type WaitingConsent = { channel: string; topic: string; since: string; expired: boolean };

export type ContactConsent = {
  /** False while the consent ledger (0139) is pending. */
  available: boolean;
  rows: ConsentRow[];
  /** Answers waiting for the person to confirm by email. Never counted as a yes. */
  waiting?: WaitingConsent[];
  history: ConsentHistoryRow[];
  topics: { key: string; label: string }[];
  bases: StaffBasis[];
  jurisdiction: JurisdictionCode;
  jurisdictionLabel: string;
};

const UNAVAILABLE: ContactConsent = { available: false, rows: [], waiting: [], history: [], topics: [], bases: ["consent"], jurisdiction: "other", jurisdictionLabel: "" };

type Loaded = { ctx: StaffConsentContext; config: Partial<TenantConfig> | null; accountId: string; contactName: string | null };

async function loadContext(admin: SupabaseClient, tenantId: string, contactId: string): Promise<Loaded | null | "error"> {
  const { data: contact, error } = await admin.from("contacts").select("id, name, account_id, country").eq("id", contactId).eq("tenant_id", tenantId).maybeSingle();
  if (error) return "error";
  if (!contact) return null;
  const c = contact as { name: string | null; account_id: string; country: string | null };
  const [{ data: account }, { data: tenant }] = await Promise.all([
    admin.from("accounts").select("country, type").eq("id", c.account_id).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
  ]);
  const a = account as { country?: string | null; type?: string } | null;
  const config = ((tenant as { config?: unknown } | null)?.config ?? null) as Partial<TenantConfig> | null;
  return {
    accountId: c.account_id, contactName: c.name, config,
    ctx: {
      jurisdiction: jurisdictionForCountry(c.country || a?.country),
      tenantDefaults: consentDefaultsOf(config),
      isExistingCustomer: !!a && a.type !== "prospect",
    },
  };
}

export async function loadContactConsent(admin: SupabaseClient, tenantId: string, contactId: string): Promise<ContactConsent> {
  try {
    const loaded = await loadContext(admin, tenantId, contactId);
    if (loaded === "error" || !loaded) return loaded === null ? { ...UNAVAILABLE, available: true } : UNAVAILABLE;

    const { data: states, error: sErr } = await admin.from("consent_state")
      .select("channel, topic, status, since, basis").eq("tenant_id", tenantId).eq("contact_id", contactId);
    if (sErr) return isSchemaPending(sErr) ? UNAVAILABLE : { ...UNAVAILABLE, available: true };

    const { data: events } = await admin.from("consent_events")
      .select("id, channel, topic, status, basis, source, evidence, created_at")
      .eq("tenant_id", tenantId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(60);
    const rawEvents = (events ?? []) as { id: string; channel: string; topic: string | null; status: "granted" | "withdrawn" | "pending"; basis: string; source: string; evidence: { note?: unknown } | null; created_at: string }[];
    const waiting: WaitingConsent[] = openPending(rawEvents.filter((e) => e.channel === "email"))
      .map((p) => ({ channel: "email", topic: p.topic ?? "", since: p.created_at, expired: Date.now() - Date.parse(p.created_at) > CONFIRM_DAYS * 86_400_000 }));
    const evs = rawEvents
      .map((e): ConsentHistoryRow => ({ channel: e.channel, topic: e.topic, status: e.status, basis: e.basis, source: e.source, note: typeof e.evidence?.note === "string" ? e.evidence.note : null, at: e.created_at }));

    const rows = ((states ?? []) as { channel: string; topic: string; status: "granted" | "withdrawn"; since: string; basis: string }[]).map((s): ConsentRow => {
      const latest = evs.find((e) => e.channel === s.channel && (e.topic ?? "") === s.topic && e.status !== "pending");
      return { ...s, source: latest?.source ?? null, note: latest?.note ?? null };
    }).sort((a, b) => a.channel.localeCompare(b.channel) || a.topic.localeCompare(b.topic));

    return {
      available: true, rows, waiting, history: evs.slice(0, 15),
      topics: topicsOf(loaded.config).map((t) => ({ key: t.key, label: t.label })),
      bases: offeredBases(loaded.ctx),
      jurisdiction: loaded.ctx.jurisdiction,
      jurisdictionLabel: JURISDICTION_RULES[loaded.ctx.jurisdiction].label,
    };
  } catch (e) {
    console.error("[consent card] could not load", e);
    return UNAVAILABLE;
  }
}

export type RecordByStaffInput = { channel: string; topic: string | null; status: string; basis?: string | null; note: string };
export type RecordByStaffResult =
  | { ok: true; label: string | null; changes: ChangeEntry[] }
  | { ok: false; status: number; error: string; pending?: boolean };

export async function recordConsentByStaff(
  admin: SupabaseClient, tenantId: string, userId: string, contactId: string, input: RecordByStaffInput,
): Promise<RecordByStaffResult> {
  const loaded = await loadContext(admin, tenantId, contactId);
  if (loaded === "error") return { ok: false, status: 500, error: "Could not read this contact." };
  if (!loaded) return { ok: false, status: 404, error: "Contact not found" };

  const checked = checkStaffConsent(input, loaded.ctx);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };

  const topic = typeof input.topic === "string" && input.topic !== "" ? input.topic : null;
  if (topic !== null && !topicsOf(loaded.config).some((t) => t.key === topic)) return { ok: false, status: 400, error: "That topic isn't one of your workspace's topics." };

  const res = await recordConsent(tenantId, {
    contactId, channel: checked.channel, topic, status: checked.status, basis: checked.basis, source: "rep",
    evidence: { note: checked.note, rep_user_id: userId, via: "contact_card" },
    actorId: userId,
  }, admin);
  if (!res.ok) {
    return res.pending
      ? { ok: false, status: 503, error: "Consent recording is waiting for a database update.", pending: true }
      : { ok: false, status: 400, error: res.error };
  }

  const topicLabel = topic === null ? "all topics" : (topicsOf(loaded.config).find((t) => t.key === topic)?.label ?? topic);
  return {
    ok: true, label: loaded.contactName,
    changes: [{
      field: `Consent: ${checked.channel}, ${topicLabel}`,
      from: null,
      to: `${checked.status === "granted" ? "Agreed" : "Withdrawn"} (${checked.note})`,
    }],
  };
}
