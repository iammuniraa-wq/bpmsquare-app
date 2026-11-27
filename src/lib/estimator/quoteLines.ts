// Pure part of the estimate -> Standard Quote conversion (docs/estimator-
// architecture.md §4): turns an estimate's cost lines into the CUSTOMER-FACING
// quote lines, without touching a database. The DB-touching assembler
// (server.ts assembleEstimateQuote) calls this and writes the result.
//
// The one rule this file exists to hold: a quote line carries a description, a
// unit, a quantity, a rate and an amount -- never a unit cost, a cost total or
// the margin. Cost + margin is collapsed into the price here, once.
//
// Rounding: every Standard Quote screen and its PDF show money in whole units,
// so a customer line is priced in whole units, once, at line level (rate x qty
// is its amount, nothing is rounded again on the way to the total). The quote's
// price is the estimate's price (`summariseLines`: round(cost_total +
// round(cost_total * margin%))) rounded the same way, and the few units the
// individual roundings drift by are put on the largest line, so the lines add
// up to the subtotal and the total exactly as printed.

import { roundHalfAway } from "./formula";
import { roundMoney, roundQty } from "./compute";
import type { QuoteGranularity, TemplateInput } from "./types";
import { itemKeyLabel } from "./productMatch";

/** What the builder needs of an estimate line. */
export type QuoteSourceLine = {
  description: string;
  uom: string | null;
  /** Net quantity. */
  qty: number;
  waste_pct?: number | null;
  group: string;
  group_key: string;
  /** Null = unpriced; the build refuses. */
  cost_total: number | null;
};

/** A customer-facing quote line. Deliberately no cost fields. */
export type QuoteLineDraft = {
  description: string;
  uom: string;
  qty: number;
  rate: number;
  amount: number;
};

export type QuoteLinesResult =
  | { ok: true; lines: QuoteLineDraft[]; price: number }
  | { ok: false; problems: string[] };

/** Decimal places of a customer line price: the whole units every quote screen and the PDF print. */
export const QUOTE_PRICE_DP = 0;
const roundPrice = (x: number): number => roundHalfAway(x, QUOTE_PRICE_DP);

/** The price a customer is quoted for an estimate's price: the estimate's own, in whole units. */
export const quotedPrice = roundPrice;

export type CustomerFigures = { price: number; vat: number; total: number };

/**
 * The one derivation of what a customer pays for an estimate: the stored price in whole units, then VAT and total from that
 * rounded price, as the Standard Quote works them out. Every screen that shows a customer price reads it from here, never
 * `totals.price` or `totals.price_incl_vat` directly, so estimates saved earlier agree without being calculated again.
 */
export function customerFigures(price: number, vat_pct: number): CustomerFigures {
  const net = quotedPrice(price);
  const vat = roundMoney((net * (Number.isFinite(vat_pct) ? vat_pct : 0)) / 100);
  return { price: net, vat, total: roundMoney(net + vat) };
}

/** The same figures as the quote screens print them (whole units), for text that has no money formatter of its own. */
export function printedFigures(f: CustomerFigures): CustomerFigures {
  return { price: f.price, vat: roundPrice(f.vat), total: roundPrice(f.total) };
}

const fmtQty = (n: number): string => String(roundQty(n));

/** The price an estimate shows for a cost: same arithmetic as summariseLines. */
export function priceForCost(cost: number, margin_pct: number): number {
  const c = roundMoney(cost);
  const m = roundHalfAway(margin_pct, 2);
  return roundMoney(c + roundMoney((c * m) / 100));
}

/** Spread `target - sum` onto the largest amount so the amounts add up. */
function allocateRemainder(amounts: number[], target: number): number[] {
  if (amounts.length === 0) return amounts;
  const diff = roundMoney(target - amounts.reduce((a, b) => a + b, 0));
  if (diff === 0) return amounts;
  let at = 0;
  amounts.forEach((a, i) => { if (a > amounts[at]) at = i; });
  const out = [...amounts];
  out[at] = roundMoney(out[at] + diff);
  return out;
}

export function buildQuoteLines(
  lines: readonly QuoteSourceLine[],
  opts: { granularity: QuoteGranularity; margin_pct: number }
): QuoteLinesResult {
  const live = lines.filter((l) => Number.isFinite(l.qty) && l.qty > 0);
  if (live.length === 0) return { ok: false, problems: ["There are no lines to quote."] };
  const unpriced = live.filter((l) => l.cost_total === null || !Number.isFinite(l.cost_total));
  if (unpriced.length > 0) {
    const names = [...new Set(unpriced.map((l) => l.description))];
    return {
      ok: false,
      problems: [`${unpriced.length} line${unpriced.length === 1 ? " has" : "s have"} no cost yet: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", ..." : ""}.`],
    };
  }

  const totalCost = roundMoney(live.reduce((a, l) => a + (l.cost_total as number), 0));
  const target = roundPrice(priceForCost(totalCost, opts.margin_pct));
  if (target <= 0) return { ok: false, problems: ["The estimate prices to zero; there is nothing to quote."] };

  type Draft = { description: string; cost: number };
  let drafts: Draft[];
  if (opts.granularity === "line") {
    drafts = live.map((l) => ({
      description: `${l.description} (${fmtQty(l.qty * (1 + (l.waste_pct ?? 0) / 100))}${l.uom ? ` ${l.uom}` : ""})`,
      cost: l.cost_total as number,
    }));
  } else {
    const byGroup = new Map<string, Draft>();
    for (const l of live) {
      const key = l.group_key || "ungrouped";
      const g = byGroup.get(key) ?? { description: l.group?.trim() || "Items", cost: 0 };
      g.cost = roundMoney(g.cost + (l.cost_total as number));
      byGroup.set(key, g);
    }
    drafts = [...byGroup.values()];
  }

  // A line that costs nothing (a free supply) has no place on the quote.
  const priced = drafts
    .map((d) => ({ description: d.description, amount: roundPrice(priceForCost(d.cost, opts.margin_pct)) }))
    .filter((d) => d.amount > 0);
  if (priced.length === 0) return { ok: false, problems: ["Every line prices to zero; there is nothing to quote."] };
  const amounts = allocateRemainder(priced.map((d) => d.amount), target);

  return {
    ok: true,
    price: target,
    lines: priced.map((d, i) => ({ description: d.description, uom: "lot", qty: 1, rate: amounts[i], amount: amounts[i] })),
  };
}

// ── Alternatives ─────────────────────────────────────────────────────────────

/** The select input the template flags for quoting every option, if any. */
export function alternativesInput(inputs: readonly TemplateInput[]): TemplateInput | null {
  return inputs.find((i) => i.type === "select" && i.quote_alternatives === true && (i.options?.length ?? 0) > 1) ?? null;
}

export type AlternativeSet = { key: string; label: string; lines: QuoteLineDraft[] };

export type QuoteRowDraft = QuoteLineDraft & {
  sl_no: string;
  group_id: string | null;
  group_label: string | null;
  group_type: "alternative" | null;
  is_selected: boolean;
};

/** One option's lines become an alternative group; the chosen option is the
 *  one the estimate's own input value selects. */
export function tagAlternatives(sets: readonly AlternativeSet[], chosenKey: string): QuoteRowDraft[] {
  const out: QuoteRowDraft[] = [];
  for (const set of sets) {
    const chosen = set.key === chosenKey;
    for (const l of set.lines) {
      out.push({
        ...l,
        sl_no: String(out.length + 1),
        group_id: `alt_${set.key}`,
        group_label: set.label,
        group_type: "alternative",
        is_selected: chosen,
      });
    }
  }
  return out;
}

/** No alternatives: plain, numbered rows. */
export function plainRows(lines: readonly QuoteLineDraft[]): QuoteRowDraft[] {
  return lines.map((l, i) => ({ ...l, sl_no: String(i + 1), group_id: null, group_label: null, group_type: null, is_selected: true }));
}

// ── Pre-flight ───────────────────────────────────────────────────────────────

export type QuotableLine = QuoteSourceLine & { sku: string | null; product_id: string | null };

/**
 * Why an estimate cannot become a quote yet, in plain words (empty = it can).
 * A product line whose SKU never matched a catalogue product is "unresolved";
 * one with no cost is "unpriced". Both would put a hole in the customer's
 * price, so the conversion refuses instead of guessing.
 */
export function quoteBlockers(lines: readonly QuotableLine[]): string[] {
  const live = lines.filter((l) => Number.isFinite(l.qty) && l.qty > 0);
  const out: string[] = [];
  const unresolved = [...new Set(live.filter((l) => l.sku && !l.product_id).map((l) => itemKeyLabel(l.sku as string)))];
  if (unresolved.length > 0) {
    out.push(`No product in your catalogue matches ${unresolved.slice(0, 5).join(", ")}${unresolved.length > 5 ? ", ..." : ""}. Add or correct the product, then calculate again.`);
  }
  const built = buildQuoteLines(live, { granularity: "group", margin_pct: 0 });
  if (!built.ok) out.push(...built.problems);
  return out;
}
