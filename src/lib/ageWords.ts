// How old a record is, in words: "just now", "3 h ago", "today", "3 d ago", "5 wk ago", "7 mo ago".
//
// `from` is a date key (YYYY-MM-DD) or a full timestamp; `todayKey` is today in the workspace's timezone.
// A timestamp is NOT cut to its UTC date and compared with the workspace's today: east of UTC that made a record
// saved a minute ago read "1 d ago" whenever the UTC date was still yesterday (KAMCO walkthrough 2026-11-19).
// A timestamp is measured against the clock instead. A date key has no time, so it is compared by calendar day.

const DAY = 86_400_000;
const HOUR = 3_600_000;

const keyMs = (key: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
};

const inDays = (d: number): string => {
  if (d < 14) return `${d} d ago`;
  if (d < 60) return `${Math.floor(d / 7)} wk ago`;
  return `${Math.floor(d / 30)} mo ago`;
};

export function ageWords(from: string | null | undefined, todayKey: string, now: number = Date.now()): string {
  if (!from) return "";
  const today = keyMs(todayKey);
  const fromDay = keyMs(from);
  if (today == null || fromDay == null) return "";

  const stamp = from.length > 10 ? Date.parse(from) : NaN;
  // The clock is only used when `todayKey` really is today (its 24 hours, widened for any timezone). A caller that
  // passes a fixed day (a replay, a test) gets calendar-day arithmetic against that day.
  const live = Math.abs(now - (today + DAY / 2)) <= DAY * 1.5;
  if (Number.isFinite(stamp) && live) {
    const elapsed = Math.max(0, now - stamp);
    if (elapsed < HOUR) return "just now";
    if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
    return inDays(Math.floor(elapsed / DAY));
  }

  const d = Math.round((today - fromDay) / DAY);
  if (d <= 0) return "today";
  return inDays(d);
}
