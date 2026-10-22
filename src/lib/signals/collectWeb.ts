import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { webAvailability } from "@/lib/assistant/webConsent";
import { isSchemaPending } from "@/lib/marketing/pending";
import { analysisFeed } from "@/lib/analysis/feed";
import type { RawSignal } from "./types";

// The web half of the Buying signals collectors: the claims a saved company analysis found for an account. Runs on the
// service-role client, so the workspace is in every filter. A workspace that does not have web research on, or has no
// saved analysis, or has not applied migration 0206, contributes nothing and nothing breaks.

const DAY = 86_400_000;
const MAX_ROWS = 5000;

/** Account id -> its web signals. */
export async function collectWebSignals(admin: SupabaseClient, tenantId: string, now: Date, warnings: string[]): Promise<Map<string, RawSignal[]>> {
  const { data: t } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  const features = ((t as { features?: Record<string, boolean | undefined> } | null)?.features ?? {}) as Record<string, boolean | undefined>;
  const config = ((t as { config?: { ai_assistant?: { block_external_calls?: boolean } } } | null)?.config ?? null);
  if (!webAvailability(features, config).enabled) return new Map();

  // A claim cannot be younger than the run that found it, and nothing counts after 90 days, so older rows hold nothing.
  const since = new Date(now.getTime() - 90 * DAY).toISOString();
  const { data, error } = await admin.from("company_analyses").select("account_id, data")
    .eq("tenant_id", tenantId).not("account_id", "is", null).gte("computed_at", since).limit(MAX_ROWS);
  if (error) {
    if (!isSchemaPending(error)) warnings.push(`company_analyses: ${error.message ?? "could not be read"}`);
    return new Map();
  }
  return analysisFeed((data ?? []) as { account_id: string | null; data: unknown }[], now);
}
