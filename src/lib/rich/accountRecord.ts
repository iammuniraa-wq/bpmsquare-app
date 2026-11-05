import type { Contract, Invoice, Quote, ServiceCase } from "@/lib/types";
import type { Account360Rating } from "@/lib/account360/types";
import { computeAccountHealth, OPEN_CASE_STATUSES, type AccountStoryEvent } from "@/lib/nova/accountStory";
import { ROUTES } from "@/lib/constants";
import { formatMoney, type CurrencyDef } from "@/lib/currency";
import type { RingTone } from "@/components/ui/Ring";
import type { PhotoMesh } from "@/components/ui/PhotoFrame";

/**
 * The numbers and sentences on the Rich account record (docs/design/rich-ui.md). Everything here is derived from the records the
 * account hub page has already loaded; nothing is fetched and nothing is invented. A figure with no data behind it is simply
 * absent, and the screen draws no card for it.
 *
 * The next best step applies the same plain rules the Account 360 suggestions use (overdue invoices, stale quotations, aged cases,
 * single-threaded contacts, gone quiet, contracts about to end, won work never invoiced) to the hub data. It is a rubric, not an AI
 * call, so the sentence is explainable and identical on every reload (bpmsquarecore.md, 10a). Account 360 stays the fuller list
 * (it also reads signals, ABM and external sources); this card shows the one most urgent step and says how many others wait there.
 */

const DAY = 86_400_000;
const daysBetween = (iso: string | null | undefined, now: number): number | null =>
  iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY)) : null;

/** Which modules the tenant has; a rule or card for a module that is off never appears. */
export type RichModules = { quotations: boolean; cases: boolean; invoices: boolean; contacts: boolean; amc: boolean };

export type RichRecordData = {
  quotes: Quote[];
  cases: ServiceCase[];
  invoices: Invoice[];
  contacts: unknown[];
  contracts: Pick<Contract, "id" | "ref" | "start_date" | "end_date" | "status">[];
};

/** Empties the arrays of modules the tenant does not own, so no card, event or step can come from them. */
export function gateByModules(data: RichRecordData, m: RichModules): RichRecordData {
  return {
    quotes: m.quotations ? data.quotes : [],
    cases: m.cases ? data.cases : [],
    invoices: m.invoices ? data.invoices : [],
    contacts: m.contacts ? data.contacts : [],
    contracts: m.amc ? data.contracts : [],
  };
}

// ── Time words ───────────────────────────────────────────────────────────────

export function agoWords(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "1 month ago";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return days < 730 ? "1 year ago" : `${Math.floor(days / 365)} years ago`;
}

// ── Identity ─────────────────────────────────────────────────────────────────

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "?";
  const second = words.length > 1 ? Array.from(words[1])[0] ?? "" : "";
  return (first + second).toUpperCase();
}

const MESHES: PhotoMesh[] = ["a", "b", "c", "d", "e", "f"];
/** The same account always gets the same gradient, so the hero is recognisable without a stored image. */
export function meshFor(seed: string): PhotoMesh {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return MESHES[h % MESHES.length];
}

// ── Touches ──────────────────────────────────────────────────────────────────

export type RichTouchKind = "quote" | "case" | "invoice" | "contract" | "account";
export type RichTouch = { id: string; kind: RichTouchKind; title: string; detail: string; when: string; days: number; tone: AccountStoryEvent["tone"]; href: string };

const kindOf = (id: string): RichTouchKind => {
  const k = id.split(":")[0];
  return k === "quote" || k === "case" || k === "invoice" || k === "contract" ? k : "account";
};

/** The latest real events, newest first. Anything dated in the future (a contract that starts next month) is not a touch yet. */
export function latestTouches(events: AccountStoryEvent[], limit = 5, now = Date.now()): RichTouch[] {
  return events
    .filter((e) => new Date(e.date).getTime() <= now)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit)
    .map((e) => {
      const days = daysBetween(e.date, now) ?? 0;
      return { id: e.id, kind: kindOf(e.id), title: e.title, detail: e.detail, when: agoWords(days), days, tone: e.tone, href: e.href };
    });
}

// ── Summary ──────────────────────────────────────────────────────────────────

export type RichSummary = {
  health: Account360Rating;
  /** Null when there are no quotations at all. */
  pipeline: { value: number; openCount: number } | null;
  /** Null when there are no cases at all. */
  openCases: { open: number; aged: number } | null;
  /** Null when nothing is owed. */
  outstanding: { amount: number; overdueCount: number } | null;
  /** The newest real event that is not the account's own creation; null when there is none. */
  lastTouch: RichTouch | null;
};

export function ringToneFor(grade: Account360Rating["grade"]): RingTone {
  return grade === "A" || grade === "B" ? "good" : grade === "C" ? "violet" : "warm";
}

export function buildRichSummary(data: RichRecordData, touches: RichTouch[], now = Date.now()): RichSummary {
  const openQuotes = data.quotes.filter((q) => q.outcome === "open");
  const openCases = data.cases.filter((c) => OPEN_CASE_STATUSES.has(c.status));
  const aged = openCases.filter((c) => (daysBetween(c.intake_at, now) ?? 0) > 30);
  const live = data.invoices.filter((i) => i.status !== "cancelled" && i.status !== "draft");
  const owed = live.reduce((t, i) => t + Math.max(0, (i.total ?? 0) - (i.paid_amount ?? 0)), 0);
  const overdue = live.filter((i) => i.status !== "paid" && i.due_date && new Date(i.due_date).getTime() < now);

  return {
    health: computeAccountHealth({ quotes: data.quotes, cases: data.cases, invoices: data.invoices, contacts: data.contacts }),
    pipeline: data.quotes.length > 0 ? { value: openQuotes.reduce((t, q) => t + (q.total ?? 0), 0), openCount: openQuotes.length } : null,
    openCases: data.cases.length > 0 ? { open: openCases.length, aged: aged.length } : null,
    outstanding: owed > 0 ? { amount: owed, overdueCount: overdue.length } : null,
    lastTouch: touches.find((t) => t.kind !== "account") ?? null,
  };
}

// ── Next best step ───────────────────────────────────────────────────────────

export type RichNextStep = {
  id: string;
  title: string;
  detail: string;
  urgency: "high" | "medium" | "low";
  href?: string;
  /** How many other steps the same rules found (Account 360 lists them). */
  more: number;
};

type Candidate = Omit<RichNextStep, "more">;
const RANK = { high: 0, medium: 1, low: 2 } as const;

export function nextBestStep(accountId: string, data: RichRecordData, cur: CurrencyDef, modules: RichModules, now = Date.now()): RichNextStep | null {
  const money = (n: number) => formatMoney(Math.round(n), cur, {});
  const out: Candidate[] = [];

  const live = data.invoices.filter((i) => i.status !== "cancelled" && i.status !== "draft");
  const overdue = live.filter((i) => i.status !== "paid" && i.due_date && new Date(i.due_date).getTime() < now);
  if (overdue.length > 0) {
    const oldest = overdue.reduce((m, i) => Math.max(m, daysBetween(i.due_date, now) ?? 0), 0);
    out.push({
      id: "chase-overdue",
      title: `Chase ${money(overdue.reduce((t, i) => t + Math.max(0, (i.total ?? 0) - (i.paid_amount ?? 0)), 0))} overdue`,
      detail: `${overdue.length} invoice${overdue.length === 1 ? "" : "s"} past due, the oldest by ${oldest} days.`,
      urgency: "high",
      href: ROUTES.invoice(overdue[0].id),
    });
  }

  const open = data.quotes.filter((q) => q.outcome === "open");
  const stale = open.filter((q) => (daysBetween(q.quote_date ?? q.created_at, now) ?? 0) > 21);
  if (stale.length > 0) {
    out.push({
      id: "stale-quotes",
      title: `Follow up ${stale.length} quotation${stale.length === 1 ? "" : "s"}`,
      detail: `Open for over three weeks with no decision, worth ${money(stale.reduce((t, q) => t + (q.total ?? 0), 0))}.`,
      urgency: "high",
      href: ROUTES.quotation(stale[0].id),
    });
  }

  const won = data.quotes.filter((q) => q.outcome === "won");
  if (won.length > 0 && data.invoices.length === 0) {
    out.push({
      id: "won-not-invoiced",
      title: "Won work, nothing invoiced",
      detail: `${won.length} won quotation${won.length === 1 ? "" : "s"} worth ${money(won.reduce((t, q) => t + (q.total ?? 0), 0))} with no invoice raised.`,
      urgency: "high",
      href: ROUTES.quotation(won[0].id),
    });
  }

  const aged = data.cases.filter((c) => OPEN_CASE_STATUSES.has(c.status) && (daysBetween(c.intake_at, now) ?? 0) > 30);
  if (aged.length > 0) {
    out.push({
      id: "aged-cases",
      title: `${aged.length} case${aged.length === 1 ? "" : "s"} open over 30 days`,
      detail: "Long-running cases are where a complaint starts.",
      urgency: "medium",
      href: ROUTES.case(aged[0].id),
    });
  }

  if (modules.contacts && data.contacts.length <= 1) {
    out.push({
      id: "single-threaded",
      title: data.contacts.length === 0 ? "Add a contact" : "Add a second contact",
      detail: data.contacts.length === 0 ? "Nobody is attached to this account yet." : "One contact means one person leaving ends the relationship.",
      urgency: data.contacts.length === 0 ? "high" : "medium",
      href: `${ROUTES.contactNew}?account_id=${accountId}`,
    });
  }

  const dated = [
    ...data.quotes.flatMap((q) => [q.created_at, q.closed_at]),
    ...data.cases.flatMap((c) => [c.intake_at, c.closed_at]),
    ...data.invoices.map((i) => i.issued_at ?? i.created_at),
  ].filter(Boolean) as string[];
  const last = dated.length ? dated.reduce((a, b) => (new Date(a).getTime() > new Date(b).getTime() ? a : b)) : null;
  const quiet = daysBetween(last, now);
  if (quiet !== null && quiet > 60 && data.quotes.length > 0) {
    out.push({ id: "gone-quiet", title: `Nothing has happened in ${quiet} days`, detail: "Past the point where a quiet account comes back on its own.", urgency: "medium" });
  }

  const soon = data.contracts
    .filter((ct) => ct.status === "active" && ct.end_date)
    .filter((ct) => {
      const left = new Date(ct.end_date as string).getTime() - now;
      return left >= 0 && left <= 60 * DAY;
    })
    .sort((a, b) => (a.end_date as string).localeCompare(b.end_date as string));
  if (soon.length > 0) {
    out.push({
      id: "contract-renewal",
      title: `${soon.length} contract${soon.length === 1 ? "" : "s"} ending within 60 days`,
      detail: "Renewal talks start before the end date, not after.",
      urgency: "medium",
      href: ROUTES.amc,
    });
  }

  if (out.length === 0) return null;
  const sorted = [...out].sort((a, b) => RANK[a.urgency] - RANK[b.urgency]);
  return { ...sorted[0], more: sorted.length - 1 };
}

/** The one-line reason behind the health ring: the factor that costs the most points against its weight. Null when nothing is lacking. */
export function weakestFactor(health: Account360Rating): { label: string; detail: string } | null {
  const WEIGHT: Record<string, number> = { Recency: 25, "Win rate": 25, Payment: 20, Service: 15, Relationship: 15 };
  let worst: { label: string; detail: string; lost: number } | null = null;
  for (const f of health.factors) {
    const lost = (WEIGHT[f.label] ?? 0) - f.points;
    if (lost > 0 && (!worst || lost > worst.lost)) worst = { label: f.label, detail: f.detail, lost };
  }
  return worst ? { label: worst.label, detail: worst.detail } : null;
}
