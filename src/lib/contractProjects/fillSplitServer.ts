import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import { loadEstimateBudgetInputs } from "@/lib/tender/estimates/budgetServer";
import { isUuid } from "@/lib/tender/estimates/rules";
import type { EstimateBudgetInput } from "./fromTender";
import { resourceShares, type EstimateShares } from "./fillSplit";

// What "Fill from tender costs" reads besides the recorded costs, to split a cost by resource: the links of each BOQ line to the estimates that
// priced it, and, for a BOQ line that names an estimate as its price source without a link row, that estimate's own shares. Every query carries the
// tenant and the deal, and an estimate counts only when it belongs to THIS deal. A missing table reads as "no estimates", so a workspace that never
// used estimates in a tender gets the fill it always had.

export type FillEstimates = { estimates: EstimateBudgetInput; shares: Map<string, EstimateShares> };

const refToken = (ref: string): string => ref.replace(/\s*\+\d+$/, "").trim();

export async function loadFillEstimates(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<FillEstimates> {
  const shares = new Map<string, EstimateShares>();
  if (!isUuid(opportunityId)) return { estimates: new Map(), shares };
  const estimates = await loadEstimateBudgetInputs(admin, tenantId, opportunityId);

  const boq = await readAllPages((lo, hi) => admin.from("tender_boq_lines").select("line_id, price_source, price_source_ref")
    .eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("price_source", "estimate").order("id", { ascending: true }).range(lo, hi));
  const unlinked = ((boq.error ? [] : boq.data ?? []) as { line_id: string | null; price_source_ref: string | null }[])
    .filter((b) => b.line_id && b.price_source_ref && !((estimates.get(b.line_id)?.links.length ?? 0) > 0));
  if (unlinked.length === 0) return { estimates, shares };

  const heads = await admin.from("estimates").select("id, ref, name").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).limit(500);
  const known = ((heads.error ? [] : heads.data ?? []) as { id: string; ref: string | null; name: string }[]);
  const match = (token: string) => {
    const t = token.toLowerCase();
    return known.find((e) => e.id.toLowerCase() === t || (e.ref ?? "").toLowerCase() === t || e.name.toLowerCase() === t) ?? null;
  };
  const wanted = new Map<string, { id: string; ref: string }>();
  for (const b of unlinked) {
    const e = match(refToken(b.price_source_ref as string));
    if (e) wanted.set(b.line_id as string, { id: e.id, ref: e.ref ?? e.name });
  }
  if (wanted.size === 0) return { estimates, shares };

  const ids = [...new Set([...wanted.values()].map((w) => w.id))];
  const byEstimate = new Map<string, { component: string | null; cost_total: number | null; unit_cost: number | null; qty: number }[]>(ids.map((id) => [id, []]));
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const res = await readAllPages((lo, hi) => admin.from("estimate_lines").select("estimate_id, component, cost_total, unit_cost, qty")
      .eq("tenant_id", tenantId).in("estimate_id", part).order("id", { ascending: true }).range(lo, hi));
    for (const r of (res.error ? [] : res.data ?? []) as { estimate_id: string; component: string | null; cost_total: number | string | null; unit_cost: number | string | null; qty: number | string | null }[]) {
      byEstimate.get(r.estimate_id)?.push({
        component: r.component, cost_total: r.cost_total == null ? null : Number(r.cost_total), unit_cost: r.unit_cost == null ? null : Number(r.unit_cost), qty: Number(r.qty ?? 0),
      });
    }
  }
  for (const [dealLine, w] of wanted) {
    const s = resourceShares(byEstimate.get(w.id) ?? []);
    if (s.length > 0) shares.set(dealLine, { ref: w.ref, shares: s });
  }
  return { estimates, shares };
}
