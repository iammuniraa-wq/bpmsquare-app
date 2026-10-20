import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";
import { journeyActivity } from "@/lib/marketing/journeys/activity";
import { loadJourneyRow } from "@/lib/marketing/journeys/store";

// GET /api/journeys/[id]/activity -> counts (entered, waiting, stuck, finished, sent, tasks), the people skipped grouped by
// reason, and the run log. Built from the rows the runner already writes.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await journeyAccess("view");
    const { id } = await params;
    const j = await loadJourneyRow(ctx.admin, ctx.tenantId, id);
    if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const a = await journeyActivity(ctx.admin, ctx.tenantId, id, j.definition, new Date());
    const tasks = await ctx.admin.from("journey_tasks").select("id, title, due_on, status, owner_user_id, account_id").eq("tenant_id", ctx.tenantId).eq("journey_id", id).order("created_at", { ascending: false }).limit(50);
    return NextResponse.json({
      ...a,
      task_list: tasks.error ? [] : ((tasks.data ?? []) as { id: string; title: string; due_on: string | null; status: string; owner_user_id: string | null }[])
        .map((t) => ({ id: t.id, title: t.title, due_on: t.due_on, status: t.status, mine: t.owner_user_id === ctx.userId, unassigned: !t.owner_user_id })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
