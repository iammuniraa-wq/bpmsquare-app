import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { PermissionSet } from "@/lib/permissions";
import type { TenantConfig } from "@/lib/constants";
import {
  analyseCompany, analysisAccess, readCachedAnalysis, type AnalyseDeps, type AnalysisAccess, type AnalyseResult,
} from "@/lib/analysis/service";
import { refreshBlockedUntil } from "@/lib/analysis/budget";
import type { AnalysisCard } from "@/lib/analysis/types";
import { webQueryAllowed } from "./webQuery";
import { issueOnceConsent } from "./consentToken";
import { claimWebConsent, reserveWebSlot, type WebSlot } from "./research";
import {
  analysisDigest, encodeAnalysisQuery, noticeText, type AnalysisNotice, type AnalysisToolInput, type DockAnalysis,
} from "./analysisTool";

// One analysis step for the slider (docs/design/account-analysis.md section 3). Order of play, and why:
//  1. the subject is vetted: a typed name may only use words the person wrote or the open company's name;
//  2. a saved, fresh analysis is returned at once -- no consent, no search, no cost, no limit used;
//  3. otherwise the person is asked (a signed chip bound to this one company) and nothing leaves the workspace;
//  4. only with a verified yes, spent here on first use, the research runs through analyseCompany(), which applies the
//     hourly refresh limit, the workspace's daily limit and the monthly allowance and keeps the saved card as fallback.

export type AnalysisAudit = {
  tenantId: string; userId: string; route: string | null;
  params: Record<string, unknown>;
  status: "done" | "refused" | "failed";
  reason?: string;
  sources: { title: string; url: string }[];
  result: Record<string, unknown>;
};

export type AnalysisIo = {
  audit: (a: AnalysisAudit) => Promise<void>;
  reserve: (tenantId: string, userId: string) => Promise<WebSlot>;
  claim: (tenantId: string, userId: string, consentId: string) => Promise<boolean>;
};

function isMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204"
    || /does not exist|Could not find the table|schema cache/i.test(err.message ?? ""));
}

/** One assistant_actions row (kind analyse_company). A pending migration or a failed insert never stops the analysis. */
export async function recordAnalysisAudit(a: AnalysisAudit): Promise<void> {
  try {
    const { error } = await createAdminSupabase().from("assistant_actions").insert({
      tenant_id: a.tenantId, user_id: a.userId, kind: "analyse_company", action_key: "analyse_company", route: a.route,
      params: a.params, status: a.status, result: { reason: a.reason ?? null, ...a.result }, sources: a.sources, tokens: 0,
    });
    if (error && !isMissing(error)) console.error("assistant_actions insert failed:", error.message);
  } catch (e) {
    console.error("assistant_actions insert failed:", e);
  }
}

export type AnalysisSetup = {
  admin: SupabaseClient;
  config: Partial<TenantConfig>;
  budget: number;
  /** Test seams. */
  deps?: AnalyseDeps;
  io?: Partial<AnalysisIo>;
  /**
   * Set by the route when the request is an analysis on its own: the person pressed Yes on an analysis chip (`consentId`
   * set, from a verified token), or pressed Analyse / Refresh (`consentId` null). No model runs for it.
   */
  direct?: { input: AnalysisToolInput; consentId: string | null };
};

export type StepCtx = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  route: string | null;
  now: Date;
  setup: AnalysisSetup;
  /** What the person wrote in this chat; the only words a typed company name may use. */
  userTurns: readonly string[];
  /** The name of the open account or supplier, or null. */
  openCompany: string | null;
  openAccountId: string | null;
};

export type AnalysisOutcome =
  | { kind: "card"; analysis: DockAnalysis }
  | { kind: "ask"; consent: { id: string; query: string; subject: string; token: string } }
  | { kind: "error"; message: string };

const accessOf = (c: StepCtx): AnalysisAccess => ({
  supabase: c.supabase, admin: c.setup.admin, tenantId: c.tenantId, userId: c.userId, perms: c.perms,
  features: c.features, config: c.setup.config, budget: c.setup.budget,
});

const ioOf = (c: StepCtx): AnalysisIo => ({ audit: recordAnalysisAudit, reserve: reserveWebSlot, claim: claimWebConsent, ...c.setup.io });

export function toDock(card: AnalysisCard, i: { cached: boolean; saved: boolean; notice?: AnalysisNotice | null; input: AnalysisToolInput; now: Date }): DockAnalysis {
  const { internal: _internal, ...rest } = card;
  void _internal;
  // A "They are moving" factor carries the web item's own headline with its publisher: that is a source, and sources are never drawn.
  const shown = { ...rest, verdict: { ...rest.verdict, factors: rest.verdict.factors.map((f) => (f.group === "moving" ? { ...f, detail: "" } : f)) } };
  return {
    card: shown, cached: i.cached, saved: i.saved,
    notice: i.notice ? noticeText(i.notice, i.now) : null,
    webDerived: shown.doing.length > 0,
    digest: analysisDigest(shown),
    subject: { accountId: card.accountId, name: card.name, domain: i.input.domain, country: i.input.country },
  };
}

async function labelFor(c: StepCtx, i: AnalysisToolInput): Promise<string> {
  if (i.accountId) {
    const { data } = await c.supabase.from("accounts").select("name").eq("id", i.accountId).eq("tenant_id", c.tenantId).maybeSingle();
    const name = (data as { name?: unknown } | null)?.name;
    return typeof name === "string" && name ? name.slice(0, 100) : "this company";
  }
  return [i.name ?? i.domain, i.country].filter(Boolean).join(" ") || "this company";
}

const audit = (c: StepCtx, input: AnalysisToolInput, consentId: string | null, status: AnalysisAudit["status"], extra: { reason?: string; sources?: AnalysisAudit["sources"]; result?: Record<string, unknown> } = {}) =>
  ioOf(c).audit({
    tenantId: c.tenantId, userId: c.userId, route: c.route,
    params: { account_id: input.accountId, name: input.name, domain: input.domain, country: input.country, refresh: input.refresh, ...(consentId ? { consent_id: consentId } : {}) },
    status, reason: extra.reason, sources: extra.sources ?? [], result: extra.result ?? {},
  });

/**
 * @param consentId  the id inside a verified, unspent-so-far consent token, or null when the person has not said yes
 */
export async function stepAnalysis(c: StepCtx, raw: AnalysisToolInput, consentId: string | null): Promise<AnalysisOutcome> {
  let input = raw;
  if (!input.accountId && !input.name && !input.domain && c.openAccountId) input = { ...input, accountId: c.openAccountId };

  const access = accessOf(c);
  const gate = analysisAccess(access);
  if (!gate.ok) return { kind: "error", message: gate.error };
  if (!input.accountId && !input.name && !input.domain) return { kind: "error", message: "Name the company, or open its account." };

  if (!input.accountId) {
    const typed = [input.name, input.domain, input.country].filter(Boolean).join(" ");
    const v = webQueryAllowed(typed, c.userTurns, c.openCompany);
    if (!v.ok) {
      await audit(c, input, consentId, "refused", { reason: v.reason });
      return { kind: "error", message: `I did not analyse that: ${v.reason}` };
    }
  }

  const where = { accountId: input.accountId, name: input.name ?? undefined, domain: input.domain ?? undefined, country: input.country ?? undefined };
  const saved = await readCachedAnalysis(access, where, c.setup.deps);
  if (!saved.ok) return { kind: "error", message: saved.error };

  const card = saved.card;
  const show = (r: { card: AnalysisCard; cached: boolean; saved: boolean; notice?: AnalysisNotice | null }): AnalysisOutcome =>
    ({ kind: "card", analysis: toDock(r.card, { ...r, input, now: c.now }) });

  if (card && !card.stale && !input.refresh) return show({ card, cached: true, saved: true });
  if (card && input.refresh) {
    const until = refreshBlockedUntil(card.refreshedAt, c.now);
    if (until) return show({ card, cached: true, saved: true, notice: { kind: "refresh_limit", until } });
  }

  const ask = async (): Promise<AnalysisOutcome> => {
    const query = encodeAnalysisQuery(input);
    const id = randomUUID();
    return { kind: "ask", consent: { id, query, subject: await labelFor(c, input), token: issueOnceConsent({ tenantId: c.tenantId, userId: c.userId, query, id }) } };
  };
  if (!consentId) return ask();

  const io = ioOf(c);
  // The yes is spent here: a consent already used, or one that cannot be marked used, is no permission at all.
  const claimed = await io.claim(c.tenantId, c.userId, consentId).catch(() => false);
  if (!claimed) return ask();

  const slot = await io.reserve(c.tenantId, c.userId);
  if (!slot.ok) {
    await audit(c, input, consentId, "refused", { reason: "daily search limit" });
    return { kind: "error", message: "Your web searches for today are used up, or cannot be counted right now. Try again tomorrow." };
  }

  let r: AnalyseResult;
  try {
    r = await analyseCompany(access, { ...where, refresh: input.refresh, allowWeb: true }, c.setup.deps);
  } catch (e) {
    await slot.release();
    console.error("Company analysis failed:", e);
    await audit(c, input, consentId, "failed", { reason: "unexpected error" });
    return { kind: "error", message: "The analysis is unavailable right now." };
  }
  if (!r.ok) {
    await slot.release();
    await audit(c, input, consentId, "failed", { reason: r.code });
    return { kind: "error", message: r.error };
  }
  // A limit that returned the saved card ran no search: the person's own slot is given back.
  if (r.cached) await slot.release();
  await audit(c, input, consentId, "done", {
    sources: r.card.internal.sources.slice(0, 8).map((s) => ({ title: s.title, url: s.url })),
    result: { cached: r.cached, saved: r.saved, verdict: r.card.verdict.label, highlights: r.card.doing.length, notice: r.notice?.kind ?? null },
  });
  return show({ card: r.card, cached: r.cached, saved: r.saved, notice: r.notice ?? null });
}

/** The reply for a request that is an analysis on its own (a Yes on its chip, Analyse, Refresh): no model is called. */
export async function runDirectAnalysis(c: StepCtx, direct: NonNullable<AnalysisSetup["direct"]>): Promise<{
  answer: string;
  consent?: { id: string; kind: "analyse_company"; query: string; subject: string; token: string };
  analysis?: DockAnalysis;
}> {
  const o = await stepAnalysis(c, direct.input, direct.consentId);
  if (o.kind === "error") return { answer: o.message };
  if (o.kind === "ask") {
    return { answer: `Analysing ${o.consent.subject} needs a web search first.`, consent: { ...o.consent, kind: "analyse_company" } };
  }
  const a = o.analysis;
  return { answer: a.cached ? `Here is the saved analysis of ${a.card.name}.` : `Here is the analysis of ${a.card.name}.`, analysis: a };
}
