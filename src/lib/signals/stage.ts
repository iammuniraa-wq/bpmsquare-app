import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { signalsEnabled } from "./flag";
import { STAGE_LABEL, isStage, type Stage } from "./types";
import type { TenantFeatures } from "@/lib/constants";

// The one function other modules call (the ABM design reads it): where an
// account is in its buying cycle, from the stored row -- never recomputed here,
// so every surface agrees.

export type BuyingStage = {
  stage: Stage;
  label: string;
  score: number;
  stage_changed_at: string | null;
  computed_at: string | null;
};

/**
 * The account's buying stage, or null when it cannot be answered: the
 * workspace does not have Buying signals, the account is not this tenant's, or
 * the database update is pending. An account with no stored row is Quiet.
 */
export async function getBuyingStage(tenantId: string, accountId: string, client?: SupabaseClient): Promise<BuyingStage | null> {
  const admin = client ?? createAdminSupabase();
  const { data: tenant, error: tErr } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if (tErr || !signalsEnabled(tenant?.features as Partial<TenantFeatures> | undefined)) return null;
  const { data: account } = await admin.from("accounts").select("id").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return null;
  const { data, error } = await admin.from("account_intent")
    .select("stage, score, stage_changed_at, computed_at").eq("tenant_id", tenantId).eq("account_id", accountId).maybeSingle();
  if (error) return null;
  if (!data) return { stage: "quiet", label: STAGE_LABEL.quiet, score: 0, stage_changed_at: null, computed_at: null };
  const row = data as { stage: string; score: number; stage_changed_at: string | null; computed_at: string };
  const stage: Stage = isStage(row.stage) ? row.stage : "quiet";
  return { stage, label: STAGE_LABEL[stage], score: row.score, stage_changed_at: row.stage_changed_at, computed_at: row.computed_at };
}
