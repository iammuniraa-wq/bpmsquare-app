import { authorizeApi, jsonOk } from "../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { computeResults } from "@/lib/abm/results";
import type { AbmGoalMetric, AbmProgress, AbmTier } from "@/lib/abm/types";

// One ABM program with its funnel counts (by company, never by lead). No people are returned here.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApi(req, "abm_programs");
  if ("error" in auth) return auth.error;
  const { tenantId } = auth;
  const { id } = await params;
  const admin = createAdminSupabase();

  const { data: program, error } = await admin
    .from("abm_programs")
    .select("id, ref, name, kind, goal, goal_metric, goal_target, starts_on, ends_on, status, default_tier, owner_user_id, custom_data, created_at, updated_at")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error || !program) return Response.json({ error: "Not found" }, { status: 404 });

  const { data: t } = await admin.from("abm_target_accounts").select("id, account_id, tier, progress, opportunity_id").eq("tenant_id", tenantId).eq("program_id", id).limit(10000);
  const targets = (t ?? []) as { id: string; account_id: string; tier: AbmTier; progress: AbmProgress; opportunity_id: string | null }[];
  const dealIds = [...new Set(targets.map((x) => x.opportunity_id).filter((x): x is string => !!x))];
  const deals: { id: string; outcome: "open" | "won" | "lost" | "dropped"; amount: number | null }[] = [];
  for (let i = 0; i < dealIds.length; i += 150) {
    const { data: d } = await admin.from("opportunities").select("id, outcome, amount").eq("tenant_id", tenantId).in("id", dealIds.slice(i, i + 150));
    deals.push(...((d ?? []) as typeof deals));
  }
  const results = computeResults(targets, deals, { metric: program.goal_metric as AbmGoalMetric, target: program.goal_target as number | null });

  return jsonOk({
    data: {
      ...program,
      funnel: results.funnel,
      by_tier: results.byTier,
      money: results.money,
      _links: { self: `/api/v1/abm-programs/${id}`, targets: `/api/v1/abm-programs/${id}/targets` },
    },
    _links: { self: `/api/v1/abm-programs/${id}` },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" },
  });
}
