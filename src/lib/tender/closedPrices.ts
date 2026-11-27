// A won, lost or dropped tender keeps the prices it was bid, won and budgeted with: no BOQ price, line rate or deal amount changes
// until the deal is reopened. PURE, so the writers, the routes and the screens share one rule and one wording. Awarding an RFQ is NOT
// a price change: buying out after a win is normal, so the award is recorded and only the write onto the tender is skipped.

export type ClosedTenderOutcome = "won" | "lost" | "dropped";

export function closedOutcome(outcome: string | null | undefined): ClosedTenderOutcome | null {
  return outcome === "won" || outcome === "lost" || outcome === "dropped" ? outcome : null;
}

/** Why a price change is refused (409), or null while the tender is open. */
export function pricesLockText(outcome: string | null | undefined): string | null {
  const o = closedOutcome(outcome);
  return o ? `The tender is ${o}, so its prices cannot be changed. Reopen the deal to change them.` : null;
}

export const pricesKeptText = (o: ClosedTenderOutcome): string => `The tender is ${o}, so its prices were not changed.`;
export const awardKeptText = (o: ClosedTenderOutcome): string => `Award saved. ${pricesKeptText(o)}`;
