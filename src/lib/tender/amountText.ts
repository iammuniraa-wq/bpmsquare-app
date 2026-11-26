// How an amount reads on the tender screens: thousands separators, whole numbers without a decimal point, anything with cents with exactly
// two ("15,790,416.10", never "15,790,416.1"). PURE.

const cents = (n: number): number => Math.round(n * 100) / 100;

export function amountText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
  const r = cents(Number(n));
  return r.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
}

/** The plain number an amount input starts from: cents to two places when there are any ("15790416.10"), else whole. */
export function amountValue(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
  const r = cents(Number(n));
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}
