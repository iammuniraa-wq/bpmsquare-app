import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { pruneAllTenants } from "@/lib/middleware/messages";
import { cronSecretOk } from "@/lib/cronSecret";

// GET /api/middleware/cron/prune -- daily (vercel.json): the message log and any captured payload are
// kept 30 days. Every workspace is visited, not only those with the integration_middleware flag now,
// so switching the flag off never leaves captured payloads behind; each delete names its tenant.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!cronSecretOk(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const tenants = await pruneAllTenants(createAdminSupabase());
    return NextResponse.json({ ok: true, tenants });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
