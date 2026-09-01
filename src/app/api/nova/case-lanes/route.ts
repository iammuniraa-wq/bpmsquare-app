import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { CASE_STATUS_LABEL } from "@/lib/constants";
import { filterFromParams, matchesFilter } from "@/lib/caseQuery";

/**
 * Nova — Case Lanes. Cases redesign (owner request 2026-09-01), ported
 * from Quotations' QuoteLanes. Two lanes derived from real fields only:
 *
 *   1. Stuck      -- open 30+ days since intake. 30 is not a new number:
 *      it's the exact threshold src/lib/nova/flows.ts's Stream dashboard
 *      card already uses for "breaching SLA" -- reusing it here keeps
 *      one definition of "stuck" across the app instead of two.
 *   2. Unassigned -- assigned_to is null, i.e. nobody is actually working
 *      it. This is Cases' real analogue of Quotes' "needs first send":
 *      not a guess, a genuine gap the data can tell us honestly.
 *   3. Normal     -- everything else open. Collapsed by default on the
 *      client, same as Quote Lanes.
 *
 * Closed/buyback/scrapped cases are excluded entirely -- terminal states,
 * no further action is coming.
 */

const STUCK_DAYS = 30;

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
    .not("status", "in", '("closed","buyback","scrapped")')
    .order("intake_at", { ascending: true })
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
  const cards = cases.filter((sc) => {
    const ageDays = Math.max(0, Math.round((now - new Date(sc.intake_at).getTime()) / 86_400_000));
    return matchesFilter({ status: sc.status, type: sc.type, unassigned: !sc.assigned_to, ageDays }, filter);
  }).map((sc) => {
    const ageDays = Math.max(0, Math.round((now - new Date(sc.intake_at).getTime()) / 86_400_000));
    const unassigned = !sc.assigned_to;
    let lane: "stuck" | "unassigned" | "normal";
    let situation: string;
    if (ageDays >= STUCK_DAYS) {
      lane = "stuck";
      situation = unassigned
        ? `Open ${ageDays} days, still in ${CASE_STATUS_LABEL[sc.status] ?? sc.status}, no technician assigned.`
        : `In ${CASE_STATUS_LABEL[sc.status] ?? sc.status} for ${ageDays} days.`;
    } else if (unassigned) {
      lane = "unassigned";
      situation = `Opened ${ageDays} day${ageDays === 1 ? "" : "s"} ago, no technician assigned.`;
    } else {
      lane = "normal";
      situation = "";
    }
    return {
      id: sc.id,
      ref: sc.ref,
      account: accountName.get(sc.account_id) ?? "—",
      status: sc.status,
      assetCount: sc.asset_ids?.length ?? 0,
      ageDays,
      unassigned,
      lane,
      situation,
    };
  });

  const summarize = (lane: string) => {
    const rows = cards.filter((c) => c.lane === lane);
    return { count: rows.length };
  };

  return NextResponse.json({
    cards: cards.filter((c) => c.lane !== "normal"),
    normal: summarize("normal"),
    stuck: summarize("stuck"),
    unassigned: summarize("unassigned"),
    stuck_days: STUCK_DAYS,
  });
}
