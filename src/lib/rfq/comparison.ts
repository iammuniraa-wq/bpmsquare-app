// Pure comparison rules for the RFQ "Compare & award" screen and the award route (GCC tender deals, slice 3b). No server
// imports: the screen, the route and the tests all use these functions, so the cell the buyer sees highlighted as the lowest
// valid price is exactly the price the award route holds the "why not the lowest?" question against.

import { landedUnit } from "./rules";
import type { RfqResponseStatus, RfqSupplierStatus } from "./types";

/** A price older than this with no validity date of its own is stale (owner, 2026-10-25: "older than 6 months is not used"). */
export const DEFAULT_STALE_DAYS = 180;

export type ValidityState = "ok" | "expired" | "stale";

/** One recorded award as the screen reads it (the standing award on a line, rfq_line_awards, 0224). */
export type AwardView = {
  id: string;
  rfq_line_id: string;
  rfq_supplier_id: string;
  supplier_id: string;
  response_id: string;
  chosen_by: string | null;
  chosen_by_name?: string | null;
  chosen_at: string;
  reason: string | null;
  not_lowest: boolean;
  landed_unit: number | null;
  lowest_valid_unit: number | null;
  applied_to_deal_at: string | null;
  applied_rate: number | null;
};

export type CompareResponse = {
  id: string;
  rfq_supplier_id: string;
  rfq_line_id: string;
  status: RfqResponseStatus;
  unit_price: number | null;
  fx_rate: number | null;
  currency: string | null;
  lead_time_days: number | null;
  moq: number | null;
  valid_until: string | null;
  note: string | null;
  submitted_at: string;
  is_awarded?: boolean;
  offered_description?: string | null;
};

const DAY = 86_400_000;
const dayMs = (key: string) => Date.parse(`${key.slice(0, 10)}T00:00:00Z`);

/** Whole days from `fromKey` to `toKey` (both YYYY-MM-DD or ISO). Negative when `toKey` is earlier. */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((dayMs(toKey) - dayMs(fromKey)) / DAY);
}

/**
 * Is this answer still usable?
 *  - It names a validity date: expired once today is past it.
 *  - It names none: stale once it is older than `staleDays` (the workspace setting, 180 by default).
 * The day of the validity date itself still counts as valid.
 */
export function responseValidity(r: Pick<CompareResponse, "valid_until" | "submitted_at">, today: string, staleDays: number = DEFAULT_STALE_DAYS): ValidityState {
  if (r.valid_until && /^\d{4}-\d{2}-\d{2}/.test(r.valid_until)) return today.slice(0, 10) > r.valid_until.slice(0, 10) ? "expired" : "ok";
  return daysBetween(r.submitted_at, today) > staleDays ? "stale" : "ok";
}

const priced = (r: CompareResponse): number | null => {
  if (r.status === "no_quote") return null;
  const v = landedUnit(r);
  return v !== null && v > 0 ? v : null;
};

export type LineBest = { id: string; landed: number };

/** Per line: the lowest landed price among answers that are still valid, and the lowest of any (for a line where none is valid). */
export function lowestByLine(responses: CompareResponse[], today: string, staleDays: number = DEFAULT_STALE_DAYS): { valid: Map<string, LineBest>; any: Map<string, LineBest> } {
  const valid = new Map<string, LineBest>();
  const any = new Map<string, LineBest>();
  for (const r of responses) {
    const v = priced(r);
    if (v === null) continue;
    const a = any.get(r.rfq_line_id);
    if (!a || v < a.landed) any.set(r.rfq_line_id, { id: r.id, landed: v });
    if (responseValidity(r, today, staleDays) !== "ok") continue;
    const b = valid.get(r.rfq_line_id);
    if (!b || v < b.landed) valid.set(r.rfq_line_id, { id: r.id, landed: v });
  }
  return { valid, any };
}

export type AwardDecision = {
  landed: number | null;
  /** The lowest valid landed price on the line, or null when no answer on it is valid. */
  lowestValid: number | null;
  /** The chosen answer is not the lowest valid price, so the choice needs a recorded reason. */
  notLowest: boolean;
  /** Why: "higher" than the lowest valid price, or the chosen answer is itself "expired" / "stale" while a valid one exists. */
  why: "higher" | "expired" | "stale" | null;
  validity: ValidityState;
};

/**
 * The rule behind the required reason. A choice is "not the lowest" when the chosen answer
 *  - is dearer than the lowest valid answer on the line, or
 *  - is itself expired or stale while some other answer on the line is still valid.
 * When nothing on the line is valid, the lowest of what exists is the baseline, so choosing it needs no reason and choosing a
 * dearer one does. Ties are not "not lowest". `fxOverride` is the rate the buyer typed for the chosen answer.
 */
export function awardDecision(chosenId: string, lineResponses: CompareResponse[], today: string, staleDays: number = DEFAULT_STALE_DAYS, fxOverride?: number | null): AwardDecision {
  const chosen = lineResponses.find((r) => r.id === chosenId);
  if (!chosen) return { landed: null, lowestValid: null, notLowest: false, why: null, validity: "ok" };
  const adjusted = fxOverride && fxOverride > 0 ? { ...chosen, fx_rate: fxOverride } : chosen;
  const landed = priced(adjusted);
  const validity = responseValidity(chosen, today, staleDays);
  const others = lineResponses.map((r) => (r.id === chosenId ? adjusted : r));
  const { valid, any } = lowestByLine(others, today, staleDays);
  const line = chosen.rfq_line_id;
  const lowestValid = valid.get(line)?.landed ?? null;
  if (landed === null) return { landed, lowestValid, notLowest: false, why: null, validity };
  if (lowestValid !== null) {
    if (validity !== "ok") return { landed, lowestValid, notLowest: true, why: validity, validity };
    return landed > lowestValid ? { landed, lowestValid, notLowest: true, why: "higher", validity } : { landed, lowestValid, notLowest: false, why: null, validity };
  }
  const base = any.get(line)?.landed ?? landed;
  return landed > base ? { landed, lowestValid: null, notLowest: true, why: "higher", validity } : { landed, lowestValid: null, notLowest: false, why: null, validity };
}

export const MIN_REASON_CHARS = 3;
export const MAX_REASON_CHARS = 1000;

/** The reason text from untrusted input: trimmed, capped, null when blank. */
export function cleanReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, MAX_REASON_CHARS);
  return t.length >= MIN_REASON_CHARS ? t : null;
}

/** Quoted lines of one supplier against the lines asked: the "covers N of M lines" chip. */
export function coverage(lineIds: string[], supplierResponses: CompareResponse[]): { quoted: number; total: number } {
  const asked = new Set(lineIds);
  const done = new Set(supplierResponses.filter((r) => asked.has(r.rfq_line_id) && priced(r) !== null).map((r) => r.rfq_line_id));
  return { quoted: done.size, total: asked.size };
}

/** What a supplier's quoted lines add up to in the workspace currency (a line without a quantity counts as 1). */
export function supplierTotal(lines: { id: string; qty: number | null }[], supplierResponses: CompareResponse[]): number {
  const byLine = new Map(supplierResponses.map((r) => [r.rfq_line_id, r]));
  let total = 0;
  for (const l of lines) {
    const r = byLine.get(l.id);
    const v = r ? priced(r) : null;
    if (v !== null) total += v * (l.qty !== null && Number.isFinite(l.qty) && l.qty > 0 ? l.qty : 1);
  }
  return Math.round(total * 100) / 100;
}

/** A foreign-currency answer with no exchange rate typed yet: its landed price is the raw figure, which cannot be compared. */
export function needsFx(r: Pick<CompareResponse, "currency" | "fx_rate">, tenantCurrency: string): boolean {
  if (!r.currency || r.currency.toUpperCase() === tenantCurrency.toUpperCase()) return false;
  return r.fx_rate === null || Number(r.fx_rate) === 1;
}

/** "today", "3 d ago", "5 wk ago", "7 mo ago": how old an answer is. */
export function answerAge(submittedAt: string, today: string): string {
  const d = daysBetween(submittedAt, today);
  if (d <= 0) return "today";
  if (d < 14) return `${d} d ago`;
  if (d < 60) return `${Math.floor(d / 7)} wk ago`;
  return `${Math.floor(d / 30)} mo ago`;
}

export type ChaseInfo = { date: string | null; overdue: boolean };

/**
 * When a supplier who has not answered is chased next: the reminder job writes on the day before and the day after the reply-by
 * date, up to the workspace's reminder limit. No automatic reminder left and the date has passed = overdue (chase by hand).
 */
export function chaseInfo(rs: { reminder_count: number; last_reminded_at: string | null }, respondBy: string | null, maxReminders: number, today: string): ChaseInfo {
  if (!respondBy) return { date: null, overdue: false };
  const lastDay = rs.last_reminded_at ? rs.last_reminded_at.slice(0, 10) : null;
  if ((rs.reminder_count ?? 0) < maxReminders) {
    for (const k of [-1, 1]) {
      const d = new Date(dayMs(respondBy) + k * DAY).toISOString().slice(0, 10);
      if (d >= today.slice(0, 10) && (!lastDay || d > lastDay)) return { date: d, overdue: false };
    }
  }
  return respondBy.slice(0, 10) < today.slice(0, 10) ? { date: respondBy.slice(0, 10), overdue: true } : { date: null, overdue: false };
}

export type CompareSupplier = {
  id: string;
  status: RfqSupplierStatus;
  reminder_count: number;
  last_reminded_at: string | null;
};

export type CompareCell = {
  response: CompareResponse;
  landed: number | null;
  validity: ValidityState;
  lowestValid: boolean;
  lowestAny: boolean;
  needsFx: boolean;
  age: string;
};

export type CompareColumn = {
  supplierId: string;
  answered: boolean;
  declined: boolean;
  waiting: boolean;
  notSent: boolean;
  chase: ChaseInfo | null;
  cover: { quoted: number; total: number };
  total: number;
};

export type Comparison = {
  columns: CompareColumn[];
  /** lineId -> rfq_supplier_id -> cell */
  cells: Map<string, Map<string, CompareCell>>;
};

export function buildComparison(args: {
  lines: { id: string; qty: number | null }[];
  suppliers: CompareSupplier[];
  responses: CompareResponse[];
  today: string;
  staleDays?: number;
  tenantCurrency: string;
  respondBy: string | null;
  maxReminders: number;
}): Comparison {
  const stale = args.staleDays ?? DEFAULT_STALE_DAYS;
  const lineIds = args.lines.map((l) => l.id);
  const { valid, any } = lowestByLine(args.responses, args.today, stale);
  const cells = new Map<string, Map<string, CompareCell>>();
  for (const r of args.responses) {
    const row = cells.get(r.rfq_line_id) ?? new Map<string, CompareCell>();
    row.set(r.rfq_supplier_id, {
      response: r,
      landed: priced(r),
      validity: responseValidity(r, args.today, stale),
      lowestValid: valid.get(r.rfq_line_id)?.id === r.id,
      lowestAny: any.get(r.rfq_line_id)?.id === r.id,
      needsFx: r.status !== "no_quote" && needsFx(r, args.tenantCurrency),
      age: answerAge(r.submitted_at, args.today),
    });
    cells.set(r.rfq_line_id, row);
  }
  const columns = args.suppliers.map((s): CompareColumn => {
    const mine = args.responses.filter((r) => r.rfq_supplier_id === s.id);
    const answered = s.status === "replied" || s.status === "declined" || mine.length > 0;
    const waiting = !answered && (s.status === "sent" || s.status === "viewed" || s.status === "expired");
    return {
      supplierId: s.id,
      answered,
      declined: s.status === "declined" && mine.length === 0,
      waiting,
      notSent: s.status === "pending",
      chase: waiting ? chaseInfo(s, args.respondBy, args.maxReminders, args.today) : null,
      cover: coverage(lineIds, mine),
      total: supplierTotal(args.lines, mine),
    };
  });
  return { columns, cells };
}
