import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig } from "@/lib/wfm/server";
import { generateSaturdayRoster } from "@/lib/wfm/saturdayRosterServer";

// GET /api/wfm/cron/saturday-roster — Vercel cron (vercel.json), 25th of
// each month: materializes NEXT month's alternate-Saturday roster/holiday
// (see WfmConfig.saturday_rule's header in lib/constants.ts) so it exists
// well before anyone needs it, without a supervisor having to remember to
// generate it by hand every month. The manual button on the Roster page
// (api/wfm/saturday-roster/generate) calls the exact same generator, so a
// missed or early run is never a special case -- both are idempotent.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug")
    .contains("features", { wfm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
  const results: { tenant: string; month: string; holiday_created: boolean; roster_rows_created: number }[] = [];

  for (const tenant of tenants ?? []) {
    const config = await getWfmConfig(admin, tenant.id as string);
    if (!config.saturday_rule.enabled || !config.saturday_rule.short_shift_id) continue;

    const r = await generateSaturdayRoster(
      admin, tenant.id as string, nextMonth, config.timezone, config.saturday_rule.short_shift_id
    );
    results.push({ tenant: tenant.slug as string, month: r.month, holiday_created: r.holiday_created, roster_rows_created: r.roster_rows_created });
  }

  return NextResponse.json({ ok: true, results });
}
