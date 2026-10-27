// Sales Order line and header arithmetic, in one place so the route that stores a total, the print page that
// shows it and the Data Workbench that re-derives it can never disagree.
//
// Same order of operations as standardQuoteTotals.ts: the discount comes off first, tax applies to what is
// left, shipping is added last and is not taxed. The difference is that an order carries discount and tax on
// each LINE (the ERP's shape), where a Standard Quote carries them on the header; an order made from a quote
// folds the quote's header discount into every line (foldHeaderDiscount) so the two totals match.

export const r2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

const MAX_QTY = 1_000_000_000;
const MAX_MONEY = 99_999_999_999;

export function clampNumber(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export const clampQty = (v: unknown): number => clampNumber(v, 0, MAX_QTY);
export const clampMoney = (v: unknown): number => clampNumber(v, 0, MAX_MONEY);
export const clampPercent = (v: unknown): number => clampNumber(v, 0, 100);

/** Net amount of one line, before tax: quantity x unit price less the line discount. */
export function lineNet(qty: number, unitPrice: number, discountPct: number): number {
  return r2(qty * unitPrice * (1 - discountPct / 100));
}

export type TotalsLine = { qty: number; unit_price: number; discount_pct: number; tax_pct: number };

export type OrderTotals = {
  subtotal: number;
  discount_total: number;
  tax_total: number;
  shipping_amount: number;
  total: number;
};

/**
 * Header figures from the lines. subtotal is the gross (before any discount), discount_total what the line
 * discounts took off, tax_total the tax on the discounted amounts, total = net + tax + shipping.
 */
export function computeOrderTotals(lines: readonly TotalsLine[], shippingAmount: number): OrderTotals {
  let gross = 0;
  let net = 0;
  let tax = 0;
  for (const l of lines) {
    const n = lineNet(l.qty, l.unit_price, l.discount_pct);
    gross += r2(l.qty * l.unit_price);
    net += n;
    tax += r2(n * (l.tax_pct / 100));
  }
  const shipping = r2(shippingAmount);
  return {
    subtotal: r2(gross),
    discount_total: r2(gross - net),
    tax_total: r2(tax),
    shipping_amount: shipping,
    total: r2(net + tax + shipping),
  };
}

/** The line discount that gives the same net as a line discount followed by a header discount. */
export function foldHeaderDiscount(lineDiscountPct: number, headerDiscountPct: number): number {
  const kept = (1 - lineDiscountPct / 100) * (1 - headerDiscountPct / 100);
  return Math.round((1 - kept) * 100 * 10000) / 10000;
}

/** The latest confirmed date across the lines, or null when no line has one. YYYY-MM-DD strings compare as dates. */
export function expectedDateOf(lines: readonly { confirmed_date?: string | null }[]): string | null {
  let latest: string | null = null;
  for (const l of lines) {
    const d = l.confirmed_date;
    if (d && (latest === null || d > latest)) latest = d;
  }
  return latest;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD date that really exists, else null. */
export function cleanDate(v: unknown): string | null {
  if (typeof v !== "string" || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export type RawOrderLine = {
  product_id?: unknown; description?: unknown; printed_text?: unknown; qty?: unknown; uom?: unknown; unit_price?: unknown;
  discount_pct?: unknown; tax_pct?: unknown; requested_date?: unknown;
};

export type CleanOrderLine = {
  product_id: string | null;
  description: string;
  printed_text: string | null;
  qty: number;
  uom: string | null;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  line_total: number;
  requested_date: string | null;
};

export const MAX_ORDER_LINES = 200;

/**
 * Lines from a request body: clamped numbers, a line without a description dropped, line_total derived (never
 * trusted from the client). product_id is passed through untouched; the route verifies it against the tenant.
 */
export function cleanOrderLines(input: unknown): CleanOrderLine[] {
  if (!Array.isArray(input)) return [];
  const out: CleanOrderLine[] = [];
  for (const raw of input.slice(0, MAX_ORDER_LINES * 2) as RawOrderLine[]) {
    const description = typeof raw?.description === "string" ? raw.description.trim().slice(0, 1000) : "";
    if (!description) continue;
    const qty = raw.qty === undefined || raw.qty === null || raw.qty === "" ? 1 : clampQty(raw.qty);
    const unitPrice = clampMoney(raw.unit_price);
    const discountPct = clampPercent(raw.discount_pct);
    out.push({
      product_id: typeof raw.product_id === "string" && raw.product_id ? raw.product_id : null,
      description,
      printed_text: typeof raw.printed_text === "string" && raw.printed_text.trim() ? raw.printed_text.trim().slice(0, 4000) : null,
      qty,
      uom: typeof raw.uom === "string" && raw.uom.trim() ? raw.uom.trim().slice(0, 20) : null,
      unit_price: unitPrice,
      discount_pct: discountPct,
      tax_pct: clampPercent(raw.tax_pct),
      line_total: lineNet(qty, unitPrice, discountPct),
      requested_date: cleanDate(raw.requested_date),
    });
    if (out.length >= MAX_ORDER_LINES) break;
  }
  return out;
}
