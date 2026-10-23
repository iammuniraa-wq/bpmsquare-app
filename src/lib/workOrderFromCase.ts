// Pure rules for raising a work order from a service case. No I/O, so the
// route's decisions are testable without a database.

export type WorkOrderAuth = { kind: "quote" | "contract"; id: string };

/** A case in one of these states has nothing left to schedule. */
export const NON_WORKABLE_CASE_STATUSES = ["closed", "scrapped", "buyback"] as const;

/** A work order still being worked: a second one for the same case needs the user's confirmation. */
export const OPEN_WORK_ORDER_STATUSES = ["scheduled", "in_progress"] as const;

export function isWorkableCaseStatus(status: string): boolean {
  return !(NON_WORKABLE_CASE_STATUSES as readonly string[]).includes(status);
}

/**
 * work_orders.auth_kind/auth_id are NOT NULL (baseline schema), so a work order needs an authorisation.
 * An AMC case prefers its contract; any other case prefers its quote; whichever is the only one present
 * is used. Returns null when the case has neither, and the caller must refuse rather than invent one.
 */
export function resolveWorkOrderAuth(sc: {
  type?: string | null;
  quote_id?: string | null;
  contract_id?: string | null;
}): WorkOrderAuth | null {
  const quote: WorkOrderAuth | null = sc.quote_id ? { kind: "quote", id: sc.quote_id } : null;
  const contract: WorkOrderAuth | null = sc.contract_id ? { kind: "contract", id: sc.contract_id } : null;
  if (sc.type === "amc") return contract ?? quote;
  return quote ?? contract;
}

/**
 * scheduled_for is a timestamptz but the user picks a day. A date-only value is stored at noon UTC so that
 * the day reads the same in every workspace timezone (midnight UTC would fall on the previous day west of
 * Greenwich, and WFM attendance keys on the day in the tenant's timezone). Empty means today. Returns null
 * for anything that is not a valid date.
 */
export function normaliseScheduledFor(input: unknown, now: Date = new Date()): string | null {
  if (input === undefined || input === null || input === "") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12)).toISOString();
  }
  if (typeof input !== "string") return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString();
  }
  const t = new Date(input);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}
