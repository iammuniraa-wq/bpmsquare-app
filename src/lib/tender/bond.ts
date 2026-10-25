// GCC tender deals, slice 1b: the life of a bid bond. Pure. A bond is HELD from the day it is recorded until someone
// releases it; a released bond has nothing left to warn about, so the expiry chip and every reminder line that mentions the
// bond stop. The bond's amount, currency and expiry are slice 1's fields (rules.ts); status, date and person are 0221's.

import { dayKey } from "./rules";

export const BOND_STATUSES = ["held", "released"] as const;
export type BondStatus = (typeof BOND_STATUSES)[number];
export const BOND_STATUS_LABEL: Record<BondStatus, string> = { held: "Held", released: "Released" };

/** A held bond is flagged amber this many days before its expiry. */
export const BOND_WARN_DAYS = 30;

export type BondFacts = {
  bid_bond_amount: number | null;
  bid_bond_currency: string | null;
  bid_bond_expiry: string | null;
  bond_status: BondStatus;
  bond_released_at: string | null;
};

/** What the bond column reads as: anything but "released" is held (a pending migration, an odd value). */
export const parseBondStatus = (v: unknown): BondStatus => (v === "released" ? "released" : "held");

export type BondTone = "none" | "ok" | "amber" | "red";
export type BondState = { tone: BondTone; label: string; days: number | null };

const DAY_MS = 86_400_000;

/** Whole days from today (workspace timezone) to the bond's expiry date; negative once it has passed. */
export function daysToExpiry(expiry: string | null | undefined, now: Date, timezone: string): number | null {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const a = Date.parse(expiry);
  const b = Date.parse(dayKey(now, timezone));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / DAY_MS);
}

/** The chip for the bond: released = settled and quiet; held = amber under 30 days to expiry, red once expired. */
export function bondState(b: Pick<BondFacts, "bid_bond_amount" | "bid_bond_expiry" | "bond_status">, now: Date, timezone: string): BondState {
  if (b.bid_bond_amount == null && !b.bid_bond_expiry) return { tone: "none", label: "No bond recorded", days: null };
  if (b.bond_status === "released") return { tone: "ok", label: "Released", days: null };
  const days = daysToExpiry(b.bid_bond_expiry, now, timezone);
  if (days === null) return { tone: "ok", label: "Held", days };
  if (days < 0) return { tone: "red", label: days === -1 ? "Expired yesterday" : `Expired ${-days} days ago`, days };
  if (days === 0) return { tone: "red", label: "Expires today", days };
  if (days <= BOND_WARN_DAYS) return { tone: "amber", label: days === 1 ? "Expires tomorrow" : `Expires in ${days} days`, days };
  return { tone: "ok", label: "Held", days };
}

/** The bond line a reminder may carry, or null: nothing to say once the bond is released or when none is recorded. */
export function bondReminderLine(b: Pick<BondFacts, "bid_bond_amount" | "bid_bond_currency" | "bid_bond_expiry" | "bond_status">): string | null {
  if (b.bond_status === "released" || b.bid_bond_amount == null) return null;
  const amount = `${b.bid_bond_currency ?? ""} ${b.bid_bond_amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
  return b.bid_bond_expiry ? `Bid bond: ${amount}, valid to ${b.bid_bond_expiry}` : `Bid bond: ${amount}`;
}
