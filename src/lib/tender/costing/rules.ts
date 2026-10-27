// The Costing tab of a tender deal (GCC tender deals, redesign "Costing", docs/design/gcc-tender-deals.md section 25). PURE: no server
// imports, so the screen, the routes and the tests share one set of rules.
//
// Owner rule (2026-10-27): "Award and price" stores the supplier's price as the line's COST and adds the row's markup, so cost 100 with
// 15 percent is a rate of 115, and the price source reads "RFQ-0012, awarded". Awarding happens only on the Costing compare screen.
// The cost and the markup are internal: nothing in this folder is read by the priced Excel, the answer sheet or a bid version.

import type { ComposerLine } from "@/components/rfq/RfqComposer";
import type { PillarKey } from "@/lib/theme";
import type { Tone } from "@/lib/ui/tone";
import type { ValidityState } from "@/lib/rfq/comparison";

// ── The markup ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The markup an award adds when neither the person nor the row says otherwise. Settings > Tenders can change it. */
export const DEFAULT_AWARD_MARKUP_PCT = 15;
export const MAX_AWARD_MARKUP_PCT = 1000;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
export { round2 as roundMoney, round4 as roundCost };

/** A markup from untrusted input: a number or a numeric string from 0 to 1000, kept to 2 places. Anything else is null. */
export function parseMarkup(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_AWARD_MARKUP_PCT) return null;
  return round2(n);
}

/** The workspace default, from tenants.config.tender.default_markup_pct (Settings > Tenders). A bad or missing value is 15. */
export function tenderMarkupDefault(config: { tender?: { default_markup_pct?: unknown } } | null | undefined): number {
  return parseMarkup(config?.tender?.default_markup_pct) ?? DEFAULT_AWARD_MARKUP_PCT;
}

/**
 * Which markup an award uses on one row: the one the person typed on the compare screen, else the row's own (when it has one above
 * zero, from an earlier pricing), else the workspace default. 0 is a valid thing to type (sell at cost), so a typed 0 is kept.
 */
export function awardMarkup(a: { requested: number | null; rowMarkup: number | null | undefined; fallback: number }): number {
  if (a.requested !== null && Number.isFinite(a.requested)) return a.requested;
  if (a.rowMarkup != null && Number.isFinite(a.rowMarkup) && a.rowMarkup > 0) return round2(a.rowMarkup);
  return a.fallback;
}

/** The selling rate: the cost plus the markup, to 2 places. Cost 100 with 15 percent is 115; cost 22 is 25.30. */
export function awardRate(cost: number, markupPct: number): number {
  return round2(cost * (1 + (Number.isFinite(markupPct) ? markupPct : 0) / 100));
}

/** A deal line's amount from its quantity, rate and discount, to 2 places (the deal's own rule). */
export function lineAmount(qty: number, rate: number, discountPct: number | null | undefined): number {
  return round2(qty * rate * (1 - Number(discountPct ?? 0) / 100));
}

/** What the price source of a row reads after an award. */
export const awardSourceRef = (rfqRef: string | null | undefined): string => `${(rfqRef ?? "").trim() || "RFQ"}, awarded`.slice(0, 200);

const DAY = 86_400_000;
const dayNumber = (key: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / DAY) : null;
};
/** Whole days from an earlier date to a later one; null when either is missing; never negative. */
export function daysSince(fromKey: string | null | undefined, todayKey: string): number | null {
  const a = fromKey ? dayNumber(fromKey) : null;
  const b = dayNumber(todayKey);
  return a == null || b == null ? null : Math.max(0, b - a);
}

export type AwardedFields = {
  rate: number;
  price_source: "supplier";
  price_source_ref: string;
  /** The day the supplier gave the price: the 180 day staleness clock of the BOQ runs from here, not from the award. */
  price_as_of: string | null;
  /** The person chose a price that was expired, stale or older than the limit; the BOQ shows it as knowingly accepted. */
  stale_accepted: boolean;
  unit_cost: number;
  markup_pct: number;
};

/**
 * Everything an award writes on a BOQ row, from the supplier's landed unit price in the workspace currency. The cost is kept to 4
 * places (the column is numeric(14,4)), the rate to 2.
 */
export function awardedFields(a: {
  cost: number; markupPct: number; rfqRef: string | null; answeredOn: string | null; validity: ValidityState; today: string; validityDays: number;
}): AwardedFields {
  const cost = round4(a.cost);
  const age = daysSince(a.answeredOn, a.today);
  const tooOld = a.answeredOn == null || (age != null && age > a.validityDays);
  return {
    rate: awardRate(cost, a.markupPct),
    price_source: "supplier",
    price_source_ref: awardSourceRef(a.rfqRef),
    price_as_of: a.answeredOn ? a.answeredOn.slice(0, 10) : null,
    stale_accepted: a.validity !== "ok" || tooOld,
    unit_cost: cost,
    markup_pct: round2(a.markupPct),
  };
}

// ── What the list shows ──────────────────────────────────────────────────────────────────────────────────────────────────

export type RowsRef = { count: number; items: string[]; more: number };

/** The BOQ rows an estimate or an RFQ prices: how many, the first few item numbers and how many are left. */
export function rowsRef(items: readonly string[], show = 4): RowsRef {
  const unique = [...new Set(items.map((x) => x.trim()).filter(Boolean))];
  return { count: unique.length, items: unique.slice(0, show), more: Math.max(0, unique.length - show) };
}

/** "1.2 · 1.3 · +4": the item numbers a row prices, as one line. */
export function rowsText(r: RowsRef): string {
  if (r.count === 0) return "No BOQ row yet";
  return `${r.items.join(" · ")}${r.more > 0 ? ` · +${r.more}` : ""}`;
}

export type StatePill = { label: string; tone: PillarKey };

export function estimateState(e: { status: string; stale_links: number; missing_count: number; linked_rows: number }): StatePill {
  if (e.stale_links > 0) return { label: "Changed, re-price", tone: "amber" };
  if (e.missing_count > 0) return { label: `${e.missing_count} cost${e.missing_count === 1 ? "" : "s"} missing`, tone: "amber" };
  if (e.status === "quoted" || e.status === "won") return { label: e.status === "won" ? "Won" : "Quoted", tone: "teal" };
  if (e.linked_rows > 0) return { label: "Applied", tone: "green" };
  return { label: "Not used yet", tone: "purple" };
}

export function rfqState(r: { status: string; suppliers_total: number; suppliers_replied: number; lines_total: number; lines_awarded: number }): StatePill {
  if (r.status === "cancelled") return { label: "Cancelled", tone: "red" };
  if (r.status === "closed") return { label: "Closed", tone: "green" };
  if (r.status === "draft") return { label: "Draft", tone: "purple" };
  if (r.lines_total > 0 && r.lines_awarded >= r.lines_total) return { label: "Awarded", tone: "green" };
  if (r.lines_awarded > 0) return { label: `${r.lines_awarded} of ${r.lines_total} awarded`, tone: "teal" };
  if (r.suppliers_total === 0) return { label: "No suppliers", tone: "amber" };
  if (r.suppliers_replied === 0) return { label: "Sent", tone: "blue" };
  return { label: `${r.suppliers_replied} of ${r.suppliers_total} replied`, tone: r.suppliers_replied >= r.suppliers_total ? "teal" : "amber" };
}

/** An RFQ counts as out while suppliers can still answer it. */
export const rfqIsOut = (status: string): boolean => status === "sent" || status === "partially_replied" || status === "replied";

/** "today", "3 d ago", "5 wk ago", "7 mo ago": how old a record is, from a date or a timestamp. */
export function ageText(fromKey: string | null | undefined, todayKey: string): string {
  const d = daysSince(fromKey, todayKey);
  if (d == null) return "";
  if (d <= 0) return "today";
  if (d < 14) return `${d} d ago`;
  if (d < 60) return `${Math.floor(d / 7)} wk ago`;
  return `${Math.floor(d / 30)} mo ago`;
}

export type CostingTiles = { priced: number; unpriced: number; rfqs_out: number; replies_in: number };

export type BoqSummary = { rows: number; priced: number; unpriced: number; stale: number };

// ── The data the tab reads ───────────────────────────────────────────────────────────────────────────────────────────────

export type CostingEstimateItem = {
  kind: "estimate";
  id: string; ref: string | null; name: string; template_name: string | null; status: string;
  cost_total: number | null; price: number | null; currency: string | null; updated_at: string;
  rows: RowsRef; linked_rows: number; stale_links: number; missing_count: number;
  /** The links whose estimate changed after they priced a row: what "Re-price" sends (the server works the cost out again). */
  stale_link_ids: string[];
  state: StatePill;
  /** RFQs raised for this estimate's missing costs: they show here as well as in their own line. */
  rfqs: { id: string; ref: string | null; status_label: string; tone: PillarKey }[];
  /** The estimate is locked by a quote: nothing can be re-priced from it any more. */
  locked: boolean;
};

export type CostingRfqItem = {
  kind: "rfq";
  id: string; ref: string | null; title: string; status: string; created_at: string; respond_by: string | null;
  origin: "deal" | "estimate"; origin_label: string | null;
  rows: RowsRef;
  suppliers_total: number; suppliers_replied: number; lines_total: number; lines_awarded: number;
  /** What the lines add up to at the awarded cost, else at the lowest valid price; null while nothing is quoted. */
  total: number | null; total_is_awarded: boolean;
  state: StatePill;
  /** Standing awards not yet written onto a BOQ row (awarded before this screen existed, or the write failed). */
  awarded_unpriced: number;
};

export type CostingItem = CostingEstimateItem | CostingRfqItem;

export type CostingData = {
  /** 0227 (estimates in a tender) or 0128 (RFQ) has not been applied: the part that needs it says so, the rest works. */
  pending_estimates: boolean;
  pending_rfqs: boolean;
  estimates_on: boolean;
  rfqs_on: boolean;
  can_edit: boolean;
  can_create_estimate: boolean;
  can_award: boolean;
  items: CostingItem[];
  boq: BoqSummary;
  tiles: CostingTiles;
  templates: { id: string; name: string }[];
  /** The deal's saved lines as RFQ starting lines (unpriced ones ticked). Empty when the RFQ module is off. */
  rfq_lines: ComposerLine[];
  rfq_origin_label: string;
  markup_default: number;
  currency: string;
  today: string;
  stage: string;
  bid_locked: boolean;
};

// ── The compare and award screen ─────────────────────────────────────────────────────────────────────────────────────────

export type CompareLineView = {
  id: string; sl_no: number; description: string; uom: string | null; qty: number | null; status: string; awarded_unit_cost: number | null;
  /** The BOQ item numbers this RFQ line prices (its deal line's item number). */
  rows: string[];
};

export type CompareSupplierView = {
  id: string; supplier_id: string; name: string; status: string; currency: string | null; incoterm: string | null;
  reminder_count: number; last_reminded_at: string | null;
};

export type CompareAwardView = {
  id: string; rfq_line_id: string; rfq_supplier_id: string; response_id: string; chosen_at: string; chosen_by_name: string | null;
  reason: string | null; not_lowest: boolean; landed_unit: number | null; applied_to_deal_at: string | null; applied_rate: number | null;
};

export type CompareView = {
  rfq: { id: string; ref: string | null; title: string; status: string; respond_by: string | null; origin: "deal" | "estimate" };
  lines: CompareLineView[];
  suppliers: CompareSupplierView[];
  responses: {
    id: string; rfq_supplier_id: string; rfq_line_id: string; status: "quoted" | "no_quote" | "alternative"; unit_price: number | null; fx_rate: number | null;
    currency: string | null; lead_time_days: number | null; moq: number | null; valid_until: string | null; note: string | null; submitted_at: string;
    is_awarded: boolean; offered_description: string | null;
  }[];
  awards: CompareAwardView[];
  awards_pending: boolean;
  today: string;
  stale_days: number;
  max_reminders: number;
  tenant_currency: string;
  markup_default: number;
  can_award: boolean;
  bid_locked: boolean;
  /** An award on a deal RFQ writes the cost, the markup and the source onto the BOQ row; an award on an estimate RFQ goes through the estimate. */
  prices_rows: boolean;
};

/** Standing awards that exist but have not been written onto a BOQ row. */
export const unpricedAwards = (awards: readonly Pick<CompareAwardView, "applied_to_deal_at">[]): number => awards.filter((a) => !a.applied_to_deal_at).length;

/** The compare screen's one-line sum for an award: "Cost 22.00 + 15% = rate 25.30". */
export function awardSum(cost: number, markupPct: number): string {
  const f = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Cost ${f(round4(cost))} + ${round2(markupPct)}% = rate ${f(awardRate(cost, markupPct))}`;
}

export const tileTone = (n: number, whenPositive: Tone): Tone => (n > 0 ? whenPositive : "neutral");
