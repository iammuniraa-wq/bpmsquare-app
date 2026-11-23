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
import { readReport, saveReport, type ReportRow, type StoredParts } from "./cache";
import { fitWorthRunning, cleanOfferings } from "./fit";
import type { LegacyReport } from "./legacy";
import { PART_TIMEOUT_MS, RUN_BUDGET_MS, runFitCall, runReportParts, type FitRun, type PartHooks, type PartResult } from "./research";
import { MAX_REPORT_SEARCHES, REPORT_PARTS, reportIsEmpty, type CompanyReport, type FailReason, type ReportLens, type ReportPartId } from "./types";
import { mergeCitations, validateBrief, validateFit } from "./validate";

// The company brief service (docs/design/company-brief-sales.md). One function the dock and the run route call:
// buildCompanyReport(). Order of play: gate, resolve the subject (an account or lead is verified against the workspace BEFORE
// its name goes anywhere), read the cache, apply the hourly refresh limit, this person's daily limit and the monthly
// allowance, run the four research parts in parallel, validate, run Fit (no web), validate, save. A part that fails is named
// and the others are kept; the brief is saved partial so a finished part is never paid for twice. The cached brief is always
// the fallback when a limit or a failure stops a fresh run.

export const REPORT_SURFACE = "company_report";
export const RETRY_SURFACE = "company_report_retry";

export type ReportInput = SubjectInput & {
  accountId?: string | null;
  leadId?: string | null;
  refresh?: boolean;
  /** Run only the parts the saved brief is missing and merge them in. */
  retryMissing?: boolean;
  lens?: ReportLens;
  /** The person said yes to web research for this company. Without it nothing leaves the workspace. */
  allowWeb?: boolean;
};

export type ReportNotice =
  | { kind: "daily_limit" } | { kind: "refresh_limit"; until: string } | { kind: "over_budget" } | { kind: "research_failed"; message: string };

export type PartState = "done" | "missing" | "kept";

export type ReportResult =
  | {
    ok: true;
    /** The brief, or a report in the older format, which the card draws as it is. */
    report: CompanyReport | LegacyReport;
    cached: boolean; saved: boolean; pendingDb: boolean;
    companyKey: string; accountId: string | null; computedAt: string; notice?: ReportNotice;
    /** What a run did, for the audit row and the progress card: per part, and every search the provider ran. */
    run?: { states: Partial<Record<ReportPartId, PartState>>; reasons: Partial<Record<ReportPartId, FailReason>>; queries: string[] };
  }
  | { ok: false; status: 400 | 403 | 404 | 429 | 502; error: string; code: string };

export type ReportDeps = {
  now: () => Date;
  allowance: (tenantId: string, budget: number) => Promise<Allowance>;
  /** The workspace's own offering names: the only tenant data any model call receives, and only the Fit call (no web). */
  offerings: (a: AnalysisAccess) => Promise<string[]>;
  runParts: (subject: Subject, which: readonly ReportPartId[], hooks: PartHooks) => Promise<PartResult[]>;
  runFit: (report: CompanyReport, offerings: readonly string[], leftMs: number) => Promise<FitRun | null>;
};

type AccountRow = { id: string; name: string; website: string | null; city: string | null; country: string | null; industry: string | null };
const ACCOUNT_COLS = "id, name, website, city, country, industry";

const fail = (status: 400 | 403 | 404 | 429 | 502, code: string, error: string): Extract<ReportResult, { ok: false }> => ({ ok: false, status, code, error });

/**
 * Names of what this workspace sells: its enabled signal topics, its segments and its product family names (the category of an
 * active product; the name only, never a price, a cost or anything per customer). Tenant-scoped; a failed read is an empty list.
 */
export async function loadOfferings(a: AnalysisAccess): Promise<string[]> {
  const read = async (table: string, column: string, filters: [string, unknown][] = [], notNull = false): Promise<string[]> => {
    try {
      let q = a.admin.from(table).select(column).eq("tenant_id", a.tenantId);
      for (const [c, v] of filters) q = q.eq(c, v);
      if (notNull) q = q.not(column, "is", null);
      const { data, error } = await q.limit(200);
      return error ? [] : ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => (typeof r[column] === "string" ? (r[column] as string).trim() : "")).filter(Boolean);
    } catch {
      return [];
    }
  };
  const [topics, segments, families] = await Promise.all([
    read("signal_topics", "name", [["enabled", true]]),
    read("segments", "name"),
    a.features?.products === true ? read("products", "category", [["status", "active"]], true) : Promise.resolve([] as string[]),
  ]);
  const names = [...new Set([...topics, ...segments, ...families])];
  return names.filter((n) => n.length <= 60 && !looksPersonal(n)).slice(0, 30);
}

export function defaultReportDeps(): ReportDeps {
  const client = () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error(NO_KEY);
    return new Anthropic();
  };
  return {
    now: () => new Date(),
    allowance: allowanceFor,
    offerings: loadOfferings,
    runParts: (subject, which, hooks) => runReportParts(client(), subject, which, hooks),
    runFit: (report, offerings, leftMs) => runFitCall(client(), report, offerings, leftMs),
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
 * Takes one of this person's briefs for today BEFORE any search runs. The reservation is a zero-token row in the meter's
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

type Spend = { model: string; input: number; output: number };

async function settle(a: AnalysisAccess, slotId: string | null, spend: Spend): Promise<void> {
  try {
    if (slotId) {
      await a.admin.from("ai_usage_log").update({ model: spend.model, input_tokens: spend.input, output_tokens: spend.output }).eq("id", slotId).eq("tenant_id", a.tenantId);
    } else {
      // A retry of the missing parts takes no second daily slot, but what it spends still counts against the allowance.
      await a.admin.from("ai_usage_log").insert({ tenant_id: a.tenantId, user_id: a.userId, surface: RETRY_SURFACE, model: spend.model, input_tokens: spend.input, output_tokens: spend.output });
    }
  } catch (e) {
    console.error("ai_usage_log update failed:", e);
  }
}

const cachedOk = (row: ReportRow, o: { companyKey: string; accountId: string | null; pending: boolean; notice?: ReportNotice }): ReportResult => ({
  ok: true, report: (row.report ?? row.legacy)!, cached: true, saved: true, pendingDb: o.pending, companyKey: o.companyKey, accountId: o.accountId, computedAt: row.computedAt,
  ...(o.notice ? { notice: o.notice } : {}),
});

/** A saved brief with parts missing is not complete, and a report in the older format is not a brief: neither is "fresh". */
export const rowIsComplete = (row: ReportRow | null): boolean => !!row?.report && row.report.missing.length === 0;

/** What the dock reads first: the saved report if there is one and it is fresh, with no web, no cost, no limit used. */
export async function readCachedReport(a: AnalysisAccess, input: ReportInput, deps: Pick<ReportDeps, "now"> = { now: () => new Date() }):
Promise<{ ok: true; row: ReportRow | null; fresh: boolean; resolved: Extract<ResolvedReportSubject, { ok: true }>; pendingDb: boolean } | Extract<ReportResult, { ok: false }>> {
  const gate = analysisAccess(a);
  if (!gate.ok) return fail(gate.status, gate.code, gate.error);
  const resolved = await resolveReportSubject(a, input);
  if (!resolved.ok) return resolved;
  const { row, pending } = await readReport(a.admin, a.tenantId, resolved.companyKey);
  return { ok: true, row, fresh: !!row && isFresh(row.expiresAt, deps.now()), resolved, pendingDb: pending };
}

export async function buildCompanyReport(a: AnalysisAccess, input: ReportInput, deps: ReportDeps = defaultReportDeps(), hooks: Pick<PartHooks, "onPart"> = {}): Promise<ReportResult> {
  const gate = analysisAccess(a);
  if (!gate.ok) return fail(gate.status, gate.code, gate.error);
  const resolved = await resolveReportSubject(a, input);
  if (!resolved.ok) return resolved;
  const { subject, account, companyKey } = resolved;
  const accountId = account?.id ?? null;
  const lens: ReportLens = input.lens === "competitor" ? "competitor" : "prospect";

  const startedAt = deps.now().getTime();
  const now = deps.now();
  const { row, pending } = await readReport(a.admin, a.tenantId, companyKey);
  const cachedResult = (notice?: ReportNotice) => cachedOk(row!, { companyKey, accountId, pending, notice });
  const stored = row?.report ?? null;
  const live = !!row && isFresh(row.expiresAt, now);

  // A saved brief is shown at once, complete or not (a partial one carries its own "try the missing parts"). A report in the
  // older format is the one case that is never fresh: the next ask runs the new brief.
  if (row && live && stored && !input.refresh && !input.retryMissing) return cachedResult();

  // Refresh on a PARTIAL brief is "Try the missing parts": only what is missing is run again, never a second full run.
  const partial = !!(stored && live && stored.missing.length > 0);
  const retry = input.retryMissing === true || (input.refresh === true && partial);
  if (input.retryMissing === true && !partial) return fail(404, "nothing_to_retry", "There is no saved brief with parts to try again. Run the brief first.");
  // Only a complete brief is held to one refresh an hour: an incomplete one or an older format is worth redoing straight away.
  if (row && input.refresh && !retry && rowIsComplete(row)) {
    const until = refreshBlockedUntil(row.computedAt, now);
    if (until) return cachedResult({ kind: "refresh_limit", until });
  }
  // A brief is only ever made from a verified yes: without it nothing is searched and there is nothing to show.
  if (input.allowWeb !== true) return fail(403, "needs_consent", "A company brief needs web research, and nobody has said yes to it yet.");

  const stopped = (kind: "daily_limit" | "over_budget", message: string): ReportResult => (row ? cachedResult({ kind }) : fail(429, kind, message));

  // Trying the missing parts of a saved brief never takes a second daily slot (what it spends still counts against the allowance
  // and the shared daily search limit); a first brief or a refresh of a complete one does.
  let slotId: string | null = null;
  if (!retry) {
    const slot = await reserve(a, DEFAULT_REPORT_DAILY_LIMIT, now);
    if (!slot.ok) return stopped("daily_limit", `You have reached today's limit of ${DEFAULT_REPORT_DAILY_LIMIT} company briefs. Try again tomorrow.`);
    slotId = slot.id;
  }
  const giveBack = async () => { if (slotId) await release(a.admin, a.tenantId, slotId); };

  const allowance = await deps.allowance(a.tenantId, a.budget).catch(() => null);
  if (!allowance || !allowance.allowed) {
    await giveBack();
    return stopped("over_budget", "You have used this month's AI allowance.");
  }

  // The parts to run, and the finished parts a retry keeps.
  const which: ReportPartId[] = retry ? [...stored!.missing] : [...REPORT_PARTS];
  const kept: StoredParts = retry ? Object.fromEntries(Object.entries(row!.parts).filter(([p]) => !which.includes(p as ReportPartId))) as StoredParts : {};

  let results: PartResult[];
  try {
    results = await deps.runParts(subject, which, { onPart: hooks.onPart });
  } catch (e) {
    await giveBack();
    const message = e instanceof Error ? e.message : "The web research could not run.";
    return row ? cachedResult({ kind: "research_failed", message }) : fail(502, "research_failed", message);
  }

  const parts: StoredParts = { ...kept };
  const states: Partial<Record<ReportPartId, PartState>> = {};
  const reasons: Partial<Record<ReportPartId, FailReason>> = {};
  const queries: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let model = "";
  for (const p of Object.keys(kept) as ReportPartId[]) states[p] = "kept";
  for (const r of results) {
    tokensIn += r.tokens.input;
    tokensOut += r.tokens.output;
    queries.push(...r.queries);
    if (r.ok) {
      parts[r.part] = { raw: r.raw, citations: r.citations, searches: r.searches };
      states[r.part] = "done";
      model = r.model;
    } else {
      states[r.part] = "missing";
      reasons[r.part] = r.reason;
    }
  }
  const spend = (): Spend => ({ model: model || "company_brief", input: tokensIn, output: tokensOut });

  // Nothing new came back: the slot is given back when nothing was searched; a run that spent tokens still counts them.
  const gained = results.some((r) => r.ok);
  if (!gained) {
    if (tokensIn + tokensOut > 0) await settle(a, slotId, spend()); else await giveBack();
    const failed = results.find((r): r is Extract<PartResult, { ok: false }> => !r.ok && !!r.error);
    const message = failed?.error ?? "The web research could not run.";
    const text = `${message.replace(/\s+/g, " ").trim().slice(0, 200)} Nothing was saved.`;
    return row ? cachedResult({ kind: "research_failed", message: text }) : fail(502, "research_failed", text);
  }

  const missing = REPORT_PARTS.filter((p) => !parts[p]);
  const searches = Math.min(MAX_REPORT_SEARCHES, REPORT_PARTS.reduce((t, p) => t + (parts[p]?.searches ?? 0), 0));
  const raws = Object.fromEntries(REPORT_PARTS.filter((p) => parts[p]).map((p) => [p, parts[p]!.raw])) as Partial<Record<ReportPartId, unknown>>;
  const citations = mergeCitations(REPORT_PARTS.flatMap((p) => (parts[p] ? [parts[p]!.citations] : [])));
  const { report } = validateBrief(raws, { subject, citations, now, searches, lens, missing, reasons });

  if (reportIsEmpty(report)) {
    await settle(a, slotId, spend());
    const message = `The research found no page it could cite for ${subject.name}, so there is no brief. Nothing was saved.`;
    return row ? cachedResult({ kind: "research_failed", message }) : fail(502, "no_sources", message);
  }

  // Where we fit (or how they compete): one small call with no web, over the validated brief and the offering names only.
  const offerings = cleanOfferings(await deps.offerings(a).catch(() => [] as string[]));
  if (fitWorthRunning(report, offerings)) {
    const left = RUN_BUDGET_MS - (deps.now().getTime() - startedAt);
    const run = await deps.runFit(report, offerings, Math.min(left, RUN_BUDGET_MS - PART_TIMEOUT_MS + 5_000)).catch(() => null);
    if (run) {
      tokensIn += run.tokens.input;
      tokensOut += run.tokens.output;
      const checked = validateFit(run.raw, report, offerings, lens);
      report.fit = checked.fit;
      report.compete = checked.compete;
    }
  }
  await settle(a, slotId, spend());

  const computedAt = now.toISOString();
  const save = await saveReport(a.admin, {
    tenantId: a.tenantId, companyKey, report, parts, version: (row?.version ?? 0) + 1,
    searches, inputTokens: tokensIn, outputTokens: tokensOut, requestedBy: a.userId, computedAt, expiresAt: expiresAtFor(now),
  });
  return {
    ok: true, report, cached: false, saved: save.saved, pendingDb: save.pending || pending, companyKey, accountId, computedAt,
    run: { states, reasons, queries },
  };
}
