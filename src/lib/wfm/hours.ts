// Pure time-calculation functions (rules engine). No DB, no UI — input is a
// day's non-superseded events sorted ascending by ts, output is minutes.
// Unit-testable per requirements §6.

import type { PresenceEvent } from "./types";

export type DayHours = {
  /** last check_out (or endRef while still in/break) − first check_in */
  gross_minutes: number;
  /** total minutes spent in break_start→break_end intervals (an open break
   * counts up to the end reference) */
  break_minutes: number;
  /** gross − breaks, floored at 0 — the working-hours figure when the
   * tenant's deduct_breaks config is on */
  net_minutes: number;
  /** a check_in exists but no closing check_out yet */
  open: boolean;
};

type Ev = Pick<PresenceEvent, "kind" | "ts">;

/**
 * Compute one day's hours from its events. `endRef` is "now" for a live
 * running total; for a closed day the last check_out wins over it.
 * Decision 2026-08-05 (overrides requirements v1.0 §6): working hours
 * EXCLUDE break time — net = (out − in) − breaks. deduct_breaks in tenant
 * config (default true) selects net vs gross downstream.
 */
export function computeDayHours(events: Ev[], endRef: Date): DayHours {
  const firstIn = events.find((e) => e.kind === "check_in");
  if (!firstIn) return { gross_minutes: 0, break_minutes: 0, net_minutes: 0, open: false };

  const start = new Date(firstIn.ts).getTime();
  const lastOut = [...events].reverse().find(
    (e) => e.kind === "check_out" && new Date(e.ts).getTime() >= start
  );
  const open = !lastOut;
  const end = Math.max(start, lastOut ? new Date(lastOut.ts).getTime() : endRef.getTime());

  let breakMs = 0;
  let openBreak: number | null = null;
  for (const e of events) {
    const t = new Date(e.ts).getTime();
    if (t < start || t > end) continue;
    if (e.kind === "break_start") openBreak = t;
    else if (e.kind === "break_end" && openBreak !== null) {
      breakMs += t - openBreak;
      openBreak = null;
    } else if (e.kind === "check_out") {
      // checking out while on break closes the break at the same instant
      if (openBreak !== null) {
        breakMs += t - openBreak;
        openBreak = null;
      }
    }
  }
  if (openBreak !== null) breakMs += end - openBreak;

  const gross = Math.max(0, Math.round((end - start) / 60000));
  const brk = Math.min(gross, Math.round(breakMs / 60000));
  return { gross_minutes: gross, break_minutes: brk, net_minutes: gross - brk, open };
}

export type BreakSegment = {
  start: string;      // ISO ts of break_start
  end: string | null; // ISO ts of break_end, or null if still open at endRef
  minutes: number;
};

/**
 * The individual break_start→break_end pairs of one day, in order — the
 * detail behind computeDayHours' single `break_minutes` figure, for a
 * timesheet that has to show every break the employee actually booked.
 * Kept separate from computeDayHours rather than folded into its return so
 * that function's shape (and its tests) stay unchanged. Same interval rules
 * as computeDayHours, so the segment minutes always sum to its
 * break_minutes: breaks outside the in→out window are ignored, a check_out
 * closes an open break, and a still-open break runs to `endRef`.
 */
export function breakSegments(events: Ev[], endRef: Date): BreakSegment[] {
  const firstIn = events.find((e) => e.kind === "check_in");
  if (!firstIn) return [];

  const start = new Date(firstIn.ts).getTime();
  const lastOut = [...events].reverse().find(
    (e) => e.kind === "check_out" && new Date(e.ts).getTime() >= start
  );
  const end = Math.max(start, lastOut ? new Date(lastOut.ts).getTime() : endRef.getTime());

  const segments: BreakSegment[] = [];
  let openBreak: number | null = null;
  for (const e of events) {
    const t = new Date(e.ts).getTime();
    if (t < start || t > end) continue;
    if (e.kind === "break_start") {
      openBreak = t;
    } else if (e.kind === "break_end" && openBreak !== null) {
      segments.push({ start: new Date(openBreak).toISOString(), end: e.ts, minutes: Math.round((t - openBreak) / 60000) });
      openBreak = null;
    } else if (e.kind === "check_out" && openBreak !== null) {
      segments.push({ start: new Date(openBreak).toISOString(), end: e.ts, minutes: Math.round((t - openBreak) / 60000) });
      openBreak = null;
    }
  }
  if (openBreak !== null) {
    segments.push({ start: new Date(openBreak).toISOString(), end: null, minutes: Math.round((end - openBreak) / 60000) });
  }
  return segments;
}

// ── Shift-day attribution ──────────────────────────────────────────────────
// Requirements §6: "for crosses_midnight shifts, all events attribute to
// the shift's START date." A naive calendar-day match (dateKeyInTz(ts) ===
// today) splits a night shift's check-in (e.g. 22:00) and check-out (e.g.
// 06:00 the next calendar day) across two different "days," which is
// wrong for both attendance totals and the late/absent computation.

function calendarDateKey(ts: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ts);
}

function localHHMM(ts: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(ts);
}

function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export type ShiftDayInfo = { start_time: string; crosses_midnight: boolean } | null | undefined;

/**
 * Which shift-day (YYYY-MM-DD, tenant timezone) an event belongs to. For a
 * non-crossing shift (or no shift at all), this is just the event's own
 * calendar day. For a crosses_midnight shift, an event whose local
 * time-of-day falls before the shift's start time is the tail end of the
 * PREVIOUS day's shift (e.g. a 21:00→06:00 shift's 05:40 check-out is
 * attributed to yesterday, not today).
 */
export function shiftDayKey(ts: Date, timezone: string, shift: ShiftDayInfo): string {
  const calendarDay = calendarDateKey(ts, timezone);
  if (!shift?.crosses_midnight) return calendarDay;
  const local = localHHMM(ts, timezone);
  const startHHMM = shift.start_time.slice(0, 5);
  return local < startHHMM ? addDays(calendarDay, -1) : calendarDay;
}
