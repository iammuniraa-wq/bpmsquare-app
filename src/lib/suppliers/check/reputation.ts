import { cleanText, looksLikeInstruction, type Citation } from "@/lib/analysis/validate";
import { normName } from "./identity";
import { ADVERSE_KINDS, FACT_KINDS, FACT_LABEL, POSITIVE_KINDS, SERIOUS_KINDS, type FactKind, type Reputation, type ReputationFact, type Sentiment, type WebSource } from "./types";

// What the web part is allowed to say about a supplier, and how it is turned into the saved facts. Pure. Everything the research call
// returns is untrusted text: a fact is kept only when its kind is on the fixed list, its source is a page the provider itself says it
// read, and that page's title, snippet or address names the supplier (a different company with a similar name is the way a real
// supplier gets wrongly accused). What is kept is shown as "what the cited page reports", never as our own statement.

export const MAX_FACTS = 14;
export const MAX_PER_KIND = 3;
export const MAX_FACT_CHARS = 220;

/** Which kinds each of the two research parts may return. */
export const PART_KINDS = {
  standing: ["years", "scale", "client", "project", "certification", "award"],
  record: ["news_positive", "news_adverse", "review_positive", "review_negative", "legal", "fraud_report", "blacklist", "insolvency", "quality_complaint", "payment_complaint"],
} as const satisfies Record<string, readonly FactKind[]>;
export type ResearchPart = keyof typeof PART_KINDS;

const isKind = (v: unknown): v is FactKind => typeof v === "string" && (FACT_KINDS as readonly string[]).includes(v);

const tokens = (s: string): string[] => normName(s).split(" ").filter((w) => w.length > 1);

/** The supplier's own words that a cited page has to carry: up to the first three significant words of its name. */
export function nameTokens(name: string): string[] {
  return tokens(name).slice(0, 3);
}

/** Whether a cited page is about this supplier: every significant word of its name is in the page's title, snippet or address. */
export function pageNamesSupplier(c: Citation, name: string): boolean {
  const need = nameTokens(name);
  if (!need.length) return false;
  let host = "";
  try { host = new URL(c.url).hostname.replace(/[.-]/g, " "); } catch { return false; }
  const hay = new Set(tokens(`${c.title ?? ""} ${c.snippet ?? ""} ${(c.snippets ?? []).join(" ")} ${host}`));
  return need.every((w) => hay.has(w));
}

const validWhen = (v: unknown): string | undefined => {
  const t = typeof v === "string" ? v.trim() : "";
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(t) && Number(t.slice(0, 4)) >= 1950 && Number(t.slice(0, 4)) <= new Date().getUTCFullYear() ? t : undefined;
};

export type ValidatedFacts = { facts: ReputationFact[]; sources: WebSource[]; leftOut: number };

/**
 * Turns the raw JSON of the research parts into facts. `parts` carries each part's raw answer (null when it failed); a fact whose
 * kind belongs to the other part, whose page was not read by the provider, or whose page does not name the supplier is left out and
 * counted. Sources are renumbered in order of first use, so `src` always matches the list the person sees.
 */
export function validateFacts(
  parts: readonly { part: ResearchPart; raw: unknown }[], citations: readonly Citation[], supplierName: string,
): ValidatedFacts {
  const byUrl = new Map(citations.filter((c) => c.url.startsWith("https://")).map((c) => [c.url, c]));
  const out: { fact: Omit<ReputationFact, "src">; url: string }[] = [];
  const perKind = new Map<FactKind, number>();
  const seen = new Set<string>();
  let leftOut = 0;
  for (const { part, raw } of parts) {
    const list = (raw && typeof raw === "object" ? (raw as { facts?: unknown }).facts : null);
    if (!Array.isArray(list)) continue;
    const allowed = PART_KINDS[part] as readonly FactKind[];
    for (const item of list.slice(0, 30)) {
      const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const kind = r.kind;
      const text = cleanText(r.text).replace(/https?:\/\/\S+/gi, "").trim();
      const url = typeof r.source_url === "string" ? r.source_url.trim() : "";
      const cite = byUrl.get(url);
      if (!isKind(kind) || !allowed.includes(kind) || !text || r.about_subject === false) { leftOut++; continue; }
      if (text.length > MAX_FACT_CHARS || looksLikeInstruction(text) || !cite || !pageNamesSupplier(cite, supplierName)) { leftOut++; continue; }
      const when = validWhen(r.when);
      if ((SERIOUS_KINDS.includes(kind) || kind === "legal" || kind === "news_adverse") && !when) { leftOut++; continue; }
      const key = `${kind}|${text.toLowerCase()}`;
      if (seen.has(key) || (perKind.get(kind) ?? 0) >= MAX_PER_KIND || out.length >= MAX_FACTS) { leftOut++; continue; }
      seen.add(key);
      perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
      out.push({ fact: { kind, text, ...(when ? { when } : {}) }, url });
    }
  }
  const sources: WebSource[] = [];
  const facts: ReputationFact[] = out.map(({ fact, url }) => {
    let i = sources.findIndex((s) => s.url === url);
    if (i < 0) {
      const c = byUrl.get(url);
      i = sources.push({ title: cleanText(c?.title).slice(0, 160) || new URL(url).hostname, url }) - 1;
    }
    return { ...fact, src: i + 1 };
  });
  return { facts, sources, leftOut };
}

/** Worked out in code from the facts, never by the model. */
export function sentimentOf(facts: readonly ReputationFact[]): Sentiment {
  const adverse = facts.filter((f) => ADVERSE_KINDS.includes(f.kind));
  const positive = facts.filter((f) => POSITIVE_KINDS.includes(f.kind));
  if (!adverse.length && !positive.length) return "unknown";
  if (adverse.some((f) => SERIOUS_KINDS.includes(f.kind))) return "negative";
  if (!adverse.length) return "positive";
  if (!positive.length) return adverse.length >= 2 ? "negative" : "mixed";
  return adverse.length >= 2 && adverse.length >= positive.length ? "negative" : "mixed";
}

/** The facts a cited page reports that are serious enough to make the verdict concerning. */
export const seriousFacts = (facts: readonly ReputationFact[]): ReputationFact[] => facts.filter((f) => SERIOUS_KINDS.includes(f.kind));

const countOf = (facts: readonly ReputationFact[], ...kinds: FactKind[]) => facts.filter((f) => kinds.includes(f.kind)).length;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The summary written from the facts alone: used when no model writes it, or when a model sentence fails the facts check. */
export function composeSummary(i: { name: string; facts: readonly ReputationFact[]; sources: readonly WebSource[]; sentiment: Sentiment; partial: boolean }): string {
  const { facts, sources } = i;
  if (!facts.length) {
    return `Nothing was found on the web that could be cited for ${i.name}. For a small or regional company that is common, and it is not a finding against it by itself.${i.partial ? " Part of the research could not run." : ""}`;
  }
  const bits: string[] = [];
  const years = facts.find((f) => f.kind === "years");
  if (years) bits.push(`${years.text.replace(/[.\s]+$/, "")}`);
  const clients = countOf(facts, "client", "project");
  if (clients) bits.push(`${plural(clients, "named client or project", "named clients or projects")}`);
  const certs = countOf(facts, "certification");
  if (certs) bits.push(`${plural(certs, "certification", "certifications")}`);
  const adverse = facts.filter((f) => ADVERSE_KINDS.includes(f.kind));
  const lead = bits.length ? `Cited pages report: ${bits.join("; ")}.` : "Cited pages say little about the company's standing.";
  const tail = adverse.length
    ? ` ${plural(adverse.length, "cited page reports", "cited pages report")} a concern (${[...new Set(adverse.map((f) => FACT_LABEL[f.kind].toLowerCase()))].join(", ")}); read ${adverse.length === 1 ? "it" : "them"} before relying on this supplier.`
    : " No adverse report was found in the pages read.";
  return `${lead}${tail} Based on ${plural(sources.length, "source", "sources")}.${i.partial ? " Part of the research could not run." : ""}`;
}

export const emptyReputation = (note?: string): Reputation => ({
  webUsed: false, partial: false, sentiment: "unknown", facts: [], sources: [], searches: 0,
  summary: "Market reputation was not researched on the web.", ...(note ? { note } : {}),
});
