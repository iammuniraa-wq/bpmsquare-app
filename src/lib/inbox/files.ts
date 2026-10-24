import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTACHMENT_BUCKET, loadEmailForViewer, type InboxCtx } from "./server";

// Files are never public. A person who may see the message (its channel) asks for a short-lived signed link, one file at
// a time; images open in the browser, everything else downloads, and the content type comes from what the file really
// is (it was sniffed on arrival), never from the sender's claim.

export const SIGNED_URL_SECONDS = 60;
const INLINE_OK = new Set(["image/png", "image/jpeg"]);

async function sign(admin: SupabaseClient, bucket: string, path: string, name: string, mime: string | null): Promise<string | null> {
  const inline = !!mime && INLINE_OK.has(mime);
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS, inline ? undefined : { download: name });
  return error || !data ? null : data.signedUrl;
}

/** A link to one attachment of a message the person may see, or null (a 404). */
export async function attachmentLink(ctx: Pick<InboxCtx, "admin" | "tenantId" | "viewer">, attachmentId: string): Promise<{ url: string; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return null;
  const { data } = await ctx.admin.from("inbound_email_attachments").select("email_id, file_name, storage_path, mime_type")
    .eq("id", attachmentId).eq("tenant_id", ctx.tenantId).maybeSingle();
  const a = data as { email_id: string; file_name: string; storage_path: string; mime_type: string | null } | null;
  if (!a) return null;
  if (!(await loadEmailForViewer(ctx, a.email_id))) return null;
  if (!a.storage_path.startsWith(`${ctx.tenantId}/`)) return null;
  const url = await sign(ctx.admin, ATTACHMENT_BUCKET, a.storage_path, a.file_name, a.mime_type);
  return url ? { url, name: a.file_name } : null;
}

/** A link to a file copied onto a record. The caller has already checked the person may open that kind of record. */
export async function recordFileLink(admin: SupabaseClient, tenantId: string, fileId: string): Promise<{ url: string; name: string; objectType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const { data } = await admin.from("record_files").select("object_type, file_name, storage_path, mime_type").eq("id", fileId).eq("tenant_id", tenantId).maybeSingle();
  const f = data as { object_type: string; file_name: string; storage_path: string; mime_type: string | null } | null;
  if (!f || !f.storage_path.startsWith(`${tenantId}/`)) return null;
  const url = await sign(admin, ATTACHMENT_BUCKET, f.storage_path, f.file_name, f.mime_type);
  return url ? { url, name: f.file_name, objectType: f.object_type } : null;
}
