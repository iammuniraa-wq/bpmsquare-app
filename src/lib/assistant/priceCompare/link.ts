import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES } from "@/lib/constants";
import { tenderForDeal } from "@/lib/tender/server";
import type { RfqHead } from "./load";

/**
 * The tender deal an RFQ belongs to, when the workspace has the tender edition and the RFQ was raised from that deal (or from one of its
 * estimates). The RFQ of a tender is awarded on the deal's Costing tab, so this is also what picks the award route. Null for any other RFQ.
 */
export async function tenderDealOf(
  db: SupabaseClient, tenantId: string, features: Record<string, boolean | undefined>, rfq: Pick<RfqHead, "origin_type" | "origin_id">,
): Promise<{ dealId: string; dealRef: string | null } | null> {
  if (features.gcc_tender !== true || !rfq.origin_id || (rfq.origin_type !== "opportunity" && rfq.origin_type !== "estimate")) return null;
  let dealId: string | null = rfq.origin_type === "opportunity" ? rfq.origin_id : null;
  if (rfq.origin_type === "estimate") {
    const { data } = await db.from("estimates").select("opportunity_id").eq("id", rfq.origin_id).eq("tenant_id", tenantId).maybeSingle();
    dealId = (data as { opportunity_id?: string | null } | null)?.opportunity_id ?? null;
  }
  if (!dealId || !(await tenderForDeal(db, tenantId, features, dealId))) return null;
  const { data: opp } = await db.from("opportunities").select("ref").eq("id", dealId).eq("tenant_id", tenantId).maybeSingle();
  return { dealId, dealRef: (opp as { ref?: string | null } | null)?.ref ?? null };
}

/** Where the compare screen is: the deal's Costing tab for a tender, the RFQ's own page for any other RFQ. */
export const compareHref = (rfqId: string, deal: { dealId: string } | null): string => (deal ? `${ROUTES.pipelineDetail(deal.dealId)}?tab=costing` : ROUTES.rfq(rfqId));
