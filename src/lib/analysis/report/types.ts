// The company brief: the one shape the validator produces, the cache stores and the dock and the account tab draw
// (docs/design/company-brief-sales.md section 5, version 2). Client-safe and dependency-free. Every statement carries `src`,
// the number of its source in `sources`. The only text without a source is an inference (a "why it matters" line, a
// "talk about" cell, Where we fit, how a competitor competes), and each of those is labelled as the assistant's reading.
// The code names (CompanyReport, research_company_report) stay; the product word is "Company brief".

export const REPORT_VERSION = 2 as const;

/** The four parallel research parts. A part that fails is named on the card; the others are kept. */
export const REPORT_PARTS = ["financials", "signals", "people", "market"] as const;
export type ReportPartId = (typeof REPORT_PARTS)[number];

export const REPORT_PART_LABEL: Record<ReportPartId, string> = {
  financials: "Financials and performance",
  signals: "News and buying signals",
  people: "People and roles",
  market: "Market and risks",
};

/** The part's name in the sentence "X could not be researched". */
export const REPORT_PART_MISSING_TEXT: Record<ReportPartId, string> = {
  financials: "Financials and performance could not be researched.",
  signals: "News and buying signals could not be researched.",
  people: "People and roles could not be researched.",
  market: "Market and risks could not be researched.",
};

/** The block each part feeds, so the card can say "not researched" where that block belongs. */
export const REPORT_PART_BLOCK: Record<ReportPartId, "money" | "signals" | "roles" | "market"> = {
  financials: "money", signals: "signals", people: "roles", market: "market",
};

// Fixed lists: code-owned, never invented by the model. A value outside a list is dropped, not shown.
export const SIGNAL_KINDS = ["award", "expansion", "plant", "funding", "tender", "leadership", "hiring", "acquisition", "other"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  award: "award", expansion: "expansion", plant: "new plant", funding: "funding", tender: "tender", leadership: "leadership change",
  hiring: "hiring", acquisition: "acquisition", other: "news",
};

export const ROLE_FUNCTIONS = ["procurement", "projects", "operations", "finance", "executive"] as const;
export type RoleFunction = (typeof ROLE_FUNCTIONS)[number];
export const ROLE_FUNCTION_LABEL: Record<RoleFunction, string> = {
  procurement: "Procurement and supply", projects: "Projects", operations: "Operations and plant", finance: "Finance", executive: "Executive",
};

export const WATCHOUT_KINDS = ["rating", "going_concern", "payment", "litigation", "negative_news"] as const;
export type WatchoutKind = (typeof WATCHOUT_KINDS)[number];
export const WATCHOUT_KIND_LABEL: Record<WatchoutKind, string> = {
  rating: "Credit rating", going_concern: "Going concern", payment: "Payment", litigation: "Legal", negative_news: "Negative news",
};

export const OWNERSHIP_KINDS = ["public", "private", "state", "subsidiary"] as const;
export type OwnershipKind = (typeof OWNERSHIP_KINDS)[number];
export const OWNERSHIP_LABEL: Record<OwnershipKind, string> = { public: "Listed", private: "Private", state: "State-owned", subsidiary: "Subsidiary" };

export const PROXY_KINDS = ["employees", "projects", "rating", "registry", "facility"] as const;
export type ProxyKind = (typeof PROXY_KINDS)[number];

/**
 * Why a part could not be researched, as a code (never the provider's own error text, which can carry secrets or paths). The code
 * is kept in the saved partial brief and in the audit row, and the card says it in a short plain sentence behind an "i".
 */
export const FAIL_REASONS = ["timeout", "provider_error", "rate_limited", "audit_blocked", "empty_answer"] as const;
export type FailReason = (typeof FAIL_REASONS)[number];
export const FAIL_REASON_TEXT: Record<FailReason, string> = {
  timeout: "The search took longer than the time allowed. Trying the missing parts again usually works.",
  provider_error: "The search service had a problem or refused the request. Try again in a moment; an administrator can check the AI service.",
  rate_limited: "The search service was busy and asked us to slow down. Try again in a minute.",
  audit_blocked: "A search was not about the company itself, so this part was stopped. Nothing from it was kept.",
  empty_answer: "The search ran but gave no answer the app could read. Trying the missing parts again can help.",
};

export const REPORT_LENSES = ["prospect", "competitor"] as const;
export type ReportLens = (typeof REPORT_LENSES)[number];

/** One checked statement. `on` is a publication date or "as of" month (YYYY-MM-DD or YYYY-MM), when the page gave one. */
export type ReportItem = { text: string; src: number; on?: string; old?: boolean };

/** A fact held as a value, with its page. */
export type Fact<T> = { value: T; src: number; on?: string };

export type Employees = { count: number; upTo?: number; approx: boolean; src: number; on?: string; matched: boolean };

/**
 * A money figure as a field, never as prose. `amount` is in whole units of `currency` (the validator multiplies the
 * published unit out), `fiscalYear` is the year the company calls it. `matched` says the figure's digits were found in the
 * snippet the provider cited for the page; when false the card shows "check [n]" beside it. Growth and margin are never
 * stored: our code derives them from two of these.
 */
export type Money = { amount: number; currency: string; fiscalYear: number; src: number; matched: boolean };

export type MoneyBlock = {
  revenue: Money[];
  profit: Money[];
  status: "published" | "partial" | "not_published";
  proxies: { kind: ProxyKind; text: string; src: number }[];
};

export type Signal = {
  kind: SignalKind;
  text: string;
  /** Required: an event with no date is not a reason to call this month. YYYY-MM-DD or YYYY-MM. */
  on: string;
  src: number;
  old?: boolean;
  /** "Why it matters": the assistant's reading, never sourced, may be empty. */
  why: string;
};

export type NamedPerson = { name: string; title: string; src: number };

export type RoleRow = {
  fn: RoleFunction;
  /** What to talk about: the assistant's reading, never sourced, may be empty. */
  talkAbout: string;
  /** Names and titles the company itself publishes. Never anything else about a person. */
  named: NamedPerson[];
};

export type Watchout = { kind: WatchoutKind; text: string; on: string; src: number };

export type Competitor = { name: string; how: string; src: number };

/** Where a fit priority comes from: a Why-now statement or a Performance statement that exists in the validated report. */
export type FitBasis = { type: "signal" | "highlight"; index: number };

export type FitBlock = {
  angle: string;
  priorities: { basedOn: FitBasis; offering: string; why: string }[];
  questions: string[];
};

/** The assistant's own reading of how this company competes with one of the workspace's offerings. Never sourced, always labelled. */
export type ReportCompete = { offering: string; text: string };

export type ReportSource = { n: number; title: string; url: string; publisher?: string };

export type CompanyReport = {
  v: 2;
  name: string;
  domain: string | null;
  country: string | null;
  lens: ReportLens;
  oneLiner: ReportItem | null;
  facts: { hq?: Fact<string>; ownership?: Fact<{ kind: OwnershipKind; detail?: string }>; employees?: Employees; ticker?: string };
  money: MoneyBlock;
  signals: Signal[];
  roles: RoleRow[];
  performance: { market: ReportItem[]; highlights: ReportItem[]; tailwinds: ReportItem[]; headwinds: ReportItem[] };
  watchouts: Watchout[];
  market: { facts: ReportItem[]; competitors: Competitor[] };
  profile: { what: ReportItem[]; clients: ReportItem[]; projects: ReportItem[] };
  /** Prospect lens only; null when the block is hidden (no offerings, or nothing sourced to base it on). */
  fit: FitBlock | null;
  /** Competitor lens only. */
  compete: ReportCompete[];
  sources: ReportSource[];
  /** How many statements were left out because no cited page backed them. Shown as one muted line. */
  leftOut: number;
  /** The searches the provider ran for this brief. */
  searches: number;
  /** Parts that could not be researched. Empty for a complete brief. */
  missing: ReportPartId[];
  /** Why each missing part failed, as a code. A part that is missing without a code (an older saved brief) simply has none. */
  reasons?: Partial<Record<ReportPartId, FailReason>>;
  generatedAt: string;
};

/** The most searches one brief may run: four parts of two. The consent chip and the InfoTips quote this number. */
export const MAX_REPORT_SEARCHES = 8;
/** Searches one part may run. Live testing (2026-11-23) showed three searches did not finish inside 80 s; two fit with room to spare. */
export const PART_MAX_SEARCHES = 2;
/** Sources one brief keeps. */
export const REPORT_MAX_SOURCES = 20;

/** Block titles, in the order a seller reads them. */
export const REPORT_BLOCKS = ["why_now", "who", "fit", "performance", "watchouts", "market", "profile", "sources"] as const;
export type ReportBlockId = (typeof REPORT_BLOCKS)[number];
export const REPORT_BLOCK_LABEL: Record<ReportBlockId, string> = {
  why_now: "Why now", who: "Who to talk to", fit: "Where we fit", performance: "Performance", watchouts: "Watch-outs",
  market: "Market and competitors", profile: "Profile", sources: "Sources",
};

const moneyCount = (m: MoneyBlock) => m.revenue.length + m.profit.length;

/** How many entries a block holds, for the collapsed header. */
export function blockCount(r: CompanyReport, id: ReportBlockId): number {
  switch (id) {
    case "why_now": return r.signals.length;
    case "who": return r.roles.length;
    case "fit": return r.fit ? r.fit.priorities.length + r.fit.questions.length + (r.fit.angle ? 1 : 0) : r.compete.length;
    case "performance": {
      const years = new Set(r.money.revenue.map((m) => m.fiscalYear)).size;
      return years + r.performance.market.length + r.performance.highlights.length + r.performance.tailwinds.length + r.performance.headwinds.length;
    }
    case "watchouts": return r.watchouts.length;
    case "market": return r.market.facts.length + r.market.competitors.length;
    case "profile": return r.profile.what.length + r.profile.clients.length + r.profile.projects.length;
    case "sources": return r.sources.length;
  }
}

/** True when no page backed any statement: there is nothing a person could read. Inferences do not count. */
export const reportIsEmpty = (r: CompanyReport): boolean =>
  !r.oneLiner && !r.facts.hq && !r.facts.ownership && !r.facts.employees && moneyCount(r.money) === 0 && r.money.proxies.length === 0
  && r.signals.length === 0 && r.roles.every((x) => x.named.length === 0) && r.watchouts.length === 0
  && r.performance.market.length + r.performance.highlights.length + r.performance.tailwinds.length + r.performance.headwinds.length === 0
  && r.market.facts.length + r.market.competitors.length === 0 && r.profile.what.length + r.profile.clients.length + r.profile.projects.length === 0;

/** The text of the source with this number, or undefined. */
export const sourceOf = (r: { sources: ReportSource[] }, n: number): ReportSource | undefined => r.sources.find((s) => s.n === n);

/** Whether a part's block is empty because the part failed, as opposed to nothing being found. */
export const partMissing = (r: CompanyReport, part: ReportPartId): boolean => r.missing.includes(part);
