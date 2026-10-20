// Response-time (SLA) arithmetic for a lead that has become ready for sales.
// Pure. "Business days" skip the workspace's weekly-off days.

export const DEFAULT_SLA_BUSINESS_DAYS = 1;
/** Sunday only (0 = Sunday ... 6 = Saturday). A Gulf workspace sets Friday and Saturday. */
export const DEFAULT_WEEKLY_OFF: readonly number[] = [0];

const DAY_MS = 86_400_000;

/** `from` plus `days` working days, keeping the time of day. Never lands on a weekly-off day. */
export function addBusinessDays(from: Date, days: number, weeklyOff: readonly number[] = DEFAULT_WEEKLY_OFF): Date {
  const off = new Set(weeklyOff.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  // Seven days off would never terminate; treat that as "no days off".
  const skip = off.size >= 7 ? new Set<number>() : off;
  const d = new Date(from.getTime());
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    d.setTime(d.getTime() + DAY_MS);
    if (!skip.has(d.getUTCDay())) left--;
  }
  while (skip.has(d.getUTCDay())) d.setTime(d.getTime() + DAY_MS);
  return d;
}

export type LeadSla = { sla_business_days?: number; weekly_off?: number[] } | undefined;

export function slaDueFrom(enteredReady: Date, sla: LeadSla): Date {
  const days = typeof sla?.sla_business_days === "number" && sla.sla_business_days >= 0 ? sla.sla_business_days : DEFAULT_SLA_BUSINESS_DAYS;
  return addBusinessDays(enteredReady, days, Array.isArray(sla?.weekly_off) ? sla.weekly_off : DEFAULT_WEEKLY_OFF);
}

/** A lead is overdue while it still waits for a salesperson (stage "ready") and its time has passed. */
export function isLeadOverdue(stage: string, slaDueAt: string | null | undefined, now: Date = new Date()): boolean {
  if (stage !== "ready" || !slaDueAt) return false;
  const t = Date.parse(slaDueAt);
  return Number.isFinite(t) && t < now.getTime();
}

/** "due in 5 hours" or "2 days overdue", for a chip. */
export function describeDue(slaDueAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!slaDueAt) return null;
  const t = Date.parse(slaDueAt);
  if (!Number.isFinite(t)) return null;
  const diff = t - now.getTime();
  const hours = Math.round(Math.abs(diff) / 3_600_000);
  const span = hours < 1 ? "under an hour" : hours < 48 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${Math.round(hours / 24)} days`;
  return diff >= 0 ? `due in ${span}` : `${span} overdue`;
}
