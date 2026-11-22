import { TTL_DAYS } from "./types";

// The pure rules of the cache and the caps (docs/design/account-analysis.md section 4). No I/O, so the clock arithmetic is
// tested without a database.

export const DEFAULT_DAILY_LIMIT = 30;
export const MAX_DAILY_LIMIT = 1000;
export const REFRESH_MIN_MINUTES = 60;

const DAY = 86_400_000;

/** A configured daily limit is honoured only as a whole number from 0 (switched off) to 1000; anything else is the default. */
export function resolveDailyLimit(configured: unknown): number {
  return typeof configured === "number" && Number.isInteger(configured) && configured >= 0 && configured <= MAX_DAILY_LIMIT
    ? configured : DEFAULT_DAILY_LIMIT;
}

export function expiresAtFor(computedAt: Date): string {
  return new Date(computedAt.getTime() + TTL_DAYS * DAY).toISOString();
}

/** Within its seven days. */
export const isFresh = (expiresAt: string | null | undefined, now: Date): boolean => !!expiresAt && Date.parse(expiresAt) > now.getTime();

/** A fresh run is allowed once an hour per company. Returns when, if not yet. */
export function refreshBlockedUntil(computedAt: string | null | undefined, now: Date): string | null {
  if (!computedAt) return null;
  const next = Date.parse(computedAt) + REFRESH_MIN_MINUTES * 60_000;
  return Number.isNaN(next) || next <= now.getTime() ? null : new Date(next).toISOString();
}

/** UTC midnight of the day, as an ISO string: the daily cap counts from here. */
export function dayStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** Companies that are not accounts are forgotten after 90 days unused. */
export const RETENTION_DAYS = 90;

// The company report (docs/design/company-report.md): a report is far dearer than a verdict card (up to seven searches), so
// it has its own small daily ceiling per person on top of the search ceiling every web research shares. The cached report
// lives in the same table under a key of its own, so the verdict card's row is never touched.
export const DEFAULT_REPORT_DAILY_LIMIT = 10;
export const REPORT_KEY_PREFIX = "report:";

/** The cache key of a company's report, or "" when the company has no usable key. */
export const reportCacheKey = (companyKey: string): string => (companyKey ? `${REPORT_KEY_PREFIX}${companyKey}` : "");
