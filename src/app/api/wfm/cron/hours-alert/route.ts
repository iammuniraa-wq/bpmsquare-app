import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig } from "@/lib/wfm/server";
import { shiftDayKey, workSessions } from "@/lib/wfm/hours";
import { sendToEmployee, pushConfigured } from "@/lib/wfm/push";
import type { PresenceKind } from "@/lib/wfm/types";

// GET /api/wfm/cron/hours-alert — Vercel cron (vercel.json), every 15 min.
//
// Tells an employee, on their own phone, that they have passed the tenant's
// worked-hours threshold and should punch out. Client request (BIM,
// 2026-09-04): the alert must reach the EMPLOYEE, not a supervisor.
//
// Worked minutes are computed with the same workSessions() the timesheet and
// the monthly summary use -- the sum of a day's sessions, net of breaks per
// the tenant's own deduct_breaks setting. If the two ever disagreed, the
// alert would be arguing with the payslip.
//
// Deliberately narrow, all three noted rather than silent:
//   - only people currently checked IN are considered; someone who already
//     punched out needs no reminder.
//   - someone whose last punch was an OT kind is skipped: they are on
//     approved overtime, and telling them to go home would be wrong.
//   - one alert per employee per SHIFT-DAY (wfm_hours_alerts), so a job that
//     runs four times an hour does not buzz the same phone four times.

const LOOKBACK_HOURS = 36;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!pushConfigured()) {
    // Not an error: a deployment without VAPID keys simply has no push.
    return NextResponse.json({ skipped: "push not configured" });
  }

  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug")
    .contains("features", { wfm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const results: { tenant: string; alerted: number }[] = [];

  for (const tenant of tenants ?? []) {
    const config = await getWfmConfig(admin, tenant.id as string);
    const alert = config.long_day_alert;
    if (!alert?.enabled || !(alert.after_hours > 0)) continue;

    const thresholdMinutes = alert.after_hours * 60;

    const [{ data: employees }, { data: shifts }, { data: events }] = await Promise.all([
      admin
        .from("employees")
        .select("id, first_name, last_name, shift_id")
        .eq("tenant_id", tenant.id)
        .eq("status", "active"),
      admin.from("wfm_shifts").select("id, start_time, crosses_midnight").eq("tenant_id", tenant.id),
      admin
        .from("wfm_presence_events")
        .select("employee_id, kind, ts")
        .eq("tenant_id", tenant.id)
        .is("superseded_by", null)
        .gte("ts", new Date(now.getTime() - LOOKBACK_HOURS * 3600_000).toISOString())
        .order("ts", { ascending: true }),
    ]);

    const shiftById = new Map((shifts ?? []).map((s) => [s.id as string, s]));
    const byEmployee = new Map<string, { kind: PresenceKind; ts: string }[]>();
    for (const e of events ?? []) {
      const id = e.employee_id as string;
      byEmployee.set(id, [...(byEmployee.get(id) ?? []), { kind: e.kind as PresenceKind, ts: e.ts as string }]);
    }

    let alerted = 0;

    for (const emp of employees ?? []) {
      const evs = byEmployee.get(emp.id as string);
      if (!evs || evs.length === 0) continue;

      const shift = emp.shift_id ? shiftById.get(emp.shift_id as string) : null;
      const dayKey = shiftDayKey(now, config.timezone, shift ?? null);
      const today = evs.filter((e) => shiftDayKey(new Date(e.ts), config.timezone, shift ?? null) === dayKey);
      if (today.length === 0) continue;

      // Still on the clock? A closed day, or one that ended on an OT punch,
      // is not something to interrupt.
      const last = today[today.length - 1];
      if (last.kind === "check_out" || last.kind === "mobile_work_end" || last.kind === "business_trip_end") continue;
      if (last.kind === "ot_in" || last.kind === "ot_out") continue;

      const sessions = workSessions(today, now);
      if (sessions.length === 0) continue;
      const gross = sessions.reduce((t, s) => t + s.gross_minutes, 0);
      const breaks = sessions.reduce((t, s) => t + s.break_minutes, 0);
      const worked = config.deduct_breaks ? gross - breaks : gross;
      if (worked < thresholdMinutes) continue;

      // The unique index on (tenant_id, employee_id, day_key) is what actually
      // guarantees one alert per day -- claiming the row BEFORE sending means
      // two overlapping cron runs can't both push.
      const { error: claimErr } = await admin
        .from("wfm_hours_alerts")
        .insert({
          tenant_id: tenant.id,
          employee_id: emp.id,
          day_key: dayKey,
          worked_minutes: Math.round(worked),
        });
      if (claimErr) continue; // 23505 = already told them today

      const h = Math.floor(worked / 60);
      const m = Math.round(worked % 60);
      const sent = await sendToEmployee(admin, tenant.id as string, emp.id as string, {
        title: "Time to punch out",
        body: `You have worked ${h}h ${String(m).padStart(2, "0")}m today. Please punch out when you finish.`,
        url: "/wfm/me",
        tag: `long-day-${dayKey}`,
      });
      if (sent > 0) alerted += 1;
    }

    if (alerted > 0) results.push({ tenant: tenant.slug as string, alerted });
  }

  return NextResponse.json({ ok: true, results });
}
