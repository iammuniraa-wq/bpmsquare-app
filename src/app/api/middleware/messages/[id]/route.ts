import { NextResponse } from "next/server";
import { guard, fail, needsUpdate } from "../../_guard";
import { getMessageDetail } from "@/lib/middleware/monitor";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";

// GET /api/middleware/messages/<source>:<uuid> -- one message opened (admin).
// -> { message, detail }. Bodies and phone numbers are decrypted here and only here;
// every open is written to the change history.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { id } = await params;
  const r = await getMessageDetail(g.ctx.admin, g.ctx.tenantId, decodeURIComponent(id));
  if (!r.ok) {
    if (r.reason === "needs_database_update") return needsUpdate();
    return fail(r.reason === "bad_id" ? 422 : 404, r.reason === "bad_id" ? "That is not a message id." : "Message not found.");
  }
  const u = await getAuthUser();
  await logChange(g.ctx.supabase, {
    tenantId: g.ctx.tenantId, objectType: "integration_messages", objectId: r.value.message.id.split(":")[1], objectLabel: r.value.message.summary.slice(0, 120), action: "update",
    actorId: u?.id, actorEmail: u?.email, changes: [{ field: "message opened", from: null, to: r.value.message.source }],
  });
  return NextResponse.json(r.value);
}
