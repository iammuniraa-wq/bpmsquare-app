// The one rule that keeps an inference honest (docs/design/company-brief-sales.md rule 3): a "why it matters" line, a "talk about"
// cell, Where we fit and a competitor reading are the assistant's own words, never sourced. They may reason about the facts, but
// they may not introduce one: a number, a year or a proper name that is not in the validated facts or in the workspace's
// offering names is a fact the model brought from nowhere, and the sentence is dropped. Pure.

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Capitalised words that are not names: titles and abbreviations people write in capitals, and currency codes.
const FREE_WORDS = new Set([
  "ceo", "cfo", "coo", "cto", "cpo", "vp", "hq", "erp", "crm", "kpi", "rfq", "rfp", "boq", "it", "hr", "ai", "iso",
  "sar", "aed", "usd", "eur", "gbp", "qar", "kwd", "omr", "bhd", "egp", "inr",
  "i", "a", "an", "the",
]);

export type Corpus = { numbers: Set<string>; words: Set<string> };

const wordsIn = (s: string): string[] => s.normalize("NFKC").replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A number as printed, with thousands separators and a trailing decimal point removed: "2,840" -> "2840", "2.84" stays. */
const numberKey = (n: string): string => n.replace(/,/g, "").replace(/\.$/, "");

function numbersIn(s: string): string[] {
  return [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => numberKey(m[0]));
}

/** Everything a validated fact says, as the words and numbers an inference may reuse. Dates add their month and year words. */
export function buildCorpus(texts: readonly string[], dates: readonly string[] = []): Corpus {
  const numbers = new Set<string>();
  const words = new Set<string>();
  for (const t of texts) {
    for (const n of numbersIn(t)) numbers.add(n);
    for (const w of wordsIn(t)) words.add(w.toLowerCase());
  }
  for (const d of dates) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(d);
    if (!m) continue;
    numbers.add(m[1]);
    if (m[3]) numbers.add(String(Number(m[3])));
    const month = MONTHS_LONG[Number(m[2]) - 1];
    if (month) { words.add(month.toLowerCase()); words.add(month.slice(0, 3).toLowerCase()); }
  }
  return { numbers, words };
}

export type InferenceProblem = "number" | "name";

/**
 * Does the sentence bring in a number or a proper name that the facts do not hold? Capitalised words count as names unless
 * they open a sentence or a clause (a capital there is grammar), are a plain abbreviation, or are in the corpus.
 */
export function inferenceProblem(text: string, corpus: Corpus): InferenceProblem | null {
  for (const n of numbersIn(text)) if (!corpus.numbers.has(n)) return "number";
  const sentences = text.split(/(?<=[.!?:;])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.normalize("NFKC").split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
    for (let i = 1; i < tokens.length; i++) {
      const raw = tokens[i].replace(/['’]s$/, "").replace(/^[-'’]+|[-'’]+$/g, "");
      if (raw.length < 2 || !/^\p{Lu}/u.test(raw)) continue;
      const lower = raw.toLowerCase();
      if (FREE_WORDS.has(lower)) continue;
      // A hyphenated capital ("Mid-East") is checked by its parts.
      const parts = lower.split("-").filter(Boolean);
      if (!parts.every((p) => corpus.words.has(p) || FREE_WORDS.has(p))) return "name";
    }
  }
  return null;
}
