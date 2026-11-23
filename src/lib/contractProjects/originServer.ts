import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWinningBid } from "@/lib/tender/bids/costServer";
import { bidVsBudget, snapshotCostTotal, type BidVsBudget } from "@/lib/tender/bids/costSnapshot";
import { isTenderProject, type ProjectRow } from "./types";

import { readAllPages } from "@/lib/pagedRead";
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

/** Where a quote project came from: the quote, the estimate it was made from (when it was), and the deal. Tenant-scoped, from the project's own ids. */
export type QuoteOrigin = {
  type: "standard_quote" | "quotation";
  id: string;
  ref: string | null;
  total: number | null;
  estimate: { id: string; ref: string | null; name: string } | null;
  deal: { id: string; ref: string | null; title: string } | null;
};

export async function loadQuoteOrigin(admin: SupabaseClient, tenantId: string, project: ProjectRow, deal: QuoteOrigin["deal"]): Promise<QuoteOrigin | null> {
  const type = project.source_type;
  if ((type !== "standard_quote" && type !== "quotation") || !project.source_id) return null;
  const table = type === "standard_quote" ? "standard_quotes" : "quotes";
  const { data } = await admin.from(table).select("id, ref, total").eq("id", project.source_id).eq("tenant_id", tenantId).maybeSingle();
  const quote = data as { id: string; ref: string | null; total: number | string | null } | null;
  if (!quote) return null;
  let estimate: QuoteOrigin["estimate"] = null;
  if (type === "standard_quote") {
    const e = await admin.from("estimates").select("id, ref, name").eq("tenant_id", tenantId).eq("standard_quote_id", quote.id).order("created_at", { ascending: false }).limit(1);
    estimate = e.error ? null : ((e.data ?? []) as { id: string; ref: string | null; name: string }[])[0] ?? null;
  }
  return { type, id: quote.id, ref: quote.ref, total: quote.total == null ? null : Number(quote.total), estimate, deal };
}

export async function loadAfterAwardView(
  admin: SupabaseClient, tenantId: string, project: ProjectRow, args: { budgetTotal: number; source: { id: string; ref: string | null; title: string } | null },
): Promise<AfterAwardView> {
  const oppId = project.source_opportunity_id;
  if (!oppId || !args.source || !isTenderProject(project)) return { origin: null, bidAgainstBudget: null };

  const [winning, boqRes, linkRes] = await Promise.all([
    loadWinningBid(admin, tenantId, oppId),
    admin.from("tender_boq_sources").select("file_name, uploaded_at, version").eq("tenant_id", tenantId).eq("opportunity_id", oppId).eq("is_current", true).limit(1),
    readAllPages((lo, hi) => admin.from("tender_boq_estimate_links").select("estimate_id").eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("id", { ascending: true }).range(lo, hi)),
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
