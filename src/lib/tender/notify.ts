import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES, tenantOrigin, type TenantConfig } from "@/lib/constants";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutputRules";
import { logEmail } from "@/lib/emailLog";

// One way for the tender edition to tell a person something (docs/design/gcc-tender-deals.md sections 10 and 4):
//   - an e-mail, through resolveOutbound (a demo workspace is redirect-only) and recorded in email_log (kind tender);
//   - a Nova inbox entry. The inbox IS "a comment that mentions you" (record_comments.mentions, 0089), so the entry is a
//     system comment on the deal that mentions the person: no second notification table, and the person's own inbox
//     (mark read, link to the deal) works unchanged. The inbox is a Nova surface; a workspace without it still gets the e-mail.
// Nothing here throws: a failed notification never fails the decision or the message that caused it.

export type TenderMailAttachment = { filename: string; content: Buffer };

export type TenderMailer = {
  send(p: { from: string; to: string[]; subject: string; text: string; attachments?: TenderMailAttachment[] }): Promise<{ error?: string | null }>;
};

export function defaultMailer(): TenderMailer | null {
  if (!process.env.RESEND_API_KEY) return null;
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async send(p) {
      const r = await resend.emails.send({ from: p.from, to: p.to, subject: p.subject, text: p.text, ...(p.attachments?.length ? { attachments: p.attachments } : {}) });
      return { error: r.error?.message ?? null };
    },
  };
}

export const displayName = (s: string) => s.replace(/[<>",\r\n]/g, "").trim().slice(0, 60) || "BPMSquare";

export type NotifyTenant = { id: string; slug: string; name: string; is_demo: boolean | null; config: TenantConfig | null; custom_domain: string | null };

export async function loadNotifyTenant(admin: SupabaseClient, tenantId: string): Promise<NotifyTenant | null> {
  const { data } = await admin.from("tenants").select("id, slug, name, is_demo, config, custom_domain").eq("id", tenantId).maybeSingle();
  return (data as NotifyTenant | null) ?? null;
}

/** The deal's link, built from the workspace's own domain (never PRIMARY_HOST: MULTI_TENANT_GUARDRAILS.md). */
export const dealLink = (t: Pick<NotifyTenant, "custom_domain">, dealId: string, suffix = "") => `${tenantOrigin(t.custom_domain)}${ROUTES.pipelineDetail(dealId)}${suffix}`;

/** The login e-mail of each id that is a member of THIS workspace (an id of another workspace matches nothing). */
export async function memberEmails(admin: SupabaseClient, tenantId: string, userIds: string[]): Promise<{ user_id: string; email: string }[]> {
  if (userIds.length === 0) return [];
  const { data: members } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", userIds);
  const ok = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  const out: { user_id: string; email: string }[] = [];
  for (const id of ok) {
    const { data } = await admin.auth.admin.getUserById(id);
    const e = data?.user?.email;
    if (e) out.push({ user_id: id, email: e });
  }
  return out;
}

export type TenderMailResult =
  | { ok: true; to: string[]; intended: string[]; redirected: boolean }
  | { ok: false; error: string; stage: "route" | "send" };

type TenderMailMessage = { to: string[]; subject: string; text: string; dealId: string; dealLabel: string; actorId?: string | null; actorEmail?: string | null; attachments?: TenderMailAttachment[] };

/**
 * Send one e-mail through resolveOutbound and log it, and say where it really went (a demo workspace redirects: the caller records the
 * redirect, not the address the person typed). `stage` tells a refusal before sending (no redirect inbox on a demo workspace) from a
 * failure of the sender itself.
 */
export async function sendTenderMailDetailed(
  admin: SupabaseClient,
  tenant: NotifyTenant,
  msg: TenderMailMessage,
  mailer: TenderMailer | null | undefined = defaultMailer(),
): Promise<TenderMailResult> {
  const label = msg.dealLabel;
  const fail = async (why: string, stage: "route" | "send"): Promise<TenderMailResult> => {
    await logEmail(admin, { tenantId: tenant.id, kind: "tender", toEmail: msg.to.join(", "), subject: msg.subject, status: "failed", error: why, relatedObjectType: "opportunities", relatedObjectId: msg.dealId, relatedObjectLabel: label, actorId: msg.actorId, actorEmail: msg.actorEmail });
    return { ok: false, error: why, stage };
  };
  if (msg.to.length === 0) return { ok: false, error: "No recipient.", stage: "route" };
  const routed = resolveOutbound(emailOutputFor({ is_demo: tenant.is_demo, config: tenant.config }), { to: msg.to, subject: msg.subject, text: msg.text });
  if (!routed.ok) return fail(routed.error, "route");
  if (!mailer) return fail("Email sending isn't configured (missing RESEND_API_KEY).", "send");
  const from = `${displayName(tenant.name)} <${(tenant.slug || "tenders").toLowerCase().replace(/[^a-z0-9._-]/g, "") || "tenders"}@${process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com"}>`;
  let sendError: string | null = null;
  try {
    sendError = (await mailer.send({ from, to: routed.email.to, subject: routed.email.subject, text: routed.email.text, ...(msg.attachments?.length ? { attachments: msg.attachments } : {}) })).error ?? null;
  } catch (e) {
    sendError = (e as Error).message;
  }
  if (sendError) return fail(sendError, "send");
  await logEmail(admin, { tenantId: tenant.id, kind: "tender", toEmail: routed.email.to.join(", "), subject: routed.email.subject, status: "sent", relatedObjectType: "opportunities", relatedObjectId: msg.dealId, relatedObjectLabel: label, actorId: msg.actorId, actorEmail: msg.actorEmail });
  return { ok: true, to: routed.email.to, intended: routed.email.intended, redirected: routed.email.redirected };
}

/** Send one e-mail to workspace members through resolveOutbound and log it. Returns true when it went. */
export async function sendTenderMail(admin: SupabaseClient, tenant: NotifyTenant, msg: TenderMailMessage, mailer: TenderMailer | null | undefined = defaultMailer()): Promise<boolean> {
  return (await sendTenderMailDetailed(admin, tenant, msg, mailer)).ok;
}

/**
 * An entry in the Nova inbox of each person in `mentionEmails`: a system comment on the deal that mentions them. The
 * addresses must be those of workspace members (the callers take them from memberEmails). A missing table (0089) is not an error.
 */
export async function inboxNote(
  admin: SupabaseClient,
  p: { tenantId: string; dealId: string; authorId: string; authorEmail: string | null; body: string; mentionEmails: string[] },
): Promise<boolean> {
  const mentions = [...new Set(p.mentionEmails.map((e) => e.toLowerCase()).filter(Boolean))];
  if (mentions.length === 0) return false;
  const { error } = await admin.from("record_comments").insert({
    tenant_id: p.tenantId, object_type: "opportunities", object_id: p.dealId,
    author_id: p.authorId, author_email: p.authorEmail, body: p.body.slice(0, 2000), mentions,
  });
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") console.error("[tender] inbox note failed", error.message);
    return false;
  }
  return true;
}
