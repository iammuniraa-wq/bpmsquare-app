import { NextResponse, type NextRequest } from "next/server";
import { abmAccess, errorResponse, loadTarget, pendingResponse, contactBelongsToAccount, isTenantMember } from "@/lib/abm/server";
import { parseMember } from "@/lib/abm/requests";
import { recheckTarget } from "@/lib/abm/progressServer";
import { ROLE_LABEL } from "@/lib/abm/types";
import { logChange } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";

// The buying group of one target account.
//
// GET  /api/abm/targets/[id]/members
// POST /api/abm/targets/[id]/members { contact_id, role?, is_primary?, notes? }
//   The contact must belong to this target's own account AND this workspace (both checked).
//   Naming someone sends nothing and needs no consent. Roles are per program: the same person
//   can be the decision maker here and an influencer in another program.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("view");
    const { id } = await params;
    const { data: target, missing } = await loadTarget(ctx, id);
    if (missing) return pendingResponse();
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    // Role and primary only: `notes` (a rep's private note about a person) stays in the app.
    const { data, error } = await ctx.supabase.from("abm_buying_group_members").select("id, target_account_id, contact_id, role, is_primary, owner_user_id, added_via, created_at")
      .eq("tenant_id", ctx.tenantId).eq("target_account_id", id).order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ members: data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("edit");
    const { id } = await params;
    const { data: target, missing } = await loadTarget(ctx, id);
    if (missing) return pendingResponse();
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });

    const parsed = parseMember(await req.json().catch(() => null), true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const v = parsed.value;
    const contact = await contactBelongsToAccount(ctx, v.contact_id as string, target.account_id);
    if (!contact) return NextResponse.json({ error: "That person was not found at this company." }, { status: 422 });

    if (v.owner_user_id && !(await isTenantMember(ctx, v.owner_user_id))) return NextResponse.json({ error: "The owner must be a member of this workspace." }, { status: 422 });
    if (v.is_primary) {
      await ctx.supabase.from("abm_buying_group_members").update({ is_primary: false }).eq("tenant_id", ctx.tenantId).eq("target_account_id", id).eq("is_primary", true);
    }
    const { data, error } = await ctx.supabase.from("abm_buying_group_members").insert({
      tenant_id: ctx.tenantId, target_account_id: id, contact_id: contact.id, role: v.role ?? "unknown",
      is_primary: v.is_primary === true, owner_user_id: v.owner_user_id ?? null, notes: v.notes ?? null, added_by: ctx.userId, added_via: "manual",
    }).select("id, target_account_id, contact_id, role, is_primary, owner_user_id, added_via, created_at").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That person is already in this buying group." }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "abm_buying_group_members", objectId: data.id, objectLabel: contact.name, action: "create",
      actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "role", from: null, to: ROLE_LABEL[data.role as keyof typeof ROLE_LABEL] }],
    });
    await emitEvent(ctx.tenantId, {
      name: EVENTS.ABM_MEMBER_ADDED, object_type: "abm_target", object_id: id, actor_id: ctx.userId, account_id: target.account_id, contact_id: contact.id,
      key: `${data.id}:added`, payload: { program_id: target.program_id, target_account_id: id, role: data.role },
    }, ctx.admin);
    await recheckTarget(ctx, target);
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
