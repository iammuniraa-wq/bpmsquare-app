// The line editor's working shape (text boxes hold strings) and its conversions, kept apart from the component so the
// rules (what counts as a line, what is rejected, what is sent) are tested without a browser.

import type { OrderLineInput } from "@/lib/salesOrders/client";
import type { SalesOrderLine } from "@/lib/salesOrders/types";
import { estimateTotals } from "./logic";

export type EditLine = {
  key: string;
  product_id: string;
  description: string;
  printed_text: string;
  qty: string;
  uom: string;
  unit_price: string;
  discount_pct: string;
  tax_pct: string;
  requested_date: string;
};

/** The catalog fields a picked product fills in (the shape `standardQuoteProducts` already returns). */
export type PickProduct = { id: string; ref: string | null; name: string; uom: string | null; list_price: number | null };

let seq = 0;
const nextKey = () => `nl-${Date.now().toString(36)}-${(seq += 1)}`;

export const newEditLine = (defaults: { tax_pct?: string; requested_date?: string } = {}): EditLine => ({
  key: nextKey(), product_id: "", description: "", printed_text: "", qty: "1", uom: "Nos", unit_price: "0", discount_pct: "0",
  tax_pct: defaults.tax_pct ?? "0", requested_date: defaults.requested_date ?? "",
});

export const fromProduct = (p: PickProduct, defaults: { tax_pct?: string; requested_date?: string } = {}): EditLine => ({
  ...newEditLine(defaults), product_id: p.id, description: p.ref ? `${p.name} (${p.ref})` : p.name, uom: p.uom ?? "Nos", unit_price: String(p.list_price ?? 0),
});

export const fromLine = (l: SalesOrderLine): EditLine => ({
  key: l.id, product_id: l.product_id ?? "", description: l.description, printed_text: l.printed_text ?? "", qty: String(l.qty), uom: l.uom ?? "",
  unit_price: String(l.unit_price), discount_pct: String(l.discount_pct), tax_pct: String(l.tax_pct), requested_date: l.requested_date ?? "",
});

const n = (v: string): number => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

/** Blank rows (no description) are dropped, as the quote form does. */
export const meaningful = (lines: EditLine[]): EditLine[] => lines.filter((l) => l.description.trim() !== "");

export function toInput(l: EditLine): OrderLineInput {
  return {
    product_id: l.product_id || null,
    description: l.description.trim(),
    printed_text: l.printed_text.trim() === "" ? null : l.printed_text.trim(),
    qty: n(l.qty),
    uom: l.uom.trim() === "" ? null : l.uom.trim(),
    unit_price: Math.max(0, n(l.unit_price)),
    discount_pct: Math.max(0, Math.min(100, n(l.discount_pct))),
    tax_pct: Math.max(0, Math.min(100, n(l.tax_pct))),
    requested_date: l.requested_date || null,
  };
}

/** What stops a save: returns the first problem in plain words, or null. */
export function lineProblem(lines: EditLine[]): string | null {
  const real = meaningful(lines);
  if (real.length === 0) return "Add at least one line";
  for (const [i, l] of real.entries()) {
    if (!(n(l.qty) > 0)) return `Line ${i + 1}: the quantity must be more than zero`;
    if (n(l.unit_price) < 0) return `Line ${i + 1}: the price cannot be negative`;
    if (n(l.discount_pct) < 0 || n(l.discount_pct) > 100) return `Line ${i + 1}: the discount must be between 0 and 100`;
    if (n(l.tax_pct) < 0 || n(l.tax_pct) > 100) return `Line ${i + 1}: the tax must be between 0 and 100`;
  }
  return null;
}

export const editTotals = (lines: EditLine[], shipping = 0) => {
  const inputs = meaningful(lines).map(toInput);
  return estimateTotals(inputs, shipping);
};

export const lineAmount = (l: EditLine): number => {
  const i = toInput(l);
  return i.qty * i.unit_price * (1 - i.discount_pct / 100);
};

/** True when two working sets differ (drives "Unsaved changes" and the leave-page guard). */
export const linesChanged = (a: EditLine[], b: EditLine[]): boolean =>
  JSON.stringify(a.map(({ key: _k, ...rest }) => rest)) !== JSON.stringify(b.map(({ key: _k, ...rest }) => rest));

export type PickAccount = { id: string; name: string; address: string };

/** Customers whose name contains every word typed (first words first), at most `limit`. */
export function searchAccounts(accounts: PickAccount[], query: string, limit = 8): PickAccount[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return accounts
    .filter((a) => words.every((w) => a.name.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(words[0])) - Number(a.name.toLowerCase().startsWith(words[0])) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function searchProducts(products: PickProduct[], query: string, limit = 8): PickProduct[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return products.filter((p) => p.name.toLowerCase().includes(q) || (p.ref ?? "").toLowerCase().includes(q)).slice(0, limit);
}
