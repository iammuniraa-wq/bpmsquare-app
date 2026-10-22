// Who is "the same company": the cache key and the matcher's name rules (docs/design/account-analysis.md 5.4).
// Pure. A domain is the strongest identity; without one, the normalised name plus the country.

const LEGAL_SUFFIX = new Set([
  "co", "company", "corp", "corporation", "inc", "incorporated", "ltd", "limited", "llc", "llp", "plc", "gmbh", "ag", "sa", "sarl",
  "bv", "nv", "pvt", "private", "pte", "wll", "fzc", "fze", "fzco", "jsc", "psc", "ksc", "est", "the", "and", "&", "group", "holding", "holdings",
]);

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** `https://www.Najdprecast.com/about?x=1` becomes `najdprecast.com`. Null when it is not a plausible public domain. */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  let t = input.trim().toLowerCase();
  if (!t || t.length > 253 || /\s/.test(t) || t.includes("@")) return null;
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  t = t.split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t)) return null;
  if (/^\d+(\.\d+)+$/.test(t)) return null;
  if (t.split(".").some((l) => !l || l.startsWith("-") || l.endsWith("-") || l.length > 63)) return null;
  return t;
}

export function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The url's host is the company's domain or one of its sub-domains. */
export function urlOnDomain(url: string, domain: string | null): boolean {
  if (!domain) return false;
  const host = hostOfUrl(url);
  return !!host && (host === domain || host.endsWith(`.${domain}`));
}

/** Lower case, no diacritics, no punctuation, no legal-form words: "Najd Precast Co. Ltd" becomes "najd precast". */
export function normaliseName(name: string | null | undefined): string {
  if (typeof name !== "string") return "";
  const words = stripDiacritics(name).toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !LEGAL_SUFFIX.has(w));
  return (kept.length > 0 ? kept : words).join(" ");
}

const slug = (s: string) => s.replace(/\s+/g, "-");

/** `najdprecast.com`, else `najd-precast|saudi-arabia`. Empty when there is neither a usable domain nor a name. */
export function companyKey(input: { domain?: string | null; name?: string | null; country?: string | null }): string {
  const domain = normaliseDomain(input.domain);
  if (domain) return domain;
  const name = normaliseName(input.name);
  if (!name) return "";
  const country = normaliseName(input.country);
  return `${slug(name)}|${slug(country)}`;
}

/** Does the text contain the company's whole name (not a part of it), as a run of whole words? */
export function mentionsFullName(text: string, name: string): boolean {
  const n = normaliseName(name);
  if (!n) return false;
  const hay = ` ${stripDiacritics(text).toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  return hay.includes(` ${n} `);
}

/** Token overlap of two names after normalising, 0 to 1. "Najd Precast" and "Najd Trading" share one of three words. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normaliseName(a).split(" ").filter(Boolean));
  const tb = new Set(normaliseName(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return common / (ta.size + tb.size - common);
}
