import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowanceFor, askStructuredMetered, aiConfigured, logUsage } from "@/lib/ai/structured";
import type { Allowance } from "@/lib/ai/usageCap";
import { canEditWorkcenter, canViewWorkcenter, type PermissionSet } from "@/lib/permissions";
import type { TenantConfig } from "@/lib/constants";
import { claimWebConsent, reserveWebSlot, type WebSlot } from "@/lib/assistant/research";
import { webAvailability } from "@/lib/assistant/webConsent";
import { toSubject, type Subject } from "@/lib/analysis/subject";
import { NO_KEY } from "@/lib/analysis/research";
import { readAllPages } from "@/lib/pagedRead";
import { createAdminSupabase } from "@/lib/supabase-server";
import { computeSignals } from "./signals";
import { computeRating } from "./rating";
import { combineVerdict } from "./verdict";
import { NARRATIVE_SCHEMA, NARRATIVE_SYSTEM, factsBlock, narrativeAllowed, narrativePrompt } from "./facts";
import { composeSummary, emptyReputation, sentimentOf, validateFacts } from "./reputation";
import { SUPPLIER_CHECK_SEARCHES, runSupplierResearch, type SupplierResearch } from "./research";
import { isMissingTable, loadInputs, type CheckInputs } from "./load";
import { FACT_KINDS, VERDICTS, type CheckHistoryItem, type CheckSummary, type Findings, type Rating, type Reputation, type Sentiment, type SupplierCheckResult, type Verdict } from "./types";

// The supplier check service: one function the screen route and the dock tool both call, buildCheck(). Order of play: gate, load the
// supplier and its workspace (every query tenant-scoped), compute the signals and the rating in code, and only when the person has
// said yes (a signed, single-use consent the caller verified) take a daily slot, check the allowance, run the web research, validate
// it, and let a model word the summary from the validated facts. The verdict is combined by rules. Nothing here writes a check; saving
// is persistCheck(), a separate step the person asked for.

export const CHECK_SURFACE = "supplier_check";
export const NARRATIVE_SURFACE = "supplier_check_why";
export const PENDING_MESSAGE = "Supplier checks need a database update (migration 0263). Ask your administrator to apply it.";

export type CheckAccess = {
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  config: Partial<TenantConfig>;
  budget: number;
};

export type CheckDeps = {
  now: () => Date;
  research: (subject: Subject) => Promise<SupplierResearch>;
  narrate: (a: CheckAccess, name: string, block: { text: string }) => Promise<string | null>;
  claim: (tenantId: string, userId: string, consentId: string) => Promise<boolean>;
  reserve: (tenantId: string, userId: string) => Promise<WebSlot>;
  allowance: (tenantId: string, budget: number) => Promise<Allowance>;
  formatMoney?: (n: number) => string;
  audit: (row: AuditRow) => Promise<void>;
};

type AuditRow = { tenantId: string; userId: string; status: "done" | "refused" | "failed"; reason?: string; supplierId: string; sources: { title: string; url: string }[]; result: Record<string, unknown> };

export function defaultDeps(): CheckDeps {
  return {
    now: () => new Date(),
    research: (subject) => {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error(NO_KEY);
      return runSupplierResearch(new Anthropic(), subject);
    },
    narrate: async (a, name, block) => {
      if (!aiConfigured() || a.features.ai_assistant !== true) return null;
      try {
        const out = await askStructuredMetered({
          tenantId: a.tenantId, userId: a.userId, surface: NARRATIVE_SURFACE, budget: a.budget, effort: "low", maxTokens: 500,
          system: NARRATIVE_SYSTEM, prompt: narrativePrompt(block), schema: NARRATIVE_SCHEMA,
        }) as { summary?: unknown };
        return narrativeAllowed(out?.summary, block.text, name) ? String(out.summary).replace(/\s+/g, " ").trim() : null;
      } catch (e) {
        console.error("Supplier check narrative failed:", e);
        return null;
      }
    },
    claim: claimWebConsent,
    reserve: (t, u) => reserveWebSlot(t, u),
    allowance: allowanceFor,
    audit: recordAudit,
  };
}

async function recordAudit(a: AuditRow): Promise<void> {
  try {
    const { error } = await createAdminSupabase().from("assistant_actions").insert({
      tenant_id: a.tenantId, user_id: a.userId, kind: "supplier_check", action_key: "supplier_check", route: null,
      params: { supplier_id: a.supplierId }, status: a.status, result: { reason: a.reason ?? null, ...a.result }, sources: a.sources, tokens: 0,
    });
    if (error && !isMissingTable(error)) console.error("assistant_actions insert failed:", error.message);
  } catch (e) {
    console.error("assistant_actions insert failed:", e);
  }
}

export type CheckGate = { ok: true } | { ok: false; status: 403 | 404; error: string };

/** Viewing a check needs the Suppliers module and view of Suppliers; running or saving one needs edit of Suppliers (who may edit suppliers). */
export function checkGate(a: Pick<CheckAccess, "features" | "perms">, mode: "view" | "run"): CheckGate {
  if (a.features.suppliers !== true) return { ok: false, status: 404, error: "Not found" };
  if (!canViewWorkcenter(a.perms, "suppliers")) return { ok: false, status: 403, error: "You do not have access to Suppliers." };
  if (mode === "run" && !canEditWorkcenter(a.perms, "suppliers")) return { ok: false, status: 403, error: "Only people who can edit suppliers can run a supplier check." };
  return { ok: true };
}

export const webOn = (a: Pick<CheckAccess, "features" | "config">): boolean => webAvailability(a.features, a.config).enabled;

export type BuildResult =
  | { ok: true; result: SupplierCheckResult; notice: string | null }
  | { ok: false; status: 403 | 404 | 422 | 429 | 502; error: string; code: string };

type WebStep = { reputation: Reputation; notice: string | null; model: string | null };

async function webStep(a: CheckAccess, inputs: CheckInputs, consentId: string, deps: CheckDeps): Promise<WebStep> {
  const none = (notice: string): WebStep => ({ reputation: emptyReputation(), notice, model: null });
  const open = webAvailability(a.features, a.config);
  if (!open.enabled) return none("Web research is not switched on for this workspace, so the check ran on your own records only.");
  const s = toSubject({ name: inputs.supplier.name, website: inputs.identity.website, city: inputs.supplier.city });
  if ("error" in s) return none("The supplier's name could not be searched, so the check ran on your own records only.");
  if (!(await deps.claim(a.tenantId, a.userId, consentId).catch(() => false))) return none("That yes was already used. Ask again to research on the web.");
  const slot = await deps.reserve(a.tenantId, a.userId);
  if (!slot.ok) return none("Your web searches for today are used up, or cannot be counted right now. Try again tomorrow.");
  const allowance = await deps.allowance(a.tenantId, a.budget).catch(() => null);
  if (!allowance || !allowance.allowed) {
    await slot.release();
    return none("This month's AI allowance is used up, so the check ran on your own records only.");
  }

  let run: SupplierResearch;
  try {
    run = await deps.research(s);
  } catch (e) {
    await slot.release();
    const message = e instanceof Error && e.message ? e.message : "The web research could not run.";
    await deps.audit({ tenantId: a.tenantId, userId: a.userId, supplierId: inputs.supplier.id, status: "failed", reason: message.slice(0, 200), sources: [], result: {} });
    return none(`${message.slice(0, 200)} The check ran on your own records only.`);
  }
  if (run.tokens.input + run.tokens.output > 0) {
    await logUsage({ tenantId: a.tenantId, userId: a.userId, surface: CHECK_SURFACE, studyId: null, inputTokens: run.tokens.input, outputTokens: run.tokens.output, model: run.model });
  }
  const okParts = run.parts.filter((p) => p.ok);
  if (!okParts.length) {
    if (run.tokens.input + run.tokens.output === 0) await slot.release();
    const why = (run.parts.find((p) => !p.ok) as { error?: string } | undefined)?.error ?? "The web research could not run.";
    await deps.audit({ tenantId: a.tenantId, userId: a.userId, supplierId: inputs.supplier.id, status: "failed", reason: why.slice(0, 200), sources: [], result: { queries: run.queries } });
    return {
      reputation: { ...emptyReputation(), partial: true, searches: run.searches, summary: "The web research did not run, so the market reputation is not known.", note: why.slice(0, 200) },
      notice: `${why.slice(0, 200)} Nothing was found, so the market reputation is not known.`, model: null,
    };
  }

  const partial = okParts.length < run.parts.length;
  const checked = validateFacts(okParts.map((p) => ({ part: p.part, raw: (p as { raw: unknown }).raw })), run.citations, inputs.supplier.name);
  const sentiment: Sentiment = sentimentOf(checked.facts);
  const base: Reputation = { webUsed: true, partial, sentiment, facts: checked.facts, sources: checked.sources, searches: run.searches, summary: "" };
  const composed = composeSummary({ name: inputs.supplier.name, facts: checked.facts, sources: checked.sources, sentiment, partial });
  let summary = composed;
  if (checked.facts.length) {
    const block = factsBlock({ name: inputs.supplier.name, reputation: base });
    const written = await deps.narrate(a, inputs.supplier.name, block).catch(() => null);
    if (written) summary = written;
  }
  await deps.audit({
    tenantId: a.tenantId, userId: a.userId, supplierId: inputs.supplier.id, status: "done", sources: checked.sources,
    result: { searches: run.searches, facts: checked.facts.length, left_out: checked.leftOut, partial, queries: run.queries },
  });
  return {
    reputation: {
      ...base, summary,
      ...(!checked.facts.length ? { note: "Nothing was found on the web that could be cited." } : partial ? { note: "Part of the web research could not run." } : {}),
    },
    notice: partial ? "Part of the web research could not run; what finished is shown." : null, model: run.model,
  };
}

/** Computes one supplier check. Never writes it. `web` carries the id of a verified, unspent consent, or is null for the records-only check. */
export async function buildCheck(a: CheckAccess, supplierId: string, opts: { web: { consentId: string } | null }, deps: CheckDeps = defaultDeps()): Promise<BuildResult> {
  const gate = checkGate(a, "view");
  if (!gate.ok) return { ok: false, status: gate.status, code: gate.status === 404 ? "not_found" : "no_access", error: gate.error };
  const now = deps.now();
  const inputs = await loadInputs(a.admin, a.tenantId, supplierId, now);
  if (!inputs) return { ok: false, status: 404, code: "not_found", error: "Supplier not found" };

  const findings: Findings = computeSignals(inputs.identity, inputs.others, { now, quote: inputs.quote, formatMoney: deps.formatMoney });
  const rating: Rating = computeRating({ supplierId, now, rfqSuppliers: inputs.rfqSuppliers, lines: inputs.lines, responses: inputs.responses });
  const web: WebStep = opts.web ? await webStep(a, inputs, opts.web.consentId, deps) : { reputation: emptyReputation(), notice: null, model: null };
  const outcome = combineVerdict({ findings, rating, reputation: web.reputation, hasWebsite: !!inputs.identity.website, hasCr: !!inputs.identity.cr, hasTaxId: !!inputs.identity.taxId });
  const result: SupplierCheckResult = {
    supplierId, supplierName: inputs.supplier.name, checkedAt: now.toISOString(),
    verdict: outcome.verdict, verdictSentence: outcome.sentence,
    findings: { signals: findings.signals, positives: outcome.positives },
    rating, reputation: web.reputation, sharpen: outcome.sharpen,
    model: web.model,
  };
  return { ok: true, result, notice: web.notice };
}

// --- saved checks ------------------------------------------------------------------------------------------------------

export type CheckRow = {
  id: string; supplier_id: string; checked_at: string; checked_by: string | null; verdict: string;
  genuine_findings: Record<string, unknown> | null; our_rating: number | string | null; our_rating_basis: Record<string, unknown> | null;
  reputation_summary: string | null; reputation_sentiment: string; reputation_facts: unknown; sources: unknown; web_used: boolean; model: string | null;
};

const ROW_COLS = "id, supplier_id, checked_at, checked_by, verdict, genuine_findings, our_rating, our_rating_basis, reputation_summary, reputation_sentiment, reputation_facts, sources, web_used, model";

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function rowToResult(row: CheckRow, supplierName: string): SupplierCheckResult {
  const g = (row.genuine_findings ?? {}) as { signals?: unknown; positives?: unknown; verdict_sentence?: unknown; sharpen?: unknown; reputation_meta?: { partial?: boolean; searches?: number; note?: string } };
  const meta = g.reputation_meta ?? {};
  const verdict = (VERDICTS as readonly string[]).includes(row.verdict) ? (row.verdict as Verdict) : "unverified";
  const sentiment = (["positive", "mixed", "negative", "unknown"] as const).find((s) => s === row.reputation_sentiment) ?? "unknown";
  const basis = (row.our_rating_basis ?? {}) as Partial<Rating["basis"]>;
  return {
    supplierId: row.supplier_id, supplierName, checkedAt: row.checked_at, verdict,
    verdictSentence: typeof g.verdict_sentence === "string" ? g.verdict_sentence : "",
    findings: { signals: arr(g.signals), positives: arr(g.positives) },
    rating: {
      value: row.our_rating === null || row.our_rating === undefined ? null : Number(row.our_rating),
      basis: { months: basis.months ?? 24, rfqs: basis.rfqs ?? 0, replied: basis.replied ?? 0, won: basis.won ?? 0, enough: basis.enough ?? false, components: arr(basis.components), formula: basis.formula ?? "" },
    },
    reputation: {
      webUsed: row.web_used, partial: meta.partial === true, sentiment,
      facts: arr<{ kind: string }>(row.reputation_facts).filter((f) => (FACT_KINDS as readonly string[]).includes(f.kind)) as Reputation["facts"],
      sources: arr(row.sources), summary: row.reputation_summary ?? "", searches: meta.searches ?? 0, ...(meta.note ? { note: meta.note } : {}),
    },
    sharpen: arr<string>(g.sharpen).filter((s) => typeof s === "string"), model: row.model,
  };
}

/** Saves one result. The caller has already gated on who may edit suppliers and (for the dock) verified the signed token. */
export async function persistCheck(a: Pick<CheckAccess, "admin" | "tenantId" | "userId">, r: SupplierCheckResult): Promise<{ ok: true; id: string } | { ok: false; pending: boolean; error: string }> {
  const { data: owner } = await a.admin.from("suppliers").select("id").eq("id", r.supplierId).eq("tenant_id", a.tenantId).maybeSingle();
  if (!owner) return { ok: false, pending: false, error: "Supplier not found" };
  const { data, error } = await a.admin.from("supplier_checks").insert({
    tenant_id: a.tenantId, supplier_id: r.supplierId, checked_at: r.checkedAt, checked_by: a.userId, verdict: r.verdict,
    genuine_findings: {
      signals: r.findings.signals, positives: r.findings.positives, verdict_sentence: r.verdictSentence, sharpen: r.sharpen,
      reputation_meta: { partial: r.reputation.partial, searches: r.reputation.searches, ...(r.reputation.note ? { note: r.reputation.note } : {}) },
    },
    our_rating: r.rating.value, our_rating_basis: r.rating.basis,
    reputation_summary: r.reputation.summary, reputation_sentiment: r.reputation.sentiment, reputation_facts: r.reputation.facts,
    sources: r.reputation.sources, web_used: r.reputation.webUsed, model: r.model,
  }).select("id").single();
  if (error || !data) return { ok: false, pending: isMissingTable(error), error: isMissingTable(error) ? PENDING_MESSAGE : "The check could not be saved." };
  return { ok: true, id: String((data as { id: unknown }).id) };
}

/** The newest saved check and the recent history of one supplier. `pending` is true while migration 0263 is not applied. */
export async function readChecks(a: Pick<CheckAccess, "admin" | "tenantId">, supplierId: string, supplierName: string, limit = 10): Promise<{ latest: SupplierCheckResult | null; history: CheckHistoryItem[]; pending: boolean }> {
  const { data, error } = await a.admin.from("supplier_checks").select(ROW_COLS)
    .eq("tenant_id", a.tenantId).eq("supplier_id", supplierId).order("checked_at", { ascending: false }).limit(limit);
  if (error) return { latest: null, history: [], pending: isMissingTable(error) };
  const rows = (data ?? []) as CheckRow[];
  return {
    latest: rows.length ? rowToResult(rows[0], supplierName) : null,
    history: rows.map((r) => ({ id: r.id, checkedAt: r.checked_at, verdict: (VERDICTS as readonly string[]).includes(r.verdict) ? (r.verdict as Verdict) : "unverified", rating: r.our_rating === null ? null : Number(r.our_rating), webUsed: r.web_used })),
    pending: false,
  };
}

/**
 * The newest saved check of each supplier, small, for the list, the RFQ screens and the price comparison. Tenant-scoped. `ids` null
 * reads every supplier of the workspace (the list page); otherwise at most 200 are asked for. Works with the session client too.
 */
export async function readSummaries(a: { admin: SupabaseClient; tenantId: string }, ids: readonly string[] | null): Promise<{ summaries: CheckSummary[]; pending: boolean }> {
  const want = ids === null ? null : [...new Set(ids)].slice(0, 200);
  if (want && !want.length) return { summaries: [], pending: false };
  const { data, error } = await readAllPages<{ supplier_id: string; checked_at: string; verdict: string; our_rating: number | string | null; our_rating_basis: { rfqs?: number } | null }>((lo, hi) => {
    const q = a.admin.from("supplier_checks").select("supplier_id, checked_at, verdict, our_rating, our_rating_basis").eq("tenant_id", a.tenantId);
    return (want ? q.in("supplier_id", want) : q).order("checked_at", { ascending: false }).order("id", { ascending: true }).range(lo, hi);
  });
  if (error) return { summaries: [], pending: isMissingTable(error) };
  const seen = new Set<string>();
  const out: CheckSummary[] = [];
  for (const r of data ?? []) {
    if (seen.has(r.supplier_id) || !(VERDICTS as readonly string[]).includes(r.verdict)) continue;
    seen.add(r.supplier_id);
    out.push({ supplierId: r.supplier_id, verdict: r.verdict as Verdict, rating: r.our_rating === null ? null : Number(r.our_rating), rfqs: r.our_rating_basis?.rfqs ?? 0, checkedAt: r.checked_at });
  }
  return { summaries: out, pending: false };
}

export { SUPPLIER_CHECK_SEARCHES };
