import { NextResponse, type NextRequest } from "next/server";
import {
  abmAccess, errorResponse, loadTarget, loadProgram, pendingResponse, isTenantMember, dealBelongsToAccount, logTargetChange,
} from "@/lib/abm/server";
import { parseTargetPatch } from "@/lib/abm/requests";
import { refreshProgress } from "@/lib/abm/progressServer";
import { loadTargetBundle } from "@/lib/abm/views";
import { PROGRESS_LABEL, TIER_LABEL, type AbmProgress } from "@/lib/abm/types";
import { diffForLog, logChange } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";

// One target account (one company in one program).
//
// PATCH allowlist: tier, owner_user_id, next_step, next_step_due, next_step_user_id,
//   opportunity_id, notes, custom_data (cf_ keys only), and a PERSON's progress change:
//   { progress, progress_reason } -- the reason is required; Dropped stores it as dropped_reason.
//   { check_progress: true } asks the rules to look at what happened.
// A manual change records progress_source = manual, who and when. The rules never move a
// target backwards and never touch a Dropped, Won or Lost one.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("view");
    const { id } = await params;
    const { missing, bundle } = await loadTargetBundle(ctx, id);
    if (missing) return pendingResponse();
    if (!bundle) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    // A rep's private note about a person is the app's alone: it is not returned here either.
    return NextResponse.json({ ...bundle, members: bundle.members.map(({ notes: _n, ...m }) => m) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("edit");
    const { id } = await params;
    const { data: before, missing } = await loadTarget(ctx, id);
    if (missing) return pendingResponse();
    if (!before) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    const { data: program } = await loadProgram(ctx, before.program_id);
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

    const parsed = parseTargetPatch(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const v = parsed.value;

    const { data: acct } = await ctx.supabase.from("accounts").select("name").eq("id", before.account_id).eq("tenant_id", ctx.tenantId).maybeSingle();
    const label = `${(acct as { name?: string } | null)?.name ?? "Account"} in ${program.name}`;

    const patch: Record<string, unknown> = {};
    if (v.tier !== undefined) patch.tier = v.tier;
    if (v.owner_user_id !== undefined) {
      if (v.owner_user_id && !(await isTenantMember(ctx, v.owner_user_id))) return NextResponse.json({ error: "The owner must be a member of this workspace." }, { status: 422 });
      patch.owner_user_id = v.owner_user_id;
      patch.owner_source = "manual";
    }
    if (v.next_step !== undefined) patch.next_step = v.next_step;
    if (v.next_step_due !== undefined) patch.next_step_due = v.next_step_due;
    if (v.next_step_user_id !== undefined) {
      if (v.next_step_user_id && !(await isTenantMember(ctx, v.next_step_user_id))) return NextResponse.json({ error: "The person must be a member of this workspace." }, { status: 422 });
      patch.next_step_user_id = v.next_step_user_id;
    }
    if (v.opportunity_id !== undefined) {
      if (v.opportunity_id && !(await dealBelongsToAccount(ctx, v.opportunity_id, before.account_id))) {
        return NextResponse.json({ error: "That deal was not found for this company." }, { status: 422 });
      }
      patch.opportunity_id = v.opportunity_id;
    }
    if (v.notes !== undefined) patch.notes = v.notes;
    if (v.custom_data) patch.custom_data = v.custom_data;

    const manual = v.progress && v.progress.to !== before.progress ? v.progress : null;
    const now = new Date().toISOString();
    if (manual) {
      patch.progress = manual.to;
      patch.progress_source = "manual";
      patch.progress_reason = manual.reason;
      patch.progress_changed_at = now;
      patch.progress_changed_by = ctx.userId;
      patch.dropped_reason = manual.to === "dropped" ? manual.reason : null;
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await ctx.supabase.from("abm_target_accounts").update({ ...patch, updated_at: now }).eq("id", id).eq("tenant_id", ctx.tenantId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const loggable: Record<string, unknown> = { ...patch };
      delete loggable.progress_changed_at; delete loggable.progress_changed_by; delete loggable.owner_source;
      if (manual) loggable.progress = `${PROGRESS_LABEL[manual.to as AbmProgress]} (by a person: ${manual.reason})`;
      const beforeForLog: Record<string, unknown> = { ...(before as unknown as Record<string, unknown>), progress: PROGRESS_LABEL[before.progress] };
      await logTargetChange(ctx, before, label, diffForLog("abm_target_accounts", beforeForLog, loggable));

      const key = (s: string) => `${id}:${s}:${now.slice(0, 16)}`;
      const base = { object_type: "abm_target", object_id: id, actor_id: ctx.userId, account_id: before.account_id } as const;
      const payload = { program_id: program.id, target_account_id: id };
      if (manual) await emitEvent(ctx.tenantId, { ...base, name: EVENTS.ABM_TARGET_PROGRESS_CHANGED, key: key(`${before.progress}->${manual.to}`), payload: { ...payload, from: before.progress, to: manual.to, source: "manual" } }, ctx.admin);
      if (v.tier !== undefined && v.tier !== before.tier) await emitEvent(ctx.tenantId, { ...base, name: EVENTS.ABM_TARGET_TIER_CHANGED, key: key("tier"), payload: { ...payload, from: TIER_LABEL[before.tier], to: TIER_LABEL[v.tier] } }, ctx.admin);
      if (v.owner_user_id !== undefined && v.owner_user_id !== before.owner_user_id) await emitEvent(ctx.tenantId, { ...base, name: EVENTS.ABM_TARGET_OWNER_CHANGED, key: key("owner"), payload: { ...payload, owner_source: "manual" } }, ctx.admin);
      if (v.next_step !== undefined && v.next_step !== before.next_step) await emitEvent(ctx.tenantId, { ...base, name: EVENTS.ABM_TARGET_NEXT_STEP_SET, key: key("next"), payload: { ...payload, due: v.next_step_due ?? before.next_step_due } }, ctx.admin);
    }

    // A person's own change stands; otherwise let the rules look again (also after a deal was linked).
    let ruled = 0;
    if (!manual && (v.check_progress || v.opportunity_id)) {
      const { data: fresh } = await loadTarget(ctx, id);
      if (fresh) ruled = await refreshProgress(ctx, program, [fresh], new Map([[fresh.account_id, (acct as { name?: string } | null)?.name ?? "Account"]]));
    }

    const { data: after } = await loadTarget(ctx, id);
    return NextResponse.json({ ...after, rules_changed: ruled });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("delete");
    const { id } = await params;
    const { data: snap, missing } = await loadTarget(ctx, id);
    if (missing) return pendingResponse();
    if (!snap) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    const [{ data: acct }, { data: prog }] = await Promise.all([
      ctx.supabase.from("accounts").select("name").eq("id", snap.account_id).eq("tenant_id", ctx.tenantId).maybeSingle(),
      ctx.supabase.from("abm_programs").select("name").eq("id", snap.program_id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ]);

    const { error } = await ctx.supabase.from("abm_target_accounts").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "abm_target_accounts", objectId: id,
      objectLabel: `${(acct as { name?: string } | null)?.name ?? "Account"} in ${(prog as { name?: string } | null)?.name ?? "program"}`,
      action: "delete", actorId: ctx.userId, actorEmail: ctx.email,
    });
    await emitEvent(ctx.tenantId, { name: EVENTS.ABM_TARGET_REMOVED, object_type: "abm_target", object_id: id, actor_id: ctx.userId, account_id: snap.account_id, key: `${id}:removed`, payload: { program_id: snap.program_id } }, ctx.admin);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}
