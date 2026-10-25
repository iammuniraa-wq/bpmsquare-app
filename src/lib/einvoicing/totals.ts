import { ZATCA_RULES, isVatCategory, type EinvoiceInvoiceInput, type EinvoiceLineInput, type VatCategory } from "./rules";

// VAT totals by rate, in whole halalas (integers). No floating-point money is summed anywhere in this file.
//
// Rounding policy (documented because it decides every halala of a tax document):
//  * A line's NET is the stored line `amount`, converted to halalas once (round half up). The stored amount is already
//    the 2-decimal figure the customer sees, so the document and the maths agree.
//  * The invoice discount (percent or fixed) is a DOCUMENT-LEVEL allowance. It is split across the VAT groups in
//    proportion to their net with the largest-remainder method, so the pieces add up to the discount exactly and no
//    halala is created or lost.
//  * VAT is rounded ONCE PER VAT GROUP (category + rate): vat = round_half_up(taxable_of_group x rate / 100). This is the
//    EN 16931 model (BR-CO-17) that ZATCA's UBL profile follows, and it is the figure that goes in the invoice tax total.
//  * The per-line VAT shown next to a line is INDICATIVE (round_half_up(line net x rate)); rounded line by line it can
//    differ from the group figure by a few halalas. The group figure is authoritative, `lineVatSum` is returned so a
//    caller can show or test the difference.

export type VatGroup = {
  /** The category of the group, or null for lines that have no category yet (the invoice is then not ready). */
  category: VatCategory | null;
  /** Percent, e.g. 15. null for the uncategorised group. */
  rate: number | null;
  /** Sum of the line nets in the group, before the document discount. */
  net: number;
  /** The group's share of the document discount. */
  discount: number;
  /** net - discount: the amount VAT is charged on. */
  taxable: number;
  vat: number;
  /** taxable + vat. */
  gross: number;
  /** The reasons given on the lines of an exempt, zero-rated or out-of-scope group (distinct, in order). */
  reasons: string[];
  lines: number;
};

export type VatTotals = {
  groups: VatGroup[];
  /** Sum of line nets (what `invoices.total` holds). */
  subtotal: number;
  discount: number;
  /** subtotal - discount. */
  taxableTotal: number;
  vatTotal: number;
  /** taxableTotal + vatTotal: the amount payable. */
  grandTotal: number;
  /** Sum of the indicative per-line VAT; compare with vatTotal to see the line-versus-group rounding difference. */
  lineVatSum: number;
  /** Per-line indicative VAT, in line order. */
  lineVat: number[];
};

/** Halalas from a money number: round half up, tolerant of binary noise (1.005 style) by working from the 3rd decimal. */
export function toHalalas(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const sign = amount < 0 ? -1 : 1;
  // toFixed(6) strips binary noise before the half-up rounding, so 1.005 -> 100.5 -> 101 like a person would.
  const scaled = Math.abs(Number((Math.abs(amount) * ZATCA_RULES.subunit).toFixed(6)));
  return sign * Math.floor(scaled + 0.5);
}

export function fromHalalas(halalas: number): number {
  return halalas / ZATCA_RULES.subunit;
}

/** round_half_up(a * numerator / denominator) for non-negative integers, exact (BigInt) at any size. */
export function mulDivRound(a: number, numerator: number, denominator: number): number {
  if (a === 0 || numerator === 0) return 0;
  const neg = a < 0;
  const A = BigInt(Math.abs(a));
  const N = BigInt(numerator);
  const D = BigInt(denominator);
  const two = BigInt(2);
  const q = (A * N * two + D) / (D * two);
  const r = Number(q);
  return neg ? -r : r;
}

/** The rate as hundredths of a percent, so 15 -> 1500 and 2.5 -> 250 (the numeric(5,2) column). */
function rateHundredths(rate: number): number {
  return Math.round(rate * 100);
}

export function vatOnTaxable(taxableHalalas: number, rate: number): number {
  return mulDivRound(taxableHalalas, rateHundredths(rate), 10000);
}

/** The document discount in halalas, never above the subtotal and never negative. */
export function discountHalalas(invoice: Pick<EinvoiceInvoiceInput, "discount_type" | "discount_pct" | "discount_fixed">, subtotalHalalas: number): number {
  let d = 0;
  if (invoice.discount_type === "fixed") d = toHalalas(invoice.discount_fixed ?? 0);
  else if (invoice.discount_type === "pct" || invoice.discount_type == null) {
    const pct = Math.min(100, Math.max(0, invoice.discount_pct ?? 0));
    d = mulDivRound(subtotalHalalas, rateHundredths(pct), 10000);
  }
  return Math.min(Math.max(0, d), Math.max(0, subtotalHalalas));
}

/** Largest-remainder split of `total` over `weights` (non-negative integers): the parts add up to `total` exactly. */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const T = BigInt(total);
  const S = BigInt(sum);
  const base = weights.map((w) => (T * BigInt(w)) / S);
  const rem = weights.map((w, i) => ({ i, r: (T * BigInt(w)) % S }));
  let left = Number(T - base.reduce((s, b) => s + b, BigInt(0)));
  // Hand the leftover halalas to the biggest remainders; ties go to the earlier group so the result is deterministic.
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = base.map((b) => Number(b));
  for (const { i } of rem) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

const NO_CATEGORY = "none";
const groupKey = (c: VatCategory | null, r: number | null) => (c == null ? NO_CATEGORY : `${c}@${rateHundredths(r ?? 0)}`);

export function computeVatTotals(
  invoice: Pick<EinvoiceInvoiceInput, "discount_type" | "discount_pct" | "discount_fixed">,
  lines: EinvoiceLineInput[],
): VatTotals {
  const order: string[] = [];
  const byKey = new Map<string, VatGroup>();
  const lineVat: number[] = [];
  let subtotal = 0;

  for (const l of lines) {
    const net = toHalalas(l.amount);
    subtotal += net;
    const cat = isVatCategory(l.vat_category) ? l.vat_category : null;
    // A categorised line with no rate is read as rate 0 here; the validator reports the missing rate separately.
    const rate = cat == null ? null : (l.vat_rate ?? 0);
    const key = groupKey(cat, rate);
    let g = byKey.get(key);
    if (!g) {
      g = { category: cat, rate, net: 0, discount: 0, taxable: 0, vat: 0, gross: 0, reasons: [], lines: 0 };
      byKey.set(key, g);
      order.push(key);
    }
    g.net += net;
    g.lines += 1;
    const reason = (l.vat_exemption_reason ?? "").trim();
    if (reason && !g.reasons.includes(reason)) g.reasons.push(reason);
    lineVat.push(cat == null ? 0 : vatOnTaxable(net, rate ?? 0));
  }

  const discount = discountHalalas(invoice, subtotal);
  const shares = allocateProportionally(discount, order.map((k) => byKey.get(k)!.net));
  let vatTotal = 0;
  let taxableTotal = 0;
  const groups = order.map((k, i) => {
    const g = byKey.get(k)!;
    g.discount = shares[i];
    g.taxable = g.net - g.discount;
    g.vat = g.category == null ? 0 : vatOnTaxable(g.taxable, g.rate ?? 0);
    g.gross = g.taxable + g.vat;
    vatTotal += g.vat;
    taxableTotal += g.taxable;
    return g;
  });
  // Stable order: highest rate first, then category, uncategorised last -- the order a tax document prints them in.
  groups.sort((a, b) => {
    if (a.category == null) return b.category == null ? 0 : 1;
    if (b.category == null) return -1;
    return (b.rate ?? 0) - (a.rate ?? 0) || a.category.localeCompare(b.category);
  });

  return {
    groups,
    subtotal,
    discount,
    taxableTotal,
    vatTotal,
    grandTotal: taxableTotal + vatTotal,
    lineVatSum: lineVat.reduce((s, v) => s + v, 0),
    lineVat,
  };
}
