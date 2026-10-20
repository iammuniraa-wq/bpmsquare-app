import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { runLeadScoringPass } from "@/lib/marketing/leads/runner";

export const maxDuration = 60;

// GET /api/events/cron/score-leads -- every 15 minutes. Re-scores the leads
// of workspaces that have the marketing_scoring program on (and only those),
// moves them up the early stages when they earn it, and flags leads whose
// response time has passed. Platform-wide by nature (a cron is not per-tenant);
// the runner works one workspace at a time and every query it makes carries
// that workspace's id. A workspace without the program is never read.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runLeadScoringPass(createAdminSupabase(), { budgetMs: 45_000 });
  return NextResponse.json({ ok: true, ...summary });
}
