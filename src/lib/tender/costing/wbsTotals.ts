import type { WbsState } from "@/lib/tender/wbs/types";
import type { Figures } from "@/lib/wbs/tree";

// The "Totals by WBS" section of the Costing tab (docs/design/wbs.md section 3b): for each WBS item, what the client is asked to pay, what it
// costs us and the margin between them. The figures are the tender WBS roll-up (parents add their sub-items, a split line counts by its shares), so
// nothing here recounts a line. PURE: the section and its tests share it.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** What GET /api/opportunities/[id]/tender/wbs answers, as much of it as this section reads. */
export type WbsTotalsData = Pick<WbsState, "pending" | "items" | "rollup" | "total"> & { unassigned?: { amount: number; remainder_pct: number }[] };

export type TotalsItem ={ id: string; code: string; name: string; depth: number };

export type TotalsRow = {
  id: string;
  code: string;
  name: string;
  depth: number;
  /** What the client pays for what sits in the item and under it. */
  bid: number;
  /** Our cost of the same rows; null while none of them has one. */
  cost: number | null;
  /** Bid less cost; null until every priced row in the item has a cost (a margin over part of the rows would read too high). */
  margin: number | null;
  /** The margin as a whole percent of the bid; null with the margin, and when the bid is 0. */
  margin_pct: number | null;
  /** Priced rows without a cost, so a person can see why the margin is blank. */
  uncosted: number;
};

/** The margin of one set of figures, or null when it cannot be stated honestly. */
export function marginOf(f: Figures | undefined): { margin: number; pct: number | null } | null {
  if (!f || f.cost === null || f.priced_count === 0 || f.costed_count < f.priced_count) return null;
  const margin = round2(f.client_amount - f.cost);
  return { margin, pct: f.client_amount > 0 ? Math.round((margin / f.client_amount) * 100) : null };
}

export function totalsRow(item: TotalsItem, f: Figures | undefined): TotalsRow {
  const m = marginOf(f);
  return {
    id: item.id, code: item.code, name: item.name, depth: item.depth, bid: f?.client_amount ?? 0, cost: f?.cost ?? null,
    margin: m?.margin ?? null, margin_pct: m?.pct ?? null, uncosted: f ? Math.max(0, f.priced_count - f.costed_count) : 0,
  };
}

/** Every item in tree order with its figures; `items` is already in tree order (the WBS answer is). */
export const totalsRows = (items: readonly TotalsItem[], rollup: Readonly<Record<string, Figures>>): TotalsRow[] => items.map((i) => totalsRow(i, rollup[i.id]));

/** What is not in any item: the amount of the lines in none, and of the remainder of a split line. */
export function outsideWbs(unassigned: readonly { amount: number; remainder_pct: number }[]): { rows: number; bid: number } {
  return { rows: unassigned.length, bid: round2(unassigned.reduce((s, u) => s + (u.amount * u.remainder_pct) / 100, 0)) };
}

/** `1,234.50`, or a dash when there is no figure. */
export const moneyText = (n: number | null | undefined): string => (n == null ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** `-3,200.00 (-4%)` style margin cell: the amount, and the percent of the bid beside it when there is one. */
export function marginText(r: Pick<TotalsRow, "margin" | "margin_pct">): string {
  if (r.margin === null) return "–";
  return r.margin_pct === null ? moneyText(r.margin) : `${moneyText(r.margin)} (${r.margin_pct}%)`;
}
