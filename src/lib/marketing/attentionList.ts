import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NEEDS_ATTENTION_STATUSES, isEmailStatus, type EmailStatus } from "./emailHealth";
import { isSchemaPending } from "./pending";

// The contacts whose email address needs a person to look at it: bounced, marked as
// spam, invalid, or having trouble. Feeds the "Email needs attention" view of the
// Contacts list (Newsletter Studio). Tenant-scoped on the service-role client.

export type AttentionEntry = { status: EmailStatus; at: string | null; reason: string | null };

/** contact id -> entry, or null while migration 0144 is pending. */
export async function loadAttention(admin: SupabaseClient, tenantId: string): Promise<Map<string, AttentionEntry> | null> {
  const { data, error } = await admin
    .from("contacts")
    .select("id, email_status, email_status_at, email_status_reason")
    .eq("tenant_id", tenantId)
    .in("email_status", [...NEEDS_ATTENTION_STATUSES])
    .limit(5000);
  if (error) {
    if (!isSchemaPending(error)) console.error(`[email health] attention list: ${error.message}`);
    return null;
  }
  const out = new Map<string, AttentionEntry>();
  for (const r of (data ?? []) as { id: string; email_status: string; email_status_at: string | null; email_status_reason: string | null }[]) {
    if (isEmailStatus(r.email_status)) out.set(r.id, { status: r.email_status, at: r.email_status_at, reason: r.email_status_reason });
  }
  return out;
}

/** user id -> display name, for the account owners shown beside a contact. */
export async function ownerNames(admin: SupabaseClient, tenantId: string, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data } = await admin.from("tenant_users").select("user_id, display_name").eq("tenant_id", tenantId).in("user_id", ids);
  for (const r of (data ?? []) as { user_id: string; display_name: string | null }[]) if (r.display_name) out.set(r.user_id, r.display_name);
  return out;
}
