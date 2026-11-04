import { NextResponse, type NextRequest } from "next/server";
import { cronSecretOk } from "@/lib/cronSecret";
import { retentionTick } from "@/lib/crew/server/work";
import { createAdminSupabase } from "@/lib/supabase-server";

// GET /api/crew/cron/retention -- daily (vercel.json). Deletes runs, steps and findings past purge_after (attendance 90 days, tender 180) and
// keeps only the fingerprint and status of a finding whose silence has not ended. Same shape as /api/wfm/cron/retention.

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await retentionTick(createAdminSupabase());
  return NextResponse.json({ ok: true, ...summary });
}
