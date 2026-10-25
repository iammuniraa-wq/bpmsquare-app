import { createHash } from "node:crypto";

// Pure helpers for a deal's saved lines: the order they are shown in, and a short fingerprint of what is saved. The Lines editor
// keeps a copy of the saved lines; the fingerprint is how the server notices that copy is no longer what is saved.

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** "1.2" before "1.10": digit runs compare as numbers. A missing item number sorts first. */
export const naturalCompare = (a: string | null | undefined, b: string | null | undefined): number => collator.compare(a ?? "", b ?? "");

/** The saved order: item number, numerically aware. Stable, so lines with equal numbers keep the database's order. */
export function sortDealLines<T extends { sl_no?: string | null }>(lines: readonly T[]): T[] {
  return lines.map((l, i) => ({ l, i })).sort((x, y) => naturalCompare(x.l.sl_no, y.l.sl_no) || x.i - y.i).map((x) => x.l);
}

type Versioned = { id: string; description?: string | null; product_id?: string | null; uom?: string | null; qty?: unknown; rate?: unknown; discount_pct?: unknown; amount?: unknown };
const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

/** A fingerprint of the saved lines: changes when a line is added, removed, replaced, re-priced, re-worded or linked to another product. Independent of order. */
export function linesVersion(lines: readonly Versioned[]): string {
  const rows = [...lines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => [l.id, l.description ?? "", l.product_id ?? "", l.uom ?? "", n2(l.qty), n2(l.rate), n2(l.discount_pct), n2(l.amount)]);
  return createHash("sha1").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
}
