import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { logEmail } from "@/lib/emailLog";
import { PRIMARY_HOST } from "@/lib/constants";

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
 * Who should hear about this employee's attendance event: their explicit
 * supervisor (employees.supervisor_id) if one is set and has a login,
 * otherwise every tenant admin (the pre-existing tenant-wide fallback —
 * unchanged behavior for tenants that never set up a reporting line).
 */
export async function getSupervisorEmails(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  employeeId: string
): Promise<string[]> {
  const { data: employee } = await admin
    .from("employees")
    .select("supervisor_id")
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (employee?.supervisor_id) {
    const email = await getEmployeeLoginEmail(admin, tenantId, employee.supervisor_id);
    if (email) return [email];
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
    const { data: tenant } = await admin.from("tenants").select("name, slug").eq("id", params.tenantId).maybeSingle();
    const companyName = tenant?.name || "BPMSquare";
    const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
    const fromLocalPart = (tenant?.slug || "wfm").toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const fromAddress = `${companyName} <${fromLocalPart}@${sendingDomain}>`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    for (const toEmail of recipients) {
      let status: "sent" | "failed" = "sent";
      let errorMsg: string | null = null;
      try {
        const result = await resend.emails.send({ from: fromAddress, to: toEmail, subject: params.subject, text: params.text });
        if (result.error) { status = "failed"; errorMsg = result.error.message; }
      } catch (e) {
        status = "failed";
        errorMsg = e instanceof Error ? e.message : "Unknown error";
      }
      await logEmail(params.sessionSupabase, {
        tenantId: params.tenantId,
        kind: "wfm",
        toEmail,
        subject: params.subject,
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

export function wfmUrl(path: string): string {
  return `https://${PRIMARY_HOST}${path}`;
}
