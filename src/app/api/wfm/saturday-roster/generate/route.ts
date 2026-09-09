import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { generateSaturdayRoster } from "@/lib/wfm/saturdayRosterServer";

const MONTH_RE = /^\d{4}-\d{2}$/;

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// POST /api/wfm/saturday-roster/generate — supervisor-triggered version of
// the monthly cron (api/wfm/cron/saturday-roster), for backfilling a month
// the cron missed, or generating right after turning the rule on. Body:
// { month?: "YYYY-MM" }, defaults to the current month.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;

  const body = await request.json().catch(() => null);
  const month = (body as { month?: string } | null)?.month || thisMonth();
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);
  if (!config.saturday_rule.enabled || !config.saturday_rule.short_shift_id) {
    return NextResponse.json(
      { error: "Turn on the Saturday rule and pick a short-day shift in Settings → Workforce first." },
      { status: 400 }
    );
  }

  const result = await generateSaturdayRoster(
    admin, tenantId, month, config.timezone, config.saturday_rule.short_shift_id
  );
  return NextResponse.json(result);
}
