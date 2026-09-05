// Shared parsing of the leave-type rule fields (0109, 0112) for create and
// edit. Absent = untouched; null / "" = clear; a number must be sensible.

export type LeaveTypePatch = { monthly_limit?: number | null; paid_days_per_month?: number | null; quota_period?: "year" | "month" };

/** Columns that arrive with 0109/0112 -- a save that fails on one of them
 *  means the migration is pending on this database. */
export const LEAVE_TYPE_NEW_COLUMNS_RE = /monthly_limit|paid_days_per_month|quota_period/;

export function parseLeaveTypeLimits(body: Record<string, unknown>): { patch: LeaveTypePatch } | { error: string } {
  const patch: LeaveTypePatch = {};
  if ("monthly_limit" in body) {
    const v = body.monthly_limit;
    if (v === null || v === "" || v === undefined) patch.monthly_limit = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 31) return { error: "Max a month must be between 0.5 and 31 days, or empty for no cap." };
      patch.monthly_limit = Math.round(n * 2) / 2;
    }
  }
  if ("paid_days_per_month" in body) {
    const v = body.paid_days_per_month;
    if (v === null || v === "" || v === undefined) patch.paid_days_per_month = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 31) return { error: "Paid days a month must be between 0 and 31, or empty for all days paid." };
      patch.paid_days_per_month = Math.round(n * 2) / 2;
    }
  }
  if ("quota_period" in body && body.quota_period !== undefined) {
    if (body.quota_period !== "year" && body.quota_period !== "month") return { error: "Quota period must be year or month." };
    patch.quota_period = body.quota_period;
  }
  return { patch };
}
