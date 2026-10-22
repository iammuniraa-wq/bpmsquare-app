// Buying signals: the shared vocabulary of the rubric, the stored row and the
// screens (docs/signals-architecture.md sections 1, 5 and 7). Pure and
// dependency-free so the client list page and the server recompute import the
// same words.

export const STAGES = ["quiet", "looking", "comparing", "deciding"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  quiet: "Silent", looking: "Looking", comparing: "Comparing", deciding: "Deciding",
};

/** One line under each stage, in the words a rep would use (shown in hints and the tour). */
export const STAGE_HINT: Record<Stage, string> = {
  quiet: "Nothing recent to go on",
  looking: "Has shown some interest",
  comparing: "Asked us for something, or clearly engaged",
  deciding: "Asked us for something and is very engaged",
};

export const stageRank = (s: Stage): number => STAGES.indexOf(s);

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

/** The four capped groups of the rubric (doc section 5.1). */
export type SignalGroup = "asked" | "responded" | "moving" | "visited";

export const GROUP_ORDER: SignalGroup[] = ["asked", "responded", "moving", "visited"];

export const GROUPS: Record<SignalGroup, { label: string; cap: number; hint: string }> = {
  asked: { label: "They asked us", cap: 40, hint: "Quotes, deals, repeat breakdowns, contracts about to end" },
  responded: { label: "They responded", cap: 25, hint: "Clicks and interest in what you sent, opened quote links" },
  moving: { label: "They are moving", cap: 20, hint: "News, tenders and hiring. Arrives with the market sources." },
  visited: { label: "They visited", cap: 15, hint: "Visits to your website. Arrives with the website snippet." },
};

/** Where a signal came from, as the person reads it. */
export type SignalSource = "quotes" | "deals" | "cases" | "contracts" | "campaigns" | "newsletters" | "team" | "web";

export const SOURCE_LABEL: Record<SignalSource, string> = {
  quotes: "Quotes", deals: "Deals", cases: "Cases", contracts: "Contracts",
  campaigns: "Campaigns", newsletters: "Newsletters", team: "Your team", web: "Web",
};

/** The rubric row key. Every kind belongs to exactly one group. */
export type SignalKind =
  | "inquiry" | "deal_opened" | "quote_waiting" | "service_trouble" | "contract_renewal"
  | "interested" | "quote_opened" | "quote_accepted" | "quote_change"
  | "link_click_topic" | "link_click" | "email_opened" | "unsubscribed"
  | "web_tender_issued" | "web_tender_named" | "web_award" | "web_hiring" | "web_risk";

export type KindDef = {
  group: SignalGroup;
  points: number;
  label: string;
  /** At most this many signals of the kind count (the highest decayed ones). */
  maxItems?: number;
  /** Days a signal holds at full weight before it starts to fade, and when it is gone. Negatives hold longer. */
  holdDays?: number;
  /**
   * No nightly collector feeds this kind yet (the company analysis writes it for one company at a time), so it does not
   * count towards the live groups that scale the stage thresholds: existing workspaces keep their stages exactly.
   */
  offLine?: boolean;
};

export const KINDS: Record<SignalKind, KindDef> = {
  inquiry: { group: "asked", points: 25, label: "Asked for a quote", maxItems: 3 },
  deal_opened: { group: "asked", points: 20, label: "A deal was opened", maxItems: 2 },
  quote_waiting: { group: "asked", points: 10, label: "Quote waiting for an answer", maxItems: 2 },
  service_trouble: { group: "asked", points: 15, label: "Repeated breakdowns", maxItems: 1 },
  contract_renewal: { group: "asked", points: 12, label: "Contract about to end", maxItems: 1 },
  interested: { group: "responded", points: 15, label: "Said they are interested", maxItems: 2 },
  quote_opened: { group: "responded", points: 8, label: "Opened the quote link", maxItems: 2 },
  quote_accepted: { group: "responded", points: 20, label: "Accepted a quote", maxItems: 1 },
  quote_change: { group: "responded", points: 12, label: "Asked for a change to a quote", maxItems: 1 },
  link_click_topic: { group: "responded", points: 6, label: "Clicked a link on a topic you track", maxItems: 3 },
  link_click: { group: "responded", points: 3, label: "Clicked a link", maxItems: 3 },
  email_opened: { group: "responded", points: 1, label: "Opened an email", maxItems: 2 },
  unsubscribed: { group: "responded", points: -15, label: "Unsubscribed", maxItems: 1, holdDays: 90 },
  // Public sources found by the company analysis (docs/design/account-analysis.md 6.2). Points are the ones fixed in
  // docs/signals-architecture.md 5.1.
  web_tender_issued: { group: "moving", points: 14, label: "Issued a tender", maxItems: 1, offLine: true },
  web_tender_named: { group: "moving", points: 8, label: "Named in a tender", maxItems: 1, offLine: true },
  web_award: { group: "moving", points: 8, label: "Won work, expanding or funded", maxItems: 2, offLine: true },
  web_hiring: { group: "moving", points: 5, label: "Hiring", maxItems: 2, offLine: true },
  web_risk: { group: "moving", points: -6, label: "Bad news reported", maxItems: 1, holdDays: 90, offLine: true },
};

/** A thing that happened, as the collectors hand it to the rubric. Nothing in here is PII. */
export type RawSignal = {
  kind: SignalKind;
  source: SignalSource;
  /** What makes it one occurrence: the same key never counts twice. */
  key: string;
  occurredAt: string;
  /** A sentence without a date or an age: "Asked for a quote (QT-0042)". */
  headline: string;
  /** Internal app path to the evidence. */
  href?: string;
  /** The tenant topic a click was about, by name. Feeds the signal_topic audience field. */
  topic?: string;
};

export type Factor = {
  group: SignalGroup | "note";
  label: string;
  /** Signed, after fading, whole points. The factors add up to the score exactly. */
  points: number;
  detail: string;
};

export type TopSignal = {
  kind: SignalKind;
  group: SignalGroup;
  source: SignalSource;
  headline: string;
  occurred_at: string;
  points: number;
  href?: string;
};

export type IntentResult = {
  score: number;
  stage: Stage;
  factors: Factor[];
  topSignals: TopSignal[];
  signalCount: number;
  /** Names of the topics the counted signals were about. */
  topics: string[];
  /** An unanswered "asked" signal from the last 30 days -- the rule that separates Comparing from Looking. */
  recentAsk: boolean;
};

/** The stored row (account_intent, 0176). */
export type IntentRow = {
  tenant_id: string;
  account_id: string;
  score: number;
  stage: Stage;
  previous_stage: Stage | null;
  factors: Factor[];
  top_signals: TopSignal[];
  signal_count: number;
  topics: string[];
  stage_changed_at: string | null;
  marked_not_in_market_at: string | null;
  computed_at: string;
};

export type SignalTopic = {
  id: string;
  tenant_id: string;
  name: string;
  keywords: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
