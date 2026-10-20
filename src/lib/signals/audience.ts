import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { signalsEnabled } from "./flag";
import { isStage } from "./types";
import type { TenantFeatures } from "@/lib/constants";

// The values behind the Buying signals audience fields (SEGMENT_FIELDS:
// buying_stage, intent_score, days_in_stage, signal_topic). Read from the stored
// account_intent row, so a target group and the list page can never disagree.

export type AudienceValues = {
  buying_stage: string;
  intent_score: number;
  days_in_stage: number | "";
  signal_topic: string;
};

const DAY = 86_400_000;

/**
 * One map of account id to its values, for the whole tenant; accounts with no
 * stored row are Quiet with score 0. Null means "cannot be answered" (the
 * workspace does not have the module, or the database update is pending): the
 * caller must then treat every signals condition as not matching.
 */
export async function loadAudienceValues(tenantId: string, client?: SupabaseClient, now: Date = new Date()): Promise<Map<string, AudienceValues> | null> {
  const admin = client ?? createAdminSupabase();
  const { data: tenant } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if (!signalsEnabled(tenant?.features as Partial<TenantFeatures> | undefined)) return null;

  const out = new Map<string, AudienceValues>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("account_intent").select("account_id, score, stage, stage_changed_at, topics")
      .eq("tenant_id", tenantId).range(from, from + 999);
    if (error) return null;
    for (const r of (data ?? []) as { account_id: string; score: number; stage: string; stage_changed_at: string | null; topics: string[] | null }[]) {
      out.set(r.account_id, {
        buying_stage: isStage(r.stage) ? r.stage : "quiet",
        intent_score: r.score,
        days_in_stage: r.stage_changed_at ? Math.max(0, Math.floor((now.getTime() - new Date(r.stage_changed_at).getTime()) / DAY)) : "",
        signal_topic: (r.topics ?? []).join(", "),
      });
    }
    if ((data ?? []).length < 1000) return out;
  }
}

export const QUIET_VALUES: AudienceValues = { buying_stage: "quiet", intent_score: 0, days_in_stage: "", signal_topic: "" };
