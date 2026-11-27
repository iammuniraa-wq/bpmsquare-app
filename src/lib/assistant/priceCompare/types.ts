import type { NextStep } from "@/lib/assistant/cards";
import type { AwardCheck } from "@/lib/suppliers/check/awardGate";

// The cards the price tools put in the dock (docs/design/gcc-tender-deals.md, RFQ comparison and Award and price). Client-safe and data only:
// the dock draws these fields and nothing else, and every figure in them was worked out by compute.ts, never by a model.

/** Weights of the recommendation score. They are shown on the card, so a buyer can argue with them. */
export const SCORE_WEIGHTS = { price: 60, completeness: 20, validity: 10, lead: 10 } as const;
/** A supplier price this far from our own history is flagged. */
export const OUTLIER_PCT = 25;

export type Validity = "ok" | "expired" | "stale";

export type Outlier = {
  pct: number;
  refPrice: number;
  refLabel: string;
  refAsOf: string | null;
  refStale: boolean;
  refAgeDays: number | null;
};

export type CompareCell = {
  /** The landed unit price in the workspace currency; null when nothing comparable was given. */
  unit: number | null;
  amount: number | null;
  validity: Validity | null;
  leadDays: number | null;
  validUntil: string | null;
  cheapest: boolean;
  alternative: boolean;
  /** Why a given answer is not compared: no quote on the line, or a foreign price with no exchange rate. */
  left: "no_quote" | "no_fx" | null;
  outlier: Outlier | null;
};

export type CompareLine = {
  id: string;
  item: string;
  description: string;
  uom: string | null;
  qty: number | null;
  /** One entry per supplier column; null = that supplier did not answer this line at all. */
  cells: (CompareCell | null)[];
  cheapestIndex: number | null;
  /** No price on the line is still valid: the cheapest shown is the lowest of what exists. */
  noValid: boolean;
  spreadPct: number | null;
};

export type ScoreParts = { price: number; completeness: number; validity: number; lead: number };

export type CompareSupplier = {
  id: string;
  supplierId: string;
  name: string;
  quoted: number;
  asked: number;
  partial: boolean;
  missingItems: string[];
  /** The supplier's own quoted lines, added up the way the compare screen adds them. */
  total: number;
  /** The same supplier over the lines every column quoted; null when no line was quoted by all. */
  likeForLike: number | null;
  score: number;
  parts: ScoreParts;
  leadMin: number | null;
  leadMax: number | null;
  validUntil: string | null;
  expired: number;
  recommended: boolean;
};

export type Risk = { id: string; kind: "partial" | "outlier" | "expired" | "no_fx" | "alternative" | "no_valid" | "silent" | "awarded" | "single" | "basis"; level: "warn" | "info"; text: string };

export type Comparison = {
  rfq: { id: string; ref: string; title: string; status: string };
  currencyCode: string;
  today: string;
  staleDays: number;
  suppliers: CompareSupplier[];
  lines: CompareLine[];
  /** Lines every supplier column quoted. */
  commonLines: number;
  askedLines: number;
  /** The single supplier award that covers every line, cheapest first; null when no supplier quoted every line. */
  bestSingle: { index: number; name: string; total: number } | null;
  /** Each line to its cheapest valid supplier. */
  split: { total: number; lines: number; suppliers: number; saving: number | null; savingPct: number | null } | null;
  /** Highest minus lowest like-for-like total. */
  spread: { amount: number; pct: number } | null;
  weights: typeof SCORE_WEIGHTS;
  outlierPct: number;
  recommendation: { index: number; name: string } | null;
  notPriced: { name: string; reason: string }[];
  risks: Risk[];
};

export type DockPriceCompare = {
  kind: "compare";
  id: string;
  comparison: Comparison;
  recommendationText: string;
  recommendationBy: "model" | "computed";
  next: NextStep[];
  /** The card as compact text, sent back inside the history so a follow-up can be answered. */
  digest: string;
  notice: string | null;
  /** The currency of every figure, as the dock formats it. */
  currency: { symbol: string; locale: string; decimals: number };
};

export type AwardLineView = {
  lineId: string;
  responseId: string;
  rfqSupplierId: string;
  item: string;
  description: string;
  supplier: string;
  cost: number;
  qty: number | null;
  markupPct: number | null;
  rate: number | null;
  /** Higher than the lowest valid price, or itself expired or stale: the award needs a reason. */
  needsReason: boolean;
  validity: Validity;
  alreadyAwarded: boolean;
};

export type AwardPlan = {
  rfqId: string;
  route: "tender" | "rfq";
  dealId: string | null;
  mode: "single" | "split";
  targets: { lineId: string; responseId: string; rfqSupplierId: string; item: string }[];
};

export type DockAward = {
  kind: "award";
  id: string;
  token: string;
  title: string;
  summary: string;
  rfq: { id: string; ref: string };
  plan: AwardPlan;
  lines: AwardLineView[];
  /** Lines left out of the award, each with the reason. */
  left: { item: string; reason: string }[];
  total: number;
  /** A tender award stores the cost and adds the markup; a plain RFQ award stores the cost only. */
  pricesRows: boolean;
  markupDefaultPct: number | null;
  /** Which markup the rates on the card use and where each comes from. Absent on a card that adds no markup. */
  markupNote?: string | null;
  needsReason: boolean;
  needsReplace: boolean;
  /** Anything that is not a clean pass, in words. Blocking ones set `blocked`. */
  notices: string[];
  blocked: string | null;
  primaryLabel: string;
  currency: { symbol: string; locale: string; decimals: number };
  compareHref: string;
  risk: "write";
  /** Suppliers on the card whose newest saved Supplier check is Check first or Concerning. The press asks again; the person types the reason. */
  supplierChecks?: AwardCheck[];
};

export type AwardDone = { awarded: number; of: number; partial?: boolean; error?: string; stoppedAt?: string; next: NextStep[]; warnings: string[] };
/** How an award card in the chat ended (see CardSettled in assistant/cards.ts). */
export type AwardSettled = { kind: "awarded"; done: AwardDone } | { kind: "cancelled" };

export type PriceCheckRow = {
  item: string;
  description: string;
  basis: "cost" | "rate";
  current: number;
  reference: number;
  referenceCount: number;
  nearest: string;
  pct: number;
  stale: boolean;
  href: string | null;
};

export type DockPriceCheck = {
  kind: "check";
  id: string;
  deal: { id: string; ref: string; title: string };
  rows: PriceCheckRow[];
  checked: number;
  noReference: number;
  digest: string;
  next: NextStep[];
  currency: { symbol: string; locale: string; decimals: number };
};

export type PriceCard = DockPriceCompare | DockAward | DockPriceCheck;

/** The card as text for the next turns of the chat (the dock sends it back inside the history as quoted data). */
export const priceDigest = (card: PriceCard): string => (card.kind === "award" ? `${card.title}. ${card.summary}` : card.digest);
