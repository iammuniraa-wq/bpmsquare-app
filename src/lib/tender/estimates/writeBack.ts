import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { tenantToday } from "@/lib/tenantClock";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { lineCost, readOverride } from "@/lib/estimator/overrides";
import { loadEstimate, refreshTotals } from "@/lib/estimator/server";
import { tenantHasFeature } from "@/lib/tenant";
import { bidIsLocked, isUuid, round4 } from "./rules";
import { loadLinks, repriceBoqLines } from "./server";

// "Award writes the cost back" (GCC tender deals, slice 3c-1). An RFQ raised for an estimate's missing costs carries, on each line, the
// estimate line it asks about (rfq_lines.estimate_line_id, 0227). When that line is awarded, the awarded cost per unit becomes the
// estimate line's unit cost with its source (the RFQ and the supplier) and as-of date, the estimate is re-totalled, and the BOQ lines
// that were priced from the estimate are re-priced and marked for a look. A bid already in the client's hands (the deal is past
// Estimating) is never changed by itself: its links are only flagged.
//
// Called by awardWithDecision (src/lib/rfq/awards.ts) for an RFQ whose origin is an estimate. It is a consequence of the award, so
// it runs for whoever may award, not only for whoever may edit the Pipeline; every id is read back through the workspace.

export type WriteBackOutcome =
  | { written: false; reason: string }
  | { written: true; estimate_id: string; estimate_ref: string | null; repriced: number; flagged: number; locked: boolean };

export async function writeAwardedCostToEstimate(
  admin: SupabaseClient,
  ctx: { tenantId: string; userId: string; email: string | null },
  args: { rfq: { id: string; ref: string | null; origin_type: string; origin_id: string | null }; rfqLineId: string; unitCost: number; supplierName: string | null },
): Promise<WriteBackOutcome> {
  const { tenantId } = ctx;
  if (args.rfq.origin_type !== "estimate" || !args.rfq.origin_id) return { written: false, reason: "not an estimate RFQ" };
  if (!isUuid(args.rfqLineId) || !Number.isFinite(args.unitCost) || args.unitCost < 0) return { written: false, reason: "no cost to write" };

  const rl = await admin.from("rfq_lines").select("estimate_line_id").eq("id", args.rfqLineId).eq("tenant_id", tenantId).eq("rfq_id", args.rfq.id).maybeSingle();
  const lineId = (rl.data as { estimate_line_id?: string | null } | null)?.estimate_line_id ?? null;
  if (rl.error || !lineId) return { written: false, reason: "this RFQ line is not tied to an estimate line" };

  const ln = await admin.from("estimate_lines").select("*").eq("id", lineId).eq("tenant_id", tenantId).eq("estimate_id", args.rfq.origin_id).maybeSingle();
  if (ln.error || !ln.data) return { written: false, reason: "the estimate line is gone" };
  const line = ln.data as Record<string, unknown>;

  const est = await loadEstimate(admin, tenantId, args.rfq.origin_id);
  if (!est.data) return { written: false, reason: "the estimate is gone" };
  const estimate = est.data;
  if (estimate.standard_quote_id) return { written: false, reason: "the estimate already has a quote, so its costs are locked" };

  const unit = round4(args.unitCost);
  const qty = Number(line.qty ?? 0);
  const waste = Number(line.waste_pct ?? 0);
  const today = await tenantToday(tenantId);
  const meta = { unit_cost: unit, as_of: today, source: "rfq", ref: `${args.rfq.ref ?? "RFQ"}${args.supplierName ? ` · ${args.supplierName}` : ""}`.slice(0, 120) };
  const data = (line.custom_data && typeof line.custom_data === "object" ? line.custom_data : {}) as Record<string, unknown>;
  const computed = line.source !== "manual";
  // A computed line keeps a hand edit across a recalculation as `override`; the cost source rides inside it for the same reason.
  const custom_data = computed
    ? { ...data, override: { ...(readOverride(data) ?? {}), unit_cost: unit, cost_meta: meta } }
    : { ...data, cost_meta: meta };
  const fromCost = line.unit_cost == null ? null : Number(line.unit_cost);

  const up = await admin.from("estimate_lines").update({ unit_cost: unit, cost_total: lineCost(qty, waste, unit), custom_data, updated_at: new Date().toISOString() })
    .eq("id", lineId).eq("tenant_id", tenantId).eq("estimate_id", estimate.id);
  if (up.error) return { written: false, reason: up.error.message };
  await refreshTotals(admin, tenantId, estimate);
  await logChange(admin, {
    tenantId, objectType: "estimates", objectId: estimate.id, objectLabel: estimate.ref ?? estimate.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email,
    changes: [{ field: `Line "${String(line.description ?? "")}": unit_cost (${meta.ref})`, from: fromCost, to: unit }],
  });

  // The BOQ lines priced from this estimate.
  const oppId = (estimate as unknown as { opportunity_id?: string | null }).opportunity_id ?? null;
  if (!oppId || !(await tenantHasFeature(admin, tenantId, "gcc_tender"))) return { written: true, estimate_id: estimate.id, estimate_ref: estimate.ref, repriced: 0, flagged: 0, locked: false };
  const opp = await loadOpportunity(admin, tenantId, oppId);
  if (!opp) return { written: true, estimate_id: estimate.id, estimate_ref: estimate.ref, repriced: 0, flagged: 0, locked: false };
  const links = (await loadLinks(admin, tenantId, oppId)).rows.filter((l) => l.estimate_id === estimate.id);
  if (links.length === 0) return { written: true, estimate_id: estimate.id, estimate_ref: estimate.ref, repriced: 0, flagged: 0, locked: false };

  const note = `${args.rfq.ref ?? "An RFQ"} was awarded${args.supplierName ? ` to ${args.supplierName}` : ""}`.slice(0, 300);
  if (bidIsLocked(opp.stage)) {
    await admin.from("tender_boq_estimate_links").update({ needs_review: true, review_note: `${note}. The bid is already in, so the rate was not changed.`.slice(0, 300), updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("opportunity_id", oppId).eq("estimate_id", estimate.id);
    return { written: true, estimate_id: estimate.id, estimate_ref: estimate.ref, repriced: 0, flagged: new Set(links.map((l) => l.boq_line_id)).size, locked: true };
  }
  const res = await repriceBoqLines(
    { admin, tenantId, userId: ctx.userId, email: ctx.email, opp } as Parameters<typeof repriceBoqLines>[0],
    [...new Set(links.map((l) => l.boq_line_id))], { markReview: true, reviewNote: note },
  );
  return { written: true, estimate_id: estimate.id, estimate_ref: estimate.ref, repriced: res.repriced.length, flagged: res.failed.length, locked: false };
}
