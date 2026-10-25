import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { cronSecretOk } from "@/lib/cronSecret";
import { sendTenderReminders } from "@/lib/tender/reminders";

// GET /api/tenders/cron/reminders -- daily (vercel.json). A live tender 7, 3 and 1 days before it closes, and on the day,
// reminds its owner and team once per threshold (opportunity_tenders.reminders_sent). Only workspaces with the
// platform-admin flag `gcc_tender` are looked at. Every send goes through resolveOutbound and is logged (kind tender).

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendTenderReminders(createAdminSupabase());
  return NextResponse.json({ ok: result.errors.length === 0, ...result });
}
