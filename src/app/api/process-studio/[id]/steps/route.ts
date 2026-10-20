import { NextResponse, type NextRequest } from "next/server";
import { parseStepCreate } from "@/lib/studio/requests";
import { studioAccess, errorResponse, ownedStudy, insertRows } from "@/lib/studio/server";

// Step 2: add a step the map missed. The map is the client's: the AI only drafted it.
// POST { area, lane?, name, what?, how_today?, frequency?, hands_over? } -> 201 { step }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    const parsed = parseStepCreate(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

    const { data: last } = await ctx.supabase.from("process_study_steps").select("sort_order")
      .eq("tenant_id", ctx.tenantId).eq("study_id", study.id).order("sort_order", { ascending: false }).limit(1);
    const next = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? -10) + 10;
    const [step] = await insertRows(ctx, "process_study_steps", study.id, [{ ...parsed.value, sort_order: next, assumed: false }]);
    return NextResponse.json({ step }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
