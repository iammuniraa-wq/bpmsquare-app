import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";

type Admin = ReturnType<typeof createAdminSupabase>;

/**
 * Claim/release for the push alerts added in 0124 (break overrun, holiday
 * digest). Same contract as wfm_hours_alerts gives the long-day alert:
 *
 *   claim BEFORE sending, so two overlapping cron runs can't both push;
 *   release when nothing actually reached a device, so the next run retries
 *   instead of the employee being silently skipped for the rest of the window
 *   (most often they simply haven't tapped "Turn on" for push yet).
 *
 * A pending 0124 (42P01) makes claimAlert return false — the alert is skipped
 * entirely rather than sent unclaimed, which would be the one failure mode
 * worse than not sending: a notification repeating every 15 minutes.
 */

export type AlertKind = "break_overrun" | "holiday_week";

export async function claimAlert(
  admin: Admin,
  tenantId: string,
  employeeId: string,
  kind: AlertKind,
  dayKey: string
): Promise<boolean> {
  const { error } = await admin
    .from("wfm_employee_alerts")
    .insert({ tenant_id: tenantId, employee_id: employeeId, kind, day_key: dayKey });
  // 23505 = already alerted for this window; 42P01 = 0124 pending. Both mean
  // "don't send", and neither is an error worth failing the whole cron over.
  return !error;
}

export async function releaseAlert(
  admin: Admin,
  tenantId: string,
  employeeId: string,
  kind: AlertKind,
  dayKey: string
): Promise<void> {
  await admin
    .from("wfm_employee_alerts")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .eq("kind", kind)
    .eq("day_key", dayKey);
}
