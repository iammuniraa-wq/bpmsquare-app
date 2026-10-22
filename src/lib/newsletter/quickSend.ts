import "server-only";
import { newsletterFieldsForCreate, type NewsletterCampaignFields } from "./campaignFields";
import { isUuid } from "./requests";
import { campaignNameFor, cleanEmails, oneOffRule, parseEmailText, ruleFromGroup, type AudienceRule, type SendAudienceInput } from "./sendAudience";
import { PENDING_MESSAGE, createVersion, loadBundle, loadVersion, sendableLanguages, type NewsletterCtx, type StoredVersion } from "./server";

// "Send..." on a newsletter: everything between the panel and the one send path (send.ts) that used to be
// three screens. The version is kept here, the campaign row is created here, and the topic and languages
// are inherited from the newsletter -- nobody types them again. This module decides NOTHING about who may
// be emailed: the row it creates is sent by sendNewsletterBranch(), whose per-person consent gate,
// suppression, language rule and demo redirect are untouched.

export type SendFail = { ok: false; status: number; error: string };

export type PreparedSend = {
  ok: true;
  version: StoredVersion;
  fields: NewsletterCampaignFields;
  rule: AudienceRule;
  newsletterName: string;
};

async function audienceRule(ctx: NewsletterCtx, audience: SendAudienceInput): Promise<{ ok: true; rule: AudienceRule } | SendFail> {
  const typed = typeof audience.manual_emails === "string" ? parseEmailText(audience.manual_emails) : audience.manual_emails;
  if (audience.group_id === undefined || audience.group_id === null || audience.group_id === "") return { ok: true, rule: oneOffRule({ ...audience, manual_emails: typed }) };
  if (!isUuid(audience.group_id)) return { ok: false, status: 422, error: "That saved audience was not found." };
  // The group id comes from the body, so it is read with the tenant on the same query (a foreign id matches nothing).
  const { data } = await ctx.supabase.from("marketing_target_groups").select("account_types, include_account_ids, exclude_account_ids, manual_emails, filters, match")
    .eq("id", audience.group_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!data) return { ok: false, status: 422, error: "That saved audience was not found." };
  return { ok: true, rule: ruleFromGroup(data as Parameters<typeof ruleFromGroup>[0], cleanEmails(typed)) };
}

/** Keeps a version of the newsletter as it is now (a new one only when something changed) and resolves what the campaign inherits from it. */
export async function prepareNewsletterSend(ctx: NewsletterCtx, newsletterId: string, audience: SendAudienceInput): Promise<PreparedSend | SendFail> {
  const loaded = await loadBundle(ctx, newsletterId);
  if (loaded.missing) return { ok: false, status: 503, error: PENDING_MESSAGE };
  const bundle = loaded.data;
  if (!bundle) return { ok: false, status: 404, error: "Newsletter not found" };
  if (bundle.newsletter.is_template) return { ok: false, status: 422, error: "A template is a starting point. Start a newsletter from it, then send that." };
  if (bundle.newsletter.status === "archived") return { ok: false, status: 422, error: "This newsletter is archived." };

  const aud = await audienceRule(ctx, audience);
  if (!aud.ok) return aud;

  const kept = await createVersion(ctx, bundle);
  if ("missing" in kept) return { ok: false, status: 503, error: PENDING_MESSAGE };
  const version = await loadVersion(ctx.admin, ctx.tenantId, kept.id);
  if (!version) return { ok: false, status: 500, error: "Could not keep a version of this newsletter." };
  if (sendableLanguages(version).length === 0) {
    return { ok: false, status: 422, error: "No language is ready to send yet. Accept every line of a language in the newsletter first." };
  }

  // Topic, languages and the fallback come from the newsletter itself, re-validated against this workspace's topics.
  const fields = await newsletterFieldsForCreate(ctx.tenantId, { newsletter_version_id: kept.id });
  if (!fields.ok) return fields;
  return { ok: true, version, fields: fields.fields, rule: aud.rule, newsletterName: bundle.newsletter.name };
}

/** The campaign row behind the panel. It is a draft until sendNewsletterBranch() takes it, and is the send history afterwards. */
export async function createNewsletterCampaign(ctx: NewsletterCtx, p: PreparedSend, now: Date = new Date()): Promise<{ ok: true; campaign: Record<string, unknown> & { id: string } } | SendFail> {
  const f = p.fields;
  const { data, error } = await ctx.supabase.from("marketing_campaigns").insert({
    tenant_id: ctx.tenantId,
    name: campaignNameFor(p.newsletterName, now),
    subject: f.subject ?? p.newsletterName,
    body: f.body ?? `Newsletter: ${p.newsletterName}`,
    template_id: null,
    custom_message: null,
    newsletter_version_id: f.newsletter_version_id,
    languages: f.languages,
    fallback_language: f.fallback_language,
    topic: f.topic,
    account_types: p.rule.account_types,
    include_account_ids: p.rule.include_account_ids,
    exclude_account_ids: p.rule.exclude_account_ids,
    manual_emails: p.rule.manual_emails,
    filters: p.rule.filters,
    match: p.rule.match,
    created_by: ctx.userId,
  }).select("*").single();
  if (error || !data) return { ok: false, status: 500, error: "Could not start the send." };
  return { ok: true, campaign: data as Record<string, unknown> & { id: string } };
}

/** A send that was refused before the first email leaves nothing behind: the campaign row made for it is removed while it is still a draft. */
export async function discardDraftCampaign(ctx: NewsletterCtx, campaignId: string): Promise<void> {
  await ctx.supabase.from("marketing_campaigns").delete().eq("id", campaignId).eq("tenant_id", ctx.tenantId).eq("status", "draft");
}
