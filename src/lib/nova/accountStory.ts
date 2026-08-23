import type { Contract, Invoice, Quote, ServiceCase } from "@/lib/types";
import { computeRating, type RatingSignals } from "@/lib/account360/rating";
import type { Account360Rating } from "@/lib/account360/types";
import { ROUTES } from "@/lib/constants";

/**
 * Nova's Account story timeline -- a REAL chronological event list built
 * from the exact same records the account hub page already fetches
 * (hub.quotes/cases/invoices/contracts), not the design prototype's
 * fictional "usage dropped 38%" / "champion left" narrative beats. No
 * historical health curve is shown -- Account 360's rating (rating.ts) is
 * computed live from current state, not stored per-day, so a trend line
 * would be fabricated. Health is shown as a single current reading instead.
 */

export type AccountStoryEvent = {
  id: string;
  date: string;
  title: string;
  detail: string;
  tone: "good" | "bad" | "neutral";
  href: string;
};

// Mirrors account360/server.ts's own OPEN_CASE_STATUSES -- duplicated
// rather than imported since that module doesn't export it and this stays
// a small, stable list unlikely to drift silently out of sync.
const OPEN_CASE_STATUSES = new Set([
  "intake", "inspection", "report_sent", "report_approved",
  "quote_sent", "quote_approved", "in_repair", "qa", "ready",
]);

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined): number | null =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : null;
const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function buildAccountStoryEvents(input: {
  accountId: string;
  accountCreatedAt: string;
  quotes: Pick<Quote, "id" | "ref" | "total" | "created_at" | "closed_at" | "outcome">[];
  cases: Pick<ServiceCase, "id" | "ref" | "intake_at" | "closed_at">[];
  invoices: Pick<Invoice, "id" | "ref" | "total" | "paid_amount" | "issued_at" | "created_at">[];
  contracts: Pick<Contract, "id" | "ref" | "start_date" | "end_date" | "status">[];
}): AccountStoryEvent[] {
  const events: AccountStoryEvent[] = [];

  events.push({
    id: "account:created",
    date: input.accountCreatedAt,
    title: "Account created",
    detail: "First recorded",
    tone: "neutral",
    href: ROUTES.account(input.accountId),
  });

  for (const q of input.quotes) {
    events.push({
      id: `quote:${q.id}:created`,
      date: q.created_at,
      title: `Quote ${q.ref} sent`,
      detail: money(q.total),
      tone: "neutral",
      href: ROUTES.quotation(q.id),
    });
    if (q.closed_at && (q.outcome === "won" || q.outcome === "lost" || q.outcome === "dropped")) {
      events.push({
        id: `quote:${q.id}:closed`,
        date: q.closed_at,
        title: `Quote ${q.ref} ${q.outcome}`,
        detail: money(q.total),
        tone: q.outcome === "won" ? "good" : "bad",
        href: ROUTES.quotation(q.id),
      });
    }
  }

  for (const cs of input.cases) {
    events.push({
      id: `case:${cs.id}:opened`,
      date: cs.intake_at,
      title: `Case ${cs.ref} opened`,
      detail: "Service intake",
      tone: "neutral",
      href: ROUTES.case(cs.id),
    });
    if (cs.closed_at) {
      events.push({
        id: `case:${cs.id}:closed`,
        date: cs.closed_at,
        title: `Case ${cs.ref} closed`,
        detail: "Resolved",
        tone: "good",
        href: ROUTES.case(cs.id),
      });
    }
  }

  for (const inv of input.invoices) {
    const issuedAt = inv.issued_at ?? inv.created_at;
    events.push({
      id: `invoice:${inv.id}:issued`,
      date: issuedAt,
      title: `Invoice ${inv.ref} issued`,
      detail: money(inv.total),
      tone: "neutral",
      href: ROUTES.invoice(inv.id),
    });
    if (inv.total > 0 && inv.paid_amount >= inv.total) {
      events.push({
        id: `invoice:${inv.id}:paid`,
        date: issuedAt,
        title: `Invoice ${inv.ref} paid in full`,
        detail: money(inv.paid_amount),
        tone: "good",
        href: ROUTES.invoice(inv.id),
      });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const ct of input.contracts) {
    if (ct.start_date) {
      events.push({
        id: `contract:${ct.id}:started`,
        date: ct.start_date,
        title: `AMC ${ct.ref} started`,
        detail: ct.status === "active" ? "Active coverage" : ct.status,
        tone: ct.status === "active" ? "good" : "neutral",
        href: ROUTES.amc,
      });
    }
    if (ct.end_date && ct.end_date <= today) {
      events.push({
        id: `contract:${ct.id}:ended`,
        date: ct.end_date,
        title: `AMC ${ct.ref} lapsed`,
        detail: "Coverage ended",
        tone: ct.status === "active" ? "bad" : "neutral",
        href: ROUTES.amc,
      });
    }
  }

  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function computeAccountHealth(input: {
  quotes: Pick<Quote, "outcome" | "created_at" | "closed_at" | "total">[];
  cases: Pick<ServiceCase, "status" | "intake_at" | "closed_at">[];
  invoices: Pick<Invoice, "status" | "total" | "paid_amount" | "due_date" | "issued_at" | "created_at">[];
  contacts: unknown[];
}): Account360Rating {
  const wonQuotes = input.quotes.filter((q) => q.outcome === "won");
  const decidedQuotes = input.quotes.filter((q) => q.outcome !== "open");
  const openQuotes = input.quotes.filter((q) => q.outcome === "open");
  const openQuoteValue = openQuotes.reduce((t, q) => t + (q.total ?? 0), 0);

  const liveInvoices = input.invoices.filter((i) => i.status !== "cancelled" && i.status !== "draft");
  const invoicedTotal = liveInvoices.reduce((t, i) => t + (i.total ?? 0), 0);
  const collected = liveInvoices.reduce((t, i) => t + (i.paid_amount ?? 0), 0);
  const outstanding = Math.max(0, invoicedTotal - collected);
  const overdue = liveInvoices.filter((i) => i.status !== "paid" && i.due_date && new Date(i.due_date).getTime() < Date.now());
  const oldestOverdueDays = overdue.reduce((max, i) => Math.max(max, daysSince(i.due_date) ?? 0), 0);

  const openCases = input.cases.filter((c) => OPEN_CASE_STATUSES.has(c.status));
  const agedCases = openCases.filter((c) => (daysSince(c.intake_at) ?? 0) > 30);

  const activityDates = [
    ...input.quotes.map((q) => q.created_at),
    ...input.quotes.map((q) => q.closed_at),
    ...input.cases.map((c) => c.intake_at),
    ...input.cases.map((c) => c.closed_at),
    ...input.invoices.map((i) => i.issued_at ?? i.created_at),
  ].filter(Boolean) as string[];
  const lastActivity = activityDates.length
    ? activityDates.reduce((a, b) => (new Date(a).getTime() > new Date(b).getTime() ? a : b))
    : null;

  const signals: RatingSignals = {
    daysSinceActivity: daysSince(lastActivity),
    quotesTotal: input.quotes.length,
    quotesWon: wonQuotes.length,
    quotesDecided: decidedQuotes.length,
    openQuoteValue,
    invoicedTotal,
    outstanding,
    overdueCount: overdue.length,
    oldestOverdueDays,
    openCases: openCases.length,
    agedCaseCount: agedCases.length,
    contactCount: input.contacts.length,
  };
  return computeRating(signals);
}
