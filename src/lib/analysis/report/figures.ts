import type { Money, MoneyBlock } from "./types";

// The numbers of a brief (docs/design/company-brief-sales.md rule 6). The model supplies a figure as fields (the amount as
// printed, the unit the page used, a currency, a fiscal year); everything derived from figures is worked out here, never
// by the model: growth and margin come from two sourced figures in the same currency. Pure and client-safe.

export const UNITS = { units: 1, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 } as const;
export type MoneyUnit = keyof typeof UNITS;

export const MAX_AMOUNT = 1e15;

/** The unit word a page used, in the forms models and pages write it. */
export function parseUnit(v: unknown): MoneyUnit | null {
  if (v === undefined || v === null || v === "") return "units";
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase().replace(/\./g, "");
  if (["units", "unit", "one", "ones", "1"].includes(t)) return "units";
  if (["thousand", "thousands", "k", "000", "th"].includes(t)) return "thousand";
  if (["million", "millions", "m", "mn", "mm", "mio"].includes(t)) return "million";
  if (["billion", "billions", "b", "bn", "bil"].includes(t)) return "billion";
  if (["trillion", "trillions", "tn"].includes(t)) return "trillion";
  return null;
}

/** A number from the model: a finite JSON number, or a plain digit string with an optional decimal point. Never a sentence. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** The significant digits of a printed figure: no separators, no sign, no leading or trailing zeros. "2,840.0" and "284" are both "284". */
export function digitsOf(n: string): string {
  return n.replace(/[^0-9]/g, "").replace(/^0+/, "").replace(/0+$/, "");
}

/** Every number the snippet prints, as significant digits. */
export function snippetNumbers(snippet: string): Set<string> {
  const out = new Set<string>();
  for (const m of snippet.matchAll(/\d[\d.,]*/g)) {
    const d = digitsOf(m[0]);
    if (d) out.add(d);
  }
  return out;
}

/**
 * Are the figure's digits in any of the snippets the provider cited for its page? The printed amount is compared as digits,
 * so "2.84" matches "2.84 bn" and "2,840" matches "2,840 million"; a unit conversion never breaks the match. No snippet at
 * all is "not matched": the card then shows "check [n]" rather than claiming a check that did not happen.
 */
export function figureMatchesSnippets(printed: number, snippets: readonly string[]): boolean {
  const want = digitsOf(String(printed));
  if (!want) return false;
  return snippets.some((s) => snippetNumbers(s).has(want));
}

const YEAR_MIN_OFFSET = 5;

/** A fiscal year the page could plausibly mean: a whole year within the last five and this one (next year for a year that ends soon). */
export function parseFiscalYear(v: unknown, now: Date): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n)) return null;
  const y = now.getUTCFullYear();
  return n >= y - YEAR_MIN_OFFSET && n <= y + 1 ? n : null;
}

export const parseCurrency = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(t) ? t : null;
};

/** "published" when revenue and profit are both known, "partial" when only one is, "not_published" when neither. */
export function moneyStatus(m: Pick<MoneyBlock, "revenue" | "profit">): MoneyBlock["status"] {
  if (m.revenue.length > 0 && m.profit.length > 0) return "published";
  return m.revenue.length + m.profit.length > 0 ? "partial" : "not_published";
}

const byYearDesc = (a: Money, b: Money) => b.fiscalYear - a.fiscalYear;

/** The latest figure of a series. */
export const latest = (rows: readonly Money[]): Money | null => [...rows].sort(byYearDesc)[0] ?? null;

/** Revenue growth in percent, one decimal, from the latest year and the year before it in the same currency. Null when either is missing. */
export function growthOf(revenue: readonly Money[]): { percent: number; current: Money; previous: Money } | null {
  const current = latest(revenue);
  if (!current) return null;
  const previous = revenue.find((m) => m.fiscalYear === current.fiscalYear - 1 && m.currency === current.currency);
  if (!previous || previous.amount <= 0) return null;
  return { percent: Math.round(((current.amount - previous.amount) / previous.amount) * 1000) / 10, current, previous };
}

/** Profit as a share of revenue for the latest year that has both, one decimal. Null when there is no such year or revenue is not positive. */
export function marginOf(m: Pick<MoneyBlock, "revenue" | "profit">): { percent: number; fiscalYear: number; currency: string; revenue: Money; profit: Money } | null {
  const years = [...m.profit].sort(byYearDesc);
  for (const p of years) {
    const r = m.revenue.find((x) => x.fiscalYear === p.fiscalYear && x.currency === p.currency);
    if (r && r.amount > 0) return { percent: Math.round((p.amount / r.amount) * 1000) / 10, fiscalYear: p.fiscalYear, currency: p.currency, revenue: r, profit: p };
  }
  return null;
}

/** "SAR 2.84 bn", "SAR 186 m", "SAR 410,000". Two decimals only when the value needs them. */
export function formatMoney(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const fit = (v: number) => String(Math.round(v * 100) / 100);
  if (abs >= 1e12) return `${sign}${currency} ${fit(abs / 1e12)} tn`;
  if (abs >= 1e9) return `${sign}${currency} ${fit(abs / 1e9)} bn`;
  if (abs >= 1e6) return `${sign}${currency} ${abs >= 1e8 ? Math.round(abs / 1e6) : fit(abs / 1e6)} m`;
  if (abs >= 1e3) return `${sign}${currency} ${Math.round(abs).toLocaleString("en-US")}`;
  return `${sign}${currency} ${fit(abs)}`;
}

/** "+12.4%" or "-3%". */
export const formatPercent = (p: number, signed = false): string => `${signed && p > 0 ? "+" : ""}${Math.round(p * 10) / 10}%`;

/** "about 4,200", "4,200 to 4,500", "310". */
export function formatEmployees(e: { count: number; upTo?: number; approx: boolean }): string {
  const n = (v: number) => v.toLocaleString("en-US");
  if (e.upTo && e.upTo > e.count) return `${n(e.count)} to ${n(e.upTo)}`;
  return `${e.approx ? "about " : ""}${n(e.count)}`;
}
