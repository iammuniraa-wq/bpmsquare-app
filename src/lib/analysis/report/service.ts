import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowanceFor } from "@/lib/ai/structured";
import type { Allowance } from "@/lib/ai/usageCap";
import { canViewWorkcenter } from "@/lib/permissions";
import { isUuid } from "@/lib/assistant/objects";
import { dayStartIso, DEFAULT_REPORT_DAILY_LIMIT, expiresAtFor, isFresh, refreshBlockedUntil } from "../budget";
import { keyOfSubject, looksPersonal, toSubject, type Subject, type SubjectInput } from "../subject";
import { NO_KEY } from "../research";
import { analysisAccess, matchAccountId, type AnalysisAccess } from "../service";
import { readReport, saveReport, type ReportRow } from "./cache";
import { runReportResearch, ReportResearchError, type ReportRun } from "./research";
import { reportIsEmpty, type CompanyReport } from "./types";
import { validateReport } from "./validate";

// The company report service (docs/design/company-report.md). One function the dock calls: buildCompanyReport(). Order of play:
// gate, resolve the subject (an account or lead is verified against the workspace BEFORE its name goes anywhere), read the
// cache, apply the hourly refresh limit, this person's daily report limit and the monthly allowance, research, validate,
// save. The cached report is always the fallback when a limit or a failure stops a fresh run.

export const REPORT_SURFACE = "company_report";

export type ReportInput = SubjectInput & {
  accountId?: string | null;
  leadId?: string | null;
  refresh?: boolean;
  /** The person said yes to web research for this company. Without it nothing leaves the workspace. */
  allowWeb?: boolean;
};

export type ReportNotice =
  | { kind: "daily_limit" } | { kind: "refresh_limit"; until: string } | { kind: "over_budget" } | { kind: "research_failed"; message: string };

export type ReportResult =
  | {
    ok: true; report: CompanyReport; cached: boolean; saved: boolean; pendingDb: boolean;
    companyKey: string; accountId: string | null; computedAt: string; notice?: ReportNotice;
  }
  | { ok: false; status: 400 | 403 | 404 | 429 | 502; error: string; code: string };

export type ReportDeps = {
  now: () => Date;
  research: (subject: Subject, offerings: readonly string[]) => Promise<ReportRun>;
  allowance: (tenantId: string, budget: number) => Promise<Allowance>;
  /** The workspace's own offering names: the only tenant data the research call ever receives, besides the subject. */
  offerings: (a: AnalysisAccess) => Promise<string[]>;
};

type AccountRow = { id: string; name: string; website: string | null; city: string | null; country: string | null; industry: string | null };
const ACCOUNT_COLS = "id, name, website, city, country, industry";

const fail = (status: 400 | 403 | 404 | 429 | 502, code: string, error: string): Extract<ReportResult, { ok: false }> => ({ ok: false, status, code, error });

/** Names of what this workspace sells: its enabled signal topics and its segments. Tenant-scoped; a failed read is an empty list. */
export async function loadOfferings(a: AnalysisAccess): Promise<string[]> {
  const read = async (table: string): Promise<string[]> => {
    try {
      const q = a.admin.from(table).select("name").eq("tenant_id", a.tenantId);
      const { data, error } = await (table === "signal_topics" ? q.eq("enabled", true) : q).limit(100);
      return error ? [] : ((data ?? []) as { name?: unknown }[]).map((r) => (typeof r.name === "string" ? r.name.trim() : "")).filter(Boolean);
    } catch {
      return [];
    }
  };
  const names = [...new Set([...(await read("signal_topics")), ...(await read("segments"))])];
  return names.filter((n) => n.length <= 60 && !looksPersonal(n)).slice(0, 20);
}

export function defaultReportDeps(): ReportDeps {
  return {
    now: () => new Date(),
    research: (subject, offerings) => {
      if (!process.env.ANTHROPIC_API_KEY) throw new ReportResearchError(NO_KEY);
      return runReportResearch(new Anthropic(), subject, offerings);
    },
    allowance: allowanceFor,
    offerings: loadOfferings,
  };
}

async function resolveAccount(a: AnalysisAccess, id: string): Promise<AccountRow | null> {
  const { data } = await a.supabase.from("accounts").select(ACCOUNT_COLS).eq("id", id).eq("tenant_id", a.tenantId).maybeSingle();
  return (data as AccountRow | null) ?? null;
}

/** A lead belongs to an account: the lead is checked against the workspace, then its account, before either name is used. */
async function accountOfLead(a: AnalysisAccess, leadId: string): Promise<AccountRow | null> {
  if (!a.features.leads || !canViewWorkcenter(a.perms, "leads")) return null;
  const { data } = await a.admin.from("leads").select("id, account_id").eq("id", leadId).eq("tenant_id", a.tenantId).maybeSingle();
  const accountId = (data as { account_id?: unknown } | null)?.account_id;
  return typeof accountId === "string" ? resolveAccount(a, accountId) : null;
}

export type ResolvedReportSubject = { ok: true; subject: Subject; account: AccountRow | null; companyKey: string } | Extract<ReportResult, { ok: false }>;

export async function resolveReportSubject(a: AnalysisAccess, input: ReportInput): Promise<ResolvedReportSubject> {
  let account: AccountRow | null = null;
  if (input.accountId) {
    if (!isUuid(input.accountId)) return fail(404, "not_found", "Account not found");
    account = await resolveAccount(a, input.accountId);
    if (!account) return fail(404, "not_found", "Account not found");
  } else if (input.leadId) {
    if (!isUuid(input.leadId)) return fail(404, "not_found", "Lead not found");
    account = await accountOfLead(a, input.leadId);
    if (!account) return fail(404, "not_found", "Lead not found");
  } else {
    const matched = await matchAccountId(a, input);
    if (matched) account = await resolveAccount(a, matched);
  }
  const s = account
    ? toSubject({ name: account.name, website: account.website, city: account.city, country: account.country, industry: account.industry })
    : toSubject(input);
  if ("error" in s) return fail(400, "bad_subject", s.error);
  const companyKey = keyOfSubject(s);
  if (!companyKey) return fail(400, "bad_subject", "Name the company or give its website.");
  return { ok: true, subject: s, account, companyKey };
}

type Slot = { ok: true; id: string } | { ok: false };

/**
 * Takes one of this person's reports for today BEFORE any search runs. The reservation is a zero-token row in the meter's
 * own log, counted straight after it is written, so parallel asks see each other's rows and at most the limit get through.
 * The same row later carries the real tokens. Any failure to write or count refuses: the cap never fails open.
 */
async function reserve(a: AnalysisAccess, limit: number, now: Date): Promise<Slot> {
  if (limit <= 0) return { ok: false };
  try {
    const { data, error } = await a.admin.from("ai_usage_log")
      .insert({ tenant_id: a.tenantId, user_id: a.userId, surface: REPORT_SURFACE, model: "reservation", input_tokens: 0, output_tokens: 0 })
      .select("id").single();
    if (error || !data) return { ok: false };
    const id = String((data as { id: unknown }).id);
    const { count, error: ce } = await a.admin.from("ai_usage_log").select("id", { count: "exact", head: true })
      .eq("tenant_id", a.tenantId).eq("user_id", a.userId).eq("surface", REPORT_SURFACE).gte("created_at", dayStartIso(now));
    if (ce || count === null || count === undefined || count > limit) {
      await release(a.admin, a.tenantId, id);
      return { ok: false };
    }
    return { ok: true, id };
  } catch {
    return { ok: false };
  }
}

async function release(admin: SupabaseClient, tenantId: string, id: string): Promise<void> {
  try { await admin.from("ai_usage_log").delete().eq("id", id).eq("tenant_id", tenantId); } catch { /* a leftover row only makes the cap stricter */ }
}

async function settle(a: AnalysisAccess, id: string, run: ReportRun): Promise<void> {
  try {
    await a.admin.from("ai_usage_log").update({ model: run.model, input_tokens: run.tokens.input, output_tokens: run.tokens.output })
      .eq("id", id).eq("tenant_id", a.tenantId);
  } catch (e) {
    console.error("ai_usage_log update failed:", e);
  }
}

const cachedOk = (row: ReportRow, o: { companyKey: string; accountId: string | null; pending: boolean; notice?: ReportNotice }): ReportResult => ({
  ok: true, report: row.report, cached: true, saved: true, pendingDb: o.pending, companyKey: o.companyKey, accountId: o.accountId, computedAt: row.computedAt,
  ...(o.notice ? { notice: o.notice } : {}),
});

/** What the dock reads first: the saved report if there is one and it is fresh, with no web, no cost, no limit used. */
export async function readCachedReport(a: AnalysisAccess, input: ReportInput, deps: Pick<ReportDeps, "now"> = defaultReportDeps()):
Promise<{ ok: true; row: ReportRow | null; fresh: boolean; resolved: Extract<ResolvedReportSubject, { ok: true }>; pendingDb: boolean } | Extract<ReportResult, { ok: false }>> {
  const gate = analysisAccess(a);
  if (!gate.ok) return fail(gate.status, gate.code, gate.error);
  const resolved = await resolveReportSubject(a, input);
  if (!resolved.ok) return resolved;
  const { row, pending } = await readReport(a.admin, a.tenantId, resolved.companyKey);
  return { ok: true, row, fresh: !!row && isFresh(row.expiresAt, deps.now()), resolved, pendingDb: pending };
}

export async function buildCompanyReport(a: AnalysisAccess, input: ReportInput, deps: ReportDeps = defaultReportDeps()): Promise<ReportResult> {
  const gate = analysisAccess(a);
  if (!gate.ok) return fail(gate.status, gate.code, gate.error);
  const resolved = await resolveReportSubject(a, input);
  if (!resolved.ok) return resolved;
  const { subject, account, companyKey } = resolved;
  const accountId = account?.id ?? null;

  const now = deps.now();
  const { row, pending } = await readReport(a.admin, a.tenantId, companyKey);
  const cachedResult = (notice?: ReportNotice) => cachedOk(row!, { companyKey, accountId, pending, notice });

  if (row && isFresh(row.expiresAt, now) && !input.refresh) return cachedResult();
  if (row && input.refresh) {
    const until = refreshBlockedUntil(row.computedAt, now);
    if (until) return cachedResult({ kind: "refresh_limit", until });
  }
  // A report is only ever made from a verified yes: without it nothing is searched and there is nothing to show.
  if (input.allowWeb !== true) return fail(403, "needs_consent", "A company report needs web research, and nobody has said yes to it yet.");

  const stopped = (kind: "daily_limit" | "over_budget", message: string): ReportResult => (row ? cachedResult({ kind }) : fail(429, kind, message));

  const slot = await reserve(a, DEFAULT_REPORT_DAILY_LIMIT, now);
  if (!slot.ok) return stopped("daily_limit", `You have reached today's limit of ${DEFAULT_REPORT_DAILY_LIMIT} company reports. Try again tomorrow.`);

  const allowance = await deps.allowance(a.tenantId, a.budget).catch(() => null);
  if (!allowance || !allowance.allowed) {
    await release(a.admin, a.tenantId, slot.id);
    return stopped("over_budget", "You have used this month's AI allowance.");
  }

  const offerings = await deps.offerings(a).catch(() => [] as string[]);
  let run: ReportRun;
  try {
    run = await deps.research(subject, offerings);
  } catch (e) {
    await release(a.admin, a.tenantId, slot.id);
    const message = e instanceof Error ? e.message : "The web research could not run.";
    return row ? cachedResult({ kind: "research_failed", message }) : fail(502, "research_failed", message);
  }
  await settle(a, slot.id, run);

  const { report } = validateReport(run.raw, { subject, citations: run.citations, offerings, now, searches: run.searches });
  if (reportIsEmpty(report)) {
    const message = `The research found no page it could cite for ${subject.name}, so there is no report. Nothing was saved.`;
    return row ? cachedResult({ kind: "research_failed", message }) : fail(502, "no_sources", message);
  }

  const computedAt = now.toISOString();
  const save = await saveReport(a.admin, {
    tenantId: a.tenantId, companyKey, report, version: (row?.version ?? 0) + 1,
    searches: run.searches, inputTokens: run.tokens.input, outputTokens: run.tokens.output, requestedBy: a.userId, computedAt, expiresAt: expiresAtFor(now),
  });
  return { ok: true, report, cached: false, saved: save.saved, pendingDb: save.pending || pending, companyKey, accountId, computedAt };
}
