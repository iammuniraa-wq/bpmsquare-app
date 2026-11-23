import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import { canCreateWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { analysisAccess, type AnalysisAccess } from "@/lib/analysis/service";
import { refreshBlockedUntil } from "@/lib/analysis/budget";
import {
  buildCompanyReport, readCachedReport, rowIsComplete, type ReportDeps, type ReportInput, type ReportNotice, type ReportResult,
} from "@/lib/analysis/report/service";
import { LEGACY_NOTICE } from "@/lib/analysis/report/legacy";
import { commentAllowed } from "@/lib/analysis/report/save";
import { findByName } from "@/lib/tender/competitors/rules";
import { listCompetitors } from "@/lib/tender/competitors/server";
import { MAX_REPORT_SEARCHES, type ReportPartId } from "@/lib/analysis/report/types";
import { webQueryAllowed } from "./webQuery";
import { issueOnceConsent } from "./consentToken";
import { claimWebConsent, reserveWebSlot, type WebSlot } from "./research";
import { recordReportAudit, type ReportAudit } from "./reportAudit";
import { encodeReportQuery, reportDigest, reportNoticeText, type DockReport, type ReportSaveTarget, type ReportToolInput } from "./reportTool";

// One brief step for the slider (docs/design/company-brief-sales.md). Order of play, and why:
//  1. the subject is vetted: a typed name may only use words the person wrote or the open company's name;
//  2. a saved, fresh brief is returned at once -- no consent, no search, no cost, no limit used (a partial one carries its own
//     "try the missing parts"; a report in the older format is drawn as it is, with a line saying so);
//  3. otherwise the person is asked (a signed chip bound to this one company) and nothing leaves the workspace;
//  4. only with a verified yes, spent here on first use, the research runs through buildCompanyReport(), which applies the
//     hourly refresh limit, this person's daily brief limit and the monthly allowance and keeps the saved brief as fallback.

export type ReportIo = {
  audit: (a: ReportAudit) => Promise<void>;
  reserve: (tenantId: string, userId: string) => Promise<WebSlot>;
  claim: (tenantId: string, userId: string, consentId: string) => Promise<boolean>;
};

export type ReportSetup = {
  admin: SupabaseClient;
  config: Partial<TenantConfig>;
  budget: number;
  /** Test seams. */
  deps?: ReportDeps;
  io?: Partial<ReportIo>;
  /**
   * Set by the route when the request is a brief on its own: the person pressed Yes on a brief chip (`consentId` set,
   * from a verified token), or pressed Refresh (`consentId` null). No model runs for it.
   */
  direct?: { input: ReportToolInput; consentId: string | null };
  /** Progress of the four research parts, for the streamed run route. Absent when nobody is watching. */
  onPart?: StepHooks["onPart"];
};

export type ReportStepCtx = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  route: string | null;
  now: Date;
  setup: ReportSetup;
  /** What the person wrote in this chat; the only words a typed company name may use. */
  userTurns: readonly string[];
  /** The name of the open account or supplier, or null. */
  openCompany: string | null;
  /** The record the person has open, when it is one a brief can start from or be saved to. */
  open: { type: "account" | "lead" | "opportunity"; id: string } | null;
};

export type ReportConsent = { id: string; query: string; subject: string; searches: number; token: string; mode: "brief" | "retry" };

export type ReportOutcome =
  | { kind: "card"; report: DockReport }
  | { kind: "ask"; consent: ReportConsent }
  | { kind: "error"; message: string };

export type StepHooks = { onPart?: (part: ReportPartId, state: "running" | "done" | "missing") => void };

const accessOf = (c: ReportStepCtx): AnalysisAccess => ({
  supabase: c.supabase, admin: c.setup.admin, tenantId: c.tenantId, userId: c.userId, perms: c.perms,
  features: c.features, config: c.setup.config, budget: c.setup.budget,
});

const ioOf = (c: ReportStepCtx): ReportIo => ({ audit: recordReportAudit, reserve: reserveWebSlot, claim: claimWebConsent, ...c.setup.io });

const auditRow = (c: ReportStepCtx, input: ReportToolInput, consentId: string | null, status: ReportAudit["status"], extra: { reason?: string; sources?: ReportAudit["sources"]; result?: Record<string, unknown> } = {}) =>
  ioOf(c).audit({
    kind: "research_company_report", tenantId: c.tenantId, userId: c.userId, route: c.route,
    params: { account_id: input.accountId, lead_id: input.leadId, name: input.name, domain: input.domain, country: input.country, refresh: input.refresh, retry: input.retry, lens: input.lens, ...(consentId ? { consent_id: consentId } : {}) },
    status, reason: extra.reason, sources: extra.sources ?? [], result: extra.result ?? {},
  });

async function labelFor(c: ReportStepCtx, i: ReportToolInput): Promise<string> {
  const nameOf = async (id: string): Promise<string | null> => {
    const { data } = await c.supabase.from("accounts").select("name").eq("id", id).eq("tenant_id", c.tenantId).maybeSingle();
    const name = (data as { name?: unknown } | null)?.name;
    return typeof name === "string" && name ? name.slice(0, 100) : null;
  };
  if (i.accountId) return (await nameOf(i.accountId)) ?? "this company";
  if (i.leadId) {
    const { data } = await c.setup.admin.from("leads").select("account_id").eq("id", i.leadId).eq("tenant_id", c.tenantId).maybeSingle();
    const accountId = (data as { account_id?: unknown } | null)?.account_id;
    return (typeof accountId === "string" ? await nameOf(accountId) : null) ?? "this company";
  }
  return [i.name ?? i.domain, i.country].filter(Boolean).join(" ") || "this company";
}

/** Where this brief can be saved from here: the record it is about and the deal the person has open. Each is checked again on Save. */
async function saveTargets(c: ReportStepCtx, input: ReportToolInput, accountId: string | null, name: string): Promise<ReportSaveTarget[]> {
  const out: ReportSaveTarget[] = [];
  const features = c.features as Partial<TenantFeatures>;
  const leadId = input.leadId;
  if (accountId && commentAllowed(features, c.perms, "account")) out.push({ kind: "account", id: accountId, label: "account" });
  if (leadId && commentAllowed(features, c.perms, "lead")) out.push({ kind: "lead", id: leadId, label: "lead" });
  if (c.open?.type === "opportunity") {
    if (commentAllowed(features, c.perms, "deal")) out.push({ kind: "deal", id: c.open.id, label: "deal" });
    if (features.gcc_tender === true && canEditWorkcenter(c.perms, "pipeline")) {
      try {
        const { rows } = await listCompetitors(c.setup.admin, c.tenantId, c.open.id);
        const hit = findByName(rows, name);
        if (hit) out.push({ kind: "competitor", id: c.open.id, competitorId: hit.id, label: "competitor" });
      } catch { /* a competitor the list could not read is simply not offered */ }
    }
  }
  return out;
}

export async function toDockReport(c: ReportStepCtx, r: Extract<ReportResult, { ok: true }>, input: ReportToolInput): Promise<DockReport> {
  const targets = await saveTargets(c, input, r.accountId, r.report.name);
  const features = c.features as Partial<TenantFeatures>;
  // A typed company that is not an account here: the card offers "Save to an account" (a picker, or create it) to someone who may post to an account.
  const unmatched = !r.accountId && !input.leadId && commentAllowed(features, c.perms, "account")
    ? { canCreate: canCreateWorkcenter(c.perms, "accounts") } : null;
  return {
    report: r.report, cached: r.cached, saved: r.saved,
    notice: r.notice ? reportNoticeText(r.notice, c.now) : (r.report.v === 1 ? LEGACY_NOTICE : null),
    webDerived: true,
    digest: reportDigest(r.report),
    key: r.companyKey, computedAt: r.computedAt,
    subject: { accountId: r.accountId, leadId: input.leadId, name: r.report.name, domain: input.domain, country: input.country },
    targets, unmatched,
  };
}

/** @param consentId  the id inside a verified, unspent-so-far consent token, or null when the person has not said yes */
export async function stepReport(c: ReportStepCtx, raw: ReportToolInput, consentId: string | null, hooks: StepHooks = {}): Promise<ReportOutcome> {
  let input = raw;
  if (!input.accountId && !input.leadId && !input.name && !input.domain && c.open) {
    if (c.open.type === "account") input = { ...input, accountId: c.open.id };
    else if (c.open.type === "lead") input = { ...input, leadId: c.open.id };
  }

  const access = accessOf(c);
  const gate = analysisAccess(access);
  if (!gate.ok) return { kind: "error", message: gate.error };
  if (!input.accountId && !input.leadId && !input.name && !input.domain) return { kind: "error", message: "Name the company, or open its account." };

  if (!input.accountId && !input.leadId) {
    const typed = [input.name, input.domain, input.country].filter(Boolean).join(" ");
    const v = webQueryAllowed(typed, c.userTurns, c.openCompany);
    if (!v.ok) {
      await auditRow(c, input, consentId, "refused", { reason: v.reason });
      return { kind: "error", message: `I did not research that: ${v.reason}` };
    }
  }

  const where: ReportInput = { accountId: input.accountId, leadId: input.leadId, name: input.name ?? undefined, domain: input.domain ?? undefined, country: input.country ?? undefined, lens: input.lens };
  const saved = await readCachedReport(access, where, { now: () => c.now });
  if (!saved.ok) return { kind: "error", message: saved.error };

  const show = async (r: Extract<ReportResult, { ok: true }>): Promise<ReportOutcome> => ({ kind: "card", report: await toDockReport(c, r, input) });
  const row = saved.row;
  // Refresh on a PARTIAL brief is "Try the missing parts": only what is missing runs again, with the question that says so.
  if (input.refresh && !input.retry && row?.report && saved.fresh && row.report.missing.length > 0) input = { ...input, refresh: false, retry: true };
  const cachedResult = (notice?: ReportNotice): Extract<ReportResult, { ok: true }> => ({
    ok: true, report: (row!.report ?? row!.legacy)!, cached: true, saved: true, pendingDb: saved.pendingDb, companyKey: saved.resolved.companyKey,
    accountId: saved.resolved.account?.id ?? null, computedAt: row!.computedAt, ...(notice ? { notice } : {}),
  });

  // A saved brief is shown whole, partial or not; a report in the older format is shown as it is, with a line about the format.
  if (row && saved.fresh && !input.refresh && !input.retry) return show(cachedResult());
  if (input.retry && !(row?.report && saved.fresh && row.report.missing.length > 0)) return { kind: "error", message: "There is no saved brief with parts to try again. Run the brief first." };
  if (row && input.refresh && !input.retry && rowIsComplete(row)) {
    const until = refreshBlockedUntil(row.computedAt, c.now);
    if (until) return show(cachedResult({ kind: "refresh_limit", until }));
  }

  const ask = async (): Promise<ReportOutcome> => {
    const query = encodeReportQuery(input);
    const id = randomUUID();
    return {
      kind: "ask",
      consent: {
        id, query, subject: await labelFor(c, input), searches: MAX_REPORT_SEARCHES, mode: input.retry ? "retry" : "brief",
        token: issueOnceConsent({ tenantId: c.tenantId, userId: c.userId, query, id }),
      },
    };
  };
  if (!consentId) return ask();

  const io = ioOf(c);
  // The yes is spent here: a consent already used, or one that cannot be marked used, is no permission at all.
  const claimed = await io.claim(c.tenantId, c.userId, consentId).catch(() => false);
  if (!claimed) return ask();

  const slot = await io.reserve(c.tenantId, c.userId);
  if (!slot.ok) {
    await auditRow(c, input, consentId, "refused", { reason: "daily search limit" });
    return { kind: "error", message: "Your web searches for today are used up, or cannot be counted right now. Try again tomorrow." };
  }

  let r: ReportResult;
  try {
    r = await buildCompanyReport(access, { ...where, refresh: input.refresh, retryMissing: input.retry, allowWeb: true }, c.setup.deps, hooks);
  } catch (e) {
    await slot.release();
    console.error("Company brief failed:", e);
    await auditRow(c, input, consentId, "failed", { reason: "unexpected error" });
    return { kind: "error", message: "The brief is unavailable right now." };
  }
  if (!r.ok) {
    await slot.release();
    await auditRow(c, input, consentId, "failed", { reason: r.code });
    return { kind: "error", message: r.error };
  }
  // A limit that returned the saved brief ran no search: the person's own slot is given back.
  if (r.cached) await slot.release();
  await auditRow(c, input, consentId, "done", {
    sources: r.report.sources.slice(0, 20).map((s) => ({ title: s.title, url: s.url })),
    result: {
      cached: r.cached, saved: r.saved, searches: r.report.searches, sources: r.report.sources.length, left_out: r.report.leftOut, notice: r.notice?.kind ?? null,
      ...(r.report.v === 2 ? { missing: r.report.missing } : {}),
      ...(r.run ? { parts: r.run.states, reasons: r.run.reasons, queries: r.run.queries } : {}),
    },
  });
  return show(r);
}

export type DirectReply = {
  answer: string;
  consent?: { id: string; kind: "research_report"; query: string; subject: string; searches: number; token: string; mode: "brief" | "retry" };
  companyReport?: DockReport;
};

/** The reply for a request that is a brief on its own (a Yes on its chip, Refresh, the missing parts): no model is called. */
export async function runDirectReport(c: ReportStepCtx, direct: NonNullable<ReportSetup["direct"]>, hooks: StepHooks = {}): Promise<DirectReply> {
  const o = await stepReport(c, direct.input, direct.consentId, hooks);
  if (o.kind === "error") return { answer: o.message };
  if (o.kind === "ask") return { answer: o.consent.mode === "retry" ? `Trying the missing parts of the brief on ${o.consent.subject} needs web research first.` : `A brief on ${o.consent.subject} needs web research first.`, consent: { ...o.consent, kind: "research_report" } };
  return { answer: `Here is the ${o.report.cached ? "saved brief" : "brief"} on ${o.report.report.name.replace(/\.+$/, "")}.`, companyReport: o.report };
}

/**
 * The saved brief for a company, drawn with no web, no model and no limit used: what the account's "Company brief" tab reads.
 * Null when nothing fresh is saved. The same gate as the brief itself, and the record is verified in this workspace first.
 */
export async function readDockReport(c: ReportStepCtx, input: ReportToolInput): Promise<{ ok: true; dock: DockReport | null } | { ok: false; message: string }> {
  const access = accessOf(c);
  const gate = analysisAccess(access);
  if (!gate.ok) return { ok: false, message: gate.error };
  const saved = await readCachedReport(access, { accountId: input.accountId, leadId: input.leadId, name: input.name ?? undefined, domain: input.domain ?? undefined, country: input.country ?? undefined, lens: input.lens }, { now: () => c.now });
  if (!saved.ok) return { ok: false, message: saved.error };
  const row = saved.row;
  if (!row || !saved.fresh) return { ok: true, dock: null };
  const r: Extract<ReportResult, { ok: true }> = {
    ok: true, report: (row.report ?? row.legacy)!, cached: true, saved: true, pendingDb: saved.pendingDb, companyKey: saved.resolved.companyKey,
    accountId: saved.resolved.account?.id ?? null, computedAt: row.computedAt,
  };
  return { ok: true, dock: await toDockReport(c, r, input) };
}
