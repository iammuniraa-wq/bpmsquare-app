import { sameCompany } from "@/lib/tender/competitors/rules";
import { marginHiddenText, marginIsStated } from "@/lib/tender/bids/marginCoverage";
import { moneyText, pctText, plural, round } from "./format";
import type {
  CompetitorRow, DealFigures, ExpectedPrice, HistorySummary, Ladder, LadderRow, Recommended, Risk, ValueBand,
} from "./types";

// The arithmetic behind the competitor analysis (docs/design/assistant-smarter.md section 8, web research rules). PURE: no I/O,
// no clock except the one handed in, so every figure on the card can be checked by hand. The model never computes anything here:
// it only writes two short texts from the figures this file produces (narrative.ts), and the card is drawn from the fields.

export const LADDER = {
  floor: 4,
  ceiling: 20,
  step: 2,
  /** A past bid counts toward a margin when it was within this many points of it. */
  window: 3,
  /** Bids of this margin band are blended with the starting assumption as if this many more had been seen. */
  shrink: 2,
  /** How much each extra point of margin lowers the odds of winning (the starting assumption). */
  slope: 0.12,
  defaultCenter: 10,
  priorBase: 0.3,
  priorWeight: 2,
  /** Decided bids with a known margin needed before the chances come from the workspace's own history. */
  minBids: 5,
  /** The recommended range holds every margin whose expected profit is within this share of the best one. */
  peakShare: 0.9,
  /** A margin outside these bounds is a data slip, not a bid. */
  marginMin: -50,
  marginMax: 80,
  /** Competitor research older than this many days is called out as old. */
  staleDays: 180,
  /** Value bands need at least this many decided bids. */
  bandMinBids: 6,
} as const;

export type DealInput = {
  ref: string;
  title: string;
  href: string;
  closingAt: string | null;
  currency: string | null;
  price: number | null;
  /** The recorded cost of the priced lines that have one. */
  cost: number | null;
  /** The priced amount of those lines. */
  costedAmount: number;
  costedLines: number;
  /** The priced lines. */
  totalLines: number;
  state: "open" | "won" | "lost" | "dropped";
};

export type EvidenceInput = {
  facts: { text: string; kind: string; source_url: string }[];
  price: { text: string; source_url: string } | null;
  wins: { text: string; source_url: string } | null;
  researchedAt: string | null;
};

export type CompetitorInput = {
  name: string;
  country: string | null;
  expectedPrice: ExpectedPrice | null;
  evidence: EvidenceInput | null;
};

export type PastTender = {
  outcome: "won" | "lost" | "dropped" | "open";
  currency: string | null;
  /** Our latest submitted total. */
  ourBid: number | null;
  /** The recorded cost behind that bid; null when none was recorded or the person may not see costs. */
  ourCost: number | null;
  /** The part of the bid that cost covers, when some lines had none. Absent = the whole bid. */
  ourCostedAmount?: number | null;
  /** On a lost tender, the winning price. */
  awardValue: number | null;
  winner: string | null;
  /** The competitors the team accepted on that tender. */
  competitors: string[];
};

export type AnalysisInput = {
  deal: DealInput;
  competitors: CompetitorInput[];
  /** Every other tender of this workspace. */
  past: PastTender[];
  /** Proposals from market research that nobody has accepted yet. */
  proposed: number;
  focus: string | null;
  costVisible: boolean;
  now: Date;
};

export type Computed = {
  deal: DealFigures;
  focus: string | null;
  competitors: CompetitorRow[];
  history: HistorySummary;
  ladder: Ladder;
  risks: Risk[];
  sharpen: string[];
  /** Decided past bids with a recorded cost, for the sentence about what would sharpen the ladder. */
  decidedWithoutCost: number;
  lostWithoutWinnerPrice: number;
  decidedWithoutCompetitors: number;
  proposed: number;
};

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

export { moneyText, pctText };

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (values: readonly number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

const DAY = 86_400_000;

export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.ceil((t - now.getTime()) / DAY) : null;
}

const decidedOutcome = (p: Pick<PastTender, "outcome">): p is { outcome: "won" | "lost" } => p.outcome === "won" || p.outcome === "lost";

/** Margin on price, in percent, of one past bid over the part its cost covers; null when too little of it has a cost or the figure is not believable. */
export function bidMargin(bid: number | null, cost: number | null, costedAmount?: number | null): number | null {
  if (bid == null || cost == null || !(bid > 0) || !(cost > 0)) return null;
  const covered = costedAmount ?? bid;
  if (!marginIsStated(bid, covered)) return null;
  const m = round(((covered - cost) / covered) * 100, 2);
  return m >= LADDER.marginMin && m <= LADDER.marginMax ? m : null;
}

/** The tender's margin as it stands, or null when it cannot be stated: no price, no cost, or cost on too little of the priced amount. */
export function dealMarginPct(deal: Pick<DealInput, "price" | "cost" | "costedAmount">): number | null {
  if (deal.price == null || deal.cost == null || !(deal.cost > 0) || !marginIsStated(deal.price, deal.costedAmount)) return null;
  return round(((deal.costedAmount - deal.cost) / deal.costedAmount) * 100, 1);
}

/** The tender's whole cost, known only when every priced line has one: a part of the cost never builds a price or a profit. */
const wholeCost = (deal: DealInput): number | null => (dealMarginPct(deal) !== null && deal.costedLines >= deal.totalLines ? deal.cost : null);

/** How far above the winning price our bid sat, in percent of the winning price (negative: we were below it). */
export function winGap(ourBid: number | null, winning: number | null): number | null {
  if (ourBid == null || winning == null || !(ourBid > 0) || !(winning > 0)) return null;
  return round(((ourBid - winning) / winning) * 100, 1);
}

// ── history ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Sample = { margin: number; won: boolean };

function marginSample(past: readonly PastTender[]): Sample[] {
  const out: Sample[] = [];
  for (const p of past) {
    if (!decidedOutcome(p)) continue;
    const m = bidMargin(p.ourBid, p.ourCost, p.ourCostedAmount);
    if (m !== null) out.push({ margin: m, won: p.outcome === "won" });
  }
  return out;
}

function valueBands(past: readonly PastTender[], deal: DealInput): ValueBand[] | null {
  const rows = past.filter((p) => decidedOutcome(p) && p.ourBid != null && p.ourBid > 0 && (p.currency === deal.currency || p.currency === null || deal.currency === null));
  if (rows.length < LADDER.bandMinBids) return null;
  const sorted = rows.map((r) => r.ourBid as number).sort((a, b) => a - b);
  // Thirds of our own bids; when many bids share a value the thirds collapse into two bands rather than showing an empty one.
  const cuts = [...new Set([sorted[Math.floor(sorted.length / 3)], sorted[Math.floor((2 * sorted.length) / 3)]])];
  const band = (v: number) => cuts.filter((q) => v >= q).length;
  const at = (q: number) => moneyText(q, deal.currency);
  const labels = cuts.length === 1
    ? [`Under ${at(cuts[0])}`, `${at(cuts[0])} and over`]
    : [`Under ${at(cuts[0])}`, `${at(cuts[0])} to ${at(cuts[1])}`, `${at(cuts[1])} and over`];
  const here = deal.price != null && deal.price > 0 ? band(deal.price) : -1;
  return labels.map((_l, i) => {
    const inBand = rows.filter((r) => band(r.ourBid as number) === i);
    return { label: labels[i], decided: inBand.length, wins: inBand.filter((r) => r.outcome === "won").length, current: i === here };
  });
}

export function summariseHistory(past: readonly PastTender[], deal: DealInput): HistorySummary {
  const decided = past.filter(decidedOutcome);
  const wins = decided.filter((p) => p.outcome === "won").length;
  const sample = marginSample(past);
  const avg = (won: boolean) => { const m = mean(sample.filter((s) => s.won === won).map((s) => s.margin)); return m === null ? null : round(m, 1); };
  const lost = decided.filter((p) => p.outcome === "lost");
  return {
    decided: decided.length,
    wins,
    losses: decided.length - wins,
    winRatePct: decided.length ? round((wins / decided.length) * 100, 0) : null,
    withMargin: sample.length,
    avgMarginWinPct: avg(true),
    avgMarginLossPct: avg(false),
    withGap: lost.filter((p) => winGap(p.ourBid, p.awardValue) !== null).length,
    bands: valueBands(past, deal),
  };
}

// ── the margin ladder ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The starting assumption: the odds of winning fall by `slope` (in log-odds) for each point of margin above the centre. */
export function priorWin(marginPct: number, base: number, center: number): number {
  const logit = Math.log(base / (1 - base)) - LADDER.slope * (marginPct - center);
  return 1 / (1 + Math.exp(-logit));
}

/** Win rate to start from: what the workspace's decided tenders show, held back toward 30% while there are few of them. */
export function baseRate(wins: number, decided: number): number {
  const b = (wins + LADDER.priorWeight * LADDER.priorBase) / (decided + LADDER.priorWeight);
  return Math.min(0.95, Math.max(0.05, b));
}

export function ladderMargins(currentMargin: number | null): number[] {
  let lo: number = LADDER.floor;
  let hi: number = LADDER.ceiling;
  if (currentMargin !== null) {
    lo = Math.min(lo, Math.max(0, Math.floor(currentMargin / LADDER.step) * LADDER.step));
    hi = Math.max(hi, Math.min(40, Math.ceil(currentMargin / LADDER.step) * LADDER.step));
  }
  const out: number[] = [];
  for (let m = lo; m <= hi; m += LADDER.step) out.push(m);
  return out;
}

export function buildLadder(args: { past: readonly PastTender[]; deal: DealInput; costVisible: boolean }): { ladder: Ladder; currentMargin: number | null } {
  const { past, deal } = args;
  const decided = past.filter(decidedOutcome);
  const wins = decided.filter((p) => p.outcome === "won").length;
  const sample = args.costVisible ? marginSample(past) : [];
  const base = baseRate(wins, decided.length);
  const center = sample.length ? mean(sample.map((s) => s.margin)) as number : LADDER.defaultCenter;
  const basis = sample.length >= LADDER.minBids ? "history" : "prior";
  const cost = args.costVisible ? wholeCost(deal) : null;
  const currentMargin = args.costVisible ? dealMarginPct(deal) : null;

  const margins = ladderMargins(currentMargin);
  const raw = margins.map((m) => {
    const prior = priorWin(m, base, center);
    const near = basis === "history" ? sample.filter((s) => Math.abs(s.margin - m) <= LADDER.window) : [];
    const nearWins = near.filter((s) => s.won).length;
    const p = basis === "history" ? (nearWins + LADDER.shrink * prior) / (near.length + LADDER.shrink) : prior;
    return { m, p, nearby: near.length, nearbyWins: nearWins };
  });
  // A higher margin is never shown as more likely to win than a lower one.
  for (let i = 1; i < raw.length; i++) raw[i].p = Math.min(raw[i].p, raw[i - 1].p);

  const rows: LadderRow[] = raw.map((r) => {
    const p = round(r.p, 3);
    const price = cost !== null ? round(cost / (1 - r.m / 100), 0) : null;
    const profit = price !== null && cost !== null ? round(price - cost, 0) : null;
    return {
      marginPct: r.m, winPct: round(p * 100, 1), nearby: r.nearby, nearbyWins: r.nearbyWins,
      price, profit, expected: profit !== null ? round(p * profit, 0) : null,
      expectedPer100: round(p * ((r.m / (100 - r.m)) * 100), 1),
      recommended: false, current: false,
    };
  });

  let recommended: Recommended | null = null;
  if (rows.length) {
    const best = rows.reduce((a, b) => (b.expectedPer100 > a.expectedPer100 ? b : a));
    const peakIdx = rows.indexOf(best);
    let lo = peakIdx;
    let hi = peakIdx;
    const floorValue = best.expectedPer100 * LADDER.peakShare;
    while (lo > 0 && rows[lo - 1].expectedPer100 >= floorValue) lo--;
    while (hi < rows.length - 1 && rows[hi + 1].expectedPer100 >= floorValue) hi++;
    for (let i = lo; i <= hi; i++) rows[i].recommended = true;
    const atTop = peakIdx === rows.length - 1;
    const where = basis === "history"
      ? `where ${best.nearbyWins} of ${best.nearby} nearby past bids won`
      : "on a starting assumption, with no tender history behind it yet";
    recommended = {
      fromPct: rows[lo].marginPct, toPct: rows[hi].marginPct, peakPct: best.marginPct,
      reason: `Expected profit is highest at a ${best.marginPct}% margin${atTop ? " (it may still rise above the top of this range)" : ""}, ${where}. ` +
        `Margins from ${rows[lo].marginPct}% to ${rows[hi].marginPct}% stay within ${round((1 - LADDER.peakShare) * 100, 0)}% of that.`,
    };
  }
  if (currentMargin !== null && rows.length) {
    const nearest = rows.reduce((a, b) => (Math.abs(b.marginPct - currentMargin) < Math.abs(a.marginPct - currentMargin) ? b : a));
    if (Math.abs(nearest.marginPct - currentMargin) <= LADDER.step) nearest.current = true;
  }

  const why = !args.costVisible
    ? "margins of past bids are not shown for your role"
    : sample.length === 0 ? "no decided bid has a recorded margin"
    : `only ${plural(sample.length, "decided bid")} ${sample.length === 1 ? "has" : "have"} a recorded margin (at least ${LADDER.minBids} are needed)`;
  const note = basis === "history"
    ? `Chances come from ${plural(sample.length, "decided bid")} of yours with a recorded margin: each margin looks at past bids within ${LADDER.window} points of it, held back toward a starting assumption.`
    : `Starting assumption, not your history: ${why}. Each extra point of margin lowers the chance of winning by about a tenth.`;
  return { ladder: { basis, sample: sample.length, note, rows, recommended }, currentMargin };
}

// ── competitors ────────────────────────────────────────────────────────────────────────────────────────────────────────

const FACT_ORDER = ["award", "tender", "project", "strength", "profile", "other"];

function webLine(e: EvidenceInput | null): { line: string | null; sources: number; researchedAt: string | null } {
  if (!e) return { line: null, sources: 0, researchedAt: null };
  const urls = new Set<string>([...e.facts.map((f) => f.source_url), ...(e.price ? [e.price.source_url] : []), ...(e.wins ? [e.wins.source_url] : [])]);
  const ordered = [...e.facts].sort((a, b) => FACT_ORDER.indexOf(a.kind) - FACT_ORDER.indexOf(b.kind));
  const line = e.wins?.text ?? ordered[0]?.text ?? e.price?.text ?? null;
  return { line: line ? line.replace(/\s+/g, " ").trim().slice(0, 140) : null, sources: urls.size, researchedAt: e.researchedAt };
}

export function competitorRows(args: { competitors: readonly CompetitorInput[]; past: readonly PastTender[]; focus: string | null }): CompetitorRow[] {
  const rows = args.competitors.map((c): CompetitorRow => {
    const wonBy = (p: PastTender) => !!p.winner && sameCompany(p.winner, c.name);
    const listed = args.past.filter((p) => p.competitors.some((n) => sameCompany(n, c.name)) || wonBy(p));
    const decided = listed.filter(decidedOutcome);
    const theirs = decided.filter((p) => p.outcome === "lost" && wonBy(p));
    const gaps = theirs.map((p) => winGap(p.ourBid, p.awardValue)).filter((g): g is number => g !== null);
    const typical = median(gaps);
    return {
      name: c.name,
      country: c.country,
      met: decided.length,
      weWon: decided.filter((p) => p.outcome === "won" && !wonBy(p)).length,
      theyWon: theirs.length,
      openElsewhere: listed.filter((p) => p.outcome === "open").length,
      typicalGapPct: typical === null ? null : round(typical, 1),
      gapSample: gaps.length,
      expectedPrice: c.expectedPrice,
      web: webLine(c.evidence),
      focus: !!args.focus && sameCompany(args.focus, c.name),
    };
  });
  return rows.sort((a, b) => Number(b.focus) - Number(a.focus) || b.met - a.met || b.theyWon - a.theyWon || a.name.localeCompare(b.name));
}

// ── risks and what would sharpen it ──────────────────────────────────────────────────────────────────────────────────────

export function buildRisks(a: {
  input: AnalysisInput; rows: readonly CompetitorRow[]; history: HistorySummary; ladder: Ladder; daysLeft: number | null;
}): Risk[] {
  const { input, rows, history, ladder } = a;
  const out: Risk[] = [];
  if (input.deal.state !== "open") out.push({ id: "closed", level: "info", text: "This tender is already decided, so the ladder is for reference, not for pricing." });
  else if (a.daysLeft !== null && a.daysLeft < 0) out.push({ id: "past_end", level: "info", text: `The bid end date passed ${plural(Math.abs(a.daysLeft), "day")} ago.` });
  if (rows.length === 0) {
    out.push({ id: "no_competitors", level: "warn", text: `No competitors are recorded on this tender${input.proposed > 0 ? `, and ${plural(input.proposed, "proposal")} from market research ${input.proposed === 1 ? "is" : "are"} not accepted yet` : ""}.` });
  } else if (rows.every((r) => r.met === 0)) {
    out.push({ id: "new_faces", level: "info", text: "You have not met any of these competitors on a decided tender before." });
  }
  if (ladder.basis === "prior") {
    out.push({ id: "thin_history", level: "warn", text: `Only ${plural(ladder.sample, "decided bid")} ${ladder.sample === 1 ? "has" : "have"} a recorded margin, so the ladder is a starting assumption, not your history.` });
  } else if (ladder.sample < 10) {
    out.push({ id: "small_history", level: "info", text: `The ladder rests on ${plural(ladder.sample, "decided bid")}: treat it as a guide.` });
  }
  if (!input.costVisible) {
    out.push({ id: "cost_hidden", level: "info", text: "Costs are not shown for your role, so the ladder uses the starting assumption and shows no amounts." });
  } else if (input.deal.cost === null) {
    out.push({ id: "no_cost", level: "warn", text: "No cost is recorded on this tender yet, so the ladder shows chances and expected profit per 100 of cost, not amounts." });
  } else if (input.deal.price !== null && !marginIsStated(input.deal.price, input.deal.costedAmount)) {
    out.push({ id: "margin_hidden", level: "warn", text: `${marginHiddenText({ costedLines: input.deal.costedLines, pricedLines: input.deal.totalLines })}.` });
  } else if (input.deal.costedLines < input.deal.totalLines) {
    out.push({ id: "partial_cost", level: "warn", text: `${input.deal.totalLines - input.deal.costedLines} of ${input.deal.totalLines} lines have no recorded cost. The margin is over the other lines only, and the ladder shows no amounts.` });
  }
  if (input.deal.price === null) out.push({ id: "no_price", level: "warn", text: "This tender has no priced lines yet, so there is no current margin to compare." });
  const stale = rows.filter((r) => r.web.researchedAt && Date.parse(r.web.researchedAt) < input.now.getTime() - LADDER.staleDays * DAY);
  if (stale.length) out.push({ id: "stale_research", level: "info", text: `Web research on ${stale.map((r) => r.name).slice(0, 3).join(", ")} is older than ${LADDER.staleDays} days.` });
  const unresearched = rows.filter((r) => r.web.sources === 0);
  if (rows.length && unresearched.length === rows.length) out.push({ id: "no_web", level: "info", text: "No web research is saved for these competitors." });
  if (history.decided === 0) out.push({ id: "no_history", level: "info", text: "No tender of this workspace has been decided yet." });
  return out;
}

export function buildSharpen(c: Pick<Computed, "decidedWithoutCost" | "lostWithoutWinnerPrice" | "decidedWithoutCompetitors"> & { costVisible: boolean; decided: number }): string[] {
  const out: string[] = [];
  if (c.costVisible && c.decidedWithoutCost > 0) out.push(`Record the cost behind each submitted bid: ${plural(c.decidedWithoutCost, "decided tender")} ${c.decidedWithoutCost === 1 ? "has" : "have"} no cost, or too little of it.`);
  if (c.lostWithoutWinnerPrice > 0) out.push(`Record the winning price on lost tenders: ${c.lostWithoutWinnerPrice} ${c.lostWithoutWinnerPrice === 1 ? "has" : "have"} none.`);
  if (c.decidedWithoutCompetitors > 0) out.push(`List the competitors on each tender: ${plural(c.decidedWithoutCompetitors, "decided tender")} list none.`);
  if (c.decided < 10) out.push("Close out each tender as won or lost, so the history grows.");
  return out;
}

// ── the whole analysis ───────────────────────────────────────────────────────────────────────────────────────────────────

export function computeAnalysis(input: AnalysisInput): Computed {
  const history = summariseHistory(input.past, input.deal);
  const { ladder, currentMargin } = buildLadder({ past: input.past, deal: input.deal, costVisible: input.costVisible });
  const rows = competitorRows({ competitors: input.competitors, past: input.past, focus: input.focus });
  const daysLeft = daysUntil(input.deal.closingAt, input.now);
  const deal: DealFigures = {
    ref: input.deal.ref, title: input.deal.title, href: input.deal.href, closingAt: input.deal.closingAt, daysLeft,
    currency: input.deal.currency, price: input.deal.price, cost: input.costVisible ? wholeCost(input.deal) : null, marginPct: currentMargin,
    costedLines: input.costVisible ? input.deal.costedLines : 0, totalLines: input.deal.totalLines,
  };
  const decided = input.past.filter(decidedOutcome);
  const base = {
    decidedWithoutCost: decided.filter((p) => bidMargin(p.ourBid, p.ourCost, p.ourCostedAmount) === null).length,
    lostWithoutWinnerPrice: decided.filter((p) => p.outcome === "lost" && winGap(p.ourBid, p.awardValue) === null).length,
    decidedWithoutCompetitors: decided.filter((p) => p.competitors.length === 0 && !p.winner).length,
  };
  return {
    deal, focus: input.focus, competitors: rows, history, ladder,
    risks: buildRisks({ input, rows, history, ladder, daysLeft }),
    sharpen: buildSharpen({ ...base, costVisible: input.costVisible, decided: history.decided }),
    ...base, proposed: input.proposed,
  };
}
