// Shared parsing of the leave-type limit fields (0109) for create and edit.
// Absent = untouched; null / "" = clear; a number must be sensible.

export function parseLeaveTypeLimits(body: Record<string, unknown>): { patch: { monthly_limit?: number | null; paid_days_per_month?: number | null } } | { error: string } {
  const patch: { monthly_limit?: number | null; paid_days_per_month?: number | null } = {};
  if ("monthly_limit" in body) {
    const v = body.monthly_limit;
    if (v === null || v === "" || v === undefined) patch.monthly_limit = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 31) return { error: "Monthly limit must be between 0.5 and 31 days, or empty for no limit." };
      patch.monthly_limit = Math.round(n * 2) / 2;
    }
  }
  if ("paid_days_per_month" in body) {
    const v = body.paid_days_per_month;
    if (v === null || v === "" || v === undefined) patch.paid_days_per_month = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 31) return { error: "Paid days per month must be between 0 and 31, or empty for all days paid." };
      patch.paid_days_per_month = Math.round(n * 2) / 2;
    }
  }
  return { patch };
}
