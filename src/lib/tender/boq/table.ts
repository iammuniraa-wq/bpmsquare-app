// The Bill of quantities table of a tender deal (redesign, 2026-10-27): the rules the table and its row panel share. PURE, so a test can
// hold them. One row per client BOQ line; the client's item number is always shown as written; the Source cell keeps its source whoever
// edits the rate; chips say which estimate prices the row, which RFQ it was awarded under, and whether it is unpriced or stale.

import { PRICE_SOURCE_LABEL, type PriceSource } from "./price";

export const BOQ_FILTERS = ["all", "unpriced", "stale"] as const;
export type BoqFilter = (typeof BOQ_FILTERS)[number];

/** The slice of a BOQ line the rules need (the screen's BoqLineView satisfies it). */
export type RowLike = {
  item_no: string | null; row_no: number; priced: boolean; removed: boolean;
  price_source: PriceSource | null; price_source_ref: string | null;
  stale: boolean; stale_accepted: boolean;
};

/** A row counts as stale the way the totals count it: priced, older than the workspace's limit, and not accepted knowingly. */
export const isStaleRow = (l: Pick<RowLike, "priced" | "stale" | "stale_accepted">): boolean => l.priced && l.stale && !l.stale_accepted;
export const isUnpricedRow = (l: Pick<RowLike, "priced">): boolean => !l.priced;

/** Rows removed in a revised file are not part of the table (the screen says how many are kept). */
export const activeRows = <T extends Pick<RowLike, "removed">>(lines: readonly T[]): T[] => lines.filter((l) => !l.removed);

export function filterRows<T extends RowLike>(lines: readonly T[], filter: BoqFilter): T[] {
  const active = activeRows(lines);
  if (filter === "unpriced") return active.filter(isUnpricedRow);
  if (filter === "stale") return active.filter(isStaleRow);
  return active;
}

export const filterCounts = (lines: readonly RowLike[]): Record<BoqFilter, number> => {
  const active = activeRows(lines);
  return { all: active.length, unpriced: active.filter(isUnpricedRow).length, stale: active.filter(isStaleRow).length };
};

/** A value from the address or a saved state that is not a filter is "all". */
export const parseFilter = (v: unknown): BoqFilter => (BOQ_FILTERS as readonly string[]).includes(v as string) ? (v as BoqFilter) : "all";

/** The item number as the client wrote it. A row the file gave no number to is named by its row in the file, never renumbered. */
export const itemLabel = (l: Pick<RowLike, "item_no" | "row_no">): string => (l.item_no && l.item_no.trim() ? l.item_no : `#${l.row_no}`);

// ── Source ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const WAS = "was ";

/**
 * What a manual rate records in `price_source_ref` so the source it replaced is not lost: "was Supplier · RFQ-0012 · Gulf Pipes". A rate
 * that was already manual keeps what it recorded earlier (a second manual edit does not erase the first source). A row that was never
 * priced records nothing.
 */
export function manualSourceRef(prev: { price_source: PriceSource | null; price_source_ref: string | null }): string | null {
  if (!prev.price_source) return null;
  if (prev.price_source === "manual") return prev.price_source_ref && prev.price_source_ref.startsWith(WAS) ? prev.price_source_ref : null;
  const label = PRICE_SOURCE_LABEL[prev.price_source];
  return `${WAS}${label}${prev.price_source_ref ? ` · ${prev.price_source_ref}` : ""}`.slice(0, 200);
}

/** The Source cell: the source's name, and for a manual rate the source it replaced ("Supplier · RFQ-0012 · Gulf Pipes"). */
export function sourceView(l: Pick<RowLike, "price_source" | "price_source_ref">): { label: string; detail: string | null; was: string | null } {
  if (!l.price_source) return { label: "Not priced", detail: null, was: null };
  const label = PRICE_SOURCE_LABEL[l.price_source];
  if (l.price_source === "manual") {
    const ref = l.price_source_ref;
    return { label, detail: null, was: ref && ref.startsWith(WAS) ? ref.slice(WAS.length) : null };
  }
  return { label, detail: l.price_source_ref ?? null, was: null };
}

// ── Chips ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An RFQ-priced row: a supplier price whose reference starts with the RFQ's own reference ("RFQ-0012 · Gulf Pipes"). */
export function rfqRefOf(l: Pick<RowLike, "price_source" | "price_source_ref">): string | null {
  if (l.price_source !== "supplier" || !l.price_source_ref) return null;
  const m = /^(RFQ-[A-Za-z0-9-]+)/i.exec(l.price_source_ref.trim());
  return m ? m[1] : null;
}

export type EstimateLinkLike = { boq_id: string; estimate_ref: string | null; estimate_name: string; stale?: boolean; waiting?: boolean; broken?: boolean };

/** The estimates that price a row: the deal's links first; a rate set from an estimate with no link left still names it from its reference. */
export function estimateRefsOf(l: Pick<RowLike, "price_source" | "price_source_ref"> & { id: string }, links: readonly EstimateLinkLike[]): string[] {
  const refs = links.filter((k) => k.boq_id === l.id && !k.broken).map((k) => k.estimate_ref ?? k.estimate_name);
  if (refs.length === 0 && l.price_source === "estimate" && l.price_source_ref) refs.push(l.price_source_ref);
  return [...new Set(refs)];
}

export type Chip = { kind: "estimate" | "rfq" | "unpriced" | "stale" | "changed"; label: string };

/** The chips of a row, in a fixed order: estimate, RFQ, then what needs a person (unpriced, stale, estimate changed). */
export function rowChips(l: RowLike & { id: string }, links: readonly EstimateLinkLike[] = []): Chip[] {
  const chips: Chip[] = [];
  for (const ref of estimateRefsOf(l, links)) chips.push({ kind: "estimate", label: ref });
  const rfq = rfqRefOf(l);
  if (rfq) chips.push({ kind: "rfq", label: rfq });
  if (!l.priced) chips.push({ kind: "unpriced", label: "Unpriced" });
  else if (l.stale) chips.push({ kind: "stale", label: l.stale_accepted ? "Stale, accepted" : "Stale" });
  if (links.some((k) => k.boq_id === l.id && (k.stale || k.waiting) && !k.broken)) chips.push({ kind: "changed", label: "Estimate changed" });
  return chips;
}

// ── Totals and paging ────────────────────────────────────────────────────────────────────────────────────────────────

/** Priced rows as a whole-number percent of the active rows (0 when there are none). */
export const pricedPercent = (priced: number, lines: number): number => (lines > 0 ? Math.round((priced / lines) * 100) : 0);

export const PAGE_SIZE = 50;

/** Hundreds of rows are shown a page at a time; "Show N more" adds the next page. */
export function pageOf<T>(rows: readonly T[], shown: number): { rows: T[]; hidden: number; more: number } {
  const n = Math.max(PAGE_SIZE, shown);
  const visible = rows.slice(0, n);
  const hidden = rows.length - visible.length;
  return { rows: visible, hidden, more: Math.min(PAGE_SIZE, hidden) };
}

/** A markup typed in a box: a number from 0 to 1000, else the fallback. */
export function parseMarkup(v: string, fallback: number): number {
  if (v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : fallback;
}

/** Cost, markup and rate for the panel: "Cost 100.00 + 15% = 115.00", only when the row's rate was built from a cost. */
export function costBreakdown(l: { unit_cost: number | null; markup_pct: number | null; rate: number }): { cost: number; markup: number; rate: number } | null {
  if (l.unit_cost == null || !(l.unit_cost > 0)) return null;
  return { cost: l.unit_cost, markup: l.markup_pct ?? 0, rate: l.rate };
}
