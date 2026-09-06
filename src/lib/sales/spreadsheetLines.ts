// "Create line items from this spreadsheet" (0119, docs/
// sales-engine-architecture.md §3.7): turns the first sheet of an
// attached .xlsx/.csv into Standard Quote line rows. Column matching is
// by header name with the same aliases the Data Workbench quote-lines
// import accepts, plus a product column (ref / SKU / name) so a line can
// bind to the catalog. Pure: no I/O, so it is unit-testable; the route
// resolves products and writes.

import type { ParsedSheet } from "@/lib/import/types";

export type SheetLine = {
  row: number;
  description: string;
  uom: string | null;
  qty: number;
  rate: number;
  discount_pct: number;
  /** Whatever the product column held -- a ref, SKU or name, resolved by the caller. */
  product_key: string | null;
};

const ALIASES: Record<keyof Omit<SheetLine, "row">, string[]> = {
  description: ["description", "item", "particulars", "work description", "line item", "desc", "item description", "material description"],
  uom: ["uom", "unit", "units", "u/m"],
  qty: ["qty", "quantity", "nos", "qty.", "q'ty"],
  rate: ["rate", "price", "unit price", "unit rate", "rate (inr)", "rate (₹)", "unit cost"],
  discount_pct: ["discount %", "discount", "disc %", "disc", "item discount", "discount_pct"],
  product_key: ["product", "product ref", "product id", "ref", "sku", "code", "item code", "part no", "part number", "material code", "product code"],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]+/g, " ").trim();

/** Header index for each field, or -1. Exact alias match first, then a
 *  header that starts with one (so "Qty (Nos)" still reads as qty). */
export function mapSheetColumns(headers: string[]): Record<keyof Omit<SheetLine, "row">, number> {
  const h = headers.map(norm);
  const find = (aliases: string[]) => {
    for (const a of aliases) { const i = h.indexOf(norm(a)); if (i >= 0) return i; }
    for (const a of aliases) { const i = h.findIndex((x) => x.startsWith(norm(a) + " ") || x.startsWith(norm(a) + "(")); if (i >= 0) return i; }
    return -1;
  };
  return {
    description: find(ALIASES.description), uom: find(ALIASES.uom), qty: find(ALIASES.qty),
    rate: find(ALIASES.rate), discount_pct: find(ALIASES.discount_pct), product_key: find(ALIASES.product_key),
  };
}

const num = (s: string | undefined, fallback: number) => {
  if (s === undefined) return fallback;
  const n = parseFloat(String(s).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

export type SheetReadResult =
  | { ok: true; lines: SheetLine[]; skipped: number; columns: Record<keyof Omit<SheetLine, "row">, number> }
  | { ok: false; error: string };

/** Rows with a description (or a product key) become lines; anything else
 *  is skipped and counted. A sheet with neither a description nor a
 *  product column is refused with the headers it did have. */
export function sheetToLines(sheet: ParsedSheet): SheetReadResult {
  const cols = mapSheetColumns(sheet.headers);
  if (cols.description < 0 && cols.product_key < 0) {
    return { ok: false, error: `No description or product column found. Headers seen: ${sheet.headers.filter(Boolean).join(", ") || "(none)"}. Expected something like Description, UOM, Qty, Rate.` };
  }
  const lines: SheetLine[] = [];
  let skipped = 0;
  sheet.rows.forEach((r, i) => {
    const description = cols.description >= 0 ? (r[cols.description] ?? "").trim() : "";
    const productKey = cols.product_key >= 0 ? (r[cols.product_key] ?? "").trim() : "";
    if (!description && !productKey) { skipped++; return; }
    lines.push({
      row: sheet.rowNumbers[i] ?? i + 2,
      description: description || productKey,
      uom: cols.uom >= 0 && (r[cols.uom] ?? "").trim() ? (r[cols.uom] ?? "").trim() : null,
      qty: Math.max(0, num(cols.qty >= 0 ? r[cols.qty] : undefined, 1)) || 1,
      rate: Math.max(0, num(cols.rate >= 0 ? r[cols.rate] : undefined, 0)),
      discount_pct: Math.max(0, Math.min(100, num(cols.discount_pct >= 0 ? r[cols.discount_pct] : undefined, 0))),
      product_key: productKey || null,
    });
  });
  return { ok: true, lines, skipped, columns: cols };
}

/** The key two lines are "the same item" by: the product when both have
 *  one, else the description, case- and whitespace-insensitive. */
export function lineDedupKey(l: { product_id?: string | null; description: string }): string {
  return l.product_id ? `p:${l.product_id}` : `d:${norm(l.description)}`;
}
