import { ROUTES } from "@/lib/constants";
import type { BriefingLine, Candidate, CandidateKind, FocusLine, ScoreWorking } from "./types";

/**
 * Where to focus: a fixed rubric, deliberately not an AI call (the Account 360 doctrine -- a ranking a person is told
 * to act on has to be explainable and identical on every reload). Every line hands back its own working:
 *
 *   score = urgency (0-100, from the rule for its kind) x value factor (1.0-1.5) x ownership (1.0 yours / 0.6 yours to decide)
 *
 * Ties fall to the older item, then to the id, so two reloads always give the same order. Pure.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const ahead = (n: number) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const behind = (n: number) => (n <= 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`);
const lateBy = (n: number) => (n <= 0 ? "due today" : `${plural(n, "day")} overdue`);
const extra = (c: Candidate, per: number, max: number) => clamp((c.count ?? 1) - 1, 0, max) * per;

type Rule = {
  urgency: (c: Candidate) => number;
  reason: (c: Candidate) => string;
  /** The grouped "Open today" wording for n items of this kind. */
  group: (n: number) => string;
  /** Where the grouped line goes when more than one item sits behind it. Absent: the most urgent item's own link. */
  list?: string;
  /** Section order of the grouped lines: the most pressing kinds first. */
  order: number;
};

export const RULES: Record<CandidateKind, Rule> = {
  quote_expired: {
    urgency: (c) => 60 + clamp(c.days, 0, 30),
    reason: (c) => `expired ${behind(c.days)}`,
    group: (n) => `${plural(n, "quote")} expired`, list: ROUTES.quotations, order: 1,
  },
  quote_expiring: {
    urgency: (c) => 80 - clamp(c.days, 0, 7) * 5,
    reason: (c) => `expires ${ahead(c.days)}`,
    group: (n) => `${plural(n, "quote")} expiring`, list: ROUTES.quotations, order: 2,
  },
  deal_late: {
    urgency: (c) => 70 + clamp(c.days, 0, 30),
    reason: (c) => `close date passed ${behind(c.days)}`,
    group: (n) => `${plural(n, "deal")} past the close date`, list: ROUTES.pipeline, order: 3,
  },
  deal_closing: {
    urgency: (c) => 75 - clamp(c.days, 0, 7) * 4,
    reason: (c) => `closing ${ahead(c.days)}`,
    group: (n) => `${plural(n, "deal")} closing soon`, list: ROUTES.pipeline, order: 4,
  },
  invoice_overdue: {
    urgency: (c) => 60 + clamp(c.days, 0, 60) / 2,
    reason: (c) => lateBy(c.days),
    group: (n) => `${plural(n, "invoice")} overdue`, list: ROUTES.invoices, order: 5,
  },
  lead_ready: {
    urgency: (c) => 55 + clamp(c.days, 0, 10),
    reason: (c) => (c.days <= 0 ? "ready for sales today" : `ready for sales for ${plural(c.days, "day")}`),
    group: (n) => `${plural(n, "lead")} ready for sales`, list: ROUTES.marketingLeads, order: 6,
  },
  abm_step: {
    urgency: (c) => 50 + clamp(c.days, 0, 20) * 1.5,
    reason: (c) => `next step ${lateBy(c.days)}`,
    group: (n) => `${plural(n, "ABM step")} due`, list: ROUTES.marketingAbm, order: 7,
  },
  task_due: {
    urgency: (c) => 45 + clamp(c.days, 0, 20) * 2,
    reason: (c) => lateBy(c.days),
    group: (n) => `${plural(n, "task")} due`, list: ROUTES.marketingJourneys, order: 8,
  },
  wfm_leave: {
    urgency: (c) => 50 + clamp(c.days, 0, 7) * 3 + extra(c, 2, 5),
    reason: (c) => `${c.count ?? 1} waiting, oldest ${plural(c.days, "day")}`,
    group: (n) => `${plural(n, "leave request")} to decide`, list: ROUTES.wfmLeave, order: 9,
  },
  wfm_correction: {
    urgency: (c) => 50 + clamp(c.days, 0, 7) * 3 + extra(c, 2, 5),
    reason: (c) => `${c.count ?? 1} waiting, oldest ${plural(c.days, "day")}`,
    group: (n) => `${plural(n, "time correction")} to decide`, list: ROUTES.wfmCorrections, order: 10,
  },
  wfm_overtime: {
    urgency: (c) => 50 + clamp(c.days, 0, 7) * 3 + extra(c, 2, 5),
    reason: (c) => `${c.count ?? 1} waiting, oldest ${plural(c.days, "day")}`,
    group: (n) => `${plural(n, "overtime session")} to decide`, list: ROUTES.wfmCorrections, order: 11,
  },
  mention: {
    urgency: (c) => 45 + clamp(c.days, 0, 5) * 2,
    reason: (c) => `mentioned you ${behind(c.days)}`,
    group: (n) => `${plural(n, "unread mention")}`, order: 12,
  },
  lead_new: {
    urgency: (c) => 40 + clamp(c.days, 0, 14),
    reason: (c) => `new for ${plural(c.days, "day")}`,
    group: (n) => `${plural(n, "new lead")} waiting`, list: ROUTES.leads, order: 13,
  },
  quote_draft: {
    urgency: (c) => 30 + clamp(c.days - 7, 0, 21),
    reason: (c) => `draft for ${plural(c.days, "day")}`,
    group: (n) => `${plural(n, "draft quote")} to finish`, list: ROUTES.quotations, order: 14,
  },
  order_confirm: {
    urgency: (c) => 52 + clamp(c.days, 0, 10),
    reason: (c) => (c.days <= 0 ? "draft order made today, not confirmed" : `draft order not confirmed for ${plural(c.days, "day")}`),
    group: (n) => `${plural(n, "order")} to confirm`, list: ROUTES.salesOrders, order: 5.5,
  },
  sync_failed: {
    urgency: (c) => 55 + extra(c, 2, 5),
    reason: (c) => `${c.count ?? 1} failed in the last 24 hours`,
    group: (n) => `${plural(n, "failed sync")}`, list: ROUTES.settingsMiddleware, order: 15,
  },
};

/** The kinds the rubric knows, in section order. */
export const KIND_ORDER = (Object.keys(RULES) as CandidateKind[]).sort((a, b) => RULES[a].order - RULES[b].order);

const OWNERSHIP = { own: 1.0, approver: 0.6 } as const;

/** Money is worth a little extra attention, never more than half again: log-scaled, 1.0 for no value. */
export function valueFactor(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) return 1;
  return Math.round((1 + Math.min(0.5, Math.log10(1 + value) / 12)) * 1000) / 1000;
}

export function scoreCandidate(c: Candidate, formatValue?: (n: number) => string): { score: number; why: string; working: ScoreWorking } {
  const rule = RULES[c.kind];
  const urgency = clamp(Math.round(rule.urgency(c) * 10) / 10, 0, 100);
  const vf = valueFactor(c.value);
  const own = OWNERSHIP[c.ownership];
  const ownershipWhy: ScoreWorking["ownershipWhy"] = c.ownership === "own" ? "yours" : "waiting for your decision";
  const score = Math.round(urgency * vf * own * 10) / 10;
  const reason = rule.reason(c);
  const bits = [reason.charAt(0).toUpperCase() + reason.slice(1)];
  if (c.value && c.value > 0 && formatValue) bits.push(formatValue(c.value));
  if (c.ownership === "approver") bits.push(ownershipWhy);
  return { score, why: bits.join(" · "), working: { urgency, urgencyWhy: reason, valueFactor: vf, ownership: own, ownershipWhy } };
}

/** The top of the list, each line with its reason and its working. Highest score first; ties: older, then id. */
export function rankFocus(candidates: readonly Candidate[], opts: { limit?: number; formatValue?: (n: number) => string } = {}): FocusLine[] {
  const scored = candidates.map((c) => ({ c, ...scoreCandidate(c, opts.formatValue) }));
  scored.sort((a, b) => b.score - a.score || b.c.days - a.c.days || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
  return scored.slice(0, opts.limit ?? 5).map(({ c, score, why, working }) => ({
    id: c.id, label: c.label, href: c.href, objectType: c.objectType, count: c.count, score, why, working,
  }));
}

const MAX_ITEMS = 3;

/** "Open today": one grouped line per kind with something in it ("3 quotes expiring"), most pressing kinds first. */
export function groupOpen(candidates: readonly Candidate[]): BriefingLine[] {
  const lines: BriefingLine[] = [];
  for (const kind of KIND_ORDER) {
    const rule = RULES[kind];
    const mine = candidates.filter((c) => c.kind === kind)
      .sort((a, b) => rule.urgency(b) - rule.urgency(a) || (a.id < b.id ? -1 : 1));
    if (mine.length === 0) continue;
    const n = mine.reduce((t, c) => t + (c.count ?? 1), 0);
    const single = n === 1 || (mine.length === 1 && (mine[0].count ?? 1) === 1);
    lines.push({
      id: `open:${kind}`,
      label: rule.group(n),
      href: single || !rule.list ? mine[0].href : rule.list,
      objectType: mine[0].objectType,
      count: n,
      items: mine.length > 1 || (mine[0].count ?? 1) === 1 ? mine.slice(0, MAX_ITEMS).map((c) => ({ label: c.label, href: c.href })) : undefined,
    });
  }
  return lines;
}
