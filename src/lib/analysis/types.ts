import type { Factor, Stage } from "@/lib/signals/types";

// Company analysis: the shared vocabulary of the card (docs/design/account-analysis.md, owner corrections 2026-10-22
// evening). The card is four parts: a verdict, what they are doing, what we have in our system, next steps. Sources are
// kept for audit and "what changed" in `internal` and are never drawn. Pure and dependency-free apart from the Buying
// signals words, so the engine, the cache and the screens read one shape.

export const CLAIM_KINDS = ["profile", "award", "project", "tender", "hiring", "expansion", "funding", "leadership", "risk", "other"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/** Kinds that count as "something is happening" and may become Buying signals. */
export const TRIGGER_KINDS: readonly ClaimKind[] = ["award", "project", "tender", "hiring", "expansion", "funding"];

export const STALE_DAYS = 180;
export const TTL_DAYS = 7;
export const TRIGGER_RECENT_DAYS = 30;
export const TRIGGER_WATCH_DAYS = 90;

export type SourceRef = { id: string; url: string; title: string; publisher?: string; fetchedAt: string };

export type SourcedValue = { value: string; source: SourceRef; asOf: string };

export type Claim = {
  text: string;
  kind: ClaimKind;
  /** The tenant topic this was classified into, by name. Only ever a name from the tenant's own list. */
  topic?: string;
  /** For a tender: did the company issue it, or is it named in it. */
  tenderRole?: "issuer" | "named";
  source: SourceRef;
  publishedOn?: string;
  confidence: "found" | "unsure";
  stale: boolean;
  /** The text reads like an instruction to a model. Kept as data, never scored, never shown, never sent to a model. */
  instructionLike?: boolean;
};

export type PublicPerson = { name: string; title: string; source: SourceRef };

/** A line from the tenant's own records. `href` is an internal app path, never a web address. */
export type Line = { text: string; date?: string; href?: string };

export type ContactLine = { id: string; name: string; title?: string; role?: string; href?: string };

export type Gap = { role: string; text: string };

/** One named reason, signed. `area` says whether it belongs to Fit or to Timing. */
export type AnalysisFactor = Factor & { area: "fit" | "timing" };

export const FIT_LABELS = ["strong", "partial", "weak", "unknown"] as const;
export type FitLabel = (typeof FIT_LABELS)[number];
export const FIT_TEXT: Record<FitLabel, string> = { strong: "Strong", partial: "Partial", weak: "Weak", unknown: "Unknown" };

export const VERDICT_LABELS = ["call_this_week", "watch", "not_a_fit", "not_enough"] as const;
export type VerdictLabel = (typeof VERDICT_LABELS)[number];
export const VERDICT_TEXT: Record<VerdictLabel, string> = {
  call_this_week: "Worth a call this week",
  watch: "Worth watching",
  not_a_fit: "Not a fit now",
  not_enough: "Not enough to say",
};

/** The three answers the card shows after "Worth following up:". */
export type FollowUp = "yes" | "not_now" | "unclear";
export const FOLLOW_UP_TEXT: Record<FollowUp, string> = { yes: "Yes", not_now: "Not now", unclear: "Unclear" };
export const FOLLOW_UP_FOR: Record<VerdictLabel, FollowUp> = {
  call_this_week: "yes", watch: "not_now", not_a_fit: "not_now", not_enough: "unclear",
};

export type Change = { kind: "new_claim" | "gone_claim" | "verdict" | "fit" | "timing"; text: string };

export type NextStepCard = { id: string; kind: string; label: string };

export type Verdict = {
  followUp: FollowUp;
  label: VerdictLabel;
  fit: FitLabel;
  timing: { stage: Stage; score: number | null; from: "signals" | "web_only" };
  /** Which fixed rule decided (1 to 4, 4 also being the catch-all). */
  rule: 1 | 2 | 3 | 4;
  because: string;
  /** One sentence of reason. The AI may word it from the factors only; without it, the top factors verbatim. */
  sentence: { text: string; byAi: boolean };
  /** Fit and Timing, named and signed, behind the card's expandable line. */
  factors: AnalysisFactor[];
};

/** One highlight line. There is no source here on purpose: sources are stored for audit and never drawn. */
export type Highlight = {
  text: string;
  kind: ClaimKind;
  topic?: string;
  /** "last month", "3 weeks ago". Empty when the item has no date. */
  when: string;
  publishedOn?: string;
  stale: boolean;
};

/** "What we have in our system": read from the workspace's own tables, only what the person may view. */
export type InSystem = {
  inCrm: boolean;
  /** The account's own facts, one line each: "Type: End customer", "Owner: Faisal", "Customer since Mar 2024". */
  account: Line[];
  contacts: ContactLine[];
  gaps: Gap[];
  openQuotes: Line[];
  openCases: Line[];
  invoicesDue: Line[];
  lastActivity: Line | null;
  /** What we do not have: "No procurement contact", "No quotes yet". */
  missing: string[];
  /** For a company that is not an account: existing accounts with a similar name or the same website. */
  similar: { id: string; name: string; href: string }[];
};

/** Everything kept for audit, "what changed" and Check these. Returned to the caller, never drawn. */
export type AnalysisInternal = {
  sources: SourceRef[];
  claims: Claim[];
  checkThese: Claim[];
  publicPeople: PublicPerson[];
};

export type AnalysisCard = {
  id: string;
  companyKey: string;
  accountId: string | null;
  name: string;
  /** One line: "Riyadh, Saudi Arabia · Precast concrete · about 450 staff". */
  identity: string;
  verdict: Verdict;
  doing: Highlight[];
  inSystem: InSystem;
  /** Filled by the next-step cards (CA5). Empty until then. */
  nextSteps: NextStepCard[];
  refreshedAt: string;
  expiresAt: string;
  stale: boolean;
  changes?: Change[];
  /** Something the card must say plainly: "Little public information found", "Needs web research". */
  notes: string[];
  internal: AnalysisInternal;
};

/** What the engine keeps from one run so the next run can say what changed. */
export type AnalysisSnapshot = {
  claims: Claim[];
  fit: FitLabel;
  stage: Stage;
  verdict: VerdictLabel;
};
