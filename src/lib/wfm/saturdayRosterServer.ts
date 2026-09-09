import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";
import { saturdaysInMonth } from "./saturdayRule";

type Admin = ReturnType<typeof createAdminSupabase>;

export type SaturdayRosterResult = {
  month: string;
  holiday_created: boolean;
  roster_rows_created: number;
  roster_rows_skipped: number;
};

/**
 * Materializes the Saturday rule for one calendar month as ORDINARY data: a
 * wfm_holidays row for the 2nd Saturday, and a wfm_roster_assignments row
 * (on `shortShiftId`) for every other Saturday, for every active employee.
 *
 * Additive only -- never touches a row that already exists for that
 * employee+date (a supervisor's own override always wins), and safe to call
 * twice for the same month (the cron and the Roster page's manual button
 * can overlap without duplicating anything).
 */
export async function generateSaturdayRoster(
  admin: Admin,
  tenantId: string,
  yearMonth: string,
  timezone: string,
  shortShiftId: string
): Promise<SaturdayRosterResult> {
  const saturdays = saturdaysInMonth(yearMonth, timezone);
  const result: SaturdayRosterResult = {
    month: yearMonth, holiday_created: false, roster_rows_created: 0, roster_rows_skipped: 0,
  };

  const secondSaturday = saturdays.find((s) => s.nth === 2);
  if (secondSaturday) {
    const { error } = await admin.from("wfm_holidays").insert({
      tenant_id: tenantId, date: secondSaturday.date, name: "2nd Saturday", applies_to: "all",
    });
    // 23505 = a holiday for that date+audience already exists (a manual
    // entry, or this generator already ran) -- not a failure, just done.
    result.holiday_created = !error;
  }

  const shortSaturdays = saturdays.filter((s) => s.nth !== 2);
  if (shortSaturdays.length === 0) return result;

  const { data: employees } = await admin
    .from("employees").select("id").eq("tenant_id", tenantId).eq("status", "active");
  const employeeIds = (employees ?? []).map((e) => e.id as string);
  if (employeeIds.length === 0) return result;

  const { data: existing } = await admin
    .from("wfm_roster_assignments")
    .select("employee_id, date")
    .eq("tenant_id", tenantId)
    .in("employee_id", employeeIds)
    .in("date", shortSaturdays.map((s) => s.date));
  const already = new Set((existing ?? []).map((r) => `${r.employee_id}|${r.date}`));

  const toInsert: Record<string, unknown>[] = [];
  for (const employeeId of employeeIds) {
    for (const sat of shortSaturdays) {
      if (already.has(`${employeeId}|${sat.date}`)) { result.roster_rows_skipped += 1; continue; }
      toInsert.push({
        tenant_id: tenantId, employee_id: employeeId, date: sat.date,
        shift_id: shortShiftId, is_day_off: false,
        note: "Auto-rostered: alternate Saturday (short day)",
      });
    }
  }
  if (toInsert.length === 0) return result;

  // ignoreDuplicates rather than a plain insert: two overlapping calls (the
  // cron and someone clicking the manual button at the same moment) would
  // otherwise fail the WHOLE batch on the first row either one already wrote.
  const { data, error } = await admin
    .from("wfm_roster_assignments")
    .upsert(toInsert, { onConflict: "tenant_id,employee_id,date", ignoreDuplicates: true })
    .select("id");
  if (!error) result.roster_rows_created = data?.length ?? 0;
  return result;
}
