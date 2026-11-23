import type { SupabaseClient } from "@supabase/supabase-js";
import { reportCacheKey } from "../budget";
import { isMissing } from "../cache";
import type { Citation } from "../validate";
import { readLegacyReport, type LegacyReport } from "./legacy";
import { REPORT_PARTS, type CompanyReport, type ReportPartId } from "./types";
import { readStoredReport } from "./validate";

// The cached company brief. It lives in company_analyses (migration 0206) under the key "report:<company key>" with
// `data.kind = "report"` and the brief in `data.report`, so no new table and no migration: the verdict card's row for the
// same company is a different row and is never read or overwritten here. `account_id` is left empty on purpose: the
// Buying signals collector reads only rows that have one, and a brief is not a signal. Service role only, workspace in
// every filter; a missing table (0206 pending) reads as "no report yet" and a save that reports pending.
//
// `data.parts` keeps what each finished research part answered (its JSON and the pages it cited), so a retry of the missing
// parts re-validates all four together and a finished part is never paid for twice. It is never drawn: the card shows only
// the validated brief. A row written before the brief (`data.report.v` 1) reads as `legacy` and never counts as fresh.

export type StoredPart = { raw: unknown; citations: Citation[]; searches: number };
export type StoredParts = Partial<Record<ReportPartId, StoredPart>>;

export type ReportRow = {
  id: string;
  /** The brief, or null when the row holds an older report (see `legacy`). */
  report: CompanyReport | null;
  legacy: LegacyReport | null;
  parts: StoredParts;
  version: number;
  computedAt: string;
  expiresAt: string;
};

type Stored = { id: string; data: unknown; version: number | null; computed_at: string; expires_at: string };

const MAX_PART_BYTES = 80_000;

const textOf = (v: unknown, max: number): string | undefined => (typeof v === "string" && v ? v.slice(0, max) : undefined);

/** Parts read back from the jsonb: https pages only, bounded in size. The raw JSON is only ever fed to the validator again. */
export function readStoredParts(raw: unknown): StoredParts {
  const out: StoredParts = {};
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return out;
  for (const part of REPORT_PARTS) {
    const p = r[part] as { raw?: unknown; citations?: unknown; searches?: unknown } | undefined;
    if (!p || typeof p !== "object" || p.raw === undefined || p.raw === null) continue;
    let size = 0;
    try { size = JSON.stringify(p.raw).length; } catch { continue; }
    if (size > MAX_PART_BYTES) continue;
    const citations: Citation[] = [];
    for (const c of Array.isArray(p.citations) ? p.citations : []) {
      const x = c as Citation;
      if (typeof x?.url !== "string") continue;
      try { if (new URL(x.url).protocol !== "https:") continue; } catch { continue; }
      const snippets = Array.isArray(x.snippets) ? x.snippets.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 300)).slice(0, 3) : undefined;
      citations.push({ url: x.url, title: textOf(x.title, 200), snippet: textOf(x.snippet, 300), ...(snippets?.length ? { snippets } : {}) });
      if (citations.length >= 60) break;
    }
    out[part] = { raw: p.raw, citations, searches: typeof p.searches === "number" && p.searches >= 0 ? Math.min(3, Math.floor(p.searches)) : 0 };
  }
  return out;
}

export async function readReport(admin: SupabaseClient, tenantId: string, companyKey: string): Promise<{ row: ReportRow | null; pending: boolean }> {
  const key = reportCacheKey(companyKey);
  if (!key) return { row: null, pending: false };
  const { data, error } = await admin.from("company_analyses").select("id, data, version, computed_at, expires_at")
    .eq("tenant_id", tenantId).eq("company_key", key).maybeSingle();
  if (error) return { row: null, pending: isMissing(error) };
  const row = data as Stored | null;
  const d = row?.data as { kind?: unknown; report?: unknown; parts?: unknown } | null | undefined;
  if (!row || !d || d.kind !== "report") return { row: null, pending: false };
  const report = readStoredReport(d.report);
  const legacy = report ? null : readLegacyReport(d.report);
  if (!report && !legacy) return { row: null, pending: false };
  return {
    row: { id: row.id, report, legacy, parts: report ? readStoredParts(d.parts) : {}, version: row.version ?? 1, computedAt: row.computed_at, expiresAt: row.expires_at },
    pending: false,
  };
}

export type SaveReportIn = {
  tenantId: string; companyKey: string; report: CompanyReport; parts: StoredParts; version: number;
  searches: number; inputTokens: number; outputTokens: number; requestedBy: string | null; computedAt: string; expiresAt: string;
};

/** Never throws. `pending` means the table does not exist yet; `saved` is false for any failure. */
export async function saveReport(admin: SupabaseClient, s: SaveReportIn): Promise<{ saved: boolean; pending: boolean }> {
  const key = reportCacheKey(s.companyKey);
  if (!key) return { saved: false, pending: false };
  try {
    const { error } = await admin.from("company_analyses").upsert({
      tenant_id: s.tenantId, company_key: key, account_id: null, name: s.report.name, domain: s.report.domain,
      data: { v: 1, kind: "report", claims: [], report: s.report, parts: s.parts }, previous_data: null, changes: [],
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
