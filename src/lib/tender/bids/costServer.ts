import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenant } from "@/lib/tenant";
import { contractProjectSettings, type DealLine } from "@/lib/contractProjects/fromTender";
import { loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { loadEstimateBudgetInputs } from "../estimates/budgetServer";
import { isMissingSchema } from "../server";
import { buildCostSnapshot, parseCostSnapshot, snapshotCostTotal, type CostBoqInfo, type CostSnapshot } from "./costSnapshot";
import type { Snapshot } from "./rules";

import { readAllPages } from "@/lib/pagedRead";
// Server side of the bid versions' INTERNAL cost (migration 0230, table tender_bid_version_costs). The table has RLS on and no policy, so
// only these functions, on the service-role client, ever touch it. Every query is tenant-scoped and tolerates the migration being
// pending. This is the only place that writes or reads the table; the bid routes, the exports and the answer sheet never import it.

/** The cost of a bid as it stands now: the deal's lines, their BOQ rows, the estimates that priced them and the workspace's margin. */
export async function buildCurrentCost(admin: SupabaseClient, tenantId: string, opportunityId: string, snap: Pick<Snapshot, "lines" | "source_ids">): Promise<CostSnapshot> {
  const [deal, boqRes, tenant, estimates] = await Promise.all([
    loadOpportunityLines(admin, tenantId, opportunityId),
    readAllPages((lo, hi) => admin.from("tender_boq_lines").select("line_id, item_no, cost_code, unit_cost, markup_pct, price_source, price_source_ref").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("id", { ascending: true }).range(lo, hi)),
    getTenant(),
    loadEstimateBudgetInputs(admin, tenantId, opportunityId),
  ]);
  const boq = new Map<string, CostBoqInfo>();
  for (const r of ((boqRes.error ? [] : boqRes.data ?? []) as { line_id: string | null; item_no: string | null; cost_code: string | null; unit_cost: number | string | null; markup_pct: number | string | null; price_source: string | null; price_source_ref: string | null }[])) {
    if (!r.line_id) continue;
    boq.set(r.line_id, {
      item_no: r.item_no, cost_code: r.cost_code, unit_cost: r.unit_cost == null ? null : Number(r.unit_cost), markup_pct: r.markup_pct == null ? null : Number(r.markup_pct),
      price_source: r.price_source, price_source_ref: r.price_source_ref,
    });
  }
  const dealLines = new Map((deal as unknown as DealLine[]).map((l) => [l.id, l]));
  return buildCostSnapshot({ snapshot: snap, dealLines, boq, defaultMarginPct: contractProjectSettings(tenant?.config).defaultMarginPct, estimates });
}

export type SaveCostResult = "saved" | "pending" | "failed";

/** Stores the cost of version `versionNo`. Never throws: a bid that went in is not undone because its cost could not be kept. */
export async function saveCostSnapshot(admin: SupabaseClient, tenantId: string, opportunityId: string, versionNo: number, cost: CostSnapshot): Promise<SaveCostResult> {
  const { error } = await admin.from("tender_bid_version_costs").insert({
    tenant_id: tenantId, opportunity_id: opportunityId, version_no: versionNo, total_cost: snapshotCostTotal(cost), line_count: cost.lines.length, snapshot: cost,
  });
  if (!error) return "saved";
  if (isMissingSchema(error)) return "pending";
  console.error("[tender-bids] cost snapshot not saved", error.message);
  return "failed";
}

export type WinningBid = {
  version_no: number;
  submitted_at: string;
  currency: string | null;
  /** What was offered. */
  total: number;
  /** The cost recorded with it; null for a version submitted before costs were stored (or while 0230 is pending). */
  cost: CostSnapshot | null;
};

/** The last bid version submitted for a tender, with its cost when one was stored. The caller has already checked the deal is this workspace's. */
export async function loadWinningBid(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<WinningBid | null> {
  const head = await admin.from("tender_bid_versions").select("version_no, submitted_at, currency, total").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("version_no", { ascending: false }).limit(1);
  const row = head.error ? null : ((head.data ?? [])[0] as { version_no: number; submitted_at: string; currency: string | null; total: number | string } | undefined);
  if (!row) return null;
  const costRes = await admin.from("tender_bid_version_costs").select("snapshot").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("version_no", row.version_no).maybeSingle();
  const cost = costRes.error || !costRes.data ? null : parseCostSnapshot((costRes.data as { snapshot: unknown }).snapshot);
  return { version_no: Number(row.version_no), submitted_at: row.submitted_at, currency: row.currency, total: Number(row.total), cost };
}
