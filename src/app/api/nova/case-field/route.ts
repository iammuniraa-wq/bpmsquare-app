import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { filterFromParams, matchesFilter } from "@/lib/caseQuery";

/**
 * Nova — Case Field. Cases redesign (owner request 2026-09-01), same
 * "ask, don't filter" treatment ported from Quotations. A plot of every
 * still-open case: days since intake across, pipeline progress up, colour
 * by whether a technician is assigned, size by asset count.
 *
 * Two real deviations from the Quotations version of Field, both because
 * ServiceCase's schema is genuinely thinner than Quote's -- see
 * types.ts:
 *  - X axis is "days since INTAKE", not "days since last touched" --
 *    ServiceCase has no updated_at at all (only intake_at and
 *    closed_at), so there is no touch-tracking signal to use the way
 *    quote-field used updated_at.
 *  - Y axis is pipeline PROGRESS (0-100%, position in CASE_STAGE_ORDER --
 *    the same 9-stage order src/lib/nova/flows.ts's Stream dashboard
 *    card already uses), not a money value -- cases carry no value field
 *    at all. This is a genuinely nicer axis for a scatter than quotes'
 *    was, too: it's naturally bounded 0-100, so unlike quote-field there
 *    is no outlier-clamping needed on this axis.
 *
 * "Stuck corner" (Cases' analogue of Field's exposure corner) is age +
 * behind-typical-progress, both derived from the tenant's own matching
 * set the same way quote-field's exposure thresholds are -- see that
 * file for why a fixed threshold is wrong once real data varies.
 *
 * Closed/buyback/scrapped cases are excluded -- terminal states, no more
 * work is coming, same principle as quote-field excluding lost quotes.
 */

const CASE_STAGE_ORDER = [
  "intake", "inspection", "report_sent", "report_approved",
  "quote_sent", "quote_approved", "in_repair", "qa", "ready",
];
const TERMINAL = new Set(["closed", "buyback", "scrapped"]);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export async function GET(request: NextRequest) {
  const filter = filterFromParams(request.nextUrl.searchParams);
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "cases"))) {
    return NextResponse.json({ error: "Cases isn't enabled for your workspace" }, { status: 404 });
  }

  const admin = createAdminSupabase();

  const { data: caseRows } = await admin
    .from("service_cases")
    .select("id, ref, account_id, status, type, assigned_to, asset_ids, intake_at")
    .eq("tenant_id", tenantId)
    .not("status", "in", `(${[...TERMINAL].map((s) => `"${s}"`).join(",")})`)
    .order("intake_at", { ascending: false })
    .limit(500);

  const cases = (caseRows ?? []) as {
    id: string; ref: string; account_id: string; status: string; type: string;
    assigned_to: string | null; asset_ids: string[] | null; intake_at: string;
  }[];

  const accountIds = [...new Set(cases.map((c) => c.account_id).filter(Boolean))];
  const { data: accountRows } = accountIds.length
    ? await admin.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds)
    : { data: [] as { id: string; name: string }[] };
  const accountName = new Map((accountRows ?? []).map((a) => [a.id as string, a.name as string]));

  const now = Date.now();
  const ageDaysOf = (intakeAt: string) => Math.max(0, Math.round((now - new Date(intakeAt).getTime()) / 86_400_000));
  const progressOf = (status: string) => {
    const idx = CASE_STAGE_ORDER.indexOf(status);
    return idx < 0 ? 0 : Math.round((idx / (CASE_STAGE_ORDER.length - 1)) * 100);
  };

  const matching = cases.filter((c) =>
    matchesFilter({ status: c.status, type: c.type, unassigned: !c.assigned_to, ageDays: ageDaysOf(c.intake_at) }, filter)
  );

  const ages = matching.map((c) => ageDaysOf(c.intake_at)).sort((a, b) => a - b);
  const progresses = matching.map((c) => progressOf(c.status)).sort((a, b) => a - b);
  const STUCK_AGE = Math.max(14, percentile(ages, 0.5));
  const STUCK_PROGRESS_MAX = Math.min(60, percentile(progresses, 0.25));

  const points = matching.map((c) => {
    const ageDays = ageDaysOf(c.intake_at);
    const progress = progressOf(c.status);
    const unassigned = !c.assigned_to;
    return {
      id: c.id,
      ref: c.ref,
      account: accountName.get(c.account_id) ?? "—",
      status: c.status,
      ageDays,
      progress,
      assetCount: c.asset_ids?.length ?? 0,
      unassigned,
      stuck: ageDays >= STUCK_AGE && progress <= STUCK_PROGRESS_MAX,
    };
  });

  const stuck = points.filter((p) => p.stuck).sort((a, b) => b.ageDays - a.ageDays);

  return NextResponse.json({
    points,
    stuck,
    stuck_age: STUCK_AGE,
    stuck_progress_max: STUCK_PROGRESS_MAX,
  });
}
