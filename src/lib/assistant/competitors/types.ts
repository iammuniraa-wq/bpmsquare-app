// What the competitor analysis card is made of. Client-safe and data only: the dock draws the card from these fields, so no
// model text is ever the card's numbers and no tenant or user id can ride along.

export type LadderBasis = "history" | "prior";
export type ExpectedPrice = "lower" | "similar" | "higher";

export type CompetitorRow = {
  name: string;
  country: string | null;
  /** Other decided tenders of this workspace in which they were listed, or won. */
  met: number;
  /** Of those, the ones we won. */
  weWon: number;
  /** Of those, the ones they won against us. */
  theyWon: number;
  /** Open tenders besides this one that list them. */
  openElsewhere: number;
  /** The usual gap when they beat us: how far above their winning price our bid sat, in percent (median). Null when no winning price was recorded. */
  typicalGapPct: number | null;
  gapSample: number;
  /** What the team expects on this tender, read from our side. */
  expectedPrice: ExpectedPrice | null;
  /** One line from the sourced web research saved on this tender, and how many pages stand behind the saved research. */
  web: { line: string | null; sources: number; researchedAt: string | null };
  /** The one the person asked about. */
  focus: boolean;
};

export type LadderRow = {
  marginPct: number;
  winPct: number;
  /** Past bids this row's chance is read from (within three points of this margin), and how many of them won. */
  nearby: number;
  nearbyWins: number;
  price: number | null;
  profit: number | null;
  /** Win chance times profit; null when no cost is recorded. */
  expected: number | null;
  /** Expected profit per 100 of cost: the same ranking with or without a recorded cost. */
  expectedPer100: number;
  recommended: boolean;
  /** The row closest to where the price stands now. */
  current: boolean;
};

export type ValueBand = { label: string; decided: number; wins: number; current: boolean };

export type HistorySummary = {
  decided: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  /** Decided bids whose margin is known (a recorded cost and a submitted price). */
  withMargin: number;
  avgMarginWinPct: number | null;
  avgMarginLossPct: number | null;
  /** Lost bids with our price and the winning price both recorded. */
  withGap: number;
  bands: ValueBand[] | null;
};

export type Risk = { id: string; level: "warn" | "info"; text: string };

export type Step = { id: string; label: string; kind: "navigate" | "ask" | "add"; target?: string; question?: string };

export type Recommended = { fromPct: number; toPct: number; peakPct: number; reason: string };

export type Ladder = {
  basis: LadderBasis;
  /** Past bids the chances are read from; 0 for the starting assumption. */
  sample: number;
  /** One plain sentence saying where the chances come from. */
  note: string;
  rows: LadderRow[];
  recommended: Recommended | null;
};

export type DealFigures = {
  ref: string;
  title: string;
  href: string;
  closingAt: string | null;
  daysLeft: number | null;
  currency: string | null;
  price: number | null;
  cost: number | null;
  marginPct: number | null;
  costedLines: number;
  totalLines: number;
};

export type DockCompetitors = {
  deal: DealFigures;
  focus: string | null;
  summary: string;
  position: string;
  /** Whether a model wrote the two texts; "rules" is the plain wording built from the same figures. */
  writtenBy: "model" | "rules";
  competitors: CompetitorRow[];
  history: HistorySummary;
  ladder: Ladder;
  risks: Risk[];
  /** What data would make this sharper, one short line each. */
  sharpen: string[];
  steps: Step[];
  /** The card as compact text for the next turns of the chat. It holds figures and names only, never text from the web. */
  digest: string;
};
