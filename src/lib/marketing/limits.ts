import { DEFAULT_WFM_CONFIG, type MarketingConfig, type TenantConfig } from "@/lib/constants";
import { marketingConfigOf } from "./config";
import { limitsOf } from "./journeys/safety";
import { weeklyCapOf } from "./whatsapp/rules";

// Settings, Marketing, Consent, Limits: how often and when a message may go out. The journey values live in
// config.marketing.journey_limits and the WhatsApp cap in config.whatsapp, where the senders already read them
// (journeys/safety.ts, whatsapp/rules.ts); this file is only the shared reading and the validation for the screen.
// Pure, so the route, the screen and the tests agree.

export type LimitsSettings = {
  /** Local hour journey sending stops (0-23) and starts again. Equal values = no quiet hours. */
  quiet_from_hour: number;
  quiet_to_hour: number;
  /** 0 = Sunday ... 6 = Saturday. */
  off_weekdays: number[];
  /** Most journey emails one person gets in a day. */
  max_per_day: number;
  /** Most marketing WhatsApp messages one person gets in a week. */
  whatsapp_weekly_cap: number;
};

export const MAX_EMAILS_PER_DAY = 10;
export const MAX_WHATSAPP_PER_WEEK = 20;

/** Every value with its default filled in, from whatever the workspace has stored. */
export function limitsSettingsOf(config: Partial<TenantConfig> | null | undefined): LimitsSettings {
  const l = limitsOf(config);
  return {
    quiet_from_hour: l.quietFromHour,
    quiet_to_hour: l.quietToHour,
    off_weekdays: [...l.offWeekdays].sort(),
    max_per_day: l.maxPerDay,
    whatsapp_weekly_cap: weeklyCapOf(config),
  };
}

/** The timezone the journeys run in, and where it came from: Workforce attendance, or the product default. */
export function limitsTimezoneOf(config: Partial<TenantConfig> | null | undefined): { timezone: string; source: "workforce" | "default" } {
  const tz = config?.wfm?.timezone;
  return typeof tz === "string" && tz ? { timezone: tz, source: "workforce" } : { timezone: DEFAULT_WFM_CONFIG.timezone, source: "default" };
}

const whole = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export type LimitsSave = { ok: true; value: LimitsSettings } | { ok: false; error: string };

/**
 * Validates what the screen sends. A value that is absent keeps what the workspace has now (an older page cannot
 * wipe a limit); a value that is present and out of range is refused, never clamped, so the person is told.
 */
export function sanitizeLimits(input: unknown, current: LimitsSettings): LimitsSave {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save" };
  const b = input as Record<string, unknown>;
  const next: LimitsSettings = { ...current, off_weekdays: [...current.off_weekdays] };

  if (b.quiet_from_hour !== undefined) {
    const n = whole(b.quiet_from_hour, 0, 23);
    if (n === null) return { ok: false, error: "Quiet hours start at a whole hour between 0 and 23" };
    next.quiet_from_hour = n;
  }
  if (b.quiet_to_hour !== undefined) {
    const n = whole(b.quiet_to_hour, 0, 23);
    if (n === null) return { ok: false, error: "Quiet hours end at a whole hour between 0 and 23" };
    next.quiet_to_hour = n;
  }
  if (b.off_weekdays !== undefined) {
    if (!Array.isArray(b.off_weekdays) || !b.off_weekdays.every((d) => whole(d, 0, 6) !== null)) return { ok: false, error: "Choose days of the week" };
    const days = [...new Set((b.off_weekdays as number[]).map(Number))].sort();
    if (days.length >= 7) return { ok: false, error: "At least one day of the week has to allow sending" };
    next.off_weekdays = days;
  }
  if (b.max_per_day !== undefined) {
    const n = whole(b.max_per_day, 1, MAX_EMAILS_PER_DAY);
    if (n === null) return { ok: false, error: `Emails a day is between 1 and ${MAX_EMAILS_PER_DAY}` };
    next.max_per_day = n;
  }
  if (b.whatsapp_weekly_cap !== undefined) {
    const n = whole(b.whatsapp_weekly_cap, 1, MAX_WHATSAPP_PER_WEEK);
    if (n === null) return { ok: false, error: `WhatsApp messages a week is between 1 and ${MAX_WHATSAPP_PER_WEEK}` };
    next.whatsapp_weekly_cap = n;
  }
  return { ok: true, value: next };
}

/** The config with the limits written in, keeping every other key (trouble-case days, blast radius, the demo redirect number). */
export function applyLimits(config: Partial<TenantConfig>, v: LimitsSettings): Partial<TenantConfig> {
  const m = marketingConfigOf(config);
  const marketing: MarketingConfig = {
    ...m,
    journey_limits: {
      ...m.journey_limits,
      quiet_from_hour: v.quiet_from_hour, quiet_to_hour: v.quiet_to_hour, off_weekdays: v.off_weekdays, max_per_day: v.max_per_day,
    },
  };
  return { ...config, marketing, whatsapp: { ...config.whatsapp, weekly_cap: v.whatsapp_weekly_cap } };
}
