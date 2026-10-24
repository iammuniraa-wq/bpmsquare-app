import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTACHMENT_BUCKET, isMissingRelation } from "./server";

// Retention (owner decisions 2026-10-24). A message past its expires_at (received + 90 days, or converted + 30 days)
// loses its body, its snippet and its files; a stub row stays: id, sender, subject, when it came and the record it
// became. The files copied onto a record at conversion are different objects in a different folder and are never
// touched here, which is the whole point of copying them.

export const PURGE_BATCH = 500;

/** A storage path may be removed only if it sits in this message's own folder in this workspace. */
export const ownsPath = (tenantId: string, emailId: string, path: string) => path.startsWith(`${tenantId}/inbox/${emailId}/`);

export async function purgeExpired(admin: SupabaseClient, opts: { now?: Date; limit?: number } = {}): Promise<{ emails: number; files: number; pending?: boolean }> {
  const now = (opts.now ?? new Date()).toISOString();
  const { data, error } = await admin.from("inbound_emails").select("id, tenant_id")
    .is("purged_at", null).lte("expires_at", now).order("expires_at", { ascending: true }).limit(opts.limit ?? PURGE_BATCH);
  if (error) return { emails: 0, files: 0, pending: isMissingRelation(error) };
  const rows = (data ?? []) as { id: string; tenant_id: string }[];
  if (rows.length === 0) return { emails: 0, files: 0 };

  const byTenant = new Map<string, string[]>();
  for (const r of rows) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r.id]);

  let emails = 0;
  let files = 0;
  for (const [tenantId, ids] of byTenant) {
    const { data: atts } = await admin.from("inbound_email_attachments").select("id, email_id, storage_path").eq("tenant_id", tenantId).in("email_id", ids);
    const list = ((atts ?? []) as { id: string; email_id: string; storage_path: string }[]).filter((a) => ownsPath(tenantId, a.email_id, a.storage_path));
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const { error: rmErr } = await admin.storage.from(ATTACHMENT_BUCKET).remove(chunk.map((a) => a.storage_path));
      if (rmErr) console.error("[inbox] purge could not remove files", rmErr.message);
    }
    await admin.from("inbound_email_attachments").delete().eq("tenant_id", tenantId).in("email_id", ids);
    files += list.length;
    const { error: upErr } = await admin.from("inbound_emails")
      .update({ body_text: null, snippet: null, to_addresses: [], purged_at: now })
      .eq("tenant_id", tenantId).in("id", ids).is("purged_at", null);
    if (!upErr) emails += ids.length;
  }
  return { emails, files };
}
