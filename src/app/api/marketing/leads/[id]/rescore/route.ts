import { NextResponse, type NextRequest } from "next/server";
import { loadLeadRouteContext } from "@/lib/marketing/leads/guard";
import { scoreLead } from "@/lib/marketing/leads/scorer";

// POST /api/marketing/leads/[id]/rescore -- recompute one lead's score now,
// from the same events and the same rubric the cron uses, so the answer is the
// one the cron would give. Nothing is sent and no one is emailed.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await loadLeadRouteContext();
  if (!g.ok) return g.response;
  const { admin, tenantId } = g.ctx;
  const { id } = await params;

  const result = await scoreLead(admin, tenantId, id);
  if (!result.ok) {
    if (result.reason === "not_found") return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (result.reason === "pending") return NextResponse.json({ error: "Lead scoring needs a database update that has not been applied yet" }, { status: 503 });
    return NextResponse.json({ error: "Could not score this lead" }, { status: 500 });
  }
  return NextResponse.json({ score: result.score, stage: result.stage, label: result.label, moved_to: result.moved_to });
}
