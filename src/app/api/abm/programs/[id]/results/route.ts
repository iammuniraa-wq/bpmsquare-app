import { NextResponse, type NextRequest } from "next/server";
import { abmAccess, errorResponse, loadProgram, pendingResponse } from "@/lib/abm/server";
import { loadProgramResults } from "@/lib/abm/views";
import { goalSentence } from "@/lib/abm/results";

// The program's funnel by account: targets > reached > engaged > in talks > deals > won,
// counts and money only (no score). Every figure is a count of target rows.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("view");
    const { id } = await params;
    const { data: program, missing } = await loadProgram(ctx, id);
    if (missing) return pendingResponse();
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });
    const { results } = await loadProgramResults(ctx, program);
    return NextResponse.json({ ...results, goal_sentence: goalSentence(results) });
  } catch (e) {
    return errorResponse(e);
  }
}
