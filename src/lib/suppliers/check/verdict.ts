import { FACT_LABEL, RATING_MIN_RFQS, type Findings, type Positive, type Rating, type Reputation, type Signal, type Verdict } from "./types";
import { POSITIVE_KINDS } from "./types";
import { seriousFacts } from "./reputation";

// The combined verdict, from rules and nothing else. A hard red flag (the same bank details under another company name, a cited page
// that reports fraud, a blacklisting or an insolvency) is "concerning". Anything that cannot be confirmed is "unverified", and a
// supplier is never "looks genuine" without evidence: either a cited page on the web that describes the company, or a record that
// is consistent AND a track record of answering our requests. The wording is "could not verify" and "concerning", never an accusation.

export type VerdictOutcome = {
  verdict: Verdict;
  sentence: string;
  /** The positives from the records plus the evidence from our own history and the web. */
  positives: Positive[];
  sharpen: string[];
};

const strongest = (signals: readonly Signal[], ...levels: Signal["severity"][]) => signals.find((s) => levels.includes(s.severity));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lowerFirst = (s: string) => s.replace(/^(\w)/, (m) => m.toLowerCase());

export function evidenceFrom(findings: Findings, rating: Rating, reputation: Reputation): Positive[] {
  const out = [...findings.positives];
  const b = rating.basis;
  if (b.replied >= 3 && b.won >= 1) {
    out.push({ id: "history", kind: "history", text: `It has answered ${plural(b.replied, "request", "requests")} of ours with a quote in the last ${b.months} months and won ${plural(b.won, "line", "lines")}.` });
  }
  const standing = reputation.facts.filter((f) => POSITIVE_KINDS.includes(f.kind) && f.kind !== "news_positive" && f.kind !== "review_positive");
  if (reputation.webUsed && standing.length) {
    out.push({ id: "web", kind: "web", text: `${plural(standing.length, "cited page describes", "cited pages describe")} the company (${[...new Set(standing.map((f) => FACT_LABEL[f.kind].toLowerCase()))].join(", ")}).` });
  }
  return out;
}

export function combineVerdict(i: { findings: Findings; rating: Rating; reputation: Reputation; hasWebsite: boolean; hasCr: boolean; hasTaxId: boolean }): VerdictOutcome {
  const { findings, rating, reputation } = i;
  const positives = evidenceFrom(findings, rating, reputation);
  const serious = seriousFacts(reputation.facts);
  const high = strongest(findings.signals, "high");
  const medium = strongest(findings.signals, "medium");
  const web = positives.some((p) => p.kind === "web");
  const own = positives.some((p) => p.kind === "history") && positives.some((p) => p.kind === "domain" || p.kind === "ids_format");

  let verdict: Verdict;
  let sentence: string;
  if (high || serious.length) {
    verdict = "concerning";
    const reason = high ? lowerFirst(high.text.replace(/\.$/, "")) : `a cited page reports ${FACT_LABEL[serious[0].kind].toLowerCase()} (see the sources)`;
    sentence = `Concerning: ${reason}. This is a risk indicator, not a legal finding: check it before asking or awarding.`;
  } else if (medium || reputation.sentiment === "negative" || reputation.sentiment === "mixed") {
    verdict = "check_first";
    const reason = medium ? lowerFirst(medium.text.replace(/\.$/, "")) : "cited pages report both good and bad about the company (see the findings)";
    sentence = `Check first: ${reason}. A risk indicator, not a legal finding.`;
  } else if (web || own) {
    verdict = "looks_genuine";
    sentence = `Looks genuine: ${positives.filter((p) => p.kind !== "ids_format").slice(0, 2).map((p) => lowerFirst(p.text.replace(/\.$/, ""))).join("; ")}. Based on ${plural(positives.length, "supporting finding", "supporting findings")}; not a guarantee.`;
  } else {
    verdict = "unverified";
    sentence = reputation.webUsed && !reputation.facts.length
      ? "Could not verify: nothing on record confirms who this company is, and nothing was found on the web that could be cited. That is common for a small company and is not a finding against it."
      : "Could not verify: nothing on record yet confirms who this company is. That is not a finding against it.";
  }

  const sharpen: string[] = [];
  if (!i.hasWebsite) sharpen.push("Add the company website to the supplier record, so the email domain can be matched to it.");
  if (!i.hasCr) sharpen.push("Add the commercial registration number.");
  if (!i.hasTaxId) sharpen.push("Add the VAT number.");
  if (!rating.basis.enough) {
    const need = Math.max(1, RATING_MIN_RFQS - rating.basis.rfqs);
    sharpen.push(`Ask this supplier on ${plural(need, "more RFQ", "more RFQs")}: a rating needs at least ${RATING_MIN_RFQS}.`);
  }
  if (!reputation.webUsed) sharpen.push("Run the check with web research to look for years in business, named clients, certifications and news.");
  else if (!reputation.facts.length) sharpen.push("Ask the supplier for its company profile and registration certificate, since the web gave nothing to cite.");
  return { verdict, sentence, positives, sharpen: sharpen.slice(0, 5) };
}
