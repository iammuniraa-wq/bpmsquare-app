import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EmailLogKind = "quote" | "campaign" | "wfm" | "auth";
export type EmailLogStatus = "sent" | "failed";

/**
 * Records one email_log row. Never throws -- a logging failure must not
 * fail the send it's describing (the email may have already gone out).
 * Call this with the tenant-scoped session client (never
 * createAdminSupabase()) so RLS enforces tenant_id even if a caller ever
 * got that field wrong; call it AFTER the real send has already resolved
 * (success or failure both get logged).
 */
export async function logEmail(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    kind: EmailLogKind;
    toEmail: string;
    subject: string;
    status: EmailLogStatus;
    error?: string | null;
    relatedObjectType?: string | null;
    relatedObjectId?: string | null;
    relatedObjectLabel?: string | null;
    actorId?: string | null;
    actorEmail?: string | null;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from("email_log").insert({
      tenant_id: params.tenantId,
      kind: params.kind,
      to_email: params.toEmail,
      subject: params.subject,
      status: params.status,
      error: params.error ?? null,
      related_object_type: params.relatedObjectType ?? null,
      related_object_id: params.relatedObjectId ?? null,
      related_object_label: params.relatedObjectLabel ?? null,
      actor_id: params.actorId ?? null,
      actor_email: params.actorEmail ?? null,
    });
    if (error) console.error(`[emailLog] insert failed for ${params.kind} send to ${params.toEmail}`, error.message);
  } catch (e) {
    console.error(`[emailLog] failed to record ${params.kind} send to ${params.toEmail}`, e);
  }
}
