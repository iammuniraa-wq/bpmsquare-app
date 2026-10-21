import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { tenantOrigin, type TenantConfig } from "@/lib/constants";
import { logEmail } from "@/lib/emailLog";
import { emailOutputFor, resolveOutbound, type EmailOutput } from "@/lib/emailOutputRules";
import { cleanText } from "./sanitize";
import { signConfirmToken, CONFIRM_DAYS } from "./confirmToken";
import type { FormRow } from "./types";
import type { TenantForSubmit } from "./submit";

// The two emails a form can send once a submission is kept (docs/shells/forms-shell.md):
//
//   the thank-you   to the VISITOR, about their own submission. It is a confirmation of something they just did, not
//                   marketing, so it is sent whatever they ticked. It carries the form's own words and, for a form
//                   that asks people to confirm by email, the signed confirm link (confirmToken.ts).
//   the notice      to ONE person of the workspace the form names, telling them a new answer arrived.
//
// Both go through resolveOutbound(): a demo workspace is redirect-only, always, so nothing here can reach a real
// person from a demo workspace, and with no redirect inbox set it sends nothing at all. Neither ever throws: the
// submission is already kept and the visitor must see their thank-you whatever the mail service does.

export type FormMailer = {
  emails: { send(p: { from: string; to: string[]; replyTo?: string; subject: string; html?: string; text: string }): Promise<{ error?: { message: string } | null }> };
};

export type SubmissionEmailInput = {
  form: FormRow;
  tenant: TenantForSubmit;
  contactId: string;
  email: string;
  values: Partial<Record<string, string>>;
  /** Topic names still waiting for the visitor's confirmation (double opt-in); empty when none. */
  confirmTopics: string[];
  /** The same person sent this form a moment ago: do not email them a second thank-you (it would let anyone mail-bomb an address). */
  skipThanks?: boolean;
};

export type EmailOutcome = "sent" | "skipped" | "failed";
export type SubmissionEmailResult = { thanks: EmailOutcome; notice: EmailOutcome; reasons: string[] };

export type EmailDeps = { mailer?: FormMailer | null; output?: EmailOutput };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paragraphs = (s: string) => s.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.55;">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
/** A header-safe display name. */
const displayName = (s: string) => s.replace(/[<>",\r\n]/g, "").trim().slice(0, 60) || "Our team";

function defaultMailer(): FormMailer | null {
  return process.env.RESEND_API_KEY ? (new Resend(process.env.RESEND_API_KEY) as unknown as FormMailer) : null;
}

function fromAddress(tenant: TenantForSubmit): string {
  const local = (tenant.slug || "marketing").toLowerCase().replace(/[^a-z0-9._-]/g, "") || "marketing";
  return `${displayName(tenant.name)} <${local}@${process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com"}>`;
}

export function confirmLink(tenant: Pick<TenantForSubmit, "custom_domain">, contactId: string): string | null {
  const token = signConfirmToken(contactId);
  return token ? `${tenantOrigin(tenant.custom_domain)}/marketing/confirm/${encodeURIComponent(contactId)}/${encodeURIComponent(token)}` : null;
}

export type ThankYouMessage = { subject: string; text: string; html: string };

/** The visitor's email. Pure, so a test can read exactly what a person would receive. */
export function buildThankYou(p: { brand: string; firstName: string; words: string; link: string | null; confirmTopics: string[] }): ThankYouMessage {
  const hello = p.firstName ? `Hello ${p.firstName},` : "Hello,";
  const ask = p.link
    ? `One more step: please confirm that you want to hear from ${p.brand} by email${p.confirmTopics.length ? ` about ${p.confirmTopics.join(", ")}` : ""}. Until you do, we will not send you news or offers.`
    : "";
  const small = `You are receiving this because this address was entered on a form at ${p.brand}. If that was not you, you can ignore this email and nothing will happen.${p.link ? ` The confirm link works for ${CONFIRM_DAYS} days.` : ""}`;
  const text = [hello, p.words, p.link ? `${ask}\n${p.link}` : "", small, p.brand].filter(Boolean).join("\n\n");
  const html = `<div style="font:15px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#1f2933;max-width:560px;">`
    + `<p style="margin:0 0 14px;">${esc(hello)}</p>${p.words ? paragraphs(p.words) : ""}`
    + (p.link ? `<p style="margin:0 0 14px;">${esc(ask)}</p><p style="margin:0 0 18px;"><a href="${esc(p.link)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#1f2933;color:#ffffff;text-decoration:none;font-weight:600;">Yes, confirm my email</a></p>` : "")
    + `<p style="margin:18px 0 0;font-size:12.5px;color:#66727f;">${esc(small)}</p><p style="margin:10px 0 0;font-size:12.5px;color:#66727f;">${esc(p.brand)}</p></div>`;
  const subject = p.words ? `Thank you from ${p.brand}` : `Please confirm your email for ${p.brand}`;
  return { subject, text, html };
}

export function buildNotice(p: { brand: string; formName: string; values: Partial<Record<string, string>> }): ThankYouMessage {
  const row = (label: string, v: string | undefined) => (v ? { label, v: cleanText(v, 600, { multiline: true }) } : null);
  const rows = [row("Name", p.values.name), row("Email", p.values.email), row("Company", p.values.company), row("Phone", p.values.phone), row("Message", p.values.message),
    row("Question 1", p.values.custom1), row("Question 2", p.values.custom2), row("Question 3", p.values.custom3)].filter((r): r is { label: string; v: string } => !!r);
  const text = [`A new answer arrived on the form "${p.formName}".`, ...rows.map((r) => `${r.label}: ${r.v}`), "Open Marketing, Forms to see it with the rest."].join("\n");
  const html = `<div style="font:15px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#1f2933;max-width:560px;"><p style="margin:0 0 12px;">A new answer arrived on the form <b>${esc(p.formName)}</b>.</p>`
    + `<table style="border-collapse:collapse;font-size:14px;">${rows.map((r) => `<tr><td style="padding:3px 14px 3px 0;color:#66727f;vertical-align:top;">${esc(r.label)}</td><td style="padding:3px 0;">${esc(r.v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`
    + `<p style="margin:14px 0 0;font-size:12.5px;color:#66727f;">Open Marketing, Forms to see it with the rest.</p></div>`;
  return { subject: `New answer on ${p.formName}`, text, html };
}

type Sendable = { to: string; message: ThankYouMessage; kind: "thanks" | "notice"; related: { id: string; label: string } };

async function deliver(
  admin: SupabaseClient, tenant: TenantForSubmit, mailer: FormMailer, output: EmailOutput, s: Sendable, replyTo: string | undefined,
): Promise<{ outcome: EmailOutcome; reason?: string }> {
  const routed = resolveOutbound(output, { to: [s.to], subject: s.message.subject, text: s.message.text, html: s.message.html });
  if (!routed.ok) return { outcome: "skipped", reason: `${s.kind}: ${routed.error}` };
  let error: string | null = null;
  try {
    const r = await mailer.emails.send({ from: fromAddress(tenant), to: routed.email.to, replyTo, subject: routed.email.subject, html: routed.email.html, text: routed.email.text });
    error = r?.error?.message ?? null;
  } catch (e) {
    error = (e as Error)?.message ?? "send failed";
  }
  await logEmail(admin, {
    tenantId: tenant.id, kind: "campaign", toEmail: s.to, subject: s.message.subject, status: error ? "failed" : "sent", error,
    relatedObjectType: "forms", relatedObjectId: s.related.id, relatedObjectLabel: s.related.label,
  });
  if (error) {
    console.error(`[forms] ${s.kind} email not sent: ${error}`);
    return { outcome: "failed", reason: `${s.kind}: ${error}` };
  }
  return { outcome: "sent" };
}

/** The address of the person the form names, but only if they still belong to THIS workspace. */
async function ownerEmail(admin: SupabaseClient, tenantId: string, userId: string): Promise<string | null> {
  const { data: member } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (!member) return null;
  const { data } = await admin.auth.admin.getUserById(userId).catch(() => ({ data: null }));
  return data?.user?.email ?? null;
}

export async function sendSubmissionEmails(admin: SupabaseClient, input: SubmissionEmailInput, deps: EmailDeps = {}): Promise<SubmissionEmailResult> {
  const result: SubmissionEmailResult = { thanks: "skipped", notice: "skipped", reasons: [] };
  try {
    const { form, tenant } = input;
    const after = form.after_submit;
    // A form that asks for confirmation always sends the link, even with the thank-you words switched off.
    const owes = input.confirmTopics.length > 0;
    const thank = (after.thank_you_email || owes) && !input.skipThanks;
    if (!thank && !(after.notify_owner && after.notify_user_id)) return result;
    const mailer = deps.mailer === undefined ? defaultMailer() : deps.mailer;
    if (!mailer) { result.reasons.push("mail service not configured"); return result; }
    const output = deps.output ?? emailOutputFor({ is_demo: tenant.is_demo, config: tenant.config as TenantConfig | null });
    const replyTo = tenant.company_info?.email || undefined;
    const brand = displayName(tenant.name);

    if (thank) {
      const link = input.confirmTopics.length ? confirmLink(tenant, input.contactId) : null;
      const firstName = cleanText(input.values.name ?? "", 60).split(" ")[0] ?? "";
      const message = buildThankYou({ brand, firstName, words: after.thank_you_email ? after.thank_you_text : "", link, confirmTopics: input.confirmTopics });
      const r = await deliver(admin, tenant, mailer, output, { to: input.email, message, kind: "thanks", related: { id: form.id, label: form.ref ?? form.name } }, replyTo);
      result.thanks = r.outcome;
      if (r.reason) result.reasons.push(r.reason);
    }

    if (after.notify_owner && after.notify_user_id) {
      const to = await ownerEmail(admin, tenant.id, after.notify_user_id);
      if (!to) {
        result.reasons.push("notice: the person is no longer in this workspace");
      } else {
        const message = buildNotice({ brand, formName: cleanText(form.name, 80), values: { ...input.values, email: input.email } });
        const r = await deliver(admin, tenant, mailer, output, { to, message, kind: "notice", related: { id: form.id, label: form.ref ?? form.name } }, undefined);
        result.notice = r.outcome;
        if (r.reason) result.reasons.push(r.reason);
      }
    }
  } catch (e) {
    console.error("[forms] emails failed", e);
    result.reasons.push("unexpected error");
  }
  return result;
}
