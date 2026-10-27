// GCC tender deals, slice 1b: the life of a bid guarantee (the database still calls it a bond). Pure. Redesign step 1 (docs/design/
// gcc-tender-deals.md section 21): four states a person moves it through -- Requested from the bank, Issued by it, Submitted with the
// bid, Released once the issuer hands it back -- plus "held", the value every row had before migration 0228, which reads as Issued.
// A released guarantee has nothing left to warn about, so the expiry chip and every reminder line that mentions it stop. The amount,
// currency and expiry are slice 1's fields (rules.ts); status, date and person are 0221's; the new states arrive with 0228.

import { dayKey } from "./rules";

export const BOND_STATUSES = ["requested", "issued", "submitted", "held", "released"] as const;
export type BondStatus = (typeof BOND_STATUSES)[number];
export const BOND_STATUS_LABEL: Record<BondStatus, string> = { requested: "Requested", issued: "Issued", submitted: "Submitted", held: "Issued", released: "Released" };
/** The states a person sets by hand. Released is its own deliberate step (confirm, who and when are stamped); held is legacy. */
export const BOND_STEPS = ["requested", "issued", "submitted"] as const;
export type BondStep = (typeof BOND_STEPS)[number];

/** A guarantee that is not released is warned about this many days before its expiry. */
export const BOND_WARN_DAYS = 30;

export type BondFacts = {
  bid_bond_amount: number | null;
  bid_bond_currency: string | null;
  bid_bond_expiry: string | null;
  bond_status: BondStatus;
  bond_released_at: string | null;
};

/** What the status column reads as: a known value as it is, anything else (a pending migration, an odd value) as the legacy "held". */
export const parseBondStatus = (v: unknown): BondStatus => ((BOND_STATUSES as readonly unknown[]).includes(v) ? (v as BondStatus) : "held");

/**
 * Is there a guarantee to talk about? Money or an expiry recorded, or someone has moved it past "Requested". A bare "Requested" or the
 * legacy "held" on a tender nobody entered a guarantee for is the default, not a fact.
 */
export function guaranteeRecorded(b: Pick<BondFacts, "bid_bond_amount" | "bid_bond_expiry" | "bond_status">): boolean {
  return b.bid_bond_amount != null || !!b.bid_bond_expiry || b.bond_status === "issued" || b.bond_status === "submitted" || b.bond_status === "released";
}

export type BondTone = "none" | "ok" | "amber" | "red";
export type BondState = { tone: BondTone; label: string; days: number | null };

const DAY_MS = 86_400_000;

/** Whole days from today (workspace timezone) to the guarantee's expiry date; negative once it has passed. */
export function daysToExpiry(expiry: string | null | undefined, now: Date, timezone: string): number | null {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const a = Date.parse(expiry);
  const b = Date.parse(dayKey(now, timezone));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / DAY_MS);
}

/**
 * The chip for the guarantee. The label is the state in words ("Issued"); once an unreleased guarantee is within 30 days of its expiry
 * the label adds when ("Issued, expires in 12 days") and the tone turns amber, red once it has expired. "Requested" is amber on its own:
 * the bank has not issued it yet.
 */
export function bondState(b: Pick<BondFacts, "bid_bond_amount" | "bid_bond_expiry" | "bond_status">, now: Date, timezone: string): BondState {
  if (!guaranteeRecorded(b)) return { tone: "none", label: "No guarantee recorded", days: null };
  if (b.bond_status === "released") return { tone: "ok", label: "Released", days: null };
  const word = BOND_STATUS_LABEL[b.bond_status];
  const days = daysToExpiry(b.bid_bond_expiry, now, timezone);
  const base: BondTone = b.bond_status === "requested" ? "amber" : "ok";
  if (days === null) return { tone: base, label: word, days };
  if (days < 0) return { tone: "red", label: `${word}, ${days === -1 ? "expired yesterday" : `expired ${-days} days ago`}`, days };
  if (days === 0) return { tone: "red", label: `${word}, expires today`, days };
  if (days <= BOND_WARN_DAYS) return { tone: "amber", label: `${word}, ${days === 1 ? "expires tomorrow" : `expires in ${days} days`}`, days };
  return { tone: base, label: word, days };
}

/** The guarantee line a reminder may carry, or null: nothing to say once it is released or when no amount is recorded. */
export function bondReminderLine(b: Pick<BondFacts, "bid_bond_amount" | "bid_bond_currency" | "bid_bond_expiry" | "bond_status">): string | null {
  if (b.bond_status === "released" || b.bid_bond_amount == null) return null;
  const amount = `${b.bid_bond_currency ?? ""} ${b.bid_bond_amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
  return b.bid_bond_expiry ? `Bid guarantee: ${amount}, valid to ${b.bid_bond_expiry}` : `Bid guarantee: ${amount}`;
}
