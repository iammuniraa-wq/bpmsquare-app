import type { SupabaseClient } from "@supabase/supabase-js";
import { reportCacheKey } from "../budget";
import { isMissing } from "../cache";
import { readStoredReport } from "./validate";
import type { CompanyReport } from "./types";

// The cached company report. It lives in company_analyses (migration 0206) under the key "report:<company key>" with
// `data.kind = "report"` and the report in `data.report`, so no new table and no migration: the verdict card's row for the
// same company is a different row and is never read or overwritten here. `account_id` is left empty on purpose: the
// Buying signals collector reads only rows that have one, and a report is not a signal. Service role only, workspace in
// every filter; a missing table (0206 pending) reads as "no report yet" and a save that reports pending.

export type ReportRow = {
  id: string;
  report: CompanyReport;
  version: number;
  computedAt: string;
  expiresAt: string;
};

type Stored = { id: string; data: unknown; version: number | null; computed_at: string; expires_at: string };

export async function readReport(admin: SupabaseClient, tenantId: string, companyKey: string): Promise<{ row: ReportRow | null; pending: boolean }> {
  const key = reportCacheKey(companyKey);
  if (!key) return { row: null, pending: false };
  const { data, error } = await admin.from("company_analyses").select("id, data, version, computed_at, expires_at")
    .eq("tenant_id", tenantId).eq("company_key", key).maybeSingle();
  if (error) return { row: null, pending: isMissing(error) };
  const row = data as Stored | null;
  const d = row?.data as { kind?: unknown; report?: unknown } | null | undefined;
  if (!row || !d || d.kind !== "report") return { row: null, pending: false };
  const report = readStoredReport(d.report);
  return report ? { row: { id: row.id, report, version: row.version ?? 1, computedAt: row.computed_at, expiresAt: row.expires_at }, pending: false } : { row: null, pending: false };
}

export type SaveReportIn = {
  tenantId: string; companyKey: string; report: CompanyReport; version: number;
  searches: number; inputTokens: number; outputTokens: number; requestedBy: string | null; computedAt: string; expiresAt: string;
};

/** Never throws. `pending` means the table does not exist yet; `saved` is false for any failure. */
export async function saveReport(admin: SupabaseClient, s: SaveReportIn): Promise<{ saved: boolean; pending: boolean }> {
  const key = reportCacheKey(s.companyKey);
  if (!key) return { saved: false, pending: false };
  try {
    const { error } = await admin.from("company_analyses").upsert({
      tenant_id: s.tenantId, company_key: key, account_id: null, name: s.report.name, domain: s.report.domain,
      data: { v: 1, kind: "report", claims: [], report: s.report }, previous_data: null, changes: [],
      sources: s.report.sources.map((x) => ({ url: x.url, title: x.title, publisher: x.publisher ?? null, fetched_at: s.computedAt })),
      version: s.version, searches: s.searches, input_tokens: s.inputTokens, output_tokens: s.outputTokens,
      requested_by: s.requestedBy, computed_at: s.computedAt, expires_at: s.expiresAt,
    }, { onConflict: "tenant_id,company_key" });
    if (error) {
      if (!isMissing(error)) console.error("company report save failed:", error.message);
      return { saved: false, pending: isMissing(error) };
    }
    return { saved: true, pending: false };
  } catch (e) {
    console.error("company report save failed:", e);
    return { saved: false, pending: false };
  }
}
