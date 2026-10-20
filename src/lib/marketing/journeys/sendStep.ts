import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { tenantOrigin } from "@/lib/constants";
import type { ContactDecision } from "@/lib/marketing/consent";
import { isSchemaPending } from "@/lib/marketing/pending";
import { sendNewsletterCampaign, type SendOutcome } from "@/lib/newsletter/send";
import { loadVersion, sendableLanguages } from "@/lib/newsletter/server";
import type { TenantEnv } from "./env";
import type { PersonRow } from "./facts";
import type { JourneyRow, RunRow, JourneyStep } from "./types";

// The "Send a newsletter version" step. It does not send anything itself: it
// finds (or makes, once) the quiet campaign this step belongs to and hands ONE
// recipient to sendNewsletterCampaign() -- the same function the Campaigns page
// uses -- which resolves the person, calls canContact(), picks the language,
// runs resolveOutbound() and writes the recipient row, email_log and events.

export type SendStep = Extract<JourneyStep, { kind: "send_newsletter" }>;

export type SendStepArgs = {
  env: TenantEnv;
  journey: JourneyRow;
  step: SendStep;
  run: RunRow;
  contact: PersonRow;
  accountName: string;
  accountOptedOut: boolean;
};

export type SendStepResult = { status: "sent" | "skipped" | "failed"; reason: string; detail?: string; recipientId: string | null };

type ResendLike = Parameters<typeof sendNewsletterCampaign>[0]["resend"];

export type SendStepDeps = {
  gate?: (tenantId: string, contactId: string, topic: string | null) => Promise<ContactDecision>;
  mailer?: ResendLike;
  delayMs?: number;
};

const CONSENT_REASONS = new Set(["no_consent", "withdrawn", "do_not_contact", "suppressed", "account_opted_out", "contact_not_found", "unavailable"]);

async function stepCampaign(admin: SupabaseClient, a: SendStepArgs, languages: string[], versionName: string): Promise<{ id: string } | { error: string }> {
  const { tenantId } = a.env;
  const find = () => admin.from("marketing_campaigns").select("id").eq("tenant_id", tenantId).eq("journey_id", a.journey.id).eq("journey_step_id", a.step.id).maybeSingle();
  const found = await find();
  if (found.error) return { error: isSchemaPending(found.error) ? "pending_migration" : found.error.message };
  if (found.data) {
    // Keep the quiet campaign in step with the step's current settings.
    await admin.from("marketing_campaigns").update({
      newsletter_version_id: a.step.newsletter_version_id, languages, fallback_language: a.step.fallback_language, topic: a.step.topic,
    }).eq("id", (found.data as { id: string }).id).eq("tenant_id", tenantId);
    return { id: (found.data as { id: string }).id };
  }
  const ins = await admin.from("marketing_campaigns").insert({
    tenant_id: tenantId, name: `${a.journey.name} (journey step)`, subject: versionName, body: "", status: "sent",
    sent_at: new Date().toISOString(), newsletter_version_id: a.step.newsletter_version_id, languages, fallback_language: a.step.fallback_language,
    topic: a.step.topic, journey_id: a.journey.id, journey_step_id: a.step.id,
  }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") {
      const again = await find();
      if (again.data) return { id: (again.data as { id: string }).id };
    }
    return { error: isSchemaPending(ins.error) ? "pending_migration" : ins.error.message };
  }
  return { id: (ins.data as { id: string }).id };
}

export async function sendJourneyNewsletter(admin: SupabaseClient, a: SendStepArgs, deps: SendStepDeps = {}): Promise<SendStepResult> {
  const { env, step, contact } = a;
  const tenantId = env.tenantId;
  if (env.features.newsletter_studio !== true) return { status: "skipped", reason: "studio_off", recipientId: null };
  if (!step.newsletter_version_id) return { status: "skipped", reason: "no_version", recipientId: null };
  if (!contact.email) return { status: "skipped", reason: "no_email", recipientId: null };

  // The version is loaded again at every send: a definition can outlive the thing it points to.
  const version = await loadVersion(admin, tenantId, step.newsletter_version_id);
  if (!version) return { status: "skipped", reason: "version_missing", recipientId: null };
  const ready = sendableLanguages(version);
  const languages = step.languages.length ? step.languages.filter((l) => ready.includes(l)) : ready;
  if (languages.length === 0) return { status: "skipped", reason: "no_language", recipientId: null };

  const campaign = await stepCampaign(admin, a, languages, version.snapshot.name);
  if ("error" in campaign) return { status: "failed", reason: "send_failed", detail: campaign.error, recipientId: null };

  // A retry after a crash must not send twice: if this person already has a sent (or half-written) row for the step, the email went.
  const prior = await admin.from("marketing_campaign_recipients").select("id, status").eq("tenant_id", tenantId).eq("campaign_id", campaign.id).eq("contact_id", contact.id);
  const sentBefore = ((prior.data ?? []) as { id: string; status: string }[]).find((r) => r.status === "sent" || r.status === "pending");
  if (sentBefore) return { status: "sent", reason: "already_sent", recipientId: sentBefore.id };

  const mailer = deps.mailer ?? (process.env.RESEND_API_KEY ? (new Resend(process.env.RESEND_API_KEY) as unknown as ResendLike) : null);
  if (!mailer) return { status: "failed", reason: "not_configured", detail: "RESEND_API_KEY is not set", recipientId: null };
  if (!process.env.QUOTE_PUBLIC_LINK_SECRET) return { status: "failed", reason: "not_configured", detail: "Signed links are not set up (QUOTE_PUBLIC_LINK_SECRET)", recipientId: null };

  let outcome: SendOutcome | null = null;
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (env.slug || "marketing").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const origin = tenantOrigin(env.customDomain);
  await sendNewsletterCampaign({
    supabase: admin, admin, tenantId, userId: null, userEmail: null,
    campaign: { id: campaign.id, name: `${a.journey.name} (journey step)`, topic: step.topic, languages, fallback_language: step.fallback_language, newsletter_version_id: step.newsletter_version_id },
    version,
    candidates: [{ account_id: contact.account_id, account_name: a.accountName, email: contact.email, marketing_opt_out: a.accountOptedOut, manual_email: null }],
    resend: mailer, output: env.output, companyName: env.name || "our team", replyTo: env.replyTo,
    fromAddress: `${env.name || "our team"} <${fromLocalPart}@${sendingDomain}>`,
    absoluteUrl: async (p) => `${origin}${p}`,
    gate: deps.gate, delayMs: deps.delayMs ?? 0,
    // Events from a journey send carry depth + 1 so no journey can be started by its own email.
    events: { depth: 1, source: "runner" },
    onOutcome: (o) => { outcome = o; },
    skipSummary: true,
  });

  const o = outcome as SendOutcome | null;
  if (!o) return { status: "failed", reason: "send_failed", detail: "The send did not report a result", recipientId: null };
  if (o.status === "sent") return { status: "sent", reason: "sent", recipientId: o.recipientId };
  if (o.status === "failed") return { status: "failed", reason: "send_failed", detail: (o.reason ?? "").slice(0, 300), recipientId: o.recipientId };
  const reason = o.recipientStatus === "skipped_no_consent" ? (o.reason && CONSENT_REASONS.has(o.reason) ? o.reason : "no_consent")
    : o.recipientStatus === "skipped_opt_out" ? "account_opted_out"
    : o.recipientStatus === "skipped_no_email" ? "no_email"
    : o.recipientStatus === "skipped_no_contact" ? "no_contact"
    : o.recipientStatus === "skipped_no_language" ? "no_language" : (o.reason ?? "send_failed");
  return { status: "skipped", reason, recipientId: o.recipientId };
}
