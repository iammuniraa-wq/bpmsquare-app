// Tenant currency (owner decision 2026-09-07, prompted by the Big Blue
// tenant in Qatar): every money figure the product shows, prints or emails
// is formatted through here, from ONE setting -- TenantConfig.currency --
// instead of a hardcoded rupee sign in each screen. Pure: no framework
// imports, safe in client components, server components, API routes and
// print documents alike.
//
// A missing setting means INR with Indian digit grouping, byte-for-byte what
// every existing tenant already sees (currency.test.ts pins that), so
// turning this on changes nothing for a tenant that has not chosen.

export type CurrencyCode = "INR" | "QAR" | "AED" | "SAR" | "OMR" | "KWD" | "BHD" | "USD" | "EUR" | "GBP";

export type CurrencyDef = {
  code: CurrencyCode;
  name: string;
  /** What goes in front of the number: "₹" glued on, or an ISO code with a
   *  space ("QAR 2,690") -- the Gulf convention, where the local symbols are
   *  Arabic script most business documents do not use. */
  symbol: string;
  /** Intl locale for digit grouping and decimal separators. */
  locale: string;
  /** Minor-unit digits (OMR/KWD/BHD use three). */
  decimals: number;
  /** Compact style: lakh/crore or thousand/million. */
  grouping: "indian" | "western";
};

export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  INR: { code: "INR", name: "Indian rupee",        symbol: "₹",   locale: "en-IN", decimals: 2, grouping: "indian" },
  QAR: { code: "QAR", name: "Qatari riyal",        symbol: "QAR", locale: "en-US", decimals: 2, grouping: "western" },
  AED: { code: "AED", name: "UAE dirham",          symbol: "AED", locale: "en-US", decimals: 2, grouping: "western" },
  SAR: { code: "SAR", name: "Saudi riyal",         symbol: "SAR", locale: "en-US", decimals: 2, grouping: "western" },
  OMR: { code: "OMR", name: "Omani rial",          symbol: "OMR", locale: "en-US", decimals: 3, grouping: "western" },
  KWD: { code: "KWD", name: "Kuwaiti dinar",       symbol: "KWD", locale: "en-US", decimals: 3, grouping: "western" },
  BHD: { code: "BHD", name: "Bahraini dinar",      symbol: "BHD", locale: "en-US", decimals: 3, grouping: "western" },
  USD: { code: "USD", name: "US dollar",           symbol: "$",   locale: "en-US", decimals: 2, grouping: "western" },
  EUR: { code: "EUR", name: "Euro",                symbol: "€",   locale: "de-DE", decimals: 2, grouping: "western" },
  GBP: { code: "GBP", name: "Pound sterling",      symbol: "£",   locale: "en-GB", decimals: 2, grouping: "western" },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];
export const DEFAULT_CURRENCY: CurrencyCode = "INR";

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === "string" && v in CURRENCIES;
}

/** The tenant's currency from its config; INR when unset or unknown. */
export function resolveCurrency(config: { currency?: string | null } | null | undefined): CurrencyDef {
  const code = config?.currency;
  return CURRENCIES[isCurrencyCode(code) ? code : DEFAULT_CURRENCY];
}

/** "₹" or "QAR " -- the prefix a number gets. */
function prefix(cur: CurrencyDef): string {
  return /^[A-Z]{3}$/.test(cur.symbol) ? `${cur.symbol} ` : cur.symbol;
}

/**
 * A money figure. Defaults to whole units (the shape most lists use);
 * pass Intl options for two decimals etc. Negative amounts keep the sign in
 * front of the prefix: "-₹1,200", "-QAR 1,200".
 */
export function formatMoney(n: number, cur: CurrencyDef, opts: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }): string {
  const abs = Math.abs(n).toLocaleString(cur.locale, opts);
  return `${n < 0 ? "-" : ""}${prefix(cur)}${abs}`;
}

/** A partially applied formatMoney for the component-level `money(n)` helper. */
export function moneyFormatter(cur: CurrencyDef, opts?: Intl.NumberFormatOptions): (n: number) => string {
  return (n) => formatMoney(n, cur, opts);
}

/**
 * Compact figure for tiles and boards: ₹4.5L / ₹2.3Cr under Indian
 * grouping, QAR 4.5K / QAR 2.3M otherwise. `digits` is the number of
 * decimals in the compact form (screens vary between 1 and 2).
 */
export function formatMoneyCompact(n: number, cur: CurrencyDef, digits = 1): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const p = prefix(cur);
  if (cur.grouping === "indian") {
    if (abs >= 10_000_000) return `${sign}${p}${(abs / 10_000_000).toFixed(digits)}Cr`;
    if (abs >= 100_000) return `${sign}${p}${(abs / 100_000).toFixed(digits)}L`;
  } else {
    if (abs >= 1_000_000) return `${sign}${p}${(abs / 1_000_000).toFixed(digits)}M`;
    if (abs >= 1_000) return `${sign}${p}${(abs / 1_000).toFixed(digits)}K`;
  }
  return `${sign}${p}${Math.round(abs).toLocaleString(cur.locale)}`;
}

/**
 * Bare compact number with no prefix, for chart axes: 50K, 4.5L, 2.3Cr under
 * Indian grouping; 50K, 4.5M under western.
 */
export function formatCompactNumber(n: number, cur: CurrencyDef): string {
  const abs = Math.abs(n);
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (cur.grouping === "indian") {
    if (abs >= 10_000_000) return trim((n / 10_000_000).toFixed(abs >= 100_000_000 ? 0 : 1)) + "Cr";
    if (abs >= 100_000) return trim((n / 100_000).toFixed(abs >= 1_000_000 ? 0 : 1)) + "L";
  } else if (abs >= 1_000_000) {
    return trim((n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)) + "M";
  }
  if (abs >= 1_000) return trim((n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)) + "K";
  return Math.round(n).toLocaleString(cur.locale);
}

/** "Rate (₹)" / "Rate (QAR)" -- a field label carrying the unit. */
export function moneyLabel(label: string, cur: CurrencyDef): string {
  return `${label} (${cur.symbol})`;
}

/**
 * Parse a typed or imported amount: strips any currency prefix, grouping
 * separators and spaces ("₹1,50,000", "QAR 2,690.50", "$ 1,200"). null when
 * nothing numeric remains.
 */
export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
