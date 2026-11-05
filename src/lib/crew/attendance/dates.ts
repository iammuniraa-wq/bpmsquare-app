// Small pure date helpers on "YYYY-MM-DD" keys (workspace-local shift-days). UTC arithmetic only, so no time zone enters.

const KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(s: unknown): s is string {
  if (typeof s !== "string" || !KEY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/** Inclusive range; null when invalid, reversed or longer than `max` days. */
export function dateRange(from: string, to: string, max = 93): string[] | null {
  if (!isDateKey(from) || !isDateKey(to) || from > to) return null;
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > max) return null;
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "27 Oct" */
export function shortDate(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Tue 27 Oct" */
export function longDate(key: string): string {
  return `${DAYS[weekdayOf(key)]} ${shortDate(key)}`;
}

/**
 * Minutes after the site's shift start that a check-in happened, or null when it cannot be told. `firstIn` is an ISO
 * timestamp (read in the workspace time zone) or a bare "HH:MM". Negative means early.
 */
export function minutesAfterStart(firstIn: string | null, shiftStart: string | null, timezone: string): number | null {
  if (!firstIn || !shiftStart) return null;
  const hhmm = /^(\d{2}):(\d{2})/.exec(shiftStart);
  if (!hhmm) return null;
  const startMin = Number(hhmm[1]) * 60 + Number(hhmm[2]);
  let inMin: number | null = null;
  const bare = /^(\d{2}):(\d{2})(:\d{2})?$/.exec(firstIn);
  if (bare) {
    inMin = Number(bare[1]) * 60 + Number(bare[2]);
  } else {
    const t = new Date(firstIn);
    if (Number.isNaN(t.getTime())) return null;
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
      const h = Number(parts.find((p) => p.type === "hour")?.value);
      const m = Number(parts.find((p) => p.type === "minute")?.value);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      inMin = h * 60 + m;
    } catch {
      return null;
    }
  }
  let diff = inMin - startMin;
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}
