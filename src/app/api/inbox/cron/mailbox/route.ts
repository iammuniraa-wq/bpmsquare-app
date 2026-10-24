import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { cronSecretOk } from "@/lib/cronSecret";
import { pollInboxMailboxes } from "@/lib/inbox/poll";

// GET /api/inbox/cron/mailbox -- every 5 minutes (vercel.json). Intake B: for each channel with a connected mailbox, read
// the inbox over IMAP (read-only: nothing is marked read, moved or deleted on the client's server) from a stored UID
// cursor, a bounded batch per run, three days back the first time. Bounded by a time budget and taken oldest-polled
// first, like the RFQ poller it mirrors.

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await pollInboxMailboxes(createAdminSupabase());
  return NextResponse.json({ ok: true, ...r });
}
