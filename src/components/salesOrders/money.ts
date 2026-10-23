import { CURRENCIES, DEFAULT_CURRENCY, formatMoney, isCurrencyCode } from "@/lib/currency";

/** An amount in the order's own currency (falls back to the default when the order carries none we know). */
export function fmtMoney(n: number, currency: string | null | undefined, digits = 2): string {
  const code = currency && isCurrencyCode(currency) ? currency : DEFAULT_CURRENCY;
  return formatMoney(n, CURRENCIES[code], { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
