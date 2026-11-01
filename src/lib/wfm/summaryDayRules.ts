// The two per-day decisions of the monthly summary that rules by employment type change, extracted so they can be
// tested without a database (docs/design/wfm-rules-by-type.md, section 6). Pure.

import type { ResolvedLeaveRule } from "./typeRules";

/** A weekly off for the person on that day, or the workspace's alternate 2nd Saturday. */
export function weekOffForDay(a: { weekOffDays: number[]; weekday: number; secondSaturday: boolean }): boolean {
  return a.weekOffDays.includes(a.weekday) || a.secondSaturday;
}

/** Whether the person was expected to work: late and absent are only judged on such a day. */
export function expectedToWork(a: {
  hasShift: boolean;
  rosterDayOff: boolean;
  onLeave: boolean;
  holiday: boolean;
  weekOff: boolean;
}): boolean {
  return a.hasShift && !a.rosterDayOff && !a.onLeave && !a.holiday && !a.weekOff;
}

export type LeaveDayEntry = { name: string; category: string; half_day: boolean };

/**
 * Paid-days-per-month applied to one leave day. `withinAllowance` comes from paidWithinMonthlyAllowance over the days
 * the same rule governs; undefined = the day is not in that map. With the workspace rule the name reads "(beyond N paid
 * days this month)" exactly as before; a rule that came from the employment type reads "(unpaid for <Type>)".
 */
export function leaveEntryAfterAllowance(
  entry: LeaveDayEntry,
  rule: ResolvedLeaveRule,
  typeLabel: string,
  withinAllowance: boolean | undefined
): LeaveDayEntry {
  const allowance = rule.paid_days_per_month;
  if (allowance === null) return entry;
  if (entry.category === "paid" && withinAllowance === false) {
    const name = rule.source === "type"
      ? `${entry.name} (unpaid for ${typeLabel})`
      : `${entry.name} (beyond ${allowance} paid day${allowance === 1 ? "" : "s"} this month)`;
    return { ...entry, category: "unpaid", name };
  }
  return entry;
}
