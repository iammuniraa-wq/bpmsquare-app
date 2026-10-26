// GCC tender deals, slice 1 (docs/design/gcc-tender-deals.md section 3). Pure rules, no I/O and no server imports, so the
// screens, the routes, the cron job and the tests share one set of stages, thresholds and field checks.
//
// A tender is an ordinary deal (opportunities) plus ONE row in opportunity_tenders. Nothing here touches a standard deal:
// every function takes the tender row (or its absence) as an argument, and a deal with no tender row gets exactly the
// standard stage list back.

import { DEFAULT_TENDER_STAGES, type OpportunityStageDef } from "@/lib/constants";
import { opportunityStages } from "@/lib/sales/opportunity";

export const TENDER_PORTALS = ["ariba", "email", "excel", "other"] as const;
export type TenderPortal = (typeof TENDER_PORTALS)[number];
export const TENDER_PORTAL_LABEL: Record<TenderPortal, string> = { ariba: "Ariba", email: "Email", excel: "Excel", other: "Other" };

export const TENDER_DECISIONS = ["go", "no_go"] as const;
export type TenderDecision = (typeof TENDER_DECISIONS)[number];
export const TENDER_DECISION_LABEL: Record<TenderDecision, string> = { go: "Go", no_go: "No-go" };

/** Days before the closing date on which the owner and team are reminded (0 = the day itself). */
export const TENDER_REMINDER_DAYS = [7, 3, 1, 0] as const;
/** "Closing soon" on the Tenders tab: open tenders closing within this many days. */
export const TENDER_CLOSING_SOON_DAYS = 14;
export const TENDER_CLOSING_SOON_SHOWN = 5;

export type TenderFields = {
  tender_no: string | null;
  issuer_name: string | null;
  issuer_account_id: string | null;
  portal: TenderPortal | null;
  closing_at: string | null;
  bid_bond_amount: number | null;
  bid_bond_currency: string | null;
  bid_bond_expiry: string | null;
  addenda_count: number;
};

/** The stage list tender deals use. Fixed in code for slice 1. */
export function tenderStages(): OpportunityStageDef[] {
  return DEFAULT_TENDER_STAGES;
}

/**
 * The stage list that governs a deal: the tender stages when the deal has a tender row, otherwise exactly what
 * `opportunityStages(config)` returns today. The caller passes `hasTender = false` whenever the flag is off or the
 * table is missing, so a standard deal can never reach the tender list.
 */
export function stagesForDeal(config: Parameters<typeof opportunityStages>[0], hasTender: boolean): OpportunityStageDef[] {
  return hasTender ? tenderStages() : opportunityStages(config);
}

// ── Closing date ────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** yyyy-mm-dd of `at` in an IANA timezone (falls back to UTC for an unknown zone). */
export function dayKey(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Whole calendar days from `now` to the closing moment, both read in the workspace's timezone; negative once it has passed. */
export function daysUntilClosing(closingAt: string | null | undefined, now: Date, timezone: string): number | null {
  if (!closingAt) return null;
  const t = new Date(closingAt);
  if (Number.isNaN(t.getTime())) return null;
  const a = Date.parse(dayKey(t, timezone));
  const b = Date.parse(dayKey(now, timezone));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / DAY_MS);
}

export type ClosingTone = "none" | "ok" | "amber" | "red";
export type ClosingState = { days: number | null; tone: ClosingTone; label: string };

/** Countdown chip: amber under 7 days, red under 2 days or once the date has passed. */
export function closingState(closingAt: string | null | undefined, now: Date, timezone: string): ClosingState {
  const days = daysUntilClosing(closingAt, now, timezone);
  if (days === null) return { days, tone: "none", label: "No bid end date" };
  if (days < 0) return { days, tone: "red", label: days === -1 ? "Bid ended yesterday" : `Bid ended ${-days} days ago` };
  const tone: ClosingTone = days < 2 ? "red" : days < 7 ? "amber" : "ok";
  if (days === 0) return { days, tone, label: "Bid ends today" };
  if (days === 1) return { days, tone, label: "Bid ends tomorrow" };
  return { days, tone, label: `Bid ends in ${days} days` };
}

/** Stages before the bid goes in: only here does the closing date still matter (after Submitted there is nothing left to hurry). */
export const TENDER_PRE_SUBMISSION_STAGES: readonly string[] = ["received", "bid_no_bid", "estimating"];

/** Is the closing date still a deadline for this tender? Reminders and the "Closing soon" list only concern these. */
export function tenderIsLive(deal: { outcome: string; stage: string }, tender: { decision: string | null }): boolean {
  return deal.outcome === "open" && tender.decision !== "no_go" && TENDER_PRE_SUBMISSION_STAGES.includes(deal.stage);
}

/**
 * "Closing soon": the tenders still facing their deadline whose closing date is within `withinDays` days (or already
 * past), soonest first. Overdue ones lead the list, because they are the ones somebody has to act on.
 */
export function closingSoon<T extends { outcome: string; stage: string; tender: { closing_at: string | null; decision: string | null } }>(
  rows: T[], now: Date, timezone: string, withinDays = TENDER_CLOSING_SOON_DAYS,
): (T & { days: number })[] {
  const out: (T & { days: number })[] = [];
  for (const r of rows) {
    if (!tenderIsLive(r, r.tender)) continue;
    const days = daysUntilClosing(r.tender.closing_at, now, timezone);
    if (days === null || days > withinDays) continue;
    out.push({ ...r, days });
  }
  return out.sort((a, b) => Date.parse(a.tender.closing_at as string) - Date.parse(b.tender.closing_at as string));
}

// ── Reminders ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** reminders_sent from the database (jsonb): only the known thresholds, as numbers, without duplicates. */
export function parseSent(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<number>(TENDER_REMINDER_DAYS);
  const numeric = raw.filter((x) => typeof x === "number" || (typeof x === "string" && x.trim() !== ""));
  return [...new Set(numeric.map((x) => Number(x)).filter((n) => known.has(n)))].sort((a, b) => b - a);
}

export type ReminderDecision =
  | { send: false }
  | { send: true; days: number; mark: number[] };

/**
 * Should a closing-date reminder go out now, and which thresholds does it use up?
 * A threshold T is due once the tender is T or fewer days from closing, and it is due only once (reminders_sent). When the
 * job missed a day, or the tender was created with fewer than 7 days left, several thresholds are due together: ONE
 * message goes (it states the real number of days) and all of them are marked, so none repeats. Nothing is sent after the
 * closing day, and nothing before 7 days out.
 */
export function reminderDecision(args: { closingAt: string | null | undefined; now: Date; timezone: string; sent: number[] }): ReminderDecision {
  const days = daysUntilClosing(args.closingAt, args.now, args.timezone);
  if (days === null || days < 0) return { send: false };
  const already = new Set(args.sent);
  const due = TENDER_REMINDER_DAYS.filter((t) => days <= t && !already.has(t));
  if (due.length === 0) return { send: false };
  return { send: true, days, mark: [...due] };
}

/** The wording of one reminder. Plain text; the deal title and issuer are the workspace's own data, never HTML. */
export function reminderMessage(args: { title: string; tenderNo: string | null; issuer: string | null; closingAt: string; days: number; timezone: string; link: string | null; bondLine?: string | null }): { subject: string; text: string } {
  const when = args.days === 0 ? "today" : args.days === 1 ? "tomorrow" : `in ${args.days} days`;
  const what = [args.tenderNo, args.issuer].filter(Boolean).join(" · ") || args.title;
  let at = args.closingAt;
  try {
    at = new Intl.DateTimeFormat("en-GB", { timeZone: args.timezone, weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(args.closingAt));
  } catch { /* keep the ISO text */ }
  const subject = `Bid ends ${when}: ${what}`.slice(0, 200);
  const text = [
    `The bid end date of the tender "${args.title}" is ${when} (${at}).`,
    args.issuer ? `Issuer: ${args.issuer}` : "",
    args.tenderNo ? `Tender no.: ${args.tenderNo}` : "",
    args.bondLine ?? "",
    args.link ? `Open the deal: ${args.link}` : "",
    "You are receiving this because you own this deal or are on its team.",
  ].filter(Boolean).join("\n");
  return { subject, text };
}

// ── The tender block: what a request may set ─────────────────────────────────────────────────────────────────────────

export type ParsedTender = { ok: true; values: Partial<TenderFields> } | { ok: false; error: string };

const clean = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * The fields of the tender block a create or update request may carry, validated and normalised. Only keys that are
 * present are returned (a PATCH leaves the others alone). This is the whole allow-list: decision, who decided and when,
 * the reminders already sent, the source e-mail, the deal type and the tenant are never read from a body here.
 */
export function parseTenderFields(body: Record<string, unknown>): ParsedTender {
  const values: Partial<TenderFields> = {};

  if ("tender_no" in body) {
    const v = clean(body.tender_no, 60);
    if (v === undefined) return { ok: false, error: "tender_no must be text" };
    values.tender_no = v;
  }
  if ("issuer_name" in body) {
    const v = clean(body.issuer_name, 200);
    if (v === undefined) return { ok: false, error: "issuer_name must be text" };
    values.issuer_name = v;
  }
  if ("issuer_account_id" in body) {
    const v = clean(body.issuer_account_id, 64);
    if (v === undefined) return { ok: false, error: "issuer_account_id must be an id" };
    values.issuer_account_id = v;
  }
  if ("portal" in body) {
    const v = body.portal;
    if (v === null || v === "") values.portal = null;
    else if ((TENDER_PORTALS as readonly unknown[]).includes(v)) values.portal = v as TenderPortal;
    else return { ok: false, error: "portal must be ariba, email, excel or other" };
  }
  if ("closing_at" in body) {
    const v = body.closing_at;
    if (v === null || v === "") values.closing_at = null;
    else if (typeof v === "string" && !Number.isNaN(Date.parse(v))) values.closing_at = new Date(v).toISOString();
    else return { ok: false, error: "closing_at must be a date and time" };
  }
  if ("bid_bond_amount" in body) {
    const v = body.bid_bond_amount;
    if (v === null || v === "") values.bid_bond_amount = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 99_999_999_999) return { ok: false, error: "bid_bond_amount must be a positive amount" };
      values.bid_bond_amount = Math.round(n * 100) / 100;
    }
  }
  if ("bid_bond_currency" in body) {
    const v = body.bid_bond_currency;
    if (v === null || v === "") values.bid_bond_currency = null;
    else if (typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim())) values.bid_bond_currency = v.trim().toUpperCase();
    else return { ok: false, error: "bid_bond_currency must be a 3-letter currency code" };
  }
  if ("bid_bond_expiry" in body) {
    const v = body.bid_bond_expiry;
    if (v === null || v === "") values.bid_bond_expiry = null;
    else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) values.bid_bond_expiry = v;
    else return { ok: false, error: "bid_bond_expiry must be YYYY-MM-DD" };
  }
  if ("addenda_count" in body) {
    const n = Number(body.addenda_count);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return { ok: false, error: "addenda_count must be a whole number from 0 to 9999" };
    values.addenda_count = n;
  }
  return { ok: true, values };
}

/** The decision a request may record: go, or no-go with a reason. */
export function parseDecision(body: Record<string, unknown>): { ok: true; decision: TenderDecision; reason: string | null } | { ok: false; error: string } {
  const decision = body.decision;
  if (!(TENDER_DECISIONS as readonly unknown[]).includes(decision)) return { ok: false, error: "decision must be go or no_go" };
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null;
  if (decision === "no_go" && !reason) return { ok: false, error: "Give the reason for a no-go" };
  return { ok: true, decision: decision as TenderDecision, reason };
}

/** A start-of-form title for a tender deal when nobody typed one: "<number> · <issuer>", else the issuing account. */
export function derivedTenderTitle(args: { tenderNo: string | null; issuer: string | null; accountName: string | null }): string {
  const t = [args.tenderNo, args.issuer ?? args.accountName].filter(Boolean).join(" · ");
  return (t || "Tender").slice(0, 200);
}

/** The date part (yyyy-mm-dd, workspace timezone) of a closing moment, or null. Used to keep the deal's expected close in step. */
export function closingDateKey(closingAt: string | null | undefined, timezone: string): string | null {
  if (!closingAt) return null;
  const t = new Date(closingAt);
  return Number.isNaN(t.getTime()) ? null : dayKey(t, timezone);
}
