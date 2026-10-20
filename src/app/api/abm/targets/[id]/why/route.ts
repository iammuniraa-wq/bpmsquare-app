import { NextResponse, type NextRequest } from "next/server";
import { abmAccess, errorResponse, loadTarget, loadProgram, pendingResponse } from "@/lib/abm/server";
import { explainTarget } from "@/lib/abm/progressServer";
import { userNames } from "@/lib/abm/views";
import { PROGRESS_LABEL } from "@/lib/abm/types";
import { PROGRESS_MEANING, describeProgressSource, shortDate } from "@/lib/abm/progress";

// "Why this status": the rule that set the progress and the events behind it, with dates.
// A manual override shows its reason and who made it. Read-only; nothing here writes.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("view");
    const { id } = await params;
    const { data: target, missing } = await loadTarget(ctx, id);
    if (missing) return pendingResponse();
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    const { data: program } = await loadProgram(ctx, target.program_id);
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

    const [names, why] = await Promise.all([userNames(ctx), explainTarget(ctx, program, target)]);
    const actor = target.progress_changed_by ? names.get(target.progress_changed_by) ?? null : null;
    return NextResponse.json({
      progress: target.progress,
      label: PROGRESS_LABEL[target.progress],
      source: target.progress_source,
      sentence: describeProgressSource({ progress_source: target.progress_source, progress_reason: target.progress_reason, progress_changed_at: target.progress_changed_at, actorName: actor }),
      changed_on: shortDate(target.progress_changed_at),
      changed_by: target.progress_source === "manual" ? actor : null,
      means: PROGRESS_MEANING[target.progress].means,
      next: PROGRESS_MEANING[target.progress].next,
      evidence: why.evidence.map((e) => ({ text: e.text, on: shortDate(e.at) })),
      held: why.verdict.held,
      would_change_to: why.verdict.changed ? PROGRESS_LABEL[why.verdict.progress] : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
