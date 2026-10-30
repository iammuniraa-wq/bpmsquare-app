import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";
import { tenantToday } from "@/lib/tenantClock";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { tenderForDeal } from "@/lib/tender/server";
import type { ComposerLine } from "@/components/rfq/RfqComposer";
import { estimateOriginLabel, missingRfqLines } from "./rfqLines";
import { bidIsLocked, costPerUnit, isLinkStale, isUuid, missingCosts, outputCost, parseOutput, type QuantityView } from "./rules";
import { loadDealEstimate, loadLinesFor, loadLinks, quantityChecks } from "./server";
import { rfqConfig } from "@/lib/rfq/types";

// What the estimate screens need to know about the tender deal an estimate belongs to (GCC tender deals, slice 3c-1). Both functions
// start from the platform flag and answer null without a query for a workspace that does not have it, so a standard estimate page costs
// nothing extra. Every read is tenant-scoped; a deal id that is not this workspace's tender deal reads as "no deal".

export type DealContext = { id: string; ref: string | null; title: string; stage: string };

/** The tender deal of this workspace with this id, or null (flag off, not a tender, another workspace's deal, migration pending). */
export async function tenderDealContext(admin: SupabaseClient, tenantId: string, features: Partial<TenantFeatures> | null | undefined, oppId: string | null | undefined): Promise<DealContext | null> {
  if (!oppId || !isUuid(oppId) || features?.gcc_tender !== true || features?.pipeline !== true) return null;
  const tender = await tenderForDeal(admin, tenantId, features, oppId);
  if (!tender) return null;
  const opp = await loadOpportunity(admin, tenantId, oppId);
  return opp ? { id: opp.id, ref: opp.ref ?? null, title: opp.title, stage: opp.stage } : null;
}

export type EstimateBoqLink = {
  link_id: string; boq_id: string; item: string;
  /** The client's item number as written ("1.1", or "row 5" when the file gave none), for "Back to BOQ line 1.1". Absent = take the first word of `item`. */
  item_no?: string;
  qty: number; uom: string | null;
  waiting: boolean; stale: boolean; needs_review: boolean; review_note: string | null; output_label: string;
  /** Only for a rate build-up: is this estimate made for the quantity of the BOQ line? Absent = nothing to say. */
  quantity?: QuantityView | null;
  /** The cost per BOQ unit this link works out to from the estimate as it is saved now (the rule that prices the line). Null when it cannot be worked out. */
  unit_cost?: number | null;
};

export type EstimateTenderContext = {
  deal: DealContext;
  bid_locked: boolean;
  links: EstimateBoqLink[];
  missing: ComposerLine[];
  origin_label: string;
  valid_days: number;
  rfq_enabled: boolean;
  /**
   * "Cost used for the BOQ": the saved estimate's cost, the sum of all its cost lines (overhead included), before margin and VAT. A BOQ
   * line takes its share of this divided by its quantity; the row markup is added on top, never VAT. Unsaved edits are not in it.
   */
  cost?: number;
  /** The estimate has a quote, so its costs can no longer change and an RFQ for them would have nowhere to go. */
  locked: boolean;
};

function unitCostOf(link: { output: string; basis: string; share_pct: number }, boqQty: number, lines: Parameters<typeof outputCost>[1], fallback: number | null): number | null {
  const ref = parseOutput(link.output);
  const out = ref ? outputCost(ref, lines, fallback) : null;
  if (!out || (link.basis !== "total" && link.basis !== "per_unit")) return null;
  const r = costPerUnit({ basis: link.basis, out, boqQty, sharePct: link.share_pct });
  return r.ok ? r.perUnit : null;
}

export async function estimateTenderContext(
  admin: SupabaseClient, tenantId: string, features: Partial<TenantFeatures> | null | undefined, config: unknown,
  estimate: { id: string; ref: string | null; standard_quote_id: string | null; opportunity_id?: string | null },
): Promise<EstimateTenderContext | null> {
  const deal = await tenderDealContext(admin, tenantId, features, estimate.opportunity_id);
  if (!deal) return null;
  const head = await loadDealEstimate(admin, tenantId, deal.id, estimate.id);
  if (!head) return null;

  const [linksRes, lines, today] = await Promise.all([loadLinks(admin, tenantId, deal.id), loadLinesFor(admin, tenantId, [estimate.id]), tenantToday(tenantId)]);
  const mine = linksRes.rows.filter((l) => l.estimate_id === estimate.id);
  const boqIds = [...new Set(mine.map((l) => l.boq_line_id))];
  const boq = new Map<string, { item_no: string | null; row_no: number; file_description: string; file_qty: number; file_uom: string | null }>();
  if (boqIds.length > 0) {
    const { data } = await admin.from("tender_boq_lines").select("id, item_no, row_no, file_description, file_qty, file_uom").eq("tenant_id", tenantId).eq("opportunity_id", deal.id).in("id", boqIds);
    for (const r of (data ?? []) as { id: string; item_no: string | null; row_no: number; file_description: string; file_qty: number | string; file_uom: string | null }[]) {
      boq.set(r.id, { item_no: r.item_no, row_no: r.row_no, file_description: r.file_description, file_qty: Number(r.file_qty), file_uom: r.file_uom });
    }
  }
  const validDays = rfqConfig((config as { rfq?: Parameters<typeof rfqConfig>[0] } | null)?.rfq).price_valid_days;
  const estLines = lines.get(estimate.id) ?? [];
  const miss = estimate.standard_quote_id ? [] : missingCosts(estLines, today, validDays);
  const byId = new Map(estLines.map((l) => [l.id, l]));
  const quantities = await quantityChecks(admin, tenantId, deal.id, linksRes.rows);
  const total = outputCost({ kind: "total" }, estLines, head.cost_total);
  return {
    cost: total?.cost ?? 0,
    deal, bid_locked: bidIsLocked(deal.stage), valid_days: validDays, rfq_enabled: features?.rfq === true, locked: !!estimate.standard_quote_id,
    origin_label: estimateOriginLabel(estimate.ref, deal.ref),
    links: mine.map((l) => {
      const b = boq.get(l.boq_line_id);
      return {
        link_id: l.id, boq_id: l.boq_line_id, item_no: b ? (b.item_no ?? `row ${b.row_no}`) : undefined, item: b ? `${b.item_no ?? `row ${b.row_no}`} ${b.file_description}`.trim().slice(0, 80) : "A BOQ line",
        qty: b?.file_qty ?? 0, uom: b?.file_uom ?? null, waiting: !l.applied_at, stale: isLinkStale(l, head.updated_at), needs_review: l.needs_review, review_note: l.review_note,
        quantity: quantities.get(l.id) ?? null,
        unit_cost: unitCostOf(l, b?.file_qty ?? 0, estLines, head.cost_total),
        output_label: l.output === "total" ? "Whole estimate" : l.output.startsWith("line:") ? byId.get(l.output.slice(5))?.description ?? "A line" : `WBS ${l.output.slice(4)}`,
      };
    }),
    missing: missingRfqLines(miss.map((m) => ({ line: byId.get(m.line_id)!, reason: m.reason, age_days: m.age_days }))),
  };
}
