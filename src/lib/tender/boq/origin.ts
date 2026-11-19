// Where each BOQ price came from, for the screen (owner walkthrough 2026-11-19: "what if there are more projects"). PURE.
// One short chip per row, the detail behind a click, and the BOQ amount split by source group for the bar above the table.

import { priceKind, type PriceKind, type PriceSource } from "./price";
import { rfqRefOf, sourceView } from "./table";

export const SOURCE_GROUPS = ["supplier", "estimate", "past", "client", "typed", "unpriced"] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];
export const SOURCE_GROUP_LABEL: Record<SourceGroup, string> = {
  supplier: "Supplier", estimate: "Estimate / BOM", past: "Past bids", client: "Client rate", typed: "Typed", unpriced: "Unpriced",
};
/** The long name, for a button's accessible name. */
export const SOURCE_GROUP_NAME: Record<SourceGroup, string> = {
  supplier: "Supplier cost", estimate: "Estimate or BOM cost", past: "Past bids, rate only", client: "Client's rate", typed: "Typed by hand", unpriced: "Unpriced",
};
type PricedGroup = Exclude<SourceGroup, "unpriced">;
const GROUP_OF: Record<PriceSource, PricedGroup> = { supplier: "supplier", bom: "estimate", estimate: "estimate", past_project: "past", boq_rate: "client", manual: "typed" };

type OriginRow = { priced: boolean; removed?: boolean; amount: number; price_source: PriceSource | null; price_source_ref: string | null; unit_cost: number | null };

export const sourceGroupOf = (l: Pick<OriginRow, "priced" | "price_source">): SourceGroup => (!l.priced || !l.price_source ? "unpriced" : GROUP_OF[l.price_source]);

export const parseSourceGroup = (v: unknown): SourceGroup | null => ((SOURCE_GROUPS as readonly string[]).includes(v as string) ? (v as SourceGroup) : null);

export type MixPart = { group: SourceGroup; rows: number; amount: number; pct: number };

/** The BOQ amount by source group, in a fixed order, empty groups left out. Percentages are whole numbers of the priced amount. */
export function sourceMix(lines: readonly OriginRow[]): MixPart[] {
  const acc = new Map<SourceGroup, { rows: number; amount: number }>();
  for (const l of lines) {
    if (l.removed) continue;
    const g = sourceGroupOf(l);
    const a = acc.get(g) ?? { rows: 0, amount: 0 };
    a.rows += 1; a.amount += g === "unpriced" ? 0 : Number(l.amount) || 0;
    acc.set(g, a);
  }
  const total = [...acc.values()].reduce((s, a) => s + a.amount, 0);
  return SOURCE_GROUPS.filter((g) => acc.has(g)).map((g) => {
    const a = acc.get(g)!;
    return { group: g, rows: a.rows, amount: a.amount, pct: total > 0 ? Math.round((a.amount / total) * 100) : 0 };
  });
}

/** "Supplier 12%"; unpriced rows carry no amount, so they are counted. */
export const mixPartText = (p: MixPart): string =>
  p.group === "unpriced" ? `${SOURCE_GROUP_LABEL.unpriced} ${p.rows} row${p.rows === 1 ? "" : "s"}` : `${SOURCE_GROUP_LABEL[p.group]} ${p.pct}%`;

export type SourceChipView = {
  icon: PricedGroup; kind: PriceKind;
  /** "Supplier", "Past bid": the short name in the column. */
  name: string;
  /** The record's own reference ("RFQ-0008", "OPP-0027"), or null. */
  short: string | null;
  /** The one line on the row. */
  text: string;
  /** The whole of it, for the title and the accessible name. */
  full: string;
};

const CHIP_NAME: Record<PriceSource, string> = { supplier: "Supplier", bom: "BOM", estimate: "Estimate", past_project: "Past bid", boq_rate: "Client rate", manual: "Typed" };
const KIND_WORD: Record<PriceKind, string> = { cost: "a cost", sell: "a selling rate only, no known cost" };

/** The first part of a stored reference: "OPP-0027 · T-14" is "OPP-0027", "Estimate EST-0016" is "EST-0016". */
export function shortRef(source: PriceSource, ref: string | null): string | null {
  if (!ref || source === "boq_rate" || source === "manual") return null;
  const first = ref.split(" · ")[0].trim().replace(/^Estimate\s+/i, "");
  return first || null;
}

/** The chip of a priced row; null for a row with no price. */
export function sourceChip(l: Pick<OriginRow, "price_source" | "price_source_ref" | "unit_cost">): SourceChipView | null {
  const source = l.price_source;
  const kind = priceKind(source, l.unit_cost);
  if (!source || !kind) return null;
  const name = CHIP_NAME[source];
  const short = rfqRefOf(l) ?? shortRef(source, l.price_source_ref);
  const v = sourceView(l);
  const rest = v.detail ?? (v.was ? `was ${v.was}` : null);
  return { icon: GROUP_OF[source], kind, name, short, text: short ? `${name} · ${short}` : name, full: `${name}${rest ? ` · ${rest}` : ""}, ${KIND_WORD[kind]}` };
}

/** "(same cost code)" at the end of a candidate's label is why a past bid matched. */
export function whyOf(label: string): string | null {
  const m = /\((same (?:cost code|product|description))\)\s*$/.exec(label);
  return m ? m[1] : null;
}
