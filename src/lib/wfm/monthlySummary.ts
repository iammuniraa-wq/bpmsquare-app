import "server-only";

import { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig, dateKeyInTz } from "./server";
import { breakSegments, computeDayHours, shiftDayKey, type BreakSegment } from "./hours";
import type { PresenceKind } from "./types";

// Shared per-employee-per-month aggregation — the one place the "rules
// engine" (§6) actually runs across a whole month, used by BOTH the
// employee's own timesheet (/wfm-app/timesheet) and the admin monthly
// summary + CA Excel export. Built once here rather than duplicated,
// per the same day/late/absent/leave/holiday logic already proven in
// getWfmLiveBoardSnapshot (today-only) -- this generalizes it to a
// full month and adds the monthly aggregates (half-day deductions,
// night-shift cost, leave/holiday counts) that a single day can't show.

export type EmployeeDayRecord = {
  date: string; // YYYY-MM-DD, shift-day
  first_in: string | null;
  last_out: string | null;
  /** Every break the employee actually booked that day, in order — the
   * detail behind break_minutes, for the detailed daily timesheet. */
  breaks: BreakSegment[];
  gross_minutes: number;
  break_minutes: number;
  net_minutes: number;
  late: boolean;
  absent: boolean;
  incomplete: boolean; // a past day with a check-in but no check-out
  on_leave: { name: string; category: string; half_day: boolean } | null;
  holiday: string | null;
  is_night_shift: boolean;
  night_allowance_amount: number;
  is_week_off: boolean;
  punches: number;
};

export type EmployeeMonthSummary = {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  employment_type: "full_time" | "contractor";
  shift_name: string | null;
  site_id: string | null;
  site_name: string | null;
  days: EmployeeDayRecord[];
  totals: {
    days_present: number;
    working_minutes: number; // net or gross per config.deduct_breaks
    late_marks: number;
    half_day_deductions: number;
    paid_leave_days: number;
    unpaid_leave_days: number;
    holiday_days: number;
    night_shifts: number;
    night_allowance_total: number;
    incomplete_days: number;
  };
};

function daysInMonth(yearMonth: string): string[] {
  const [y, m] = yearMonth.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${yearMonth}-${String(i + 1).padStart(2, "0")}`);
}

function weekdayIndex(dateKey: string, timezone: string): number {
  const noon = new Date(`${dateKey}T12:00:00Z`); // safely mid-day, no DST/offset edge case
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(noon);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/**
 * Per-employee, per-day rules-engine pass for one calendar month. Pass
 * `employeeIds` to scope to specific employees (e.g. the calling
 * employee's own timesheet); omit for every active employee (the admin
 * monthly summary).
 */
export async function getMonthlySummary(
  tenantId: string,
  yearMonth: string,
  employeeIds?: string[]
): Promise<EmployeeMonthSummary[]> {
  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);
  const dates = daysInMonth(yearMonth);
  const todayKey = dateKeyInTz(new Date(), config.timezone);

  let employeeQuery = admin
    .from("employees")
    .select("id, employee_code, first_name, last_name, employment_type, shift_id, site_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  if (employeeIds && employeeIds.length > 0) employeeQuery = employeeQuery.in("id", employeeIds);

  const [{ data: employees }, { data: sites }, { data: shifts }, { data: holidays }, { data: leaves }] = await Promise.all([
    employeeQuery,
    admin.from("wfm_sites").select("id, name").eq("tenant_id", tenantId),
    admin.from("wfm_shifts").select("*").eq("tenant_id", tenantId),
    admin.from("wfm_holidays").select("date, name, applies_to").eq("tenant_id", tenantId)
      .gte("date", dates[0]).lte("date", dates[dates.length - 1]),
    admin.from("wfm_leave_records")
      .select("employee_id, date_from, date_to, half_day, wfm_leave_types(name, category)")
      .eq("tenant_id", tenantId)
      .lte("date_from", dates[dates.length - 1])
      .gte("date_to", dates[0]),
  ]);

  const employeeRows = employees ?? [];
  if (employeeRows.length === 0) return [];

  const shiftById = new Map((shifts ?? []).map((s) => [s.id, s]));
  const siteById = new Map((sites ?? []).map((s) => [s.id, s.name as string]));

  // Fetch presence events with 24h padding on each side of the month so
  // night-shift boundary days (last day of prev month, first of next) can
  // still resolve to their correct shift-day.
  const windowStart = new Date(`${dates[0]}T00:00:00Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - 1);
  const windowEnd = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 2);

  const { data: events } = await admin
    .from("wfm_presence_events")
    .select("employee_id, kind, ts")
    .eq("tenant_id", tenantId)
    .in("employee_id", employeeRows.map((e) => e.id))
    .is("superseded_by", null)
    .gte("ts", windowStart.toISOString())
    .lt("ts", windowEnd.toISOString())
    .order("ts", { ascending: true });

  const eventsByEmp = new Map<string, { kind: PresenceKind; ts: string }[]>();
  for (const e of events ?? []) {
    const key = e.employee_id as string;
    if (!eventsByEmp.has(key)) eventsByEmp.set(key, []);
    eventsByEmp.get(key)!.push({ kind: e.kind as PresenceKind, ts: e.ts as string });
  }

  const leaveByEmpDay = new Map<string, { name: string; category: string; half_day: boolean }>();
  for (const l of leaves ?? []) {
    const type = Array.isArray(l.wfm_leave_types) ? l.wfm_leave_types[0] : l.wfm_leave_types;
    let d = l.date_from;
    while (d <= l.date_to) {
      leaveByEmpDay.set(`${l.employee_id}|${d}`, {
        name: (type?.name as string) ?? "Leave",
        category: (type?.category as string) ?? "paid",
        half_day: l.half_day,
      });
      const next = new Date(d + "T00:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      d = next.toISOString().slice(0, 10);
    }
  }

  const weekdayCache = new Map<string, number>();
  const weekdayOf = (d: string) => {
    if (!weekdayCache.has(d)) weekdayCache.set(d, weekdayIndex(d, config.timezone));
    return weekdayCache.get(d)!;
  };

  return employeeRows.map((emp) => {
    const shift = emp.shift_id ? shiftById.get(emp.shift_id) : null;
    const allEvents = eventsByEmp.get(emp.id) ?? [];

    const days: EmployeeDayRecord[] = dates.map((date) => {
      const dayEvents = allEvents.filter((e) => shiftDayKey(new Date(e.ts), config.timezone, shift) === date);
      const endRef = dayEvents.length > 0 ? new Date(dayEvents[dayEvents.length - 1].ts) : new Date(`${date}T00:00:00Z`);
      const hours = computeDayHours(dayEvents, endRef);
      const breaks = breakSegments(dayEvents, endRef);
      const firstIn = dayEvents.find((e) => e.kind === "check_in") ?? null;
      const lastOut = [...dayEvents].reverse().find((e) => e.kind === "check_out") ?? null;

      const onLeave = leaveByEmpDay.get(`${emp.id}|${date}`) ?? null;
      const holiday = (holidays ?? []).find(
        (h) => h.date === date && (h.applies_to === "all" || h.applies_to === emp.employment_type)
      );
      const isWeekOff = config.week_off_days.includes(weekdayOf(date));

      let late = false;
      let absent = false;
      if (shift && !onLeave && !holiday && !isWeekOff) {
        // Compare local wall-clock time-of-day strings (minutes-of-day)
        // rather than doing UTC offset arithmetic -- avoids DST/offset
        // edge cases entirely.
        if (firstIn) {
          const inLocal = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(firstIn.ts));
          const [gh, gm] = shift.start_time.slice(0, 5).split(":").map(Number);
          const graceMinutesOfDay = gh * 60 + gm + shift.grace_minutes;
          const [ih, im] = inLocal.split(":").map(Number);
          late = ih * 60 + im > graceMinutesOfDay;
        } else if (date < todayKey) {
          absent = true;
        } else if (date === todayKey) {
          const nowLocal = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
          const [gh, gm] = shift.start_time.slice(0, 5).split(":").map(Number);
          const graceMinutesOfDay = gh * 60 + gm + shift.grace_minutes;
          const [nh, nm] = nowLocal.split(":").map(Number);
          absent = nh * 60 + nm > graceMinutesOfDay;
        }
      }

      const incomplete = hours.open && date < todayKey;

      return {
        date,
        first_in: firstIn?.ts ?? null,
        last_out: lastOut?.ts ?? null,
        breaks,
        gross_minutes: hours.gross_minutes,
        break_minutes: hours.break_minutes,
        net_minutes: hours.net_minutes,
        late,
        absent,
        incomplete,
        on_leave: onLeave,
        holiday: holiday?.name ?? null,
        is_night_shift: shift?.is_night_shift ?? false,
        night_allowance_amount: shift?.night_allowance_amount ?? 0,
        is_week_off: isWeekOff,
        punches: dayEvents.length,
      };
    });

    const workingDays = days.filter((d) => !d.incomplete);
    const lateMarks = days.filter((d) => d.late).length;

    return {
      employee_id: emp.id,
      employee_code: emp.employee_code,
      full_name: [emp.first_name, emp.last_name].filter(Boolean).join(" "),
      employment_type: emp.employment_type,
      shift_name: shift?.name ?? null,
      site_id: emp.site_id ?? null,
      site_name: emp.site_id ? (siteById.get(emp.site_id) ?? null) : null,
      days,
      totals: {
        days_present: days.filter((d) => d.punches > 0).length,
        working_minutes: workingDays.reduce((s, d) => s + (config.deduct_breaks ? d.net_minutes : d.gross_minutes), 0),
        late_marks: lateMarks,
        half_day_deductions: Math.floor(lateMarks / Math.max(1, config.late_marks_per_half_day)),
        paid_leave_days: days.filter((d) => d.on_leave?.category === "paid").length,
        unpaid_leave_days: days.filter((d) => d.on_leave?.category === "unpaid").length,
        holiday_days: days.filter((d) => d.holiday).length,
        night_shifts: days.filter((d) => d.is_night_shift && d.punches > 0).length,
        night_allowance_total: days
          .filter((d) => d.is_night_shift && d.punches > 0)
          .reduce((s, d) => s + d.night_allowance_amount, 0),
        incomplete_days: days.filter((d) => d.incomplete).length,
      },
    };
  });
}

/** Annual leave balance per type: this employee's override quota (or the
 * tenant default) minus days already taken this calendar year. */
export async function getLeaveBalance(tenantId: string, employeeId: string, year: number) {
  const admin = createAdminSupabase();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [{ data: types }, { data: quotas }, { data: leaves }] = await Promise.all([
    admin.from("wfm_leave_types").select("id, name, category").eq("tenant_id", tenantId).eq("active", true),
    admin.from("wfm_leave_quotas").select("leave_type_id, employee_id, annual_quota").eq("tenant_id", tenantId),
    admin.from("wfm_leave_records").select("leave_type_id, date_from, date_to, half_day")
      .eq("tenant_id", tenantId).eq("employee_id", employeeId)
      .lte("date_from", yearEnd).gte("date_to", yearStart),
  ]);

  return (types ?? []).map((t) => {
    const override = (quotas ?? []).find((q) => q.leave_type_id === t.id && q.employee_id === employeeId);
    const defaultQuota = (quotas ?? []).find((q) => q.leave_type_id === t.id && !q.employee_id);
    const quota = override?.annual_quota ?? defaultQuota?.annual_quota ?? 0;

    let used = 0;
    for (const l of (leaves ?? []).filter((l) => l.leave_type_id === t.id)) {
      const from = l.date_from < yearStart ? yearStart : l.date_from;
      const to = l.date_to > yearEnd ? yearEnd : l.date_to;
      const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
      used += l.half_day ? days * 0.5 : days;
    }

    return { leave_type_id: t.id, name: t.name, category: t.category, quota, used, balance: quota - used };
  });
}
