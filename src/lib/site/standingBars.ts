// The budget line bar of an expense (design 3c.12: "an expense opens with its budget line bar: budget, committed, posted, recorded, this one"), pure.
// Segments are shares of the budget (or of the largest figure when the line is over budget), so the bar never overflows its box.

export type StandingInput = { budget: number | null; committed: number | null; posted: number | null; recorded_others: number; this_one: number };
export type BarSegment = { key: "posted" | "recorded" | "this"; label: string; amount: number; pct: number };

/** What is used of the line: posted by the ERP, recorded from approved expenses (other than this one), and this expense. Never counted twice. */
export function standingBars(s: StandingInput): { segments: BarSegment[]; scale: number; used: number; over: number; left: number | null } {
  const posted = Math.max(0, s.posted ?? 0);
  const recorded = Math.max(0, s.recorded_others);
  const thisOne = Math.max(0, s.this_one);
  const used = Math.round((posted + recorded + thisOne) * 100) / 100;
  const budget = s.budget !== null && s.budget > 0 ? s.budget : null;
  const scale = Math.max(budget ?? 0, used, s.committed ?? 0, 1);
  const pct = (n: number) => Math.round((n / scale) * 1000) / 10;
  const segments: BarSegment[] = [
    { key: "posted" as const, label: "Posted by the ERP", amount: posted, pct: pct(posted) },
    { key: "recorded" as const, label: "Recorded", amount: recorded, pct: pct(recorded) },
    { key: "this" as const, label: "This expense", amount: thisOne, pct: pct(thisOne) },
  ].filter((x) => x.amount > 0);
  return { segments, scale, used, over: budget !== null && used > budget ? Math.round((used - budget) * 100) / 100 : 0, left: budget === null ? null : Math.round((budget - used) * 100) / 100 };
}
