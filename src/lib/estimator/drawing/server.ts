import "server-only";
import { ATTACHMENT_BUCKET, loadEmailForViewer, type InboxCtx } from "@/lib/inbox/server";
import { MAX_DXF_BYTES } from "./model";

// Loading one DXF attachment of an inbox message for measuring. The same path as the signed-link route
// (src/lib/inbox/files.ts): the attachment must belong to the message named in the request, in the session tenant, and the
// message must be on a channel the person may see (loadEmailForViewer). Anything else is a 404, never a hint that it exists.
// The email and attachment ids come from the request, but only ever as lookups scoped by .eq("tenant_id", tenantId).

export type DxfFile = { name: string; bytes: Uint8Array };
export type LoadedDxf = { ok: true; file: DxfFile } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f-]{36}$/i;
const NOT_FOUND: LoadedDxf = { ok: false, status: 404, error: "File not found" };

export async function loadDxfAttachment(ctx: Pick<InboxCtx, "admin" | "tenantId" | "viewer">, emailId: unknown, attachmentId: unknown): Promise<LoadedDxf> {
  if (typeof emailId !== "string" || typeof attachmentId !== "string" || !UUID.test(emailId) || !UUID.test(attachmentId)) return NOT_FOUND;
  if (!(await loadEmailForViewer(ctx, emailId))) return NOT_FOUND;
  const { data } = await ctx.admin.from("inbound_email_attachments").select("id, email_id, file_name, storage_path, size_bytes")
    .eq("id", attachmentId).eq("email_id", emailId).eq("tenant_id", ctx.tenantId).maybeSingle();
  const a = data as { file_name: string; storage_path: string; size_bytes: number | null } | null;
  if (!a || !a.storage_path.startsWith(`${ctx.tenantId}/`)) return NOT_FOUND;
  if (!/\.dxf$/i.test(a.file_name)) return { ok: false, status: 422, error: "Only DXF drawings can be measured. Save the drawing as a DXF and send that." };
  if (Number(a.size_bytes ?? 0) > MAX_DXF_BYTES) return { ok: false, status: 413, error: `The drawing is larger than ${MAX_DXF_BYTES / 1048576} MB. Save a smaller DXF and try again.` };
  const dl = await ctx.admin.storage.from(ATTACHMENT_BUCKET).download(a.storage_path);
  if (dl.error || !dl.data) return { ok: false, status: 404, error: "The file could not be opened. It may have passed its retention period." };
  return { ok: true, file: { name: a.file_name, bytes: new Uint8Array(await dl.data.arrayBuffer()) } };
}
