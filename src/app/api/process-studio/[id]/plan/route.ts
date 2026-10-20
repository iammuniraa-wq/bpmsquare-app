import { NextResponse, type NextRequest } from "next/server";
import { parsePlanSave } from "@/lib/studio/requests";
import { studioAccess, errorResponse, ownedStudy, childOf, insertRows, updateStudy } from "@/lib/studio/server";
import { runPlan } from "@/lib/studio/run";

export const maxDuration = 120;

// Step 5.
//
// POST  { confirm? }  -> build the plan: template tasks by rule, tasks from the kept
//                        changes, a few client-specific additions from the model.
//                        409 { confirm_required } when a plan already exists.
// PATCH { start_date?, weekend?, durations[], owners[], oks[], comments[], added[], removed[] }
//                     -> the one batch Save: ticks, comments and durations together.
//                        Dates are never stored; they are computed from the start date
//                        and the durations whenever they are shown.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
    return NextResponse.json(await runPlan(ctx, study, body?.confirm === true));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    const parsed = parsePlanSave(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const v = parsed.value;
    const now = new Date().toISOString();

    const header: Record<string, unknown> = {};
    if (v.start_date !== undefined) header.plan_start_date = v.start_date;
    if (v.weekend) header.weekend = v.weekend;
    if (Object.keys(header).length) await updateStudy(ctx, study.id, header);

    // Every task id from the body is proved to belong to THIS study before it is touched.
    const taskIds = new Set<string>([...v.durations.map((d) => d.task_id), ...v.owners.map((o) => o.task_id), ...v.removed, ...v.comments.flatMap((c) => (c.task_id ? [c.task_id] : []))]);
    const owned = new Map<string, { id: string; client_added: boolean; phase: string }>();
    for (const id of taskIds) {
      const t = await childOf<{ id: string; client_added: boolean; phase: string }>(ctx, "process_study_tasks", study.id, id, "id, client_added, phase");
      if (!t) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      owned.set(id, t);
    }

    for (const d of v.durations) {
      const { error } = await ctx.admin.from("process_study_tasks").update({ duration_days: d.duration_days, updated_at: now })
        .eq("id", d.task_id).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const o of v.owners) {
      const { error } = await ctx.admin.from("process_study_tasks").update({ owner: o.owner, updated_at: now })
        .eq("id", o.task_id).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const id of v.removed) {
      if (!owned.get(id)?.client_added) return NextResponse.json({ error: "Only a task you added can be removed." }, { status: 409 });
      const { error } = await ctx.admin.from("process_study_tasks").delete().eq("id", id).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (v.added.length) {
      const { data: last } = await ctx.supabase.from("process_study_tasks").select("sort_order")
        .eq("tenant_id", ctx.tenantId).eq("study_id", study.id).order("sort_order", { ascending: false }).limit(1);
      let next = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? -10) + 10;
      await insertRows(ctx, "process_study_tasks", study.id, v.added.map((a) => ({
        ...a, milestone: false, from_template: false, client_added: true, sort_order: (next += 10),
      })));
    }

    // "Looks right" ticks: one row per phase, the latest state wins.
    for (const k of v.oks) {
      const { data: existing } = await ctx.supabase.from("process_study_comments").select("id")
        .eq("tenant_id", ctx.tenantId).eq("study_id", study.id).eq("phase", k.phase).not("phase_ok", "is", null).limit(1);
      const rowId = (existing?.[0] as { id: string } | undefined)?.id;
      if (rowId) {
        await ctx.admin.from("process_study_comments").update({ phase_ok: k.ok, updated_at: now })
          .eq("id", rowId).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
      } else {
        await insertRows(ctx, "process_study_comments", study.id, [{ phase: k.phase, task_id: null, phase_ok: k.ok, text: null, author_user_id: ctx.userId }]);
      }
    }

    // Comments: one box per phase or task. Empty text removes it. The client's words are never edited by the AI.
    for (const c of v.comments) {
      let q = ctx.supabase.from("process_study_comments").select("id")
        .eq("tenant_id", ctx.tenantId).eq("study_id", study.id).eq("phase", c.phase).not("text", "is", null);
      q = c.task_id ? q.eq("task_id", c.task_id) : q.is("task_id", null);
      const { data: existing } = await q.limit(1);
      const rowId = (existing?.[0] as { id: string } | undefined)?.id;
      if (!c.text) {
        if (rowId) await ctx.admin.from("process_study_comments").delete().eq("id", rowId).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
      } else if (rowId) {
        await ctx.admin.from("process_study_comments").update({ text: c.text, updated_at: now })
          .eq("id", rowId).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
      } else {
        await insertRows(ctx, "process_study_comments", study.id, [{ phase: c.phase, task_id: c.task_id, text: c.text, phase_ok: null, author_user_id: ctx.userId }]);
      }
    }

    await updateStudy(ctx, study.id, {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
