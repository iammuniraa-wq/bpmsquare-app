import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { cronSecretOk } from "@/lib/cronSecret";
import { purgeExpired } from "@/lib/inbox/purge";

// GET /api/inbox/cron/purge -- daily (vercel.json). Retention, owner decisions 2026-10-24: a message past its expiry
// (received + 90 days, or converted + 30 days) loses its body and its files and keeps a stub row (id, sender, subject,
// the record it became). Files copied onto a record at conversion are different objects and are never touched.

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminSupabase();
  // A backlog drains over a few passes in one run, each bounded.
  let emails = 0;
  let files = 0;
  let pending = false;
  for (let i = 0; i < 5; i++) {
    const r = await purgeExpired(admin);
    emails += r.emails;
    files += r.files;
    pending = pending || !!r.pending;
    if (r.emails === 0) break;
  }
  return NextResponse.json({ ok: true, emails, files, ...(pending ? { pending_migration: true } : {}) });
}
