import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { runTenant, tenantsToRun, type TenantResult } from "@/lib/marketing/journeys/runner";

export const maxDuration = 300;
const BUDGET_MS = 240_000;

// GET /api/marketing/cron/journeys -- every 5 minutes (vercel.json), CRON_SECRET bearer like the other crons.
// For each workspace that owns Marketing AND the platform-admin Journeys flag, least recently run first:
// enrol people from new events, then move due runs forward. Workspaces without the flag are never even
// read past the tenants list, so a flag that is off costs nothing. The loop stops starting new workspaces
// once the time budget is spent; the rest go first on the next tick.

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const admin = createAdminSupabase();
  const ids = await tenantsToRun(admin);
  const results: TenantResult[] = [];
  for (const id of ids) {
    if (Date.now() - started > BUDGET_MS) break;
    results.push(await runTenant(admin, id, { deadline: started + BUDGET_MS }));
  }
  return NextResponse.json({ ok: true, tenants: ids.length, ran: results.filter((r) => r.status === "ran").length, results });
}
