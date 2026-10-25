import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { cronSecretOk } from "@/lib/cronSecret";
import { sendRoomDigests } from "@/lib/tender/roomDigest";

// GET /api/tenders/cron/room-digest -- every 15 minutes (vercel.json). Each member of a Deal Room with unread messages from
// others gets one summary e-mail, at most one per 15 minutes. Only workspaces with the platform-admin flags gcc_tender and
// deal_room are looked at. Every send goes through resolveOutbound and is logged (kind tender).

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendRoomDigests(createAdminSupabase());
  return NextResponse.json({ ok: result.errors.length === 0, ...result });
}
