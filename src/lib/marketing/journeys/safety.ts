import type { TenantConfig } from "@/lib/constants";

// The timing and volume rules that run before every journey send. Pure: the
// runner and the simulation load the facts (the tenant's timezone, how many
// messages a person had, whether the company is in trouble) and ask these
// functions. Consent is NOT here: it is canContact(), called by the send path
// itself at the moment of sending, and nothing in this file can override it.

export type JourneyLimits = {
  maxPerDay: number;
  quietFromHour: number;
  quietToHour: number;
  /** 0 = Sunday ... 6 = Saturday. */
  offWeekdays: number[];
  troubleCaseDays: number;
  blastRadius: number;
};

// Friday is the default day off for a Saudi workspace (owner brief); a workspace
// that works Fridays clears it in config.marketing.journey_limits.off_weekdays.
export const DEFAULT_LIMITS: JourneyLimits = {
  maxPerDay: 1, quietFromHour: 20, quietToHour: 8, offWeekdays: [5], troubleCaseDays: 30, blastRadius: 200,
};

const int = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);

export function limitsOf(config: Partial<TenantConfig> | null | undefined): JourneyLimits {
  const c = config?.marketing?.journey_limits ?? {};
  const days = Array.isArray(c.off_weekdays) ? [...new Set(c.off_weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : DEFAULT_LIMITS.offWeekdays;
  return {
    maxPerDay: int(c.max_per_day, 1, 10, DEFAULT_LIMITS.maxPerDay),
    quietFromHour: int(c.quiet_from_hour, 0, 23, DEFAULT_LIMITS.quietFromHour),
    quietToHour: int(c.quiet_to_hour, 0, 23, DEFAULT_LIMITS.quietToHour),
    offWeekdays: days,
    troubleCaseDays: int(c.trouble_case_days, 1, 365, DEFAULT_LIMITS.troubleCaseDays),
    blastRadius: int(c.blast_radius, 1, 100000, DEFAULT_LIMITS.blastRadius),
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayName = (d: number) => WEEKDAYS[d] ?? "";

/** The hour (0-23) and weekday (0-6) at `at` in an IANA timezone. */
export function localParts(at: Date, timezone: string): { hour: number; weekday: number; dateKey: string } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
    const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday));
    return { hour: Number(p.hour) % 24, weekday: weekday < 0 ? 0 : weekday, dateKey: `${p.year}-${p.month}-${p.day}` };
  } catch {
    return { hour: at.getUTCHours(), weekday: at.getUTCDay(), dateKey: at.toISOString().slice(0, 10) };
  }
}

export type TimingDecision = { ok: true } | { ok: false; reason: "quiet_hours" | "weekly_off"; resumeAt: Date };

function inQuiet(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

function blocked(at: Date, tz: string, l: JourneyLimits): "quiet_hours" | "weekly_off" | null {
  const p = localParts(at, tz);
  if (l.offWeekdays.includes(p.weekday)) return "weekly_off";
  if (inQuiet(p.hour, l.quietFromHour, l.quietToHour)) return "quiet_hours";
  return null;
}

/** May a message go out at `now`? If not, when is the first allowed moment (found in 15-minute steps, so it also holds for half-hour timezones). */
export function timingCheck(now: Date, timezone: string, l: JourneyLimits): TimingDecision {
  const why = blocked(now, timezone, l);
  if (!why) return { ok: true };
  const STEP = 15 * 60_000;
  // Eight days covers any weekly off day plus a night, even with several days off.
  for (let t = now.getTime() + STEP, i = 0; i < 8 * 96; t += STEP, i++) {
    if (!blocked(new Date(t), timezone, l)) return { ok: false, reason: why, resumeAt: new Date(t) };
  }
  return { ok: false, reason: why, resumeAt: new Date(now.getTime() + 24 * 3_600_000) };
}

export type CapDecision = { ok: true } | { ok: false; reason: "daily_cap"; resumeAt: Date };

/** `recentSends` are the times of this person's journey emails in the last 24 hours. */
export function capCheck(now: Date, recentSends: Date[], l: JourneyLimits): CapDecision {
  const inWindow = recentSends.filter((d) => now.getTime() - d.getTime() < 86_400_000).sort((a, b) => a.getTime() - b.getTime());
  if (inWindow.length < l.maxPerDay) return { ok: true };
  // The slot that frees first: the (n - max + 1)th oldest send leaves the 24 hour window.
  const frees = inWindow[inWindow.length - l.maxPerDay];
  return { ok: false, reason: "daily_cap", resumeAt: new Date(frees.getTime() + 86_400_000 + 60_000) };
}

export type TroubleFacts = { oldestOpenCaseAt: Date | null; hasOverdueInvoice: boolean };

export function inTrouble(now: Date, f: TroubleFacts, l: JourneyLimits): boolean {
  if (f.hasOverdueInvoice) return true;
  return !!f.oldestOpenCaseAt && now.getTime() - f.oldestOpenCaseAt.getTime() > l.troubleCaseDays * 86_400_000;
}

/** How long a run waits before it looks at an account in trouble again. */
export const TROUBLE_RECHECK_MS = 6 * 3_600_000;

/** Back-off for a send that failed: 5, 20 then 45 minutes. After the third failure the run is stalled. */
export const MAX_ATTEMPTS = 3;
export const backoffMs = (attempt: number) => 5 * 60_000 * attempt * attempt;

export function isOverdueByTicks(nextDueAt: string | null, now: Date, ticks = 2): boolean {
  if (!nextDueAt) return false;
  return now.getTime() - Date.parse(nextDueAt) > ticks * 5 * 60_000;
}
