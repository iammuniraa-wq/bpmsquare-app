import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SegmentFilter } from "@/lib/marketingSegmentation";
import { bestLeadsByAccount } from "./queries";

// The two campaign-audience fields that come from lead scoring: an account's
// lead_score and lead_stage are those of its best lead (the one a salesperson
// would act on). The campaign recipient resolver calls this only when a rule
// actually uses one of them, so an ordinary campaign pays nothing.

const LEAD_FIELDS = new Set(["lead_score", "lead_stage"]);

export function filtersUseLeadSignals(filters: SegmentFilter[] | undefined): boolean {
  return (filters ?? []).some((f) => LEAD_FIELDS.has(f.field));
}

export type LeadSignals = { lead_score?: number; lead_stage?: string };

export async function loadLeadSignals(admin: SupabaseClient, tenantId: string): Promise<Map<string, LeadSignals>> {
  const best = await bestLeadsByAccount(admin, tenantId);
  const out = new Map<string, LeadSignals>();
  for (const [accountId, lead] of best) {
    out.set(accountId, { ...(lead.score != null ? { lead_score: lead.score } : {}), lead_stage: lead.stage });
  }
  return out;
}
