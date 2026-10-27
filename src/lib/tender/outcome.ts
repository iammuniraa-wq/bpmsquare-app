// GCC tender deals, slice 4: the outcome facts of a closed tender (docs/design/gcc-tender-deals.md section 15). PURE.
//
// Awarded: the value awarded to us and when. Lost: who won, the winning price, why we lost. No-bid: a note. The loss reason and the
// competitor are the deal's own columns (opportunities.loss_reason / competitor); the other four facts live on opportunity_tenders.

import { LOSS_REASONS, type LossReason } from "@/lib/constants";
import { isDayKey } from "./calls";

export const OUTCOME_STAGES = ["awarded", "bid_lost", "no_bid"] as const;
export type OutcomeStage = (typeof OUTCOME_STAGES)[number];
export const isOutcomeStage = (stage: string): stage is OutcomeStage => (OUTCOME_STAGES as readonly string[]).includes(stage);

export const OUTCOME_LIMITS = { bidderMax: 200, noteMax: 1000, valueMax: 9_999_999_999_999.99 } as const;

export type OutcomeFacts = {
  award_value: number | null;
  winning_bidder: string | null;
  award_date: string | null;
  outcome_note: string | null;
};

/** What the Outcome section is given (built on the server). */
export type OutcomeData = OutcomeFacts & {
  stage: OutcomeStage;
  /** The deal's own columns. */
  competitor: string | null;
  loss_reason: LossReason | null;
  /** Our final submitted total (the latest bid version) and its version number; null when no bid was recorded. */
  our_total: number | null;
  our_version: number | null;
  currency: string | null;
  canEdit: boolean;
  /** 0225 has not been applied yet. */
  pending: boolean;
};

type Parsed = { ok: true; tender: Partial<OutcomeFacts>; deal: { competitor?: string | null; loss_reason?: LossReason } } | { ok: false; error: string };
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * The outcome facts a person typed, checked against the stage the tender is in. Only the fields that belong to that stage are
 * taken (an Awarded tender has no loss reason). For Lost both the loss reason and who won are required: either typed now or
 * already on the deal.
 */
export function parseOutcome(stage: OutcomeStage, body: unknown, existing: { competitor: string | null; loss_reason: string | null; winning_bidder: string | null }): Parsed {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const tender: Partial<OutcomeFacts> = {};
  const deal: { competitor?: string | null; loss_reason?: LossReason } = {};

  if ("outcome_note" in b) {
    const n = text(b.outcome_note);
    if (n.length > OUTCOME_LIMITS.noteMax) return { ok: false, error: `The note is too long (${OUTCOME_LIMITS.noteMax} characters at most)` };
    tender.outcome_note = n || null;
  }
  if (stage === "no_bid") return { ok: true, tender, deal };

  if ("award_value" in b) {
    if (b.award_value === null || b.award_value === "") tender.award_value = null;
    else {
      const n = typeof b.award_value === "number" ? b.award_value : Number(String(b.award_value).replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > OUTCOME_LIMITS.valueMax) return { ok: false, error: "The price must be a number from 0 up" };
      tender.award_value = Math.round(n * 100) / 100;
    }
  }
  if ("award_date" in b) {
    if (b.award_date === null || b.award_date === "") tender.award_date = null;
    else if (!isDayKey(b.award_date)) return { ok: false, error: "The award date must be YYYY-MM-DD" };
    else tender.award_date = b.award_date;
  }
  if (stage === "awarded") return { ok: true, tender, deal };

  // Lost.
  if ("winning_bidder" in b) {
    const w = text(b.winning_bidder);
    if (w.length > OUTCOME_LIMITS.bidderMax) return { ok: false, error: `The name is too long (${OUTCOME_LIMITS.bidderMax} characters at most)` };
    tender.winning_bidder = w || null;
    deal.competitor = w || null;
  }
  if ("loss_reason" in b) {
    if (!(LOSS_REASONS as readonly unknown[]).includes(b.loss_reason)) return { ok: false, error: "Pick a loss reason from the list" };
    deal.loss_reason = b.loss_reason as LossReason;
  }
  const reason = deal.loss_reason ?? ((LOSS_REASONS as readonly string[]).includes(existing.loss_reason ?? "") ? existing.loss_reason : null);
  if (!reason) return { ok: false, error: "Say why the tender was lost" };
  const who = "winning_bidder" in b ? tender.winning_bidder : existing.winning_bidder || existing.competitor;
  if (!who) return { ok: false, error: "Say who won (the competitor)" };
  return { ok: true, tender, deal };
}

export type PriceComparison = { ours: number; theirs: number; diff: number; pct: number | null };

/** Our final submitted total against the winning price. diff = ours - theirs; pct is relative to the winning price. */
export function priceComparison(ours: number | null | undefined, theirs: number | null | undefined): PriceComparison | null {
  if (ours == null || theirs == null || !Number.isFinite(ours) || !Number.isFinite(theirs)) return null;
  const diff = Math.round((ours - theirs) * 100) / 100;
  return { ours, theirs, diff, pct: theirs === 0 ? null : Math.round((diff / theirs) * 10_000) / 100 };
}

/** One short sentence for the comparison: "We were 3.20% above the winning price" / "within it" / "below". */
export function comparisonText(cmp: PriceComparison, what: "winning price" | "awarded price"): string {
  if (cmp.diff === 0) return `Our bid matched the ${what}`;
  const dir = cmp.diff > 0 ? "above" : "below";
  return cmp.pct === null ? `Our bid was ${dir} the ${what}` : `Our bid was ${Math.abs(cmp.pct).toFixed(2)}% ${dir} the ${what}`;
}
