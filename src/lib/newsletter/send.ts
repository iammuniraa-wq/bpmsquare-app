import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import { canContact, type ContactDecision } from "@/lib/marketing/consent";
import { contactsForEmails, eventIdentity } from "@/lib/marketing/recipientLookup";
import { isSchemaPending } from "@/lib/marketing/pending";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS, type EventSource } from "@/lib/events/catalog";
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
  /** A journey step passes its own loop-guard depth and source; a person pressing Send leaves this out (depth 0, "app"). */
  events?: { depth: number; source: EventSource };
  /** Called once per recipient with the outcome. */
  onOutcome?: (o: SendOutcome) => void;
  /** A journey sends one person at a time; it does not announce a campaign.sent for each. */
  skipSummary?: boolean;
};

/**
 * What happened to one recipient, reported to a caller that asked (the journey
 * runner). It is the only extra the journey step needs from this path; the send
 * itself is not duplicated anywhere.
 */
export type SendOutcome = {
  status: "sent" | "failed" | "skipped";
  /** The marketing_campaign_recipients status, e.g. skipped_no_consent. */
  recipientStatus: string;
  /** For a skip: the consent or language reason; for a failure: the provider message. */
  reason: string | null;
  recipientId: string | null;
  contactId: string | null;
  lang: string | null;
};

export type SendResult = { sent: number; failed: number; skipped: number; byLanguage: Record<string, number> };

type DbRes = { data: unknown; error: { code?: string; message?: string } | null };
type ContactRow = { id: string; account_id: string; email: string | null; email_status?: string | null; preferred_language?: string | null; name?: string | null; created_at?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (e: string | null | undefined): string => (e ?? "").trim().toLowerCase();
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** The contacts of these accounts, newest columns first and tolerant of a pending migration (preferred_language). */
/** Does contacts have an address-health column yet? Nothing writes it today; when something does, the send honours it. */
async function hasEmailStatus(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const r = await admin.from("contacts").select("email_status").eq("tenant_id", tenantId).limit(1);
  return !r.error;
}

async function contactsOfAccounts(admin: SupabaseClient, tenantId: string, accountIds: string[], withStatus: boolean): Promise<ContactRow[]> {
  const out: ContactRow[] = [];
  const extra = withStatus ? ", email_status" : "";
  for (const ids of chunk(accountIds, 150)) {
    let res: DbRes = await admin.from("contacts").select(`id, account_id, name, email, preferred_language, created_at${extra}`).eq("tenant_id", tenantId).in("account_id", ids);
    if (res.error && isSchemaPending(res.error)) res = await admin.from("contacts").select(`id, account_id, name, email, created_at${extra}`).eq("tenant_id", tenantId).in("account_id", ids);
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

export type Decision =
  | { kind: "skip"; status: string; reason: string; contact: ContactRow | null; lang: string | null }
  | { kind: "send"; contact: ContactRow; lang: string; via: "contact" | "account" | "fallback" };

type AudienceInput = Pick<SendInput, "admin" | "tenantId" | "campaign" | "version" | "candidates" | "gate">;

/** Everything needed to decide about a recipient, found once for the whole audience rather than one query per person. */
async function audienceContext(d: AudienceInput) {
  const { tenantId, campaign, version } = d;
  const ready = new Set(sendableLanguages(version));
  const included = (campaign.languages ?? []).filter((l) => ready.has(l) && typeof version.html[l] === "string");
  const gate = d.gate ?? ((t: string, c: string, topic: string | null) => canContact(t, c, "email", topic, d.admin));
  const accountIds = [...new Set(d.candidates.map((c) => c.account_id).filter((x): x is string => !!x))];
  const withStatus = await hasEmailStatus(d.admin, tenantId);
  const [accountContacts, accountLangs] = await Promise.all([contactsOfAccounts(d.admin, tenantId, accountIds, withStatus), accountLanguages(d.admin, tenantId, accountIds)]);
  const byAccount = new Map<string, ContactRow[]>();
  for (const c of accountContacts) byAccount.set(c.account_id, [...(byAccount.get(c.account_id) ?? []), c]);
  for (const list of byAccount.values()) list.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const { contactByEmail, hashByEmail } = await contactsForEmails(d.admin, tenantId, d.candidates.flatMap((c) => (c.manual_email ? [c.manual_email] : [])));
  return { included, gate, byAccount, accountLangs, contactByEmail, hashByEmail };
}

type Ctx = Awaited<ReturnType<typeof audienceContext>>;

/**
 * The one decision about one recipient, in the order that matters: opt-out, address, the PERSON, the consent
 * gate, the language. The real send and the before-send audience check both call this, so what the panel
 * promises is what the send does.
 */
async function decide(d: AudienceInput, ctx: Ctx, candidate: MarketingRecipientCandidate): Promise<Decision> {
  const skip = (status: string, reason: string, contact: ContactRow | null = null, lang: string | null = null): Decision => ({ kind: "skip", status, reason, contact, lang });
  if (candidate.marketing_opt_out) return skip("skipped_opt_out", "account_opted_out");
  if (!candidate.email) return skip("skipped_no_email", "no_email");

  const email = norm(candidate.email);
  let contact: ContactRow | null = null;
  if (candidate.account_id) {
    const list = ctx.byAccount.get(candidate.account_id) ?? [];
    contact = list.find((c) => norm(decrypt(c.email)) === email) ?? list[0] ?? null;
  } else {
    const found = ctx.contactByEmail.get(email);
    contact = found ? { ...found, email: found.email } : null;
  }
  if (!contact) return skip("skipped_no_contact", "no_contact");
  // Present only once the address-health column exists; a bounced or complained address is never mailed again.
  if (contact.email_status === "bounced" || contact.email_status === "complained") return skip("skipped_no_consent", contact.email_status, contact);

  const decision = await ctx.gate(d.tenantId, contact.id, d.campaign.topic);
  if (!decision.ok) return skip("skipped_no_consent", decision.reason, contact);

  const choice = resolveRecipientLanguage({
    contactLanguage: contact.preferred_language, accountLanguage: ctx.accountLangs.get(contact.account_id) ?? null, included: ctx.included, fallback: d.campaign.fallback_language,
  });
  const snap = d.version.snapshot.languages.find((l) => l.lang === choice.lang);
  if (!ctx.included.includes(choice.lang) || typeof d.version.html[choice.lang] !== "string" || !snap) return skip("skipped_no_language", "no_language", contact);
  return { kind: "send", contact, lang: choice.lang, via: choice.via };
}

export type AudiencePlan = {
  total: number;
  contactable: number;
  byLanguage: Record<string, number>;
  /** Why people would be skipped, with how many. Reasons are the same codes the send records. */
  skipped: Record<string, number>;
};

/**
 * Dry run: the same decisions as the send for everyone in the audience, sending and writing nothing.
 * Contact lookups are batched; the consent gate runs a few people at a time.
 */
export async function planNewsletterAudience(d: AudienceInput & { concurrency?: number }): Promise<AudiencePlan> {
  const ctx = await audienceContext(d);
  const plan: AudiencePlan = { total: d.candidates.length, contactable: 0, byLanguage: {}, skipped: {} };
  const width = Math.max(1, d.concurrency ?? 5);
  for (let i = 0; i < d.candidates.length; i += width) {
    const results = await Promise.all(d.candidates.slice(i, i + width).map((c) => decide(d, ctx, c)));
    for (const r of results) {
      if (r.kind === "send") { plan.contactable++; plan.byLanguage[r.lang] = (plan.byLanguage[r.lang] ?? 0) + 1; }
      else plan.skipped[r.reason] = (plan.skipped[r.reason] ?? 0) + 1;
    }
  }
  return plan;
}

export async function sendNewsletterCampaign(d: SendInput): Promise<SendResult> {
  const { tenantId, campaign, version } = d;
  const result: SendResult = { sent: 0, failed: 0, skipped: 0, byLanguage: {} };
  const delay = d.delayMs ?? 200;
  const ctx = await audienceContext(d);
  const { hashByEmail } = ctx;

  const common = (rid: string | null, contact: ContactRow | null, lang: string | null, candidate: MarketingRecipientCandidate) => ({
    object_type: "marketing_campaign", object_id: campaign.id, actor_id: d.userId, source: d.events?.source ?? ("app" as const), depth: d.events?.depth ?? 0,
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
    d.onOutcome?.({ status: "skipped", recipientStatus: status, reason, recipientId: rid, contactId: contact?.id ?? null, lang });
  };

  for (const candidate of d.candidates) {
    const decision = await decide(d, ctx, candidate);
    if (decision.kind === "skip") { await skip(candidate, decision.status, decision.reason, decision.contact, decision.lang); continue; }
    const { contact } = decision;
    const choice = { lang: decision.lang };
    const toEmail = candidate.email as string; // a skip above already handled a missing address
    const accountId = contact.account_id;
    const html = version.html[choice.lang];
    const text = version.text[choice.lang] ?? "";
    const snap = version.snapshot.languages.find((l) => l.lang === choice.lang)!;

    // The row exists before the send so the links in the email can name it.
    const { data: ins, error: insErr } = await d.supabase.from("marketing_campaign_recipients").insert({
      tenant_id: tenantId, campaign_id: campaign.id, account_id: candidate.account_id, manual_email: candidate.manual_email,
      email: toEmail, status: "pending", contact_id: contact.id, lang: choice.lang,
    }).select("id").single();
    const rid = (ins as { id?: string } | null)?.id;
    if (insErr || !rid) { result.failed++; d.onOutcome?.({ status: "failed", recipientStatus: "failed", reason: insErr?.message ?? "recipient_not_recorded", recipientId: null, contactId: contact.id, lang: choice.lang }); continue; }

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
    const routed = resolveOutbound(d.output, { to: [toEmail], subject, html: fillTokens(html, values, { html: true }), text: fillTokens(text, values, { html: false }) });
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
        logEmail(d.supabase, { tenantId, kind: "campaign", toEmail: toEmail, subject, status: "failed", error: sendError.message, ...label }),
        emitEvent(tenantId, { name: EVENTS.EMAIL_FAILED, ...common(`${rid}:failed`, contact, choice.lang, candidate), payload: { error: sendError.message.slice(0, 200) } }, d.admin),
      ]);
      result.failed++;
      d.onOutcome?.({ status: "failed", recipientStatus: "failed", reason: sendError.message, recipientId: rid, contactId: contact.id, lang: choice.lang });
    } else {
      await Promise.all([
        d.supabase.from("marketing_campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", rid).eq("tenant_id", tenantId),
        rememberProviderId(d.supabase, tenantId, rid, resendId),
        logEmail(d.supabase, { tenantId, kind: "campaign", toEmail: toEmail, subject, status: "sent", ...label }),
        emitEvent(tenantId, { name: EVENTS.EMAIL_SENT, ...common(`${rid}:sent`, contact, choice.lang, candidate), payload: { resend_id: resendId, redirected: routed.ok ? routed.email.redirected : false } }, d.admin),
      ]);
      result.sent++;
      result.byLanguage[choice.lang] = (result.byLanguage[choice.lang] ?? 0) + 1;
      d.onOutcome?.({ status: "sent", recipientStatus: "sent", reason: null, recipientId: rid, contactId: contact.id, lang: choice.lang });
    }
    if (delay > 0) await sleep(delay);
  }

  if (!d.skipSummary) await emitCampaignSent(tenantId, { campaignId: campaign.id, name: campaign.name, sent: result.sent, failed: result.failed, skipped: result.skipped, actorId: d.userId });
  return result;
}
