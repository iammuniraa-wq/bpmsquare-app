// Pure break-overrun rules (no DB, no UI), unit-tested alongside hours.ts.
//
// Client request (BIM, 2026-09-10): tell an employee whose break has run long,
// on their own phone. The failure this actually prevents is a forgotten
// break_end -- an open break keeps accruing against worked time (see
// workSessions in hours.ts, where a break still open at the end reference is
// closed at that reference), so a break nobody ended quietly eats the day's
// hours and the employee only finds out at month end.

import { isSessionEnd, isSessionStart, type PresenceKind } from "./types";

type Ev = { kind: PresenceKind; ts: string };

/**
 * How many minutes the employee has been on an OPEN break as of `now`, or
 * null when they are not on one.
 *
 * Walks the day rather than looking only at the last event: a break is open
 * when its break_start has no break_end after it AND the session it belongs
 * to has not been closed out. Checking `last.kind === "break_start"` instead
 * would be wrong the moment any other punch lands after the break began.
 */
export function openBreakMinutes(events: Ev[], now: Date): number | null {
  let openBreakAt: number | null = null;

  for (const e of [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())) {
    const t = new Date(e.ts).getTime();
    if (e.kind === "break_start") {
      if (openBreakAt === null) openBreakAt = t;
    } else if (e.kind === "break_end") {
      openBreakAt = null;
    } else if (isSessionEnd(e.kind) || isSessionStart(e.kind) || e.kind === "ot_in" || e.kind === "ot_out") {
      // Punching out (or opening a fresh session, or moving onto OT) ends any
      // break still hanging open -- there is nobody on a break to nudge.
      openBreakAt = null;
    }
  }

  if (openBreakAt === null) return null;
  const minutes = Math.floor((now.getTime() - openBreakAt) / 60000);
  return minutes < 0 ? 0 : minutes;
}

/**
 * The push body. A tenant's own wording wins when they set one ("custom");
 * otherwise the standard sentence, which states the elapsed time because that
 * is the fact the employee needs in order to act.
 */
export function breakAlertBody(minutes: number, customMessage: string): string {
  const trimmed = customMessage.trim();
  if (trimmed) return trimmed;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const elapsed = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  return `You've been on break for ${elapsed}. Punch back in when you're ready.`;
}
