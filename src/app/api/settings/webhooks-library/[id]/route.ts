import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, needsUpdate, fail, UUID_RE } from "../_guard";
import { changeEntries, deleteWebhook, updateWebhook } from "@/lib/webhooks/library";
import { logChange } from "@/lib/changeLog";

// PATCH { same fields as POST, all optional; headers = the FULL list (value "" keeps the stored one, a name left out is removed);
//         active, regenerate_secret: true } -> { webhook, signing_secret? }   (signing_secret only when regenerated)
// DELETE -> { deleted: true }  or  409 { error, used_by } while a Link, a Coverage row or a button uses it.
// The kind and the object of a webhook are fixed after it is created.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "Not found");
  const r = await updateWebhook(g.ctx.admin, g.ctx.tenantId, id, await jsonBody(req));
  if (!r.ok) return r.pending ? needsUpdate() : fail(r.status, r.error ?? "Could not save.", { errors: r.errors ?? [] });
  const changes = changeEntries(r.value.before, r.value.patch);
  if (changes.length) {
    await logChange(g.ctx.supabase, {
      tenantId: g.ctx.tenantId, objectType: "webhooks", objectId: id, objectLabel: r.value.after.name, action: "update",
      actorId: g.ctx.userId, actorEmail: g.ctx.email, changes,
    });
  }
  return NextResponse.json({ webhook: r.value.webhook, ...(r.value.secret ? { signing_secret: r.value.secret } : {}) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "Not found");
  const r = await deleteWebhook(g.ctx.admin, g.ctx.tenantId, id);
  if (!r.ok) return r.pending ? needsUpdate() : fail(r.status, r.error ?? "Could not delete.", r.usedBy ? { used_by: r.usedBy } : {});
  await logChange(g.ctx.supabase, {
    tenantId: g.ctx.tenantId, objectType: "webhooks", objectId: id, objectLabel: r.value.row.name, action: "delete",
    actorId: g.ctx.userId, actorEmail: g.ctx.email,
  });
  return NextResponse.json({ deleted: true });
}
