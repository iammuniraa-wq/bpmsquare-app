import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealLine } from "@/lib/contractProjects/fromTender";
import { loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { loadEstimateBudgetInputs } from "../estimates/budgetServer";
import { isMissingSchema } from "../server";
import { buildCostSnapshot, parseCostSnapshot, snapshotCostTotal, type CostBoqInfo, type CostSnapshot } from "./costSnapshot";
import { parseStoredLines, type Snapshot } from "./rules";
import { costCoverage, type CostCoverage } from "./marginCoverage";

import { readAllPages } from "@/lib/pagedRead";
// Server side of the bid versions' INTERNAL cost (migration 0230, table tender_bid_version_costs). The table has RLS on and no policy, so
// only these functions, on the service-role client, ever touch it. Every query is tenant-scoped and tolerates the migration being
// pending. This is the only place that writes or reads the table; the bid routes, the exports and the answer sheet never import it.

/** The cost of a bid as it stands now: the deal's lines, their BOQ rows and the estimates that priced them. */
export async function buildCurrentCost(admin: SupabaseClient, tenantId: string, opportunityId: string, snap: Pick<Snapshot, "lines" | "source_ids">): Promise<CostSnapshot> {
  const [deal, boqRes, estimates] = await Promise.all([
    loadOpportunityLines(admin, tenantId, opportunityId),
    readAllPages((lo, hi) => admin.from("tender_boq_lines").select("line_id, item_no, cost_code, unit_cost, markup_pct, price_source, price_source_ref").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("id", { ascending: true }).range(lo, hi)),
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
  return buildCostSnapshot({ snapshot: snap, dealLines, boq, estimates });
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
  /** How much of the bid that cost covers; null with no cost. */
  coverage: CostCoverage | null;
};

/** The last bid version submitted for a tender, with its cost when one was stored. The caller has already checked the deal is this workspace's. */
export async function loadWinningBid(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<WinningBid | null> {
  const head = await admin.from("tender_bid_versions").select("version_no, submitted_at, currency, total, lines").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("version_no", { ascending: false }).limit(1);
  const row = head.error ? null : ((head.data ?? [])[0] as { version_no: number; submitted_at: string; currency: string | null; total: number | string; lines: unknown } | undefined);
  if (!row) return null;
  const costRes = await admin.from("tender_bid_version_costs").select("snapshot").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("version_no", row.version_no).maybeSingle();
  const cost = costRes.error || !costRes.data ? null : parseCostSnapshot((costRes.data as { snapshot: unknown }).snapshot);
  return {
    version_no: Number(row.version_no), submitted_at: row.submitted_at, currency: row.currency, total: Number(row.total), cost,
    coverage: cost ? costCoverage(parseStoredLines(row.lines), cost.lines) : null,
  };
}

/**
 * The deal's cost as figures only, for the assistant's competitor analysis: what the priced lines with a recorded cost cost, the amount
 * they are priced at, and how many of the priced lines they are. Never a line, a rate or a markup leaves this file.
 */
export async function currentCostSummary(admin: SupabaseClient, tenantId: string, opportunityId: string, snap: Pick<Snapshot, "lines" | "source_ids">): Promise<CostCoverage> {
  const cost = await buildCurrentCost(admin, tenantId, opportunityId, snap);
  return costCoverage(snap.lines, cost.lines);
}

/**
 * The recorded cost of bid versions and the part of each bid it covers, by `${opportunityId}:${versionNo}`, for the assistant's competitor
 * analysis. Figures only leave this file. A pending migration reads as no costs.
 */
export async function loadBidCostTotals(admin: SupabaseClient, tenantId: string, opportunityIds: readonly string[]): Promise<Map<string, Pick<CostCoverage, "cost" | "costedAmount">>> {
  const out = new Map<string, Pick<CostCoverage, "cost" | "costedAmount">>();
  for (let i = 0; i < opportunityIds.length; i += 50) {
    const part = opportunityIds.slice(i, i + 50);
    const costs = await admin.from("tender_bid_version_costs").select("opportunity_id, version_no, snapshot").eq("tenant_id", tenantId).in("opportunity_id", part).limit(1000);
    if (costs.error) break;
    const rows = (costs.data ?? []) as { opportunity_id: string; version_no: number; snapshot: unknown }[];
    if (rows.length === 0) continue;
    const bids = await admin.from("tender_bid_versions").select("opportunity_id, version_no, lines").eq("tenant_id", tenantId).in("opportunity_id", [...new Set(rows.map((r) => r.opportunity_id))]).limit(1000);
    if (bids.error) break;
    const linesOf = new Map(((bids.data ?? []) as { opportunity_id: string; version_no: number; lines: unknown }[]).map((b) => [`${b.opportunity_id}:${Number(b.version_no)}`, b.lines]));
    for (const r of rows) {
      const key = `${r.opportunity_id}:${Number(r.version_no)}`;
      const snapshot = parseCostSnapshot(r.snapshot);
      if (!snapshot) continue;
      const c = costCoverage(parseStoredLines(linesOf.get(key)), snapshot.lines);
      if (c.costedLines > 0) out.set(key, { cost: c.cost, costedAmount: c.costedAmount });
    }
  }
  return out;
}
