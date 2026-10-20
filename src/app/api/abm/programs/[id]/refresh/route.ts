import { NextResponse, type NextRequest } from "next/server";
import {
  abmAccess, errorResponse, loadProgram, pendingResponse, isUuid, accountIdsForSegment, accountIdsForTargetGroup, addTargets, TARGET_COLUMNS,
} from "@/lib/abm/server";
import { refreshProgress } from "@/lib/abm/progressServer";
import { logChange } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import type { AbmTargetAccount } from "@/lib/abm/types";

// POST /api/abm/programs/[id]/refresh
//   { what: "progress" }
//        Runs the progress rules over every target now. -> { changed }
//   { what: "source" }
//        Compares the saved source list (target group or segment) with the targets and answers
//        { new: [{id, name}], no_longer_matching: [{target_id, name}] }. Writes nothing.
//   { what: "source", add: [account ids], drop: [target ids] }
//        Applies only what the person ticked. A dropped target keeps its row, with the reason
//        "No longer in the source list". -> { added, dropped }
// The list is a commitment: it never changes unless a person presses this.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("edit");
    const { id } = await params;
    const { data: program, missing } = await loadProgram(ctx, id);
    if (missing) return pendingResponse();
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { what?: string; add?: unknown; drop?: unknown } | null;

    const { data: tRows } = await ctx.supabase.from("abm_target_accounts").select(TARGET_COLUMNS).eq("tenant_id", ctx.tenantId).eq("program_id", id).limit(5000);
    const targets = (tRows ?? []) as unknown as AbmTargetAccount[];
    const accountIds = [...new Set(targets.map((t) => t.account_id))];
    const names = new Map<string, string>();
    for (let i = 0; i < accountIds.length; i += 150) {
      const { data: a } = await ctx.supabase.from("accounts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", accountIds.slice(i, i + 150));
      for (const r of (a ?? []) as { id: string; name: string }[]) names.set(r.id, r.name);
    }

    if (body?.what === "progress") {
      const changed = await refreshProgress(ctx, program, targets, names);
      return NextResponse.json({ changed });
    }

    if (body?.what === "source") {
      const sourceIds = program.source_target_group_id
        ? await accountIdsForTargetGroup(ctx, program.source_target_group_id)
        : program.source_segment_id ? await accountIdsForSegment(ctx, program.source_segment_id) : null;
      if (sourceIds === null) return NextResponse.json({ error: "This program was not built from a target group or segment." }, { status: 422 });

      const have = new Set(targets.map((t) => t.account_id));
      const inSource = new Set(sourceIds);
      const freshIds = sourceIds.filter((a) => !have.has(a));
      const stale = targets.filter((t) => !inSource.has(t.account_id) && t.progress !== "dropped");

      if (!Array.isArray(body.add) && !Array.isArray(body.drop)) {
        const freshNames = new Map<string, string>();
        for (let i = 0; i < freshIds.length; i += 150) {
          const { data: a } = await ctx.supabase.from("accounts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", freshIds.slice(i, i + 150));
          for (const r of (a ?? []) as { id: string; name: string }[]) freshNames.set(r.id, r.name);
        }
        return NextResponse.json({
          new: freshIds.filter((x) => freshNames.has(x)).map((x) => ({ id: x, name: freshNames.get(x) as string })),
          no_longer_matching: stale.map((t) => ({ target_id: t.id, name: names.get(t.account_id) ?? "Account" })),
        });
      }

      // Only ids that the comparison itself produced can be applied: a client cannot add or drop anything else here.
      const addIds = (Array.isArray(body.add) ? body.add : []).filter((x): x is string => isUuid(x) && freshIds.includes(x));
      const dropIds = new Set((Array.isArray(body.drop) ? body.drop : []).filter((x): x is string => isUuid(x) && stale.some((t) => t.id === x)));
      const result = addIds.length > 0 ? await addTargets(ctx, program, addIds, program.source_target_group_id ? "target_group" : "segment") : { added: 0 };
      let dropped = 0;
      for (const t of stale.filter((x) => dropIds.has(x.id))) {
        const now = new Date().toISOString();
        const reason = "No longer in the source list";
        const { error } = await ctx.supabase.from("abm_target_accounts")
          .update({ progress: "dropped", dropped_reason: reason, progress_source: "manual", progress_reason: reason, progress_changed_at: now, progress_changed_by: ctx.userId, updated_at: now })
          .eq("id", t.id).eq("tenant_id", ctx.tenantId);
        if (error) continue;
        dropped++;
        await logChange(ctx.supabase, {
          tenantId: ctx.tenantId, objectType: "abm_target_accounts", objectId: t.id, objectLabel: `${names.get(t.account_id) ?? "Account"} in ${program.name}`, action: "update",
          actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "progress", from: t.progress, to: "dropped" }, { field: "dropped_reason", from: null, to: reason }],
        });
        await emitEvent(ctx.tenantId, {
          name: EVENTS.ABM_TARGET_PROGRESS_CHANGED, object_type: "abm_target", object_id: t.id, actor_id: ctx.userId, account_id: t.account_id,
          key: `${t.id}:${t.progress}->dropped`, payload: { program_id: id, target_account_id: t.id, from: t.progress, to: "dropped", source: "manual" },
        }, ctx.admin);
      }
      await ctx.supabase.from("abm_programs").update({ source_snapshot_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId);
      return NextResponse.json({ added: result.added, dropped });
    }

    return NextResponse.json({ error: 'Say what to refresh: "progress" or "source".' }, { status: 422 });
  } catch (e) {
    return errorResponse(e);
  }
}
