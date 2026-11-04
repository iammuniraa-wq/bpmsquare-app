/**
 * Pure helpers for a campaign that is being sent or that partly failed: the "provider daily limit" case, which people
 * to send the rest to, the progress count, and the polling rhythm of the campaign page.
 */

/** The email service's own refusal when the account's daily sending limit is used up. */
export function isQuotaError(message: string | null | undefined): boolean {
  return /(daily|monthly).{0,40}quota|quota.{0,40}(daily|exceeded|reached)|sending quota|rate limit exceeded/i.test(message ?? "");
}

export const REST_TIP = "Only people whose email failed or was never tried are sent to. Nobody who was already sent is emailed again.";
export const QUOTA_LINE = "The email service has reached its daily limit. The rest can be sent later.";

export type RecipientKeyRow = { account_id: string | null; manual_email: string | null; status: string };
type Keyed = { account_id: string | null; manual_email: string | null };

/** One person is one account, or one typed address. */
export const recipientKey = (r: Keyed): string => (r.account_id ? `a:${r.account_id}` : `m:${(r.manual_email ?? "").toLowerCase()}`);

/**
 * Who "Send the rest" is for: people who were tried and failed, or never reached, and never anyone who was already sent
 * or deliberately left out. Running it twice therefore sends nothing the second time.
 */
export function restCandidates<T extends Keyed>(candidates: T[], rows: RecipientKeyRow[]): T[] {
  const sent = new Set<string>(), leftOut = new Set<string>();
  for (const r of rows) {
    if (r.status === "sent") sent.add(recipientKey(r));
    else if (r.status.startsWith("skipped_")) leftOut.add(recipientKey(r));
  }
  return candidates.filter((c) => !sent.has(recipientKey(c)) && !leftOut.has(recipientKey(c)));
}

export type Counts = { sent: number; failed: number; skipped: number };
export function countStatuses(rows: { status: string }[]): Counts {
  const out: Counts = { sent: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    if (r.status === "sent") out.sent++;
    else if (r.status === "failed") out.failed++;
    else if (r.status.startsWith("skipped_")) out.skipped++;
  }
  return out;
}

/** "Sending… 4 of 8" while the total is known, "Sending… 4 so far" before. */
export function progressText(done: number, total: number | null): string {
  return total && total >= done ? `Sending… ${done} of ${total}` : `Sending… ${done} so far`;
}

export const POLL_MAX_MS = 20 * 60 * 1000;
/** Wait before the next check: 3 s for the first minute, then slowing to 10 s. */
export function pollDelay(attempt: number): number {
  return Math.min(10_000, 3_000 + Math.max(0, attempt - 20) * 500);
}
