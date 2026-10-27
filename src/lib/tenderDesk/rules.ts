// Tender desk (docs/design/tender-desk.md, "Data"). PURE: every function takes plain rows and returns a piece of TenderDeskData, so each
// number on the home screen can be explained and tested without a database. `composeTenderDesk` is the one place the pieces meet;
// src/lib/tenderDesk/server.ts only loads the rows.
//
// Days are calendar days in the workspace time zone (never the server's), read with the same helpers the tender reminders use.

import { ROUTES } from "@/lib/constants";
import { daysToExpiry } from "@/lib/tender/bond";
import { isStale } from "@/lib/tender/boq/price";
import { dayKey, daysUntilClosing, TENDER_CLOSING_SOON_DAYS, TENDER_PRE_SUBMISSION_STAGES } from "@/lib/tender/rules";
import type {
  TenderDeskAttention, TenderDeskBuyout, TenderDeskBuyoutPackage, TenderDeskClient, TenderDeskClosing, TenderDeskData, TenderDeskKpis,
  TenderDeskMonth, TenderDeskStage, TenderDeskTrendPoint,
} from "./types";

export const DESK_CLOSING_SHOWN = 8;
export const DESK_CLIENTS_SHOWN = 5;
export const DESK_ATTENTION_SHOWN = 5;
export const DESK_MONTHS = 12;
export const DESK_TREND_POINTS = 12;
/** A bid guarantee that is not released is flagged this many days before it expires. */
export const DESK_BOND_WARN_DAYS = 30;
/** A deal closing within this many days with prices from an old source, or with no price at all, is flagged. */
export const DESK_STALE_WINDOW_DAYS = TENDER_CLOSING_SOON_DAYS;
export const DESK_UNPRICED_WINDOW_DAYS = 3;
export const DESK_OTHERS_LABEL = "Others";
export const DESK_NO_CLIENT_LABEL = "No client";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const chance = (v: number | null | undefined): number => Math.min(100, Math.max(0, money(v)));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── Inputs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One tender deal: the opportunity plus its opportunity_tenders row, already joined by the loader. */
export type DeskTender = {
  id: string;
  ref: string | null;
  title: string;
  stage: string;
  outcome: string;
  /** opportunities.amount. Null reads as 0. */
  amount: number | null;
  /** opportunities.probability, 0..100. Null reads as 0. */
  probability: number | null;
  /** opportunity_tenders.closing_at, an ISO timestamp. */
  closingAt: string | null;
  createdAt: string;
  closedAt: string | null;
  clientName: string | null;
  clientAccountId: string | null;
};

export type DeskStageDef = { value: string; label: string; color: string; is_closed?: boolean };

export type DeskPackage = { name: string; budget: number; best_quote: number | null; committed: number | null };
export type DeskProject = { id: string; name: string; createdAt: string; packages: DeskPackage[] };

export type DecisionRequest = { opportunityId: string; title: string; proposed: "go" | "no_go"; createdAt: string; closingAt: string | null };
export type RfqWait = { rfqId: string; ref: string | null; title: string; respondBy: string; waiting: number };
export type BondExpiry = { opportunityId: string; title: string; expiry: string; closingAt: string | null };
export type StaleDeal = { opportunityId: string; title: string; closingAt: string | null; staleLines: number };
export type UnpricedDeal = { opportunityId: string; title: string; closingAt: string | null };
export type BoqPriceLine = { opportunityId: string; priceSource: string | null; priceAsOf: string | null; staleAccepted: boolean; removed: boolean };

// ── Days and months ────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** yyyy-mm-dd plus n days (calendar arithmetic on the key itself, so no time zone can shift it). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** yyyy-mm-dd of an instant, read in the workspace time zone; null when it is not a date. */
export function localDayOf(iso: string | null | undefined, timezone: string): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : dayKey(t, timezone);
}

/** "2026-10" of an instant, read in the workspace time zone; null when it is not a date. */
export const monthKeyOf = (iso: string | null | undefined, timezone: string): string | null => localDayOf(iso, timezone)?.slice(0, 7) ?? null;

/** The last `count` calendar months ending with the current one, oldest first. */
export function lastMonths(now: Date, timezone: string, count = DESK_MONTHS): { key: string; label: string }[] {
  const [y, m] = dayKey(now, timezone).slice(0, 7).split("-").map(Number);
  const out: { key: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    const yy = Math.floor(idx / 12);
    const mm = idx % 12;
    out.push({ key: `${yy}-${String(mm + 1).padStart(2, "0")}`, label: MONTH[mm] });
  }
  return out;
}

const isOpen = (t: Pick<DeskTender, "outcome">) => t.outcome === "open";

/** Whole days from today to the bid end date, or null without one. Negative once it has passed. */
export const daysLeftOf = (t: Pick<DeskTender, "closingAt">, now: Date, timezone: string): number | null => daysUntilClosing(t.closingAt, now, timezone);

/** The stages in which the closing date is still a deadline the team can act on (nothing left to price or decide after Submitted). */
const preSubmission = (t: Pick<DeskTender, "stage">) => TENDER_PRE_SUBMISSION_STAGES.includes(t.stage);

// ── Pieces ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function buildKpis(tenders: readonly DeskTender[], now: Date, timezone: string, buyout: { committed: number; budget: number | null }): TenderDeskKpis {
  const open = tenders.filter(isOpen);
  let openValue = 0, weighted = 0, soonCount = 0, soonValue = 0;
  for (const t of open) {
    const v = money(t.amount);
    openValue += v;
    weighted += (v * chance(t.probability)) / 100;
    const d = daysLeftOf(t, now, timezone);
    if (d !== null && d >= 0 && d <= TENDER_CLOSING_SOON_DAYS) { soonCount++; soonValue += v; }
  }
  const window = new Set(lastMonths(now, timezone).map((m) => m.key));
  let won = 0, lost = 0;
  for (const t of tenders) {
    if (t.outcome !== "won" && t.outcome !== "lost") continue;
    const key = monthKeyOf(t.closedAt, timezone);
    if (!key || !window.has(key)) continue;
    if (t.outcome === "won") won++; else lost++;
  }
  return {
    openValue: round2(openValue), openCount: open.length, weightedValue: round2(weighted),
    closingSoonCount: soonCount, closingSoonValue: round2(soonValue),
    winRate: won + lost === 0 ? null : won / (won + lost), won12: won, lost12: lost,
    buyoutCommitted: round2(buyout.committed), buyoutBudget: buyout.budget === null ? null : round2(buyout.budget),
  };
}

/** Open stages only, in the workspace's order, each with its own colour. A stage with no tender still shows, so the bars keep their places. */
export function buildStages(tenders: readonly DeskTender[], defs: readonly DeskStageDef[]): TenderDeskStage[] {
  const open = tenders.filter(isOpen);
  return defs.filter((d) => !d.is_closed).map((d) => {
    const mine = open.filter((t) => t.stage === d.value);
    return { stage: d.value, label: d.label, color: d.color, count: mine.length, value: round2(mine.reduce((s, t) => s + money(t.amount), 0)) };
  });
}

/** Open tenders whose bid end date is today or later (the local day), soonest first. A bid that ended yesterday is not listed. */
export function buildClosing(tenders: readonly DeskTender[], now: Date, timezone: string, limit = DESK_CLOSING_SHOWN): TenderDeskClosing[] {
  const rows: (TenderDeskClosing & { at: number })[] = [];
  for (const t of tenders) {
    if (!isOpen(t) || !t.closingAt) continue;
    const d = daysLeftOf(t, now, timezone);
    if (d === null || d < 0) continue;
    rows.push({
      id: t.id, ref: t.ref, title: t.title, client: t.clientName, closesAt: t.closingAt, daysLeft: d, value: money(t.amount),
      href: ROUTES.pipelineDetail(t.id), at: Date.parse(t.closingAt),
    });
  }
  rows.sort((a, b) => a.at - b.at || (a.ref ?? "").localeCompare(b.ref ?? "") || a.id.localeCompare(b.id));
  return rows.slice(0, limit).map(({ at: _at, ...r }) => r);
}

/** Tenders decided (won or lost) per calendar month of `closed_at`; a dropped tender is neither. */
export function buildMonths(tenders: readonly DeskTender[], now: Date, timezone: string): TenderDeskMonth[] {
  const months = lastMonths(now, timezone).map((m) => ({ key: m.key, label: m.label, won: 0, lost: 0 }));
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const t of tenders) {
    if (t.outcome !== "won" && t.outcome !== "lost") continue;
    const m = byKey.get(monthKeyOf(t.closedAt, timezone) ?? "");
    if (!m) continue;
    if (t.outcome === "won") m.won++; else m.lost++;
  }
  return months;
}

/** Open value by client: the five largest, then one "Others" row for the rest. Clients are told apart by name, ignoring case and spacing. */
export function buildClients(tenders: readonly DeskTender[], top = DESK_CLIENTS_SHOWN): TenderDeskClient[] {
  const groups = new Map<string, TenderDeskClient>();
  for (const t of tenders) {
    if (!isOpen(t)) continue;
    const name = t.clientName?.trim() || DESK_NO_CLIENT_LABEL;
    const key = name.toLowerCase().replace(/\s+/g, " ");
    const g = groups.get(key) ?? { accountId: t.clientAccountId, name, value: 0, count: 0 };
    g.value += money(t.amount);
    g.count += 1;
    if (!g.accountId) g.accountId = t.clientAccountId;
    groups.set(key, g);
  }
  const sorted = [...groups.values()].map((g) => ({ ...g, value: round2(g.value) }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.name.localeCompare(b.name));
  if (sorted.length <= top) return sorted;
  const rest = sorted.slice(top);
  return [...sorted.slice(0, top), { accountId: null, name: DESK_OTHERS_LABEL, value: round2(rest.reduce((s, g) => s + g.value, 0)), count: rest.reduce((s, g) => s + g.count, 0) }];
}

/**
 * Twelve points, one a week, the last one today: the value of the tenders that were open at the end of that day, rebuilt from their created
 * and closed dates. An honest approximation of history: a later edit of an amount is not replayed. Empty when no tender has a usable created date.
 */
export function buildTrend(tenders: readonly DeskTender[], now: Date, timezone: string, points = DESK_TREND_POINTS): TenderDeskTrendPoint[] {
  const dated = tenders.flatMap((t) => {
    const created = localDayOf(t.createdAt, timezone);
    if (!created) return [];
    const closed = localDayOf(t.closedAt, timezone);
    // A decided tender with no closed date cannot be placed in time: leave it out rather than count it forever.
    if (!isOpen(t) && !closed) return [];
    return [{ created, closed, value: money(t.amount) }];
  });
  if (dated.length === 0) return [];
  const today = dayKey(now, timezone);
  const out: TenderDeskTrendPoint[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const end = addDays(today, -7 * i);
    const sum = dated.filter((d) => d.created <= end && (d.closed === null || d.closed > end)).reduce((s, d) => s + d.value, 0);
    out.push({ weekEnd: end, openValue: round2(sum) });
  }
  return out;
}

// ── Buy-out ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function buyoutPackageStatus(p: Pick<DeskPackage, "committed" | "best_quote">): TenderDeskBuyoutPackage["status"] {
  if (p.committed !== null) return "awarded";
  return p.best_quote !== null ? "quotes in" : "waiting";
}

/**
 * The project the buy-out card shows: the one with the most packages that have moved (awarded or with a quote), then the most packages,
 * then the newest. A project without any package is never shown.
 */
export function pickFeaturedProject(projects: readonly DeskProject[]): DeskProject | null {
  const moved = (p: DeskProject) => p.packages.filter((x) => x.committed !== null || x.best_quote !== null).length;
  const eligible = projects.filter((p) => p.packages.length > 0);
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => moved(b) - moved(a) || b.packages.length - a.packages.length || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))[0];
}

/** Across every project: what is awarded, and the budget of every package. A null budget means there are no packages at all. */
export function buyoutTotals(projects: readonly DeskProject[]): { committed: number; budget: number | null } {
  const all = projects.flatMap((p) => p.packages);
  if (all.length === 0) return { committed: 0, budget: null };
  return { committed: all.reduce((s, p) => s + (p.committed ?? 0), 0), budget: all.reduce((s, p) => s + p.budget, 0) };
}

export function buildBuyout(projects: readonly DeskProject[]): TenderDeskBuyout {
  const p = pickFeaturedProject(projects);
  if (!p) return null;
  return {
    projectId: p.id, projectName: p.name, href: ROUTES.contractProject(p.id),
    packages: p.packages.map((x) => ({ name: x.name, budget: round2(x.budget), bestQuote: x.best_quote, committed: x.committed, status: buyoutPackageStatus(x) })),
  };
}

// ── Needs you today ────────────────────────────────────────────────────────────────────────────────────────────────────

type Severity = TenderDeskAttention["severity"];
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const KIND_RANK: Record<TenderDeskAttention["kind"], number> = { decision: 0, supplier_reply: 1, bond_expiry: 2, stale_price: 3, closing_unpriced: 4 };

type Ranked = TenderDeskAttention & { urgency: number };

const closesIn = (days: number | null) => (days === null ? "no bid end date" : days === 0 ? "bid ends today" : days === 1 ? "bid ends tomorrow" : `bid ends in ${days} days`);

/** A bid / no-bid proposal waiting for a manager. High once the bid ends within two weeks, since the work after "go" cannot start without it. */
export function decisionItems(rows: readonly DecisionRequest[], now: Date, timezone: string): Ranked[] {
  return rows.map((r) => {
    const waited = daysUntilClosing(r.createdAt, now, timezone);
    const ago = waited === null ? 0 : Math.max(0, -waited);
    const left = daysLeftOf(r, now, timezone);
    const soon = left !== null && left <= TENDER_CLOSING_SOON_DAYS;
    return {
      kind: "decision" as const, title: `Bid decision: ${r.title}`,
      sub: `${r.proposed === "go" ? "Go" : "No-go"} proposed ${ago === 0 ? "today" : `${plural(ago, "day")} ago`}${left !== null && left >= 0 ? `, ${closesIn(left)}` : ""}`,
      action: "Decide", href: ROUTES.pipelineDetail(r.opportunityId), severity: soon ? "high" as const : "medium" as const,
      urgency: left ?? Number.MAX_SAFE_INTEGER,
    };
  });
}

/** An RFQ whose reply date has passed while suppliers have not answered. `respondBy` is a plain date (yyyy-mm-dd). */
export function supplierReplyItems(rows: readonly RfqWait[], now: Date, timezone: string): Ranked[] {
  const today = dayKey(now, timezone);
  const out: Ranked[] = [];
  for (const r of rows) {
    if (r.waiting <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(r.respondBy) || r.respondBy >= today) continue;
    const late = Math.round((Date.parse(today) - Date.parse(r.respondBy)) / 86_400_000);
    out.push({
      kind: "supplier_reply", title: `Supplier reply overdue: ${r.ref ?? r.title}`,
      sub: `${plural(r.waiting, "supplier")} not replied, due ${late === 1 ? "yesterday" : `${late} days ago`}`,
      action: "Remind", href: ROUTES.rfq(r.rfqId), severity: late >= 7 ? "high" : "medium", urgency: -late,
    });
  }
  return out;
}

/** A bid guarantee that expires within 30 days (or already has). High from a week out. */
export function bondItems(rows: readonly BondExpiry[], now: Date, timezone: string): Ranked[] {
  const out: Ranked[] = [];
  for (const r of rows) {
    const days = daysToExpiry(r.expiry, now, timezone);
    if (days === null || days > DESK_BOND_WARN_DAYS) continue;
    out.push({
      kind: "bond_expiry", title: `Bid guarantee: ${r.title}`,
      sub: days < 0 ? (days === -1 ? "Expired yesterday" : `Expired ${-days} days ago`) : days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`,
      action: "Extend", href: ROUTES.pipelineDetail(r.opportunityId), severity: days <= 7 ? "high" : "medium", urgency: days,
    });
  }
  return out;
}

/** Deals still being priced, closing within two weeks, with lines priced from a supplier or past-project source older than the workspace's limit. */
export function staleItems(rows: readonly StaleDeal[], now: Date, timezone: string, validityDays: number): Ranked[] {
  const out: Ranked[] = [];
  for (const r of rows) {
    const left = daysLeftOf(r, now, timezone);
    if (r.staleLines <= 0 || left === null || left < 0 || left > DESK_STALE_WINDOW_DAYS) continue;
    out.push({
      kind: "stale_price", title: `Old prices: ${r.title}`,
      sub: `${plural(r.staleLines, "line")} priced from a source older than ${validityDays} days, ${closesIn(left)}`,
      action: "Review", href: `${ROUTES.pipelineDetail(r.opportunityId)}?tab=boq`, severity: "medium", urgency: left,
    });
  }
  return out;
}

/** Deals closing within three days with nothing priced. */
export function unpricedItems(rows: readonly UnpricedDeal[], now: Date, timezone: string): Ranked[] {
  const out: Ranked[] = [];
  for (const r of rows) {
    const left = daysLeftOf(r, now, timezone);
    if (left === null || left < 0 || left > DESK_UNPRICED_WINDOW_DAYS) continue;
    out.push({
      kind: "closing_unpriced", title: `Not priced yet: ${r.title}`, sub: closesIn(left).replace(/^b/, "B"),
      action: "Price", href: `${ROUTES.pipelineDetail(r.opportunityId)}?tab=boq`, severity: "high", urgency: left,
    });
  }
  return out;
}

/** Most severe first, then the order of the kinds above, then the soonest. At most five. */
export function rankAttention(items: readonly Ranked[], limit = DESK_ATTENTION_SHOWN): TenderDeskAttention[] {
  return [...items]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.urgency - b.urgency || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ urgency: _u, ...a }) => a);
}

// ── From BOQ rows to the two deal lists ────────────────────────────────────────────────────────────────────────────────

/** Count, per deal, the lines priced from a source that is now too old and that nobody accepted knowingly. Removed lines do not count. */
export function staleLineCounts(lines: readonly BoqPriceLine[], todayKey: string, validityDays: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (l.removed || !l.priceSource || l.staleAccepted) continue;
    if (!isStale(l.priceSource as Parameters<typeof isStale>[0], l.priceAsOf, todayKey, validityDays)) continue;
    out.set(l.opportunityId, (out.get(l.opportunityId) ?? 0) + 1);
  }
  return out;
}

/** Deals that have at least one priced BOQ line (a source set, not removed). */
export function pricedDealIds(lines: readonly BoqPriceLine[]): Set<string> {
  return new Set(lines.filter((l) => !l.removed && !!l.priceSource).map((l) => l.opportunityId));
}

/** Open tenders in the pre-submission stages whose bid ends within `days` days (today included): the ones price checks concern. */
export function dealsClosingWithin(tenders: readonly DeskTender[], now: Date, timezone: string, days: number): DeskTender[] {
  return tenders.filter((t) => {
    if (!isOpen(t) || !preSubmission(t)) return false;
    const d = daysLeftOf(t, now, timezone);
    return d !== null && d >= 0 && d <= days;
  });
}

/** Open tenders that have an unreleased guarantee with an expiry date. */
export function dealsWithOpenGuarantee(tenders: readonly (DeskTender & { bondExpiry: string | null; bondReleased: boolean })[]): BondExpiry[] {
  return tenders.filter((t) => isOpen(t) && !!t.bondExpiry && !t.bondReleased).map((t) => ({ opportunityId: t.id, title: t.title, expiry: t.bondExpiry as string, closingAt: t.closingAt }));
}

// ── The whole screen ───────────────────────────────────────────────────────────────────────────────────────────────────

export type DeskInput = {
  now: Date;
  timezone: string;
  currency: string;
  /** A table the desk reads is missing: the screens show their calm empty state. */
  pending: boolean;
  stageDefs: readonly DeskStageDef[];
  tenders: readonly DeskTender[];
  /** Contract projects made from tender deals, each with its buy-out packages. Null / empty when the buy-out tables are not there. */
  projects: readonly DeskProject[];
  decisions: readonly DecisionRequest[];
  rfqWaits: readonly RfqWait[];
  bonds: readonly BondExpiry[];
  stale: readonly StaleDeal[];
  unpriced: readonly UnpricedDeal[];
  validityDays: number;
};

export function emptyTenderDesk(args: { now: Date; currency: string; pending: boolean }): TenderDeskData {
  return {
    currency: args.currency, asOf: args.now.toISOString(), pending: args.pending,
    kpis: { openValue: 0, openCount: 0, weightedValue: 0, closingSoonCount: 0, closingSoonValue: 0, winRate: null, won12: 0, lost12: 0, buyoutCommitted: 0, buyoutBudget: null },
    stages: [], closing: [], months: [], clients: [], trend: [], buyout: null, attention: [],
  };
}

export function composeTenderDesk(input: DeskInput): TenderDeskData {
  const { now, timezone } = input;
  if (input.pending) return emptyTenderDesk({ now, currency: input.currency, pending: true });
  const totals = buyoutTotals(input.projects);
  const openIds = new Set(input.tenders.filter(isOpen).map((t) => t.id));
  const live = (id: string) => openIds.has(id);
  return {
    currency: input.currency,
    asOf: now.toISOString(),
    pending: false,
    kpis: buildKpis(input.tenders, now, timezone, totals),
    stages: buildStages(input.tenders, input.stageDefs),
    closing: buildClosing(input.tenders, now, timezone),
    months: buildMonths(input.tenders, now, timezone),
    clients: buildClients(input.tenders),
    trend: buildTrend(input.tenders, now, timezone),
    buyout: buildBuyout(input.projects),
    attention: rankAttention([
      ...decisionItems(input.decisions.filter((d) => live(d.opportunityId)), now, timezone),
      ...supplierReplyItems(input.rfqWaits, now, timezone),
      ...bondItems(input.bonds.filter((b) => live(b.opportunityId)), now, timezone),
      ...staleItems(input.stale.filter((s) => live(s.opportunityId)), now, timezone, input.validityDays),
      ...unpricedItems(input.unpriced.filter((u) => live(u.opportunityId)), now, timezone),
    ]),
  };
}
