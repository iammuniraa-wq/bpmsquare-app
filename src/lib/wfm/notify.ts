import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { logEmail } from "@/lib/emailLog";
import { loadEmailOutput, resolveOutbound } from "@/lib/emailOutput";
import { approversForSite } from "./siteApprovers";
import { tenantOrigin } from "@/lib/constants";

/**
 * Best-effort WFM email notifications (late arrival, correction/leave
 * pending, recheck flagged). Never throws — a notification failure must
 * never fail the punch/request/approval it's describing. Silently no-ops
 * if RESEND_API_KEY isn't configured, same as every other email path in
 * this codebase.
 */

async function resolveEmail(admin: ReturnType<typeof createAdminSupabase>, userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

/** The login email for an employee row, if one is linked (tenant_users.employee_id). */
export async function getEmployeeLoginEmail(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  employeeId: string
): Promise<string | null> {
  const { data: membership } = await admin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (!membership?.user_id) return null;
  return resolveEmail(admin, membership.user_id);
}

/**
 * Who should hear about this employee's attendance event: everyone who could
 * actually act on it — their explicit supervisor (employees.supervisor_id),
 * their site's supervisor, and any extra approvers named for that site
 * (wfm_site_approvers, 0124) — otherwise every tenant admin (the pre-existing
 * tenant-wide fallback, unchanged for tenants with no reporting line at all).
 *
 * Sending only to employees.supervisor_id used to mean a request approvable
 * by three people was announced to one of them, and if that one was on leave
 * the mail went nowhere anyone was reading. Recipients are deliberately a
 * SUPERSET of one approver rather than an exact mirror of canApproveFor():
 * this is a "somebody look at this" nudge, and the approve route re-checks
 * authority properly anyway (lib/wfm/scope.ts) before letting anyone act.
 */
export async function getSupervisorEmails(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  employeeId: string
): Promise<string[]> {
  const { data: employee } = await admin
    .from("employees")
    .select("supervisor_id, site_id")
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const approverIds = new Set<string>();
  if (employee?.supervisor_id) approverIds.add(employee.supervisor_id as string);

  if (employee?.site_id) {
    const [{ data: site }, extra] = await Promise.all([
      admin
        .from("wfm_sites")
        .select("supervisor_id")
        .eq("id", employee.site_id as string)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      approversForSite(admin, tenantId, employee.site_id as string),
    ]);
    if (site?.supervisor_id) approverIds.add(site.supervisor_id as string);
    extra.forEach((id) => approverIds.add(id));
  }

  // Never mail the request's own author about their own request.
  approverIds.delete(employeeId);

  if (approverIds.size > 0) {
    const resolved = await Promise.all(
      [...approverIds].map((id) => getEmployeeLoginEmail(admin, tenantId, id))
    );
    const emails = resolved.filter((e): e is string => !!e);
    if (emails.length > 0) return [...new Set(emails)];
  }

  const { data: admins } = await admin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("role", "admin");
  const emails = await Promise.all((admins ?? []).map((a) => resolveEmail(admin, a.user_id)));
  return emails.filter((e): e is string => !!e);
}

type SendParams = {
  sessionSupabase: SupabaseClient;
  tenantId: string;
  toEmails: string[];
  subject: string;
  text: string;
  /** Where the reader should go, as an app-relative path (ROUTES.*). The
   *  absolute link is built HERE from the tenant's own domain -- callers
   *  never build one, because a link built from PRIMARY_HOST sent a BIM
   *  supervisor to the demo workspace (P1, 2026-09-06). */
  link?: { path: string; label: string };
  relatedObjectType: string;
  relatedObjectId: string;
  relatedObjectLabel: string;
  actorId?: string | null;
  actorEmail?: string | null;
};

export async function sendWfmNotification(params: SendParams): Promise<void> {
  const recipients = [...new Set(params.toEmails.filter(Boolean))];
  if (recipients.length === 0) return;
  if (!process.env.RESEND_API_KEY) return;

  try {
    const admin = createAdminSupabase();
    const { data: tenant } = await admin.from("tenants").select("name, slug, custom_domain").eq("id", params.tenantId).maybeSingle();
    const companyName = tenant?.name || "BPMSquare";
    const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
    const fromLocalPart = (tenant?.slug || "wfm").toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const fromAddress = `${companyName} <${fromLocalPart}@${sendingDomain}>`;

    const text = params.link
      ? `${params.text}\n\n${params.link.label}: ${tenantOrigin(tenant?.custom_domain as string | null)}${params.link.path}`
      : params.text;

    // The email output channel decides where these really go (a demo
    // workspace never reaches anyone outside it) -- see src/lib/emailOutput.ts.
    const routed = resolveOutbound(await loadEmailOutput(admin, params.tenantId), {
      to: recipients, subject: params.subject, text,
    });
    if (!routed.ok) {
      await logEmail(params.sessionSupabase, {
        tenantId: params.tenantId, kind: "wfm", toEmail: recipients.join(", "), subject: params.subject,
        status: "failed", error: routed.error,
        relatedObjectType: params.relatedObjectType, relatedObjectId: params.relatedObjectId,
        relatedObjectLabel: params.relatedObjectLabel, actorId: params.actorId ?? null, actorEmail: params.actorEmail ?? null,
      });
      return;
    }
    const mail = routed.email;

    const resend = new Resend(process.env.RESEND_API_KEY);
    for (const toEmail of mail.to) {
      let status: "sent" | "failed" = "sent";
      let errorMsg: string | null = null;
      try {
        const result = await resend.emails.send({ from: fromAddress, to: toEmail, subject: mail.subject, text: mail.text });
        if (result.error) { status = "failed"; errorMsg = result.error.message; }
      } catch (e) {
        status = "failed";
        errorMsg = e instanceof Error ? e.message : "Unknown error";
      }
      await logEmail(params.sessionSupabase, {
        tenantId: params.tenantId,
        kind: "wfm",
        toEmail,
        subject: mail.subject,
        status,
        error: errorMsg,
        relatedObjectType: params.relatedObjectType,
        relatedObjectId: params.relatedObjectId,
        relatedObjectLabel: params.relatedObjectLabel,
        actorId: params.actorId ?? null,
        actorEmail: params.actorEmail ?? null,
      });
    }
  } catch (e) {
    console.error("[wfm notify] failed:", e);
  }
}
