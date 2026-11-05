// Schedules in the workspace's own clock (docs/design/nova-crew-agents.md section 3.3). Pure: the cron passes `now`.
// The slot key is what makes a double cron tick idempotent: dedupe_key = `<agent>|daily|<local day>`.

import type { AgentKey, RunTrigger, ScheduleDef } from "../types";

export type LocalParts = { dayKey: string; hhmm: string; dow: number; hourKey: string };

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Date parts of `now` in an IANA zone (an unknown zone falls back to UTC, like tender/rules dayKey). */
export function localParts(now: Date, timezone: string): LocalParts {
  let zone = timezone;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }); } catch { zone = "UTC"; }
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(now)) p[part.type] = part.value;
  const dayKey = `${p.year}-${p.month}-${p.day}`;
  const hh = p.hour === "24" ? "00" : p.hour;
  return { dayKey, hhmm: `${hh}:${p.minute}`, dow: DOW[p.weekday] ?? 0, hourKey: `${dayKey}T${hh}` };
}

/** Is a schedule's slot due now, and what is its idempotency key? Due = today is an allowed day and the clock has passed the time. */
export function dailySlot(agent: AgentKey, schedule: ScheduleDef, now: Date, timezone: string): { due: boolean; key: string; day: string } {
  const lp = localParts(now, timezone);
  const dayOk = !schedule.days || schedule.days.length === 0 || schedule.days.includes(lp.dow);
  return { due: dayOk && lp.hhmm >= schedule.time, key: `${agent}|daily|${lp.dayKey}`, day: lp.dayKey };
}

export function weeklySlot(agent: AgentKey, schedule: ScheduleDef, now: Date, timezone: string): { due: boolean; key: string; day: string } {
  const lp = localParts(now, timezone);
  const due = schedule.weeklyDay !== undefined && lp.dow === schedule.weeklyDay && lp.hhmm >= "07:00";
  return { due, key: `${agent}|weekly|${lp.dayKey}`, day: lp.dayKey };
}

/** Event wake-ups are debounced to one run per deal per hour. */
export function eventDedupeKey(agent: AgentKey, subjectId: string, now: Date, timezone: string): string {
  return `${agent}|deal:${subjectId}|${localParts(now, timezone).hourKey}`;
}

export function manualDedupeKey(agent: AgentKey, now: Date): string {
  return `${agent}|manual|${now.toISOString().slice(0, 13)}`;
}

export function triggerLabel(trigger: RunTrigger, ref: string | null | undefined): string {
  if (ref) return ref;
  return trigger === "schedule" ? "Daily pass" : trigger === "manual" ? "Run now" : "Something changed";
}

/** A valid HH:MM, else null. */
export function parseTime(v: unknown): string | null {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
}
