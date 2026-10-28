// The filters the Tenders tab of the Pipeline understands in its address (`/pipeline?tab=tenders&stage=estimating`), written by the dashboard's
// tender blocks (src/lib/tenderDesk/links.ts) and read by TendersPanel. Pure and client-safe. Every filter is optional and they combine;
// a value that does not exist (an unknown stage, a client with no tender) simply shows an empty board, never an error.

import { dayKey, daysUntilClosing } from "./rules";

export type TenderOutcomeFilter = "won" | "lost";

export type TenderFilter = {
  /** A stage value of the tender stage list, e.g. "estimating". */
  stage?: string;
  /** Open tenders whose bid end date is today or within this many days. */
  closing?: number;
  /** The issuer account (else the deal's own account) id. */
  client?: string;
  outcome?: TenderOutcomeFilter;
  /** "2026-10": with an outcome, only the tenders decided in that month (workspace time zone). */
  month?: string;
};

const MAX_CLOSING_DAYS = 365;

/** Reads the filter out of the address; anything malformed is dropped. `get` is URLSearchParams.get. */
export function parseTenderFilter(get: (key: string) => string | null, stageValues: readonly string[]): TenderFilter {
  const out: TenderFilter = {};
  const stage = get("stage");
  if (stage && stageValues.includes(stage)) out.stage = stage;
  const closing = Number(get("closing"));
  if (Number.isInteger(closing) && closing > 0 && closing <= MAX_CLOSING_DAYS) out.closing = closing;
  const client = get("client");
  if (client && /^[0-9a-fA-F-]{8,64}$/.test(client)) out.client = client;
  const outcome = get("outcome");
  if (outcome === "won" || outcome === "lost") out.outcome = outcome;
  const month = get("month");
  if (out.outcome && month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) out.month = month;
  return out;
}

export const tenderFilterActive = (f: TenderFilter): boolean => Object.keys(f).length > 0;

type FilterRow = {
  stage: string;
  outcome: string;
  account_id: string | null;
  closed_at: string | null;
  tender: { closing_at: string | null; issuer_account_id?: string | null };
};

/** The rows a filter lets through. `now` and `timezone` decide "closing within N days" and the month a decision falls in. */
export function applyTenderFilter<T extends FilterRow>(rows: T[], f: TenderFilter, now: Date, timezone: string): T[] {
  let out = rows;
  if (f.stage) out = out.filter((r) => r.stage === f.stage);
  if (f.client) out = out.filter((r) => (r.tender.issuer_account_id ?? r.account_id) === f.client);
  if (f.outcome) {
    out = out.filter((r) => r.outcome === f.outcome);
    if (f.month) out = out.filter((r) => !!r.closed_at && dayKey(new Date(r.closed_at), timezone).slice(0, 7) === f.month);
  }
  if (f.closing) {
    // The dashboard tile counts every open tender whose bid end date is today or within N days, whatever its stage; so does this.
    const within = f.closing;
    out = out.filter((r) => {
      if (r.outcome !== "open") return false;
      const d = daysUntilClosing(r.tender.closing_at, now, timezone);
      return d !== null && d >= 0 && d <= within;
    });
  }
  return out;
}
