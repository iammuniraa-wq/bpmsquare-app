import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { loadLeadRouteContext } from "@/lib/marketing/leads/guard";
import { isWorkspaceMember } from "@/lib/marketing/leads/people";

// POST /api/marketing/leads/[id]/owner { user_id: string | "me" | null }
// Reassign by hand, or take a lead yourself ("me"), or let go of it (null).
// The new owner must belong to this workspace. Reassigning a company's lead
// never changes the company's own owner (that stays with Coverage).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await loadLeadRouteContext();
  if (!g.ok) return g.response;
  const { supabase, admin, tenantId, userId } = g.ctx;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const raw = body?.user_id;
  if (raw !== null && typeof raw !== "string") return NextResponse.json({ error: "user_id must be a user, \"me\" or null" }, { status: 400 });
  const next = raw === "me" ? userId : raw;
  if (next && !(await isWorkspaceMember(admin, tenantId, next))) {
    return NextResponse.json({ error: "That person isn't part of this workspace" }, { status: 404 });
  }

  const { data: lead, error: lErr } = await admin
    .from("leads").select("id, account_id, contact_id, title, owner_user_id")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: isSchemaPending(lErr) ? 503 : 500 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if ((lead.owner_user_id ?? null) === next) return NextResponse.json({ owner_user_id: next });

  const now = new Date().toISOString();
  const full = { owner_user_id: next, assigned_at: next ? now : null, assignment_reason: next ? (raw === "me" ? "claimed" : "manual") : null };
  let { error } = await admin.from("leads").update(full).eq("id", id).eq("tenant_id", tenantId);
  if (error && isSchemaPending(error)) ({ error } = await admin.from("leads").update({ owner_user_id: next }).eq("id", id).eq("tenant_id", tenantId));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "leads", objectId: id, objectLabel: lead.title ?? null,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "owner", from: lead.owner_user_id ?? null, to: next }],
  });
  if (next) {
    await emitEvent(tenantId, {
      name: EVENTS.LEAD_ASSIGNED, object_type: "lead", object_id: id, actor_id: userId,
      lead_id: id, account_id: lead.account_id, contact_id: lead.contact_id,
      key: `${id}:assigned:${next}:${now.slice(0, 16)}`, payload: { owner: next, reason: raw === "me" ? "claimed" : "manual" },
    }, admin);
  }
  return NextResponse.json({ owner_user_id: next });
}
