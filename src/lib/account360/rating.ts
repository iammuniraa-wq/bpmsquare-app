import type { Account360Factor, Account360Rating } from "./types";

/**
 * The account health score. Deliberately NOT an AI call: a number a rep is
 * asked to act on has to be explainable and identical on every reload, so
 * it's a small weighted rubric that hands back its own working (every
 * factor carries the points it moved and why). AI's job in this drawer is
 * the suggestion text, not the score.
 *
 * Five signals, 100 points total. Each starts at its full weight and loses
 * points for what's actually wrong -- an account with no history sits mid-
 * range rather than scoring perfectly on the strength of having done
 * nothing.
 */

export type RatingSignals = {
  daysSinceActivity: number | null;
  quotesTotal: number;
  quotesWon: number;
  quotesDecided: number;
  openQuoteValue: number;
  invoicedTotal: number;
  outstanding: number;
  overdueCount: number;
  oldestOverdueDays: number;
  openCases: number;
  agedCaseCount: number;
  contactCount: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computeRating(s: RatingSignals): Account360Rating {
  const factors: Account360Factor[] = [];

  // 1. Recency (25) — how long since anything happened at all.
  let recency: number;
  let recencyDetail: string;
  if (s.daysSinceActivity === null) {
    recency = 12;
    recencyDetail = "No recorded activity yet";
  } else if (s.daysSinceActivity <= 14) {
    recency = 25;
    recencyDetail = `Active ${s.daysSinceActivity} day${s.daysSinceActivity === 1 ? "" : "s"} ago`;
  } else if (s.daysSinceActivity <= 45) {
    recency = 18;
    recencyDetail = `Last touch ${s.daysSinceActivity} days ago`;
  } else if (s.daysSinceActivity <= 90) {
    recency = 10;
    recencyDetail = `Quiet for ${s.daysSinceActivity} days`;
  } else {
    recency = 2;
    recencyDetail = `Silent for ${s.daysSinceActivity} days`;
  }
  factors.push({ label: "Recency", points: recency, detail: recencyDetail });

  // 2. Win rate (25) — decided quotes only; an account with none is neutral.
  let win: number;
  let winDetail: string;
  if (s.quotesDecided === 0) {
    win = 13;
    winDetail = s.quotesTotal > 0 ? `${s.quotesTotal} quote(s), none decided yet` : "No quotes yet";
  } else {
    const rate = s.quotesWon / s.quotesDecided;
    win = Math.round(clamp(rate, 0, 1) * 25);
    winDetail = `${s.quotesWon} of ${s.quotesDecided} decided quotes won (${Math.round(rate * 100)}%)`;
  }
  factors.push({ label: "Win rate", points: win, detail: winDetail });

  // 3. Payment behaviour (20) — overdue is the single loudest bad signal.
  let pay = 20;
  let payDetail = "Nothing overdue";
  if (s.overdueCount > 0) {
    pay = clamp(20 - s.overdueCount * 5 - Math.floor(s.oldestOverdueDays / 30) * 4, 0, 20);
    payDetail = `${s.overdueCount} overdue invoice${s.overdueCount === 1 ? "" : "s"}, oldest ${s.oldestOverdueDays} days past due`;
  } else if (s.outstanding > 0) {
    pay = 16;
    payDetail = "Outstanding balance, none past due";
  } else if (s.invoicedTotal === 0) {
    pay = 10;
    payDetail = "Never invoiced";
  }
  factors.push({ label: "Payment", points: pay, detail: payDetail });

  // 4. Service load (15) — open cases are fine; cases that have aged aren't.
  let service = 15;
  let serviceDetail = s.openCases === 0 ? "No open cases" : `${s.openCases} open case${s.openCases === 1 ? "" : "s"}, all moving`;
  if (s.agedCaseCount > 0) {
    service = clamp(15 - s.agedCaseCount * 5, 0, 15);
    serviceDetail = `${s.agedCaseCount} case${s.agedCaseCount === 1 ? "" : "s"} open over 30 days`;
  }
  factors.push({ label: "Service", points: service, detail: serviceDetail });

  // 5. Relationship depth (15) — single-threaded accounts are fragile.
  let depth: number;
  let depthDetail: string;
  if (s.contactCount === 0) {
    depth = 0;
    depthDetail = "No contacts on file";
  } else if (s.contactCount === 1) {
    depth = 7;
    depthDetail = "Single-threaded — one contact only";
  } else if (s.contactCount === 2) {
    depth = 11;
    depthDetail = "2 contacts";
  } else {
    depth = 15;
    depthDetail = `${s.contactCount} contacts`;
  }
  factors.push({ label: "Relationship", points: depth, detail: depthDetail });

  const score = clamp(Math.round(factors.reduce((t, f) => t + f.points, 0)), 0, 100);
  const grade = score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D";
  const label =
    grade === "A" ? "Healthy" : grade === "B" ? "Steady" : grade === "C" ? "Needs attention" : "At risk";

  return { score, grade, label, factors };
}
