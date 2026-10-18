// The live preview of an estimate (docs/estimator-architecture.md §15): what the
// working page shows while the person is still typing. A thin, pure layer over
// computeEstimate and buildQuoteLines -- no I/O, no server-only imports, so the
// same code runs in the browser (instant, for rate-priced templates), on the
// server (the preview route) and in tests. It adds nothing to the maths: every
// figure is the engine's, and the customer-facing sections are exactly the
// lines buildQuoteLines will put on the Standard Quote.

import { computeEstimate } from "./compute";
import type { ComputedLine, CostSummary } from "./compute";
import { roundMoney } from "./compute";
import { alternativesInput, buildQuoteLines } from "./quoteLines";
import type { QuoteSourceLine } from "./quoteLines";
import type { GeometryModel } from "./geometry";
import type { EstimateParams, TemplateIssue } from "./template";
import type { EstimateTemplateBody, QuoteGranularity } from "./types";
import type { ScheduleQty } from "./compute";

/** One customer-facing section: a quote line's description and its price. */
export type PriceSection = { key: string; name: string; amount: number };

export type PriceOption = { key: string; label: string; total: number; delta: number; selected: boolean };

/** Sections and totals, worked out from cost lines. */
export type PriceView = {
  sections: PriceSection[];
  /** Before VAT. */
  price: number;
  vat_pct: number;
  vat: number;
  /** Including VAT. */
  total: number;
  /** Why no sections could be built (an unpriced line, nothing to price). */
  problems: string[];
};

export function toQuoteSource(l: ComputedLine): QuoteSourceLine {
  return {
    description: l.description, uom: l.uom, qty: l.qty, waste_pct: l.waste_pct,
    group: l.group, group_key: l.group_key, cost_total: l.cost_total,
  };
}

/** The price a customer would see for these lines: sections that add up to the price, VAT, total. */
export function buildPriceView(
  sources: readonly QuoteSourceLine[],
  opts: { granularity: QuoteGranularity; margin_pct: number; vat_pct: number },
): PriceView {
  const built = buildQuoteLines(sources, { granularity: opts.granularity, margin_pct: opts.margin_pct });
  if (!built.ok) return { sections: [], price: 0, vat_pct: opts.vat_pct, vat: 0, total: 0, problems: built.problems };
  const vat = roundMoney((built.price * opts.vat_pct) / 100);
  return {
    sections: built.lines.map((l, i) => ({ key: String(i), name: l.description, amount: l.amount })),
    price: built.price,
    vat_pct: opts.vat_pct,
    vat,
    total: roundMoney(built.price + vat),
    problems: [],
  };
}

export type PreviewInput = {
  template: EstimateTemplateBody;
  granularity?: QuoteGranularity;
  params: Record<string, unknown> | null | undefined;
  margin_pct: number;
  vat_pct: number;
  /** Resolved unit costs for product rules (from the preview route). */
  unit_costs?: Readonly<Record<string, number>>;
  schedule?: readonly ScheduleQty[];
};

export type PreviewSuccess = {
  ok: true;
  lines: ComputedLine[];
  summary: CostSummary;
  params: EstimateParams;
  model: GeometryModel | null;
  view: PriceView;
  /** The select input whose options are quoted as alternatives, if the template flags one. */
  options: { label: string; items: PriceOption[] } | null;
  /** Codes of product rules still without a cost. */
  unpriced: string[];
  complete: boolean;
  warnings: string[];
};

export type EstimatePreview = PreviewSuccess | { ok: false; issues: TemplateIssue[] };

/** Move every option by the same amount, so options computed from the template line up with a stored total that carries hand edits. */
export function shiftOptions(options: { label: string; items: PriceOption[] } | null, by: number): { label: string; items: PriceOption[] } | null {
  if (!options || by === 0) return options;
  return { label: options.label, items: options.items.map((o) => ({ ...o, total: roundMoney(o.total + by) })) };
}

/** True when pricing the template needs the catalogue (a product-backed rule). */
export function needsCatalogue(template: Pick<EstimateTemplateBody, "rules">): boolean {
  return template.rules.some((r) => r.cost.kind === "product");
}

export function previewEstimate(input: PreviewInput): EstimatePreview {
  const granularity = input.granularity ?? "group";
  const base = {
    margin_pct: input.margin_pct, vat_pct: input.vat_pct,
    unit_costs: input.unit_costs, schedule: input.schedule ? [...input.schedule] : undefined,
  };
  const res = computeEstimate(input.template, input.params, base);
  if (!res.ok) return { ok: false, issues: res.issues };

  const view = buildPriceView(res.lines.map(toQuoteSource), { granularity, margin_pct: input.margin_pct, vat_pct: input.vat_pct });

  let options: PreviewSuccess["options"] = null;
  const alt = alternativesInput(input.template.inputs);
  if (alt && res.complete) {
    const chosen = String(res.params[alt.key] ?? alt.default);
    const items: PriceOption[] = [];
    for (const o of alt.options ?? []) {
      if (o.key === chosen) { items.push({ key: o.key, label: o.label, total: res.summary.price_incl_vat, delta: 0, selected: true }); continue; }
      const other = computeEstimate(input.template, { ...res.params, [alt.key]: o.key }, base);
      if (!other.ok) continue;
      items.push({ key: o.key, label: o.label, total: other.summary.price_incl_vat, delta: 0, selected: false });
    }
    const first = items[0]?.total ?? 0;
    for (const i of items) i.delta = roundMoney(i.total - first);
    options = items.length > 1 ? { label: alt.label, items } : null;
  }

  return {
    ok: true, lines: res.lines, summary: res.summary, params: res.params, model: res.model, view, options,
    unpriced: res.unpriced, complete: res.complete, warnings: res.warnings,
  };
}
