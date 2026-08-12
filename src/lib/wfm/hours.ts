// Pure time-calculation functions (rules engine). No DB, no UI — input is a
// day's non-superseded events sorted ascending by ts, output is minutes.
// Unit-testable per requirements §6.

import { isSessionStart, isSessionEnd, type PresenceEvent, type PresenceKind } from "./types";

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

export type BreakSegment = {
  start: string;      // ISO ts of break_start
  end: string | null; // ISO ts of break_end, or null if still open at endRef
  minutes: number;
};

/** One check_in→check_out stretch. A day can have several (an employee who
 * leaves at lunch and returns, a field tech doing a morning and an evening
 * job), which is why hours are summed per session rather than measured from
 * the day's first check-in to its last check-out. */
export type WorkSession = {
  in: string;
  out: string | null; // null while the session is still running
  gross_minutes: number;
  break_minutes: number;
  net_minutes: number;
  breaks: BreakSegment[];
};

const mins = (ms: number) => Math.round(ms / 60000);

/**
 * Split one day's events into its work sessions. The state machine
 * (types.ts) permits out→check_in again, so this is a real case, not a
 * defensive one: counting from first check-in to last check-out would bill
 * the employee for the gap in between. A session left open (no check_out)
 * runs to `endRef` — "now" for a live total, the day's last event for a
 * historical one. Events before the first check-in are ignored.
 */
export function workSessions(events: Ev[], endRef: Date): WorkSession[] {
  const sessions: WorkSession[] = [];
  let openAt: number | null = null;
  let breaks: BreakSegment[] = [];
  let openBreak: number | null = null;

  const close = (endMs: number, outTs: string | null) => {
    if (openAt === null) return;
    if (openBreak !== null) {
      // Checking out (or the day ending) while on break closes the break too.
      breaks.push({ start: new Date(openBreak).toISOString(), end: outTs, minutes: mins(endMs - openBreak) });
      openBreak = null;
    }
    const gross = Math.max(0, mins(endMs - openAt));
    const brk = Math.min(gross, breaks.reduce((s, b) => s + b.minutes, 0));
    sessions.push({
      in: new Date(openAt).toISOString(),
      out: outTs,
      gross_minutes: gross,
      break_minutes: brk,
      net_minutes: gross - brk,
      breaks,
    });
    openAt = null;
    breaks = [];
  };

  for (const e of events) {
    const t = new Date(e.ts).getTime();
    // OT is a separate, separately-approved session type -- never part of a
    // regular working session (see otSessions below).
    if (e.kind === "ot_in" || e.kind === "ot_out") continue;
    if (isSessionStart(e.kind)) {
      if (openAt === null) openAt = t;
    } else if (openAt === null) {
      continue; // break/check-out with no session open — nothing to attribute
    } else if (isSessionEnd(e.kind)) {
      close(t, e.ts);
    } else if (e.kind === "break_start") {
      if (openBreak === null) openBreak = t;
    } else if (e.kind === "break_end" && openBreak !== null) {
      breaks.push({ start: new Date(openBreak).toISOString(), end: e.ts, minutes: mins(t - openBreak) });
      openBreak = null;
    }
  }
  close(Math.max(openAt ?? 0, endRef.getTime()), null);

  return sessions;
}

/**
 * Compute one day's hours from its events. `endRef` is "now" for a live
 * running total; for a closed day the last check_out wins over it.
 * Decision 2026-08-05 (overrides requirements v1.0 §6): working hours
 * EXCLUDE break time — net = worked − breaks. deduct_breaks in tenant
 * config (default true) selects net vs gross downstream.
 *
 * Gross is the SUM of the day's work sessions, not the span from first
 * check-in to last check-out — see workSessions.
 */
export function computeDayHours(events: Ev[], endRef: Date): DayHours {
  const sessions = workSessions(events, endRef);
  if (sessions.length === 0) return { gross_minutes: 0, break_minutes: 0, net_minutes: 0, open: false };

  const gross = sessions.reduce((s, x) => s + x.gross_minutes, 0);
  const brk = sessions.reduce((s, x) => s + x.break_minutes, 0);
  return {
    gross_minutes: gross,
    break_minutes: brk,
    net_minutes: gross - brk,
    open: sessions[sessions.length - 1].out === null,
  };
}

/**
 * The punch that closes a session still open at the end of `dayEvents`, when
 * it lands in the NEXT shift-day's bucket.
 *
 * Without this, an employee who checks in at 22:00 and out at 02:00 is paid
 * nothing at all: the two punches fall in different shift-days, so day one
 * holds a lone check_in (a session opened and closed at the same instant = 0
 * minutes) and day two holds a lone check_out (no session open, ignored).
 * Four hours worked, zero recorded, and the day flagged incomplete. It only
 * bites when the shift ISN'T marked crosses_midnight -- for those, shiftDayKey
 * already keeps both punches on the start day.
 *
 * Deliberately narrow: the very next event only, only if it ENDS a session,
 * and only within `maxHours`. A check-out forgotten until the following week
 * must stay an incomplete day for a supervisor to correct -- silently paying
 * it would be worse than reporting nothing.
 */
export function overnightTail(dayEvents: Ev[], allEvents: Ev[], maxHours = 18): Ev[] {
  if (dayEvents.length === 0) return [];

  const sessions = workSessions(dayEvents, new Date(dayEvents[dayEvents.length - 1].ts));
  const openSession = sessions[sessions.length - 1];
  if (!openSession || openSession.out !== null) return [];

  const idx = allEvents.indexOf(dayEvents[dayEvents.length - 1]);
  if (idx < 0) return [];

  const openedAt = new Date(openSession.in).getTime();
  const tail: Ev[] = [];

  // Walk forward to the punch that ends the session. Everything between is
  // part of it -- a break that itself straddles midnight puts break_end in
  // the next bucket too, so stopping at the first event would miss the
  // check-out sitting behind it.
  for (let i = idx + 1; i < allEvents.length; i++) {
    const e = allEvents[i];
    if (isSessionStart(e.kind)) return []; // a new session began; the old one was abandoned
    const spanMs = new Date(e.ts).getTime() - openedAt;
    if (spanMs <= 0 || spanMs > maxHours * 3600_000) return [];
    tail.push(e);
    if (isSessionEnd(e.kind)) return tail;
  }

  return []; // never closed
}

/**
 * Every break the employee booked that day, in order, across all sessions —
 * the detail behind computeDayHours' single `break_minutes` figure, for a
 * timesheet that has to show each one. Derived from workSessions so the
 * segment minutes always sum to that figure.
 */
export function breakSegments(events: Ev[], endRef: Date): BreakSegment[] {
  return workSessions(events, endRef).flatMap((s) => s.breaks);
}

// ── Overtime sessions ──────────────────────────────────────────────────────

export type OtStretch = {
  start: string;
  /** null while the employee is still punched in on OT. */
  end: string | null;
  minutes: number;
};

/**
 * Pair a day's ot_in→ot_out events into OT stretches, independent of the
 * regular work sessions above. A still-open OT stretch runs to `endRef`
 * ("now" for a live figure) and is reported with end === null so callers can
 * show it as in-progress and keep it out of payable totals until it closes.
 *
 * Minutes are exact -- the client pays hour-wise on actual time, so nothing
 * here rounds.
 */
export function otSessions(events: Ev[], endRef: Date): OtStretch[] {
  const out: OtStretch[] = [];
  let openAt: number | null = null;
  let openTs: string | null = null;

  for (const e of events) {
    const t = new Date(e.ts).getTime();
    if (e.kind === "ot_in") {
      if (openAt === null) { openAt = t; openTs = e.ts; }
    } else if (e.kind === "ot_out" && openAt !== null) {
      out.push({ start: openTs!, end: e.ts, minutes: Math.max(0, mins(t - openAt)) });
      openAt = null; openTs = null;
    }
  }
  if (openAt !== null) {
    out.push({ start: openTs!, end: null, minutes: Math.max(0, mins(endRef.getTime() - openAt)) });
  }
  return out;
}

/** Total OT minutes across a day's closed stretches (open ones excluded --
 * they aren't payable until the employee punches out). */
export function otMinutes(events: Ev[], endRef: Date): number {
  return otSessions(events, endRef).filter((s) => s.end !== null).reduce((s, x) => s + x.minutes, 0);
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
