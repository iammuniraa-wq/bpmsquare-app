import { NextResponse, type NextRequest } from "next/server";
import { cronSecretOk } from "@/lib/cronSecret";
import { workTick } from "@/lib/crew/server/work";
import { createAdminSupabase } from "@/lib/supabase-server";

// GET /api/crew/cron/work -- every 5 minutes (vercel.json). Claims queued runs (compare-and-set), a few per tick, one workspace at a time in
// rotation, runs each under its own deadline, and expires proposals nobody answered. A run that crashes mid-way is re-queued once when its
// lease runs out. The route exports its own maxDuration: only that takes effect.

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await workTick(createAdminSupabase());
  return NextResponse.json({ ok: true, ...summary });
}
