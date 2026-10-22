import type { SupabaseClient } from "@supabase/supabase-js";
import { RETENTION_DAYS } from "./budget";
import type { StoredResearch } from "./compose";
import type { Change } from "./types";

// company_analyses (migration 0206): one row per (workspace, company key). Service role only -- every call here is on the
// admin client with the workspace in the filter, and a missing table (migration pending) reads as "not analysed yet" and a
// save that reports pending, so the analysis still runs and is simply returned uncached.

export type CacheRow = {
  id: string;
  company_key: string;
  account_id: string | null;
  name: string;
  domain: string | null;
  data: StoredResearch;
  previous_data: StoredResearch | null;
  changes: Change[] | null;
  version: number;
  computed_at: string;
  expires_at: string;
};

export function isMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204"
    || /does not exist|Could not find the table|schema cache/i.test(err.message ?? "");
}

const COLUMNS = "id, company_key, account_id, name, domain, data, previous_data, changes, version, computed_at, expires_at";

const validData = (d: unknown): d is StoredResearch => !!d && typeof d === "object" && (d as StoredResearch).v === 1 && Array.isArray((d as StoredResearch).claims);

export async function readAnalysis(admin: SupabaseClient, tenantId: string, companyKey: string): Promise<{ row: CacheRow | null; pending: boolean }> {
  if (!companyKey) return { row: null, pending: false };
  const { data, error } = await admin.from("company_analyses").select(COLUMNS).eq("tenant_id", tenantId).eq("company_key", companyKey).maybeSingle();
  if (error) return { row: null, pending: isMissing(error) };
  if (!data || !validData((data as CacheRow).data)) return { row: null, pending: false };
  const row = data as CacheRow;
  return { row: { ...row, previous_data: validData(row.previous_data) ? row.previous_data : null }, pending: false };
}

export type SaveIn = {
  tenantId: string; companyKey: string; accountId: string | null; name: string; domain: string | null;
  data: StoredResearch; previous: StoredResearch | null; changes: Change[]; version: number;
  searches: number; inputTokens: number; outputTokens: number; requestedBy: string | null; computedAt: string; expiresAt: string;
};

/** Never throws. `pending` means the table does not exist yet; `saved` is false for any failure. */
export async function saveAnalysis(admin: SupabaseClient, s: SaveIn): Promise<{ saved: boolean; pending: boolean }> {
  try {
    const { error } = await admin.from("company_analyses").upsert({
      tenant_id: s.tenantId, company_key: s.companyKey, account_id: s.accountId, name: s.name, domain: s.domain,
      data: s.data, previous_data: s.previous, changes: s.changes, sources: s.data.sources.map((x) => ({ url: x.url, title: x.title, publisher: x.publisher ?? null, fetched_at: x.fetchedAt })),
      version: s.version, searches: s.searches, input_tokens: s.inputTokens, output_tokens: s.outputTokens,
      requested_by: s.requestedBy, computed_at: s.computedAt, expires_at: s.expiresAt,
    }, { onConflict: "tenant_id,company_key" });
    if (error) {
      if (!isMissing(error)) console.error("company_analyses save failed:", error.message);
      return { saved: false, pending: isMissing(error) };
    }
    return { saved: true, pending: false };
  } catch (e) {
    console.error("company_analyses save failed:", e);
    return { saved: false, pending: false };
  }
}

/** Companies that are not accounts and have not been refreshed for 90 days. Tenant-scoped; for the nightly cron to call. */
export async function sweepOldAnalyses(admin: SupabaseClient, tenantId: string, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  try {
    await admin.from("company_analyses").delete().eq("tenant_id", tenantId).is("account_id", null).lt("computed_at", cutoff);
  } catch { /* retention is housekeeping; it never blocks anything */ }
}
