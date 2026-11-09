import { ROUTES, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef, type TenantFeatures } from "@/lib/constants";
import type { AnalyticsData } from "@/lib/data/labels";
import { tenderLinks } from "@/lib/tenderDesk/links";

// The Rich dashboard's view-model (docs/design/rich-ui.md, step 2a). Pure: it only re-reads what the dashboard page already holds (the
// summary aggregate and AnalyticsData), so Rich adds no query, no API and no rule. src/components/RichDashboard.tsx draws it.
//
// One source for the pipeline, so a number never means two things on one screen: the tender edition's tenders when the workspace has them,
// else open quotations (the tenant's own configured statuses), else the open-deal total with no per-stage picture (analytics holds none).

export type RichKpi = {
  key: "pipeline" | "win" | "unpaid" | "cases";
  label: string;
  value: number;
  kind: "money" | "count" | "percent";
  sub: string;
  subTone: "plain" | "up" | "hot";
  href: string;
};

export type RichStage = { key: string; label: string; count: number; value: number; href: string; weight: number };

export type RichPipeline = {
  title: string;
  /** Spoken noun for one record: "tender", "quotation". */
  noun: string;
  total: number;
  count: number;
  stages: RichStage[];
  emptyText: string;
  emptyAction: string;
  emptyHref: string;
};

export type RichAttentionIcon = "file" | "clock" | "alert";
export type RichAttention = { key: string; text: string; href: string; icon: RichAttentionIcon };

export type RichBid = { id: string; title: string; client: string | null; daysLeft: number; value: number; href: string; pct: number; tone: "violet" | "warm" };

export type RichDashModel = {
  kpis: RichKpi[];
  pipeline: RichPipeline | null;
  attention: RichAttention[];
  /** Everything that needs the person, before the strip cut it to three: the sentence under the greeting counts this. */
  attentionTotal: number;
  /** null: not a tender workspace, the section is not drawn. [] : a tender workspace with nothing closing. */
  bids: RichBid[] | null;
  /** Dashboard card ids the opening already shows in its own way, so the cards below do not repeat them. */
  covers: string[];
};

export type RichDashInput = {
  features: TenantFeatures;
  analytics: AnalyticsData;
  kpis: { openCases: number; openQuoteValue: number };
  attention: Array<{ serviceCase: { id: string; ref: string; intake_at?: string | null }; account?: { name: string } | null }>;
  workOrderRows: Array<{ workOrder: { id: string; ref: string; scheduled_for?: string | null } }>;
  overdueInvoices: Array<{ id: string; ref: string; due_date: string; total: number; paid_amount: number }>;
  quoteStatuses?: QuoteStatusDef[];
  /** ms since epoch; a parameter so the tests are stable. */
  now?: number;
};

const DAY = 86_400_000;
const daysBetween = (iso: string, now: number): number => Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY));
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Bids ring: a 28-day window that fills as the closing day nears. Floor of 6 so a far-off bid still shows an arc. */
export function bidRingPercent(daysLeft: number): number {
  if (!Number.isFinite(daysLeft)) return 0;
  return Math.min(100, Math.max(6, Math.round((1 - Math.max(0, daysLeft) / 28) * 100)));
}

export const bidDaysText = (daysLeft: number): string => (daysLeft <= 0 ? "Today" : daysLeft === 1 ? "1 day" : `${daysLeft} days`);

/** Flex weights for the pipeline flow: proportional to value (count when no value), with a floor so a thin stage stays tappable. */
export function stageWeights(stages: Array<{ count: number; value: number }>): number[] {
  const byValue = stages.reduce((s, x) => s + Math.max(0, x.value), 0) > 0;
  const raw = stages.map((s) => Math.max(0, byValue ? s.value : s.count));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const floor = sum * 0.1;
  const floored = raw.map((r) => Math.max(r, floor));
  const total = floored.reduce((a, b) => a + b, 0) || 1;
  return floored.map((w) => Number(((w / total) * 100).toFixed(2)));
}

export function buildRichDashboard(input: RichDashInput): RichDashModel {
  const { features, analytics: a, kpis, now = Date.now() } = input;
  const t = features.gcc_tender === true ? a.tender : null;
  const tenderOk = !!t && !t.pending && t.kpis.openCount > 0;
  const quotesOn = features.quotations === true;

  // ── pipeline ──
  let pipeline: RichPipeline | null = null;
  let pipelineKpi: RichKpi | null = null;
  if (tenderOk && t) {
    const stages = t.stages.filter((s) => s.count > 0);
    const w = stageWeights(stages);
    pipeline = {
      title: "Pipeline", noun: "tender", total: t.kpis.openValue, count: t.kpis.openCount,
      stages: stages.map((s, i) => ({ key: s.stage, label: s.label, count: s.count, value: s.value, href: tenderLinks.stage(s.stage), weight: w[i] })),
      emptyText: "No open tenders yet.", emptyAction: "Open the pipeline", emptyHref: tenderLinks.tab,
    };
    pipelineKpi = { key: "pipeline", label: "Open pipeline", value: t.kpis.openValue, kind: "money", sub: n(t.kpis.openCount, "tender"), subTone: "plain", href: tenderLinks.tab };
  } else if (quotesOn) {
    const defs = (input.quoteStatuses && input.quoteStatuses.length > 0 ? input.quoteStatuses : DEFAULT_QUOTE_STATUSES).filter((d) => !d.is_closed);
    const open = defs
      .map((d) => a.quotesByStatus.find((q) => q.status === d.value))
      .filter((q): q is NonNullable<typeof q> => !!q && q.count > 0);
    const w = stageWeights(open);
    const total = open.reduce((s, q) => s + q.value, 0);
    const count = open.reduce((s, q) => s + q.count, 0);
    pipeline = {
      title: "Quotations by stage", noun: "quotation", total, count,
      stages: open.map((q, i) => ({ key: q.status, label: q.label, count: q.count, value: q.value, href: ROUTES.quotations, weight: w[i] })),
      emptyText: "No open quotations yet.", emptyAction: "New quotation", emptyHref: ROUTES.quotationNew,
    };
    pipelineKpi = { key: "pipeline", label: "Open quotations", value: total, kind: "money", sub: n(count, "quotation"), subTone: "plain", href: ROUTES.quotations };
  } else if (features.pipeline === true && a.totals.openDeals > 0) {
    pipelineKpi = { key: "pipeline", label: "Open pipeline", value: a.totals.openDealValue, kind: "money", sub: n(a.totals.openDeals, "deal"), subTone: "plain", href: ROUTES.pipeline };
  }

  // ── win rate ──
  let winKpi: RichKpi | null = null;
  const decided = a.quoteOutcomeCounts.won + a.quoteOutcomeCounts.lost;
  if (tenderOk && t && t.kpis.winRate !== null) {
    winKpi = { key: "win", label: "Win rate", value: Math.round(t.kpis.winRate * 100), kind: "percent", sub: `${t.kpis.won12} won, ${t.kpis.lost12} lost`, subTone: "plain", href: tenderLinks.tab };
  } else if (quotesOn && decided > 0) {
    winKpi = { key: "win", label: "Win rate", value: Math.round((a.quoteOutcomeCounts.won / decided) * 100), kind: "percent", sub: `of ${decided} decided`, subTone: "plain", href: ROUTES.quotations };
  }

  // ── invoiced, unpaid ──
  const lateInvoices = input.overdueInvoices
    .map((inv) => ({ inv, days: daysBetween(inv.due_date, now) }))
    .sort((x, y) => y.days - x.days);
  const unpaidKpi: RichKpi | null = features.invoices === true
    ? {
      key: "unpaid", label: "Invoiced, unpaid", value: a.invoiceTotals.outstanding, kind: "money",
      sub: lateInvoices.length > 0 ? `${lateInvoices.length} past due` : "All inside terms",
      subTone: lateInvoices.length > 0 ? "hot" : "up", href: ROUTES.invoices,
    }
    : null;

  // ── cases open ──
  const waitingCases = input.attention
    .map((r) => ({ r, days: r.serviceCase.intake_at ? daysBetween(r.serviceCase.intake_at, now) : 0 }))
    .filter(({ days }) => days >= 3)
    .sort((x, y) => y.days - x.days);
  const casesKpi: RichKpi | null = features.cases === true
    ? {
      key: "cases", label: "Cases open", value: kpis.openCases, kind: "count",
      sub: waitingCases.length > 0 ? `${waitingCases.length} waiting 3+ days` : "None waiting long",
      subTone: waitingCases.length > 0 ? "hot" : "up", href: ROUTES.cases,
    }
    : null;

  // ── needs attention: ranked, then cut to three ──
  type Cand = RichAttention & { rank: number };
  const cands: Cand[] = [];
  if (tenderOk && t) {
    const icon = (k: string): RichAttentionIcon => (k === "supplier_reply" || k === "bond_expiry" ? "clock" : k === "stale_price" ? "file" : "alert");
    t.attention.forEach((x, i) => cands.push({ key: `tender-${i}`, text: x.title, href: x.href, icon: icon(x.kind), rank: x.severity === "high" ? 0 : x.severity === "medium" ? 3 : 6 }));
  }
  lateInvoices.forEach(({ inv, days }) => cands.push({
    key: `inv-${inv.id}`, text: days > 0 ? `Invoice ${inv.ref} is ${n(days, "day")} late` : `Invoice ${inv.ref} is due`, href: ROUTES.invoice(inv.id), icon: "clock", rank: 1,
  }));
  waitingCases.forEach(({ r, days }) => cands.push({
    key: `case-${r.serviceCase.id}`, text: `Case ${r.serviceCase.ref} has waited ${n(days, "day")}`, href: ROUTES.case(r.serviceCase.id), icon: "alert", rank: 2,
  }));
  input.workOrderRows
    .filter((r) => r.workOrder.scheduled_for && new Date(r.workOrder.scheduled_for).getTime() < now - DAY)
    .map((r) => ({ r, days: daysBetween(r.workOrder.scheduled_for as string, now) }))
    .sort((x, y) => y.days - x.days)
    .forEach(({ r, days }) => cands.push({
      key: `wo-${r.workOrder.id}`, text: `Work order ${r.workOrder.ref} is ${n(days, "day")} past its date`, href: ROUTES.workOrder(r.workOrder.id), icon: "alert", rank: 4,
    }));
  if (quotesOn && a.quoteOverdueCount > 0) {
    cands.push({ key: "quotes-overdue", text: `${n(a.quoteOverdueCount, "quotation")} past validity`, href: ROUTES.quotations, icon: "file", rank: 5 });
  }
  const ranked = cands.map((c, i) => ({ c, i })).sort((x, y) => x.c.rank - y.c.rank || x.i - y.i).map(({ c }) => c);

  // ── bids closing soonest ──
  let bids: RichBid[] | null = null;
  if (features.gcc_tender === true && t && !t.pending) {
    bids = t.closing.slice(0, 3).map((c) => ({
      id: c.id, title: c.title, client: c.client, daysLeft: c.daysLeft, value: c.value, href: c.href,
      pct: bidRingPercent(c.daysLeft), tone: c.daysLeft <= 7 ? "warm" : "violet",
    }));
  }

  const covers: string[] = ["overview_strip"];
  if (tenderOk) covers.push("tender_open_pipeline", "tender_by_stage", "tender_attention");
  if (tenderOk && winKpi) covers.push("tender_win_rate");
  if (bids && bids.length > 0) covers.push("tender_closing_list");

  return {
    covers,
    kpis: [pipelineKpi, winKpi, unpaidKpi, casesKpi].filter((k): k is RichKpi => !!k),
    pipeline,
    attention: ranked.slice(0, 3).map(({ key, text, href, icon }) => ({ key, text, href, icon })),
    attentionTotal: ranked.length,
    bids,
  };
}
