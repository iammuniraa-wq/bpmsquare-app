import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { pruneMessages } from "@/lib/middleware/messages";

// GET /api/middleware/cron/prune -- daily (vercel.json): the message log and any captured payload are
// kept 30 days. Only workspaces with the integration_middleware flag are visited, and each delete
// names its tenant.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminSupabase();
  const { data, error } = await admin.from("tenants").select("id").filter("features->>integration_middleware", "eq", "true");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  for (const t of (data ?? []) as { id: string }[]) await pruneMessages(admin, t.id);
  return NextResponse.json({ ok: true, tenants: (data ?? []).length });
}
