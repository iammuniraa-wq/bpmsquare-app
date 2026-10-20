import { NextResponse, type NextRequest } from "next/server";
import {
  abmAccess, errorResponse, loadProgram, pendingResponse, TARGET_COLUMNS, accountIdsForSegment, accountIdsForTargetGroup,
  segmentExists, targetGroupExists, addTargets, verifiedAccounts, MAX_ADD_PER_CALL,
} from "@/lib/abm/server";
import { parseAddAccounts } from "@/lib/abm/requests";
import { logChange } from "@/lib/changeLog";
import type { AbmTargetAccount } from "@/lib/abm/types";

// The target list of one program.
//
// GET  /api/abm/programs/[id]/targets?progress=&tier=      -> { targets }
// POST /api/abm/programs/[id]/targets
//        { account_ids: [...] }  |  { target_group_id }  |  { segment_id }   (+ tier?, preview?)
//   A target list is a SNAPSHOT: a group or segment is read once, its accounts are inserted as
//   rows, and the program remembers where they came from. It never changes by itself.
//   preview: true answers with the names that would be added and writes nothing.
//   -> 201 { added, already_in, not_found, capped, ids }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("view");
    const { id } = await params;
    const { data: program, missing } = await loadProgram(ctx, id);
    if (missing) return pendingResponse();
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });
    let q = ctx.supabase.from("abm_target_accounts").select(TARGET_COLUMNS).eq("tenant_id", ctx.tenantId).eq("program_id", id).order("created_at").limit(2000);
    const sp = req.nextUrl.searchParams;
    if (sp.get("progress")) q = q.eq("progress", sp.get("progress") as string);
    if (sp.get("tier")) q = q.eq("tier", sp.get("tier") as string);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ targets: (data ?? []) as unknown as AbmTargetAccount[] });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("edit");
    const { id } = await params;
    const { data: program, missing } = await loadProgram(ctx, id);
    if (missing) return pendingResponse();
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

    const parsed = parseAddAccounts(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const v = parsed.value;

    let ids: string[];
    let via: AbmTargetAccount["added_via"] = "manual";
    let sourcePatch: Record<string, unknown> | null = null;
    if (v.target_group_id) {
      if (!(await targetGroupExists(ctx, v.target_group_id))) return NextResponse.json({ error: "Target group not found" }, { status: 404 });
      ids = await accountIdsForTargetGroup(ctx, v.target_group_id);
      via = "target_group";
      sourcePatch = { source_target_group_id: v.target_group_id, source_segment_id: null };
    } else if (v.segment_id) {
      if (!(await segmentExists(ctx, v.segment_id))) return NextResponse.json({ error: "Segment not found" }, { status: 404 });
      ids = await accountIdsForSegment(ctx, v.segment_id);
      via = "segment";
      sourcePatch = { source_segment_id: v.segment_id, source_target_group_id: null };
    } else {
      ids = v.account_ids ?? [];
    }

    if (v.preview) {
      const accounts = await verifiedAccounts(ctx, ids.slice(0, MAX_ADD_PER_CALL));
      const { data: existing } = await ctx.supabase.from("abm_target_accounts").select("account_id").eq("tenant_id", ctx.tenantId).eq("program_id", id);
      const have = new Set(((existing ?? []) as { account_id: string }[]).map((r) => r.account_id));
      const fresh = accounts.filter((a) => !have.has(a.id));
      return NextResponse.json({
        would_add: fresh.length, already_in: accounts.length - fresh.length, capped: Math.max(0, ids.length - MAX_ADD_PER_CALL),
        sample: fresh.slice(0, 20).map((a) => ({ id: a.id, name: a.name, city: a.city ?? null })),
      });
    }

    const result = await addTargets(ctx, program, ids, via, v.tier);
    if (sourcePatch) {
      const now = new Date().toISOString();
      await ctx.supabase.from("abm_programs").update({ ...sourcePatch, source_snapshot_at: now, updated_at: now }).eq("id", id).eq("tenant_id", ctx.tenantId);
      await logChange(ctx.supabase, {
        tenantId: ctx.tenantId, objectType: "abm_programs", objectId: id, objectLabel: program.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email,
        changes: [{ field: "target list", from: null, to: `${result.added} added from ${via === "segment" ? "a segment" : "a target group"}` }],
      });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
