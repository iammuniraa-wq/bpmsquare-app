import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";
import { isUuid } from "./rules";

export type EstimateTenderTag = { id: string; ref: string | null; title: string };

/**
 * For the Estimates list: which of these estimates were made for a tender, and which tender. Answers an empty map without a query
 * for a workspace without the tender edition, and when the deal column or table is not there yet (migration 0227 pending). Every read
 * is tenant-scoped.
 */
export async function estimateTenderTags(
  admin: SupabaseClient, tenantId: string, features: Partial<TenantFeatures> | null | undefined, estimateIds: readonly string[],
): Promise<Map<string, EstimateTenderTag>> {
  const out = new Map<string, EstimateTenderTag>();
  if (features?.gcc_tender !== true || features?.pipeline !== true || estimateIds.length === 0) return out;
  const est = await admin.from("estimates").select("id, opportunity_id").eq("tenant_id", tenantId).in("id", [...estimateIds]);
  if (est.error) return out;
  const dealOf = new Map<string, string>();
  for (const r of (est.data ?? []) as { id: string; opportunity_id: string | null }[]) if (isUuid(r.opportunity_id)) dealOf.set(r.id, r.opportunity_id);
  if (dealOf.size === 0) return out;
  const opps = await admin.from("opportunities").select("id, ref, title").eq("tenant_id", tenantId).in("id", [...new Set(dealOf.values())]);
  if (opps.error) return out;
  const byId = new Map(((opps.data ?? []) as { id: string; ref: string | null; title: string }[]).map((o) => [o.id, o]));
  for (const [estimateId, dealId] of dealOf) {
    const o = byId.get(dealId);
    if (o) out.set(estimateId, { id: o.id, ref: o.ref ?? null, title: o.title });
  }
  return out;
}
