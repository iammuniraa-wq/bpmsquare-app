// The composition strip (docs/design/estimator-visual-for-every-estimate.md): the estimate as a picture of its parts, for EVERY template.
// One bar per group (width = share of cost), the cost components as one stacked bar, a pill per line still without a price. Built from
// the totals a compute already returns, so it moves with the live preview and needs no geometry. Pure.
//
// The customer variant keeps shares only: the totals are internal until they are quoted, so it carries no amount and no component split.

import { ESTIMATE_COMPONENTS, ESTIMATE_COMPONENT_LABEL } from "./types";
import type { EstimateComponent } from "./types";

export type StripBar = { key: string; label: string; amount: number; /** Exact share, 0..1. */ frac: number; /** Whole percent; the bars of one row add up to 100. */ pct: number };
export type StripPill = { code: string; label: string };

export type CompositionStrip = {
  total: number;
  groups: StripBar[];
  components: StripBar[];
  unpriced: StripPill[];
};

export type CustomerStrip = { groups: { key: string; label: string; frac: number; pct: number }[] };

type TotalsLike = {
  by_group: readonly { key: string; name: string; cost: number }[];
  by_component: Partial<Record<EstimateComponent, number>>;
  unpriced?: readonly string[];
};

/** Whole-number shares that add up to exactly 100 (largest remainder); every value must be positive. */
export function wholeShares(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const floor = exact.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const o of order) { if (left <= 0) break; floor[o.i] += 1; left -= 1; }
  return floor;
}

function bars(rows: readonly { key: string; label: string; amount: number }[]): StripBar[] {
  const live = rows.filter((r) => Number.isFinite(r.amount) && r.amount > 0);
  const total = live.reduce((a, r) => a + r.amount, 0);
  const pct = wholeShares(live.map((r) => r.amount));
  return live.map((r, i) => ({ ...r, frac: total > 0 ? r.amount / total : 0, pct: pct[i] }));
}

/** The strip for a set of totals; null while there is nothing to show (no totals, or no cost yet). `lines` gives names to the unpriced codes. */
export function buildStrip(totals: TotalsLike | null | undefined, lines: readonly { code: string | null; description: string }[] = []): CompositionStrip | null {
  if (!totals) return null;
  const groups = bars(totals.by_group.map((g) => ({ key: g.key, label: g.name, amount: g.cost })));
  if (groups.length === 0) return null;
  const components = bars(ESTIMATE_COMPONENTS.map((c) => ({ key: c, label: ESTIMATE_COMPONENT_LABEL[c], amount: totals.by_component[c] ?? 0 })));
  const name = new Map(lines.filter((l) => l.code).map((l) => [l.code as string, l.description]));
  return {
    total: groups.reduce((a, g) => a + g.amount, 0),
    groups, components,
    unpriced: (totals.unpriced ?? []).map((code) => ({ code, label: name.get(code) ?? code })),
  };
}

/** What a customer may see of the strip: the groups and their share, never an amount, a component or an unpriced line. */
export function customerStrip(strip: CompositionStrip | null): CustomerStrip | null {
  if (!strip) return null;
  return { groups: strip.groups.map((g) => ({ key: g.key, label: g.label, frac: g.frac, pct: g.pct })) };
}
