// Pricing a BOQ line (slice 3a). PURE: the rules for which source may set a price, and when a price is too old to be used
// without a person saying so. The sources themselves are read in boqServer.ts and arrive here as candidates.
//
// Owner rule (2026-10-25): a supplier price or a past-project price older than `config.tender.price_validity_days` (default 180)
// is shown with a "stale" label and is NEVER applied automatically; the person may still choose it knowingly, and that choice
// is recorded (stale_accepted). "Price all lines" applies only fresh sources, in a fixed order, and says why it left a line.

export const PRICE_SOURCES = ["boq_rate", "bom", "past_project", "supplier", "manual"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  boq_rate: "Client's rate", bom: "BOM / estimate", past_project: "Past project", supplier: "Supplier", manual: "Manual",
};

export const DEFAULT_PRICE_VALIDITY_DAYS = 180;
export const MAX_PRICE_VALIDITY_DAYS = 3650;

/** The workspace setting from tenants.config, read defensively: a whole number of days from 1 to 3650, else 180. */
export function parseValidityDays(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_PRICE_VALIDITY_DAYS ? n : DEFAULT_PRICE_VALIDITY_DAYS;
}

/** The workspace's limit, from tenants.config (Settings > Tenders). */
export const priceValidityDays = (config: { tender?: { price_validity_days?: unknown } } | null | undefined): number =>
  parseValidityDays(config?.tender?.price_validity_days);

/** A price some source offers for a line. `cost` prices need a markup to become a selling rate; `sell` prices are used as they are. */
export type Candidate = {
  source: Exclude<PriceSource, "manual">;
  /** Short and human: "RFQ-0012 · Gulf Pipes", "OPP-0044 ARB-3". Stored on the line as price_source_ref. */
  ref: string;
  /** One line for the picker. */
  label: string;
  price: number;
  kind: "cost" | "sell";
  /** YYYY-MM-DD: when the price was given, or null when the source carries no date. */
  as_of: string | null;
};

const DAY = 86_400_000;
const dayNumber = (key: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / DAY) : null;
};

/** Whole days between a date and today (never negative); null when there is no date. */
export function ageDays(asOf: string | null | undefined, todayKey: string): number | null {
  const a = asOf ? dayNumber(asOf) : null;
  const t = dayNumber(todayKey);
  return a == null || t == null ? null : Math.max(0, t - a);
}

/** Only supplier and past-project prices expire. A price with no date cannot be shown to be fresh, so it counts as stale. */
export function isStale(source: PriceSource, asOf: string | null | undefined, todayKey: string, validityDays: number): boolean {
  if (source !== "supplier" && source !== "past_project") return false;
  const age = ageDays(asOf, todayKey);
  return age == null || age > validityDays;
}

/** The amber label: "stale, 212 days old" or "stale, no date". */
export function staleText(asOf: string | null | undefined, todayKey: string): string {
  const age = ageDays(asOf, todayKey);
  return age == null ? "stale, no date" : `stale, ${age} day${age === 1 ? "" : "s"} old`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The selling rate a candidate gives: a selling price as it is, a cost plus the markup. */
export function rateFor(c: Pick<Candidate, "kind" | "price">, markupPct: number): number {
  const m = Number.isFinite(markupPct) ? Math.max(0, Math.min(1000, markupPct)) : 0;
  return c.kind === "cost" ? round2(c.price * (1 + m / 100)) : round2(c.price);
}

/** "Price all lines" uses these, in this order, and only while they are fresh. The client's own rate is set at upload, not here. */
export const AUTO_PRIORITY: readonly Candidate["source"][] = ["supplier", "bom", "past_project"];

export type AutoPick = { chosen: Candidate; reason?: undefined } | { chosen: null; reason: string };

export function pickAuto(candidates: readonly Candidate[], todayKey: string, validityDays: number): AutoPick {
  const usable = candidates.filter((c) => AUTO_PRIORITY.includes(c.source) && c.price > 0);
  if (usable.length === 0) return { chosen: null, reason: "No supplier, BOM or past-project price found" };
  const fresh = usable.filter((c) => !isStale(c.source, c.as_of, todayKey, validityDays));
  for (const source of AUTO_PRIORITY) {
    const ofSource = fresh.filter((c) => c.source === source);
    if (ofSource.length === 0) continue;
    // The newest price of that source; on the same day, the lower one.
    ofSource.sort((a, b) => (b.as_of ?? "").localeCompare(a.as_of ?? "") || a.price - b.price);
    return { chosen: ofSource[0] };
  }
  const oldest = usable.map((c) => ageDays(c.as_of, todayKey)).filter((n): n is number => n != null);
  const newest = oldest.length ? Math.min(...oldest) : null;
  return { chosen: null, reason: newest == null ? "Only prices without a date were found" : `Only stale prices (newest ${newest} day${newest === 1 ? "" : "s"} old, limit ${validityDays})` };
}

/**
 * A candidate chosen by hand: a stale one needs the person to say so (accept_stale), and is then recorded as knowingly accepted.
 * Returns the reason it is refused, or null when it may be applied.
 */
export function refuseCandidate(c: Candidate, todayKey: string, validityDays: number, acceptStale: boolean): string | null {
  if (!(c.price > 0)) return "That source has no price";
  if (isStale(c.source, c.as_of, todayKey, validityDays) && !acceptStale) return `That price is ${staleText(c.as_of, todayKey)}. Choose it knowingly to use it.`;
  return null;
}
