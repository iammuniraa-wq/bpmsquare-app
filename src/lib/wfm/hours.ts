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
