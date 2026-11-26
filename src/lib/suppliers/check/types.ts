// Supplier check: the shapes the compute code, the routes, the saved row and the cards share. Client-safe and dependency-free.
// The check is a risk indicator built from the workspace's own records and, when the person agrees, public web pages. It is never a
// legal finding, and the wording in this module never calls a company a fraud: "could not verify" and "concerning" are the words.

export const VERDICTS = ["looks_genuine", "check_first", "concerning", "unverified"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABEL: Record<Verdict, string> = {
  looks_genuine: "Looks genuine",
  check_first: "Check first",
  concerning: "Concerning",
  unverified: "Could not verify",
};

export type Tone = "green" | "amber" | "red" | "blue";
export const VERDICT_TONE: Record<Verdict, Tone> = { looks_genuine: "green", check_first: "amber", concerning: "red", unverified: "blue" };

export const SENTIMENTS = ["positive", "mixed", "negative", "unknown"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export const SENTIMENT_LABEL: Record<Sentiment, string> = { positive: "Positive", mixed: "Mixed", negative: "Negative", unknown: "Not known" };

export type SignalSeverity = "info" | "low" | "medium" | "high";

export type Signal = {
  id: string;
  severity: SignalSeverity;
  /** One plain sentence, computed from records. Never carries an email address, a phone number or a bank number. */
  text: string;
  /** Names of the other suppliers involved (duplicates), so the person can open them. */
  with?: { id: string; name: string }[];
  /** A well-formedness test only, never a lookup in a registry. */
  formatOnly?: boolean;
};

export type EvidenceKind = "web" | "history" | "domain" | "ids_format";
export type Positive = { id: string; kind: EvidenceKind; text: string; formatOnly?: boolean };

export const RATING_MIN_RFQS = 3;
export const RATING_MONTHS = 24;

export type RatingComponentId = "response" | "speed" | "completeness" | "price" | "awards" | "validity";

export type RatingComponent = {
  id: RatingComponentId;
  label: string;
  weight: number;
  /** 0 to 1, or null when the data for it does not exist (the component then drops out and the others are re-weighted). */
  score: number | null;
  /** The plain figure behind the score ("5 of 6 requests answered"). */
  detail: string;
};

export type RatingBasis = {
  months: number;
  /** RFQs the supplier was asked on, with a send date, in the window. */
  rfqs: number;
  /** RFQs it replied to with a quote, and lines it won, for the history evidence of the verdict. */
  replied: number;
  won: number;
  enough: boolean;
  components: RatingComponent[];
  /** The formula, in words, printed on the card. */
  formula: string;
};

export type Rating = { value: number | null; basis: RatingBasis };

export const FACT_KINDS = [
  "years", "scale", "client", "project", "certification", "award", "news_positive", "news_adverse", "review_positive", "review_negative",
  "legal", "fraud_report", "blacklist", "insolvency", "quality_complaint", "payment_complaint",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Kinds that are serious enough to make the verdict "concerning" when a cited page says them about this organisation. */
export const SERIOUS_KINDS: readonly FactKind[] = ["fraud_report", "blacklist", "insolvency"];
export const ADVERSE_KINDS: readonly FactKind[] = ["news_adverse", "review_negative", "legal", "fraud_report", "blacklist", "insolvency", "quality_complaint", "payment_complaint"];
export const POSITIVE_KINDS: readonly FactKind[] = ["years", "scale", "client", "project", "certification", "award", "news_positive", "review_positive"];

export const FACT_LABEL: Record<FactKind, string> = {
  years: "Years in business", scale: "Scale", client: "Clients", project: "Projects", certification: "Certifications", award: "Awards",
  news_positive: "Positive news", news_adverse: "Adverse news", review_positive: "Positive reviews", review_negative: "Negative reviews",
  legal: "Legal matters", fraud_report: "Reported concerns about conduct", blacklist: "Listed or sanctioned", insolvency: "Insolvency",
  quality_complaint: "Quality complaints", payment_complaint: "Payment complaints",
};

export type ReputationFact = {
  kind: FactKind;
  text: string;
  /** YYYY, YYYY-MM or YYYY-MM-DD when the page gives one. */
  when?: string;
  /** The number of the source in `sources` (1-based) that the fact comes from. */
  src: number;
};

export type WebSource = { title: string; url: string };

export type Reputation = {
  /** The web part ran for this check. */
  webUsed: boolean;
  /** The web part ran but a part of it failed or returned nothing it could cite. */
  partial: boolean;
  sentiment: Sentiment;
  facts: ReputationFact[];
  sources: WebSource[];
  summary: string;
  /** Searches the provider ran. */
  searches: number;
  /** A plain sentence when nothing was found, or part of the research failed. Absent when the research found facts. */
  note?: string;
};

export type Findings = { signals: Signal[]; positives: Positive[] };

export type SupplierCheckResult = {
  supplierId: string;
  supplierName: string;
  checkedAt: string;
  verdict: Verdict;
  /** One computed sentence saying why, with the strongest reason first. */
  verdictSentence: string;
  findings: Findings;
  rating: Rating;
  reputation: Reputation;
  /** What would sharpen the result, computed from what is missing. */
  sharpen: string[];
  /** The narrative model that wrote the reputation summary, or null when it was composed from the facts. */
  model: string | null;
};

/** What the suppliers list, the RFQ screens and the price comparison read: the newest saved check, small. */
export type CheckSummary = { supplierId: string; verdict: Verdict; rating: number | null; rfqs: number; checkedAt: string };

export const NOT_ENOUGH_HISTORY = "Not enough history";

export type CheckHistoryItem = { id: string; checkedAt: string; verdict: Verdict; rating: number | null; webUsed: boolean };
