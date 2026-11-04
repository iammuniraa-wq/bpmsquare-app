import { NextResponse, type NextRequest } from "next/server";
import { cronSecretOk } from "@/lib/cronSecret";
import { planAll } from "@/lib/crew/server/planner";
import { createAdminSupabase } from "@/lib/supabase-server";

// GET /api/crew/cron/plan -- every 15 minutes (vercel.json). For each workspace with an enabled agent: inserts the runs the agent's plan() says
// are worth starting (the daily slot, and event wake-ups from the per-workspace cursor). It only INSERTS; /api/crew/cron/work executes. A
// quiet portfolio is recorded as a finished zero-token pass. maxDuration is set here, not in vercel.json (a glob there did not take effect).

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await planAll(createAdminSupabase());
  return NextResponse.json({ ok: true, ...summary });
}
