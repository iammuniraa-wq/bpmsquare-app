import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES, tenantOrigin } from "@/lib/constants";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutputRules";
import { logEmail } from "@/lib/emailLog";
import { defaultMailer, displayName, type NotifyTenant, type TenderMailer } from "@/lib/tender/notify";

// Telling people about a budget approval (slice 5a). Same two channels as the bid decision: an e-mail through resolveOutbound (a
// demo workspace is redirect-only) recorded in email_log, and an entry in the Nova inbox, which is a system comment on the project
// that mentions the person. Nothing here throws: a failed notification never fails the approval that caused it.

/** The project's link, built from the workspace's own domain (never PRIMARY_HOST: MULTI_TENANT_GUARDRAILS.md). */
export const projectLink = (t: Pick<NotifyTenant, "custom_domain">, projectId: string) => `${tenantOrigin(t.custom_domain)}${ROUTES.contractProject(projectId)}`;

export async function sendProjectMail(
  admin: SupabaseClient,
  tenant: NotifyTenant,
  msg: { to: string[]; subject: string; text: string; projectId: string; projectLabel: string; actorId?: string | null; actorEmail?: string | null },
  mailer: TenderMailer | null | undefined = defaultMailer(),
): Promise<boolean> {
  const log = (status: "sent" | "failed", to: string[], subject: string, error?: string) =>
    logEmail(admin, { tenantId: tenant.id, kind: "tender", toEmail: to.join(", "), subject, status, error: error ?? null, relatedObjectType: "contract_projects", relatedObjectId: msg.projectId, relatedObjectLabel: msg.projectLabel, actorId: msg.actorId, actorEmail: msg.actorEmail });
  if (msg.to.length === 0) return false;
  const routed = resolveOutbound(emailOutputFor({ is_demo: tenant.is_demo, config: tenant.config }), { to: msg.to, subject: msg.subject, text: msg.text });
  if (!routed.ok) { await log("failed", msg.to, msg.subject, routed.error); return false; }
  if (!mailer) { await log("failed", msg.to, msg.subject, "Email sending isn't configured (missing RESEND_API_KEY)."); return false; }
  const from = `${displayName(tenant.name)} <${(tenant.slug || "projects").toLowerCase().replace(/[^a-z0-9._-]/g, "") || "projects"}@${process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com"}>`;
  let sendError: string | null = null;
  try {
    sendError = (await mailer.send({ from, to: routed.email.to, subject: routed.email.subject, text: routed.email.text })).error ?? null;
  } catch (e) {
    sendError = (e as Error).message;
  }
  if (sendError) { await log("failed", routed.email.to, routed.email.subject, sendError); return false; }
  await log("sent", routed.email.to, routed.email.subject);
  return true;
}

/** A Nova inbox entry for each person in `mentionEmails` (workspace members' addresses): a system comment on the project that mentions them. */
export async function projectInboxNote(
  admin: SupabaseClient,
  p: { tenantId: string; projectId: string; authorId: string; authorEmail: string | null; body: string; mentionEmails: string[] },
): Promise<boolean> {
  const mentions = [...new Set(p.mentionEmails.map((e) => e.toLowerCase()).filter(Boolean))];
  if (mentions.length === 0) return false;
  const { error } = await admin.from("record_comments").insert({
    tenant_id: p.tenantId, object_type: "contract_projects", object_id: p.projectId,
    author_id: p.authorId, author_email: p.authorEmail, body: p.body.slice(0, 2000), mentions,
  });
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") console.error("[contract-projects] inbox note failed", error.message);
    return false;
  }
  return true;
}
