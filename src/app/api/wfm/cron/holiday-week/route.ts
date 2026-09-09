import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig } from "@/lib/wfm/server";
import { shiftDayKey } from "@/lib/wfm/hours";
import {
  holidayWeekWindow, holidayAppliesTo, holidayDigestBody, holidayDigestTitle,
} from "@/lib/wfm/holidayAlert";
import { claimAlert, releaseAlert } from "@/lib/wfm/employeeAlerts";
import { sendToEmployee, pushConfigured } from "@/lib/wfm/push";

// GET /api/wfm/cron/holiday-week — Vercel cron (vercel.json), Mondays 03:00
// UTC (08:30 in Asia/Kolkata, the timezone every current WFM tenant runs).
//
// Client request (BIM, 2026-09-10): tell employees at the start of the week
// which holidays are coming, on their own phone.
//
// Reads the same wfm_holidays rows the monthly summary and the roster already
// use, so the digest can never announce a day the timesheet won't honour --
// including the 2nd-Saturday holidays the alternate-Saturday generator writes.
// Silent in a week with no holidays: a weekly "nothing this week" push is how
// people turn notifications off.

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!pushConfigured()) {
    return NextResponse.json({ skipped: "push not configured" });
  }

  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug")
    .contains("features", { wfm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const results: { tenant: string; holidays: number; notified: number }[] = [];

  for (const tenant of tenants ?? []) {
    const config = await getWfmConfig(admin, tenant.id as string);
    if (!config.holiday_week_alert?.enabled) continue;

    // Today in the tenant's own timezone. No shift is passed on purpose: a
    // holiday is a calendar day for the whole workspace, not something that
    // shifts with one employee's night roster.
    const todayKey = shiftDayKey(now, config.timezone, null);
    const { from, to } = holidayWeekWindow(todayKey);

    const { data: holidays, error: holErr } = await admin
      .from("wfm_holidays")
      .select("date, name, applies_to")
      .eq("tenant_id", tenant.id)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });
    if (holErr || !holidays || holidays.length === 0) continue;

    const { data: employees } = await admin
      .from("employees")
      .select("id, employment_type")
      .eq("tenant_id", tenant.id)
      .eq("status", "active");

    let notified = 0;

    for (const emp of employees ?? []) {
      // Holidays are per employment type, so two people can get genuinely
      // different digests for the same week -- and somebody whose types are
      // all filtered out gets nothing rather than an empty message.
      const mine = holidays
        .filter((h) => holidayAppliesTo(h.applies_to as string | null, emp.employment_type as string | null))
        .map((h) => ({ date: h.date as string, name: (h.name as string) || "Holiday" }));
      if (mine.length === 0) continue;

      // Claimed on the window's first day, so a re-run (or a retry) in the
      // same week can't send the digest twice.
      const claimed = await claimAlert(admin, tenant.id as string, emp.id as string, "holiday_week", from);
      if (!claimed) continue;

      const sent = await sendToEmployee(admin, tenant.id as string, emp.id as string, {
        title: holidayDigestTitle(mine.length),
        body: holidayDigestBody(mine),
        url: "/wfm/me",
        tag: `holiday-week-${from}`,
      });
      if (sent > 0) notified += 1;
      else await releaseAlert(admin, tenant.id as string, emp.id as string, "holiday_week", from);
    }

    if (notified > 0) {
      results.push({ tenant: tenant.slug as string, holidays: holidays.length, notified });
    }
  }

  return NextResponse.json({ ok: true, results });
}
