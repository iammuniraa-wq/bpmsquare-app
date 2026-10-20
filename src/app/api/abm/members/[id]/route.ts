import { NextResponse, type NextRequest } from "next/server";
import { abmAccess, errorResponse, isUuid, loadTarget, pendingResponse, isMissingRelation, isTenantMember } from "@/lib/abm/server";
import { parseMember } from "@/lib/abm/requests";
import { recheckTarget } from "@/lib/abm/progressServer";
import { ROLE_LABEL, type AbmRole } from "@/lib/abm/types";
import { diffForLog, logChange } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";

// One buying-group member, addressed by its own id (never by contact or account name).
// PATCH { role?, is_primary?, notes? }  -- DELETE removes the person from this buying group only;
// the contact itself is untouched.

type Row = { id: string; target_account_id: string; contact_id: string; role: AbmRole; is_primary: boolean; owner_user_id: string | null; notes: string | null };

async function loadMember(ctx: Awaited<ReturnType<typeof abmAccess>>, id: string): Promise<{ row: Row | null; missing: boolean }> {
  if (!isUuid(id)) return { row: null, missing: false };
  const { data, error } = await ctx.supabase.from("abm_buying_group_members").select("id, target_account_id, contact_id, role, is_primary, owner_user_id, notes").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { row: null, missing: isMissingRelation(error) };
  return { row: (data as Row | null) ?? null, missing: false };
}

async function contactName(ctx: Awaited<ReturnType<typeof abmAccess>>, contactId: string): Promise<string> {
  const { data } = await ctx.supabase.from("contacts").select("name").eq("id", contactId).eq("tenant_id", ctx.tenantId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "Person";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("edit");
    const { id } = await params;
    const { row: before, missing } = await loadMember(ctx, id);
    if (missing) return pendingResponse();
    if (!before) return NextResponse.json({ error: "Person not found" }, { status: 404 });

    const parsed = parseMember(await req.json().catch(() => null), false);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const patch: Record<string, unknown> = {};
    if (parsed.value.role !== undefined) patch.role = parsed.value.role;
    if (parsed.value.is_primary !== undefined) patch.is_primary = parsed.value.is_primary;
    if (parsed.value.notes !== undefined) patch.notes = parsed.value.notes;
    if (parsed.value.owner_user_id !== undefined) {
      if (parsed.value.owner_user_id && !(await isTenantMember(ctx, parsed.value.owner_user_id))) return NextResponse.json({ error: "The owner must be a member of this workspace." }, { status: 422 });
      patch.owner_user_id = parsed.value.owner_user_id;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 422 });

    if (patch.is_primary === true) {
      await ctx.supabase.from("abm_buying_group_members").update({ is_primary: false }).eq("tenant_id", ctx.tenantId).eq("target_account_id", before.target_account_id).eq("is_primary", true);
    }
    const { data, error } = await ctx.supabase.from("abm_buying_group_members").update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id).eq("tenant_id", ctx.tenantId).select("id, target_account_id, contact_id, role, is_primary, owner_user_id, added_via, created_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const label = await contactName(ctx, before.contact_id);
    const changes = diffForLog("abm_buying_group_members", { role: before.role, is_primary: before.is_primary, notes: before.notes }, patch)
      .map((c) => (c.field === "notes" ? { field: "notes", from: c.from ? "[note]" : null, to: c.to ? "[note]" : null, redacted: true } : c.field === "role" ? { ...c, from: ROLE_LABEL[before.role], to: ROLE_LABEL[patch.role as AbmRole] } : c));
    if (changes.length > 0) await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "abm_buying_group_members", objectId: id, objectLabel: label, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes });

    const { data: target } = await loadTarget(ctx, before.target_account_id);
    if (target) {
      if (patch.role !== undefined && patch.role !== before.role) {
        await emitEvent(ctx.tenantId, {
          name: EVENTS.ABM_MEMBER_ROLE_CHANGED, object_type: "abm_target", object_id: target.id, actor_id: ctx.userId, account_id: target.account_id, contact_id: before.contact_id,
          key: `${id}:${before.role}->${patch.role}:${new Date().toISOString().slice(0, 16)}`, payload: { program_id: target.program_id, target_account_id: target.id, from: before.role, to: patch.role },
        }, ctx.admin);
        await recheckTarget(ctx, target);
      }
    }
    return NextResponse.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("edit");
    const { id } = await params;
    const { row, missing } = await loadMember(ctx, id);
    if (missing) return pendingResponse();
    if (!row) return NextResponse.json({ error: "Person not found" }, { status: 404 });
    const label = await contactName(ctx, row.contact_id);
    const { error } = await ctx.supabase.from("abm_buying_group_members").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "abm_buying_group_members", objectId: id, objectLabel: label, action: "delete", actorId: ctx.userId, actorEmail: ctx.email });
    const { data: target } = await loadTarget(ctx, row.target_account_id);
    if (target) {
      await emitEvent(ctx.tenantId, {
        name: EVENTS.ABM_MEMBER_REMOVED, object_type: "abm_target", object_id: target.id, actor_id: ctx.userId, account_id: target.account_id, contact_id: row.contact_id,
        key: `${id}:removed`, payload: { program_id: target.program_id, target_account_id: target.id, role: row.role },
      }, ctx.admin);
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}
