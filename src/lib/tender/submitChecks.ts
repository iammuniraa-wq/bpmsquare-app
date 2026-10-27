// What to warn about when someone presses "Submit bid" or "Revise bid" (redesign step 1, docs/design/gcc-tender-deals.md section 21).
// PURE. These are warnings, never blocks: the dialog lists them and the person can always go on, and the server has no new rule. A
// check whose data is not known (the BOQ could not be read, approval is pending its migration) is simply not raised.

import { guaranteeRecorded, type BondStatus } from "./bond";

export type SubmitFacts = {
  /** Lines with no price, or null when it is not known. */
  unpriced: number | null;
  /** Lines whose price is older than the workspace's price validity (config.tender.price_validity_days), or null when not known. */
  stale: number | null;
  priceValidityDays: number;
  /** An approved "go" stands, or null when approval is not available yet (migration 0221 pending). */
  approvedGo: boolean | null;
  guarantee: { amount: number | null; expiry: string | null; status: BondStatus };
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function submitWarnings(f: SubmitFacts): string[] {
  const out: string[] = [];
  if (f.unpriced != null && f.unpriced > 0) out.push(`${plural(f.unpriced, "line has", "lines have")} no price.`);
  if (f.stale != null && f.stale > 0) out.push(`${plural(f.stale, "price is", "prices are")} older than ${f.priceValidityDays} days.`);
  if (f.approvedGo === false) out.push("No approved go decision.");
  const g = { bid_bond_amount: f.guarantee.amount, bid_bond_expiry: f.guarantee.expiry, bond_status: f.guarantee.status };
  if (guaranteeRecorded(g) && f.guarantee.status !== "submitted" && f.guarantee.status !== "released") out.push("The bid guarantee is not yet marked Submitted.");
  return out;
}
