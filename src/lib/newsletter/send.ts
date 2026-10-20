import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import { canContact, type ContactDecision } from "@/lib/marketing/consent";
import { contactsForEmails, eventIdentity } from "@/lib/marketing/recipientLookup";
import { isSchemaPending } from "@/lib/marketing/pending";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { emitCampaignSent } from "@/lib/events/emitters";
import { logEmail } from "@/lib/emailLog";
import { resolveOutbound, type EmailOutput } from "@/lib/emailOutputRules";
import { signUnsubscribeToken } from "@/lib/marketingUnsubscribe";
import { signCampaignInterestToken } from "@/lib/campaignInterestLink";
import { signPreferenceToken } from "@/lib/marketing/forms/preferenceToken";
import { ROUTES } from "@/lib/constants";
import type { MarketingRecipientCandidate } from "@/lib/data/live";
import { RECIPIENT_TAG } from "@/lib/marketing/resendEvents";
import { resolveRecipientLanguage } from "./language";
import { signClickToken, signOpenToken } from "./linkTokens";
import { fillTokens, type TokenValues } from "./tokens";
import { sendableLanguages, type StoredVersion } from "./server";

// The newsletter branch of the campaign send (docs/newsletter-studio-architecture.md
// section 7). It is the SAME send path as every other campaign -- the Resend client,
// the from address, email_log, the interest and unsubscribe links, the 200 ms pacing
// and the 60 second ceiling are unchanged -- with four additions, in this order for
// every recipient:
//   1. the recipient is resolved to a CONTACT (consent belongs to a person);
//   2. canContact(tenant, contact, "email", topic) -- the one consent gate;
//   3. one language is chosen (contact, then account, then the campaign's fallback);
//   4. resolveOutbound() -- a demo workspace is redirect-only, always.
// A refusal at any step is recorded as a skipped recipient and an email.skipped
// event with its reason; it never silently drops a person.

export type CampaignRow = {
  id: string; name: string; topic: string | null; languages: string[] | null; fallback_language: string | null;
  newsletter_version_id: string | null;
};

type ResendLike = { emails: { send: (m: Record<string, unknown>) => Promise<{ data?: { id?: string } | null; error?: { message: string } | null }> } };

export type SendInput = {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
  userId: string | null;
  userEmail: string | null;
  campaign: CampaignRow;
  version: StoredVersion;
  candidates: MarketingRecipientCandidate[];
  resend: ResendLike;
  output: EmailOutput;
  companyName: string;
  replyTo?: string;
  fromAddress: string;
  absoluteUrl: (path: string) => Promise<string>;
  /** The workspace has the preference centre (features.marketing_forms): "Manage preferences" opens it. Without it, the unsubscribe page. */
  preferencesEnabled?: boolean;
  /** Injected in tests; production uses the real gate. */
  gate?: (tenantId: string, contactId: string, topic: string | null) => Promise<ContactDecision>;
  delayMs?: number;
};

export type SendResult = { sent: number; failed: number; skipped: number; byLanguage: Record<string, number> };

type DbRes = { data: unknown; error: { code?: string; message?: string } | null };
type ContactRow = { id: string; account_id: string; email: string | null; preferred_language?: string | null; name?: string | null; created_at?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (e: string | null | undefined): string => (e ?? "").trim().toLowerCase();
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** The contacts of these accounts, newest columns first and tolerant of a pending migration (preferred_language). */
async function contactsOfAccounts(admin: SupabaseClient, tenantId: string, accountIds: string[]): Promise<ContactRow[]> {
  const out: ContactRow[] = [];
  for (const ids of chunk(accountIds, 150)) {
    let res: DbRes = await admin.from("contacts").select("id, account_id, name, email, preferred_language, created_at").eq("tenant_id", tenantId).in("account_id", ids);
    if (res.error && isSchemaPending(res.error)) res = await admin.from("contacts").select("id, account_id, name, email, created_at").eq("tenant_id", tenantId).in("account_id", ids);
    out.push(...((res.data ?? []) as unknown as ContactRow[]));
  }
  return out;
}

/** Remembers the provider's message id (0144), on its own so a pending migration cannot fail the sent update above. */
async function rememberProviderId(supabase: SupabaseClient, tenantId: string, rid: string, resendId: string | null): Promise<void> {
  if (!resendId) return;
  const { error } = await supabase.from("marketing_campaign_recipients").update({ resend_id: resendId }).eq("id", rid).eq("tenant_id", tenantId);
  if (error && !isSchemaPending(error)) console.error(`[newsletter send] provider id not stored: ${error.message}`);
}

async function accountLanguages(admin: SupabaseClient, tenantId: string, accountIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const ids of chunk(accountIds, 150)) {
    const res = await admin.from("accounts").select("id, preferred_language").eq("tenant_id", tenantId).in("id", ids);
    if (res.error) continue; // 0143 pending: nobody has an account language yet
    for (const r of (res.data ?? []) as { id: string; preferred_language: string | null }[]) map.set(r.id, r.preferred_language);
  }
  return map;
}

export async function sendNewsletterCampaign(d: SendInput): Promise<SendResult> {
  const { tenantId, campaign, version } = d;
  const ready = new Set(sendableLanguages(version));
  const included = (campaign.languages ?? []).filter((l) => ready.has(l) && typeof version.html[l] === "string");
  const result: SendResult = { sent: 0, failed: 0, skipped: 0, byLanguage: {} };
  const gate = d.gate ?? ((t: string, c: string, topic: string | null) => canContact(t, c, "email", topic, d.admin));
  const delay = d.delayMs ?? 200;

  // Who each candidate is, found once for the whole audience rather than one query per person.
  const accountIds = [...new Set(d.candidates.map((c) => c.account_id).filter((x): x is string => !!x))];
  const [accountContacts, accountLangs] = await Promise.all([contactsOfAccounts(d.admin, tenantId, accountIds), accountLanguages(d.admin, tenantId, accountIds)]);
  const byAccount = new Map<string, ContactRow[]>();
  for (const c of accountContacts) byAccount.set(c.account_id, [...(byAccount.get(c.account_id) ?? []), c]);
  for (const list of byAccount.values()) list.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  const { contactByEmail, hashByEmail } = await contactsForEmails(d.admin, tenantId, d.candidates.flatMap((c) => (c.manual_email ? [c.manual_email] : [])));

  const common = (rid: string | null, contact: ContactRow | null, lang: string | null, candidate: MarketingRecipientCandidate) => ({
    object_type: "marketing_campaign", object_id: campaign.id, actor_id: d.userId, source: "app" as const,
    contact_id: contact?.id ?? null, account_id: contact?.account_id ?? candidate.account_id ?? null,
    campaign_id: campaign.id, newsletter_id: version.newsletter_id, newsletter_version_id: version.id, lang, topic: campaign.topic,
    ...eventIdentity(contact ? null : candidate.manual_email ? hashByEmail.get(norm(candidate.manual_email)) : null),
    key: rid ?? undefined,
  });

  const skip = async (candidate: MarketingRecipientCandidate, status: string, reason: string, contact: ContactRow | null, lang: string | null) => {
    const { data } = await d.supabase.from("marketing_campaign_recipients").insert({
      tenant_id: tenantId, campaign_id: campaign.id, account_id: candidate.account_id, manual_email: candidate.manual_email,
      email: candidate.email, status, error: reason, contact_id: contact?.id ?? null, lang,
    }).select("id").single();
    const rid = (data as { id?: string } | null)?.id ?? null;
    await emitEvent(tenantId, { name: EVENTS.EMAIL_SKIPPED, ...common(rid ? `${rid}:skipped` : null, contact, lang, candidate), payload: { reason } }, d.admin);
    result.skipped++;
  };

  for (const candidate of d.candidates) {
    if (candidate.marketing_opt_out) { await skip(candidate, "skipped_opt_out", "account_opted_out", null, null); continue; }
    if (!candidate.email) { await skip(candidate, "skipped_no_email", "no_email", null, null); continue; }

    // 1. the person
    const email = norm(candidate.email);
    let contact: ContactRow | null = null;
    if (candidate.account_id) {
      const list = byAccount.get(candidate.account_id) ?? [];
      contact = list.find((c) => norm(decrypt(c.email)) === email) ?? list[0] ?? null;
    } else {
      const found = contactByEmail.get(email);
      contact = found ? { ...found, email: found.email } : null;
    }
    if (!contact) { await skip(candidate, "skipped_no_contact", "no_contact", null, null); continue; }

    // 2. consent: the one gate
    const decision = await gate(tenantId, contact.id, campaign.topic);
    if (!decision.ok) { await skip(candidate, "skipped_no_consent", decision.reason, contact, null); continue; }

    // 3. language
    const accountId = contact.account_id;
    const choice = resolveRecipientLanguage({
      contactLanguage: contact.preferred_language, accountLanguage: accountLangs.get(accountId) ?? null, included, fallback: campaign.fallback_language,
    });
    const html = version.html[choice.lang];
    const text = version.text[choice.lang] ?? "";
    const snap = version.snapshot.languages.find((l) => l.lang === choice.lang);
    if (!included.includes(choice.lang) || typeof html !== "string" || !snap) { await skip(candidate, "skipped_no_language", "no_language", contact, null); continue; }

    // The row exists before the send so the links in the email can name it.
    const { data: ins, error: insErr } = await d.supabase.from("marketing_campaign_recipients").insert({
      tenant_id: tenantId, campaign_id: campaign.id, account_id: candidate.account_id, manual_email: candidate.manual_email,
      email: candidate.email, status: "pending", contact_id: contact.id, lang: choice.lang,
    }).select("id").single();
    const rid = (ins as { id?: string } | null)?.id;
    if (insErr || !rid) { result.failed++; continue; }

    const unsubToken = signUnsubscribeToken(accountId);
    const interestToken = signCampaignInterestToken(campaign.id, accountId);
    const unsubUrl = unsubToken ? await d.absoluteUrl(ROUTES.marketingUnsubscribe(accountId, unsubToken)) : "";
    const prefToken = d.preferencesEnabled ? signPreferenceToken(contact.id) : null;
    const prefUrl = prefToken ? await d.absoluteUrl(ROUTES.marketingPreferences(contact.id, prefToken)) : "";
    const values: TokenValues = {
      account_name: candidate.account_name, company_name: d.companyName, contact_name: (contact.name ?? "").trim().split(/\s+/)[0] ?? "",
      unsubscribe_url: unsubUrl,
      // The preference centre (lib/marketing/forms) when the workspace has it; otherwise the same signed unsubscribe page.
      preferences_url: prefUrl || unsubUrl,
      interest_url: interestToken ? await d.absoluteUrl(ROUTES.marketingInterest(campaign.id, accountId, interestToken)) : "",
    };
    const openToken = signOpenToken(campaign.id, rid);
    if (openToken) values.open_pixel_url = await d.absoluteUrl(`/marketing/o/${campaign.id}/${rid}/${openToken}`);
    for (let i = 0; i < version.links.length; i++) {
      const t = signClickToken(campaign.id, rid, i);
      // Without a click token the link still works, untracked: the person reaches the page either way.
      values[`click_${i}`] = t ? await d.absoluteUrl(ROUTES.marketingClick(campaign.id, rid, i, t)) : version.links[i].url;
    }

    const subject = fillTokens(snap.subject, values, { html: false });
    const routed = resolveOutbound(d.output, { to: [candidate.email], subject, html: fillTokens(html, values, { html: true }), text: fillTokens(text, values, { html: false }) });
    let resendId: string | null = null;
    let sendError: { message: string } | null = null;
    if (routed.ok) {
      const r = await d.resend.emails.send({
        from: d.fromAddress, to: routed.email.to, replyTo: d.replyTo, subject: routed.email.subject, html: routed.email.html, text: routed.email.text,
        // Ties the provider's delivery events (/api/webhooks/resend) back to this row; the tenant
        // is read from the row, never from the event.
        tags: [{ name: RECIPIENT_TAG, value: rid }],
        headers: unsubToken ? {
          "List-Unsubscribe": `<${await d.absoluteUrl(`/api/marketing/unsubscribe/${accountId}/${unsubToken}`)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        } : undefined,
      });
      sendError = r.error ?? null;
      resendId = r.data?.id ?? null;
    } else sendError = { message: routed.error };

    const label = { relatedObjectType: "marketing_campaigns", relatedObjectId: campaign.id, relatedObjectLabel: campaign.name, actorId: d.userId, actorEmail: d.userEmail };
    if (sendError) {
      await Promise.all([
        d.supabase.from("marketing_campaign_recipients").update({ status: "failed", error: sendError.message }).eq("id", rid).eq("tenant_id", tenantId),
        logEmail(d.supabase, { tenantId, kind: "campaign", toEmail: candidate.email, subject, status: "failed", error: sendError.message, ...label }),
        emitEvent(tenantId, { name: EVENTS.EMAIL_FAILED, ...common(`${rid}:failed`, contact, choice.lang, candidate), payload: { error: sendError.message.slice(0, 200) } }, d.admin),
      ]);
      result.failed++;
    } else {
      await Promise.all([
        d.supabase.from("marketing_campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", rid).eq("tenant_id", tenantId),
        rememberProviderId(d.supabase, tenantId, rid, resendId),
        logEmail(d.supabase, { tenantId, kind: "campaign", toEmail: candidate.email, subject, status: "sent", ...label }),
        emitEvent(tenantId, { name: EVENTS.EMAIL_SENT, ...common(`${rid}:sent`, contact, choice.lang, candidate), payload: { resend_id: resendId, redirected: routed.ok ? routed.email.redirected : false } }, d.admin),
      ]);
      result.sent++;
      result.byLanguage[choice.lang] = (result.byLanguage[choice.lang] ?? 0) + 1;
    }
    if (delay > 0) await sleep(delay);
  }

  await emitCampaignSent(tenantId, { campaignId: campaign.id, name: campaign.name, sent: result.sent, failed: result.failed, skipped: result.skipped, actorId: d.userId });
  return result;
}
