// Single source of truth for the Standard Quote total formula -- used by
// both the create/update API routes (to persist `total`) and the print
// document (to render the breakdown), so the number on screen always
// matches what's stored. Order: taxable value = line subtotal minus the
// header discount; tax applies to that taxable value; shipping is added
// last, untaxed.
export type StandardQuoteTotals = {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  shipping: number;
  total: number;
};

export function computeStandardQuoteTotals(
  subtotal: number,
  headerDiscountPct: number,
  taxPct: number,
  shippingAmount: number
): StandardQuoteTotals {
  const discountAmount = subtotal * (headerDiscountPct / 100);
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = taxableAmount * (taxPct / 100);
  const total = taxableAmount + taxAmount + shippingAmount;
  return { subtotal, discountAmount, taxableAmount, taxAmount, shipping: shippingAmount, total };
}

/** Clamp/parse a client-supplied percentage into a safe 0-100 number. */
export function clampPct(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Clamp/parse a client-supplied non-negative amount. */
export function clampAmount(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}
