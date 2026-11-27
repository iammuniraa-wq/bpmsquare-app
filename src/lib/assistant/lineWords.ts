// "the geotextile lines": which of a list of lines the person's own words point at. Pure. A line matches when every word of one
// named group starts a word of its description or spec ("geotextile and geomembrane" is two groups); an item number ("2.1") matches
// that item only.

export type WordedLine = { description?: string | null; spec?: string | null; item?: string | number | null };

const FILLER = new Set(["the", "all", "of", "for", "only", "just", "boq", "bill", "quantities", "line", "lines", "item", "items", "row", "rows", "these", "those", "this", "unpriced", "remaining", "without", "with", "no", "a", "price", "priced", "number", "tender", "deal"]);
const ITEM_NO = /^\d+(?:\.\d+)*$/;

const wordsOf = (s: string): string[] => s.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").split(" ").map((w) => w.replace(/^\.+|\.+$/g, "")).filter(Boolean);
const stem = (w: string): string => (w.length > 3 ? w.replace(/s$/, "") : w);

export function lineGroups(words: string): string[][] {
  return words.split(/,|&|\band\b/i).map((g) => wordsOf(g).filter((w) => !FILLER.has(w)).map(stem)).filter((g) => g.length > 0);
}

/** The person's words without "the ... lines", for saying back: "the geotextile lines" reads "geotextile". */
export const lineLabel = (words: string): string => words.trim().split(/\s+/).filter((w) => !FILLER.has(w.toLowerCase())).join(" ");

/** True when the words name particular lines, not just "the lines". */
export const namesLines = (words: string): boolean => lineGroups(words).length > 0;

export function linesNamed<T extends WordedLine>(lines: readonly T[], words: string): T[] {
  const groups = lineGroups(words);
  if (groups.length === 0) return [...lines];
  return lines.filter((l) => {
    const item = String(l.item ?? "").trim().toLowerCase();
    const have = wordsOf(`${l.description ?? ""} ${l.spec ?? ""}`);
    return groups.some((g) => g.every((w) => (ITEM_NO.test(w) ? w === item : have.some((h) => h.startsWith(w)))));
  });
}
