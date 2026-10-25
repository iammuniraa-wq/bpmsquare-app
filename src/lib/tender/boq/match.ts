import { editorUom } from "@/lib/sales/uom";

// Matching a BOQ line to a catalog product (GCC tender deals). BOQ lines arrive as free text from the client's Excel; the BOM and
// supplier price sources key on a product, so a line with no product finds nothing. This is the pure half: given a line and the
// workspace's products, rank up to three, each with a score and a band. Nothing here reads a database or a price.
//
//   100  the product's SKU is the line's cost code (exact, ignoring spaces and punctuation)
//    85  the product's SKU is written inside the description
//  <=90  word overlap between description and product name (Dice coefficient x 90), at least MIN_SCORE
//    +5  the same unit (only ever added to a match that already passed the threshold)
//
// "strong" (>= 75) may be accepted in bulk; "possible" (45-74) is only ever linked by a person looking at it.

export const MIN_SCORE = 45;
export const STRONG_SCORE = 75;

export type MatchBand = "strong" | "possible";
/** Only what a person needs to recognise a product. No cost or price ever enters this module. */
export type MatchProduct = { id: string; name: string; sku: string | null; uom: string | null };
export type MatchLineInput = { description: string; cost_code?: string | null; uom?: string | null };
export type Suggestion = { product_id: string; score: number; band: MatchBand; reason: string };

export const bandFor = (score: number): MatchBand => (score >= STRONG_SCORE ? "strong" : "possible");

const STOP = new Set([
  "a", "an", "and", "or", "the", "of", "for", "with", "to", "in", "on", "at", "by", "as", "per", "all", "any", "incl", "including",
  "supply", "supplying", "supplied", "install", "installing", "installation", "complete", "completely", "provide", "providing", "fix", "fixing",
]);

/** Lower-case words and numbers; "100mm" is "100" and "mm"; a trailing plural s is dropped; filler words are ignored. */
export function tokens(text: string | null | undefined): string[] {
  const words = (text ?? "").toLowerCase()
    .replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: string[] = [];
  for (let w of words) {
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (STOP.has(w) || (w.length < 2 && !/^\d$/.test(w))) continue;
    out.push(w);
  }
  return out;
}

const compact = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const isNumber = (t: string) => /^\d+$/.test(t);
const sameUnit = (a: string | null | undefined, b: string | null | undefined) => {
  const x = (a ?? "").trim(), y = (b ?? "").trim();
  return !!x && !!y && editorUom(x).toLowerCase() === editorUom(y).toLowerCase();
};

type Prepared = { index: number; product: MatchProduct; words: Set<string>; sku: string };

/** Build the matcher once for a workspace's products; call it per line. Words are indexed, so 2,000 lines against 5,000 products is cheap. */
export function createMatcher(products: readonly MatchProduct[]): (line: MatchLineInput, limit?: number) => Suggestion[] {
  const prepared: Prepared[] = products.map((product, index) => ({ index, product, words: new Set(tokens(product.name)), sku: compact(product.sku) }));
  const byWord = new Map<string, Prepared[]>();
  const bySku = new Map<string, Prepared[]>();
  for (const p of prepared) {
    for (const w of p.words) { const l = byWord.get(w); if (l) l.push(p); else byWord.set(w, [p]); }
    if (p.sku.length >= 3) { const l = bySku.get(p.sku); if (l) l.push(p); else bySku.set(p.sku, [p]); }
  }

  return (line, limit = 3) => {
    const found = new Map<number, { score: number; reason: string }>();
    const offer = (p: Prepared, score: number, reason: string) => {
      const cur = found.get(p.index);
      if (!cur || score > cur.score) found.set(p.index, { score, reason });
    };

    // 1. The cost code is a SKU.
    const code = compact(line.cost_code);
    if (code.length >= 3) for (const p of bySku.get(code) ?? []) offer(p, 100, "Same SKU as the cost code");

    // 2. A SKU written in the description: any one to three adjacent words, put together, equals a SKU.
    const raw = (line.description ?? "").toLowerCase().split(/\s+/).map((w) => compact(w)).filter(Boolean);
    for (let i = 0; i < raw.length; i++) {
      let joined = "";
      for (let j = i; j < Math.min(raw.length, i + 3); j++) {
        joined += raw[j];
        if (joined.length >= 4) for (const p of bySku.get(joined) ?? []) offer(p, 85, "SKU in the description");
      }
    }

    // 3. Words in common with the product's name.
    const lineWords = new Set(tokens(line.description));
    if (lineWords.size > 0) {
      const lineNumbers = [...lineWords].filter(isNumber);
      const seen = new Set<number>();
      for (const w of lineWords) for (const p of byWord.get(w) ?? []) {
        if (seen.has(p.index)) continue;
        seen.add(p.index);
        let inter = 0;
        for (const x of lineWords) if (p.words.has(x)) inter++;
        let score = Math.round(((2 * inter) / (lineWords.size + p.words.size)) * 90);
        // A different size or rating is a different product: two sets of numbers with nothing in common never read as strong.
        const productNumbers = [...p.words].filter(isNumber);
        if (lineNumbers.length > 0 && productNumbers.length > 0 && !lineNumbers.some((n) => p.words.has(n))) score = Math.min(score, STRONG_SCORE - 15);
        if (score >= MIN_SCORE) offer(p, score, `${inter} of ${lineWords.size} words match the name`);
      }
    }

    const ranked = [...found].map(([index, v]) => {
      const p = prepared[index];
      // The unit only ever confirms a match that already passed on its own.
      const bonus = sameUnit(line.uom, p.product.uom) ? 5 : 0;
      const score = Math.min(100, v.score + bonus);
      return { index, score, reason: bonus ? `${v.reason}; same unit` : v.reason };
    }).sort((a, b) => b.score - a.score || a.index - b.index);

    return ranked.slice(0, Math.max(0, limit)).map((r) => ({ product_id: prepared[r.index].product.id, score: r.score, band: bandFor(r.score), reason: r.reason }));
  };
}

/** One-off convenience (tests, small lists). */
export function suggestProducts(line: MatchLineInput, products: readonly MatchProduct[], limit = 3): Suggestion[] {
  return createMatcher(products)(line, limit);
}
