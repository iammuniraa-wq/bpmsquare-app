// Day boundaries in the workspace's time zone. "Yesterday" for a person in Doha is not yesterday in UTC, and the
// briefing is cached per (workspace, person, day), so the day key and the window it covers must come from one place.
// Pure: no I/O, Intl only.

/** The zone if it is a real IANA name, else UTC. A stored typo must not take the briefing down. */
export function validTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const parts = (ms: number, tz: string) => {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
};

/** YYYY-MM-DD of an instant as the wall clock reads in `tz`. */
export function dayKey(at: Date, tz: string): string {
  const p = parts(at.getTime(), validTimeZone(tz));
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Milliseconds `tz` is ahead of UTC at that instant. */
function offsetMs(ms: number, tz: string): number {
  const p = parts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The instant a calendar day begins in `tz` (handles zones whose offset changes that day). */
export function dayStartUtc(key: string, tz: string): Date {
  const zone = validTimeZone(tz);
  const [y, m, d] = key.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - offsetMs(wall, zone);
  const second = wall - offsetMs(guess, zone);
  if (second !== guess) guess = second;
  return new Date(guess);
}

export type DayWindow = { timeZone: string; today: string; yesterday: string; yesterdayStart: string; todayStart: string };

/** Today's key and the half-open UTC window [yesterdayStart, todayStart) that "yesterday" covers. */
export function dayWindow(now: Date, tz: unknown): DayWindow {
  const timeZone = validTimeZone(tz);
  const today = dayKey(now, timeZone);
  const yesterday = addDays(today, -1);
  return {
    timeZone, today, yesterday,
    yesterdayStart: dayStartUtc(yesterday, timeZone).toISOString(),
    todayStart: dayStartUtc(today, timeZone).toISOString(),
  };
}

/** Whole calendar days from today to a date or timestamp (positive = in the future), read in `tz`. Null if unparseable. */
export function daysFromToday(today: string, value: unknown, tz: string): number | null {
  if (typeof value !== "string" || !value) return null;
  let key: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) key = value;
  else {
    const t = Date.parse(value);
    if (Number.isFinite(t)) key = dayKey(new Date(t), tz);
  }
  if (!key) return null;
  return Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
