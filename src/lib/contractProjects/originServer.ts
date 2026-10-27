import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWinningBid } from "@/lib/tender/bids/costServer";
import { bidVsBudget, snapshotCostTotal, type BidVsBudget } from "@/lib/tender/bids/costSnapshot";
import type { ProjectRow } from "./types";

// Where a contract project came from, read-only: the deal, the bid version that won, the BOQ file and the estimates that priced it, and
// how the project's budget now stands against the cost of that bid. Everything is tenant-scoped, comes from the project's own
// source_opportunity_id (never from a request), and tolerates a table that is not there yet. Internal: shown only on the project.

export type ProjectOrigin = {
  deal: { id: string; ref: string | null; title: string } | null;
  bid: { version_no: number; submitted_at: string; total: number; currency: string | null } | null;
  boq: { file_name: string; uploaded_at: string; version: number } | null;
  estimates: { id: string; ref: string | null; name: string }[];
};

export type BidAgainstBudget =
  | { available: true; version_no: number; figures: BidVsBudget }
  /** The winning bid was submitted before costs were stored, or before migration 0230 was applied. */
  | { available: false; version_no: number };

export type AfterAwardView = { origin: ProjectOrigin | null; bidAgainstBudget: BidAgainstBudget | null };

export async function loadAfterAwardView(
  admin: SupabaseClient, tenantId: string, project: ProjectRow, args: { budgetTotal: number; source: { id: string; ref: string | null; title: string } | null },
): Promise<AfterAwardView> {
  const oppId = project.source_opportunity_id;
  if (!oppId || !args.source) return { origin: null, bidAgainstBudget: null };

  const [winning, boqRes, linkRes] = await Promise.all([
    loadWinningBid(admin, tenantId, oppId),
    admin.from("tender_boq_sources").select("file_name, uploaded_at, version").eq("tenant_id", tenantId).eq("opportunity_id", oppId).eq("is_current", true).limit(1),
    admin.from("tender_boq_estimate_links").select("estimate_id").eq("tenant_id", tenantId).eq("opportunity_id", oppId).limit(5000),
  ]);
  const boqRow = boqRes.error ? null : ((boqRes.data ?? [])[0] as { file_name: string; uploaded_at: string; version: number | string } | undefined);
  const estimateIds = [...new Set((linkRes.error ? [] : (linkRes.data ?? []) as { estimate_id: string }[]).map((l) => l.estimate_id))];
  const estimates: ProjectOrigin["estimates"] = [];
  for (let i = 0; i < estimateIds.length && estimates.length < 50; i += 100) {
    const { data } = await admin.from("estimates").select("id, ref, name").eq("tenant_id", tenantId).eq("opportunity_id", oppId).in("id", estimateIds.slice(i, i + 100));
    estimates.push(...((data ?? []) as { id: string; ref: string | null; name: string }[]));
  }

  return {
    origin: {
      deal: args.source,
      bid: winning ? { version_no: winning.version_no, submitted_at: winning.submitted_at, total: winning.total, currency: winning.currency } : null,
      boq: boqRow ? { file_name: boqRow.file_name, uploaded_at: boqRow.uploaded_at, version: Number(boqRow.version) } : null,
      estimates: estimates.slice(0, 50),
    },
    bidAgainstBudget: !winning ? null : winning.cost
      ? { available: true, version_no: winning.version_no, figures: bidVsBudget({ bidPrice: winning.total, bidCost: snapshotCostTotal(winning.cost), budget: args.budgetTotal, contractValue: project.contract_value }) }
      : { available: false, version_no: winning.version_no },
  };
}
