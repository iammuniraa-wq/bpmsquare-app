import { ABM_TIERS, type AbmGoalMetric, type AbmProgress, type AbmTier } from "./types";

// The program's "did it work" numbers (docs/abm-architecture.md section 4.5).
// Counted by ACCOUNT, never by lead, and every figure is a count of target
// rows a person can click through to. Progress already encodes the events
// behind it (see progress.ts), so the funnel reads progress rather than
// re-deriving it. No score, no percentage model: counts and money.

export type ResultTarget = {
  id: string;
  account_id: string;
  tier: AbmTier;
  progress: AbmProgress;
  opportunity_id: string | null;
};

export type ResultDeal = { id: string; outcome: "open" | "won" | "lost" | "dropped"; amount: number | null };

const AT_LEAST: Record<"reached" | "engaged" | "in_talks" | "deal", AbmProgress[]> = {
  reached: ["reached", "engaged", "in_talks", "deal_open", "won", "lost"],
  engaged: ["engaged", "in_talks", "deal_open", "won", "lost"],
  in_talks: ["in_talks", "deal_open", "won", "lost"],
  deal: ["deal_open", "won", "lost"],
};

export type FunnelCounts = { targets: number; reached: number; engaged: number; inTalks: number; deals: number; won: number; dropped: number; lost: number };

export type TierRow = { tier: AbmTier; targets: number; engaged: number; deals: number; won: number };

export type ProgramResults = {
  funnel: FunnelCounts;
  byTier: TierRow[];
  /** Pipeline value of deals still open, and value of won deals, summed over distinct linked deals. */
  money: { openValue: number; wonValue: number; openDeals: number; wonDeals: number };
  goal: { metric: AbmGoalMetric; target: number | null; current: number };
  /** Targets by progress, for the chips and the stacked bar. */
  byProgress: Record<AbmProgress, number>;
  smallSample: boolean;
};

const emptyByProgress = (): Record<AbmProgress, number> => ({
  planned: 0, reached: 0, engaged: 0, in_talks: 0, deal_open: 0, won: 0, lost: 0, dropped: 0,
});

export function computeResults(
  targets: readonly ResultTarget[],
  deals: readonly ResultDeal[],
  goal: { metric: AbmGoalMetric; target: number | null },
): ProgramResults {
  const byProgress = emptyByProgress();
  for (const t of targets) byProgress[t.progress]++;

  const count = (list: AbmProgress[]) => targets.filter((t) => list.includes(t.progress)).length;
  const funnel: FunnelCounts = {
    targets: targets.length,
    reached: count(AT_LEAST.reached),
    engaged: count(AT_LEAST.engaged),
    inTalks: count(AT_LEAST.in_talks),
    deals: count(AT_LEAST.deal),
    won: byProgress.won,
    lost: byProgress.lost,
    dropped: byProgress.dropped,
  };

  const byTier: TierRow[] = ABM_TIERS.map((tier) => {
    const rows = targets.filter((t) => t.tier === tier);
    const n = (list: AbmProgress[]) => rows.filter((t) => list.includes(t.progress)).length;
    return { tier, targets: rows.length, engaged: n(AT_LEAST.engaged), deals: n(AT_LEAST.deal), won: rows.filter((t) => t.progress === "won").length };
  });

  // A deal linked to two targets (two programs' rows never share a program, but
  // an account appears once per program) is still one deal.
  const linked = new Set(targets.map((t) => t.opportunity_id).filter((x): x is string => !!x));
  const seen = new Set<string>();
  const money = { openValue: 0, wonValue: 0, openDeals: 0, wonDeals: 0 };
  for (const d of deals) {
    if (!linked.has(d.id) || seen.has(d.id)) continue;
    seen.add(d.id);
    const amt = Number(d.amount) || 0;
    if (d.outcome === "open") { money.openValue += amt; money.openDeals++; }
    if (d.outcome === "won") { money.wonValue += amt; money.wonDeals++; }
  }

  const current =
    goal.metric === "deals_won" ? funnel.won
    : goal.metric === "deals_opened" ? funnel.deals
    : goal.metric === "accounts_engaged" ? funnel.engaged
    : money.wonValue;

  return { funnel, byTier, money, goal: { metric: goal.metric, target: goal.target, current }, byProgress, smallSample: targets.length < 20 };
}

/** The one-sentence goal line: "3 deals won target: 1 so far". */
export function goalSentence(r: ProgramResults): string {
  const { metric, target, current } = r.goal;
  const unit = metric === "deals_won" ? "won" : metric === "deals_opened" ? "deals opened" : metric === "accounts_engaged" ? "accounts engaged" : "revenue won";
  const cur = metric === "revenue" ? Math.round(current).toLocaleString("en-US") : String(current);
  if (target == null) return `${cur} ${unit} so far`;
  const tgt = metric === "revenue" ? Math.round(target).toLocaleString("en-US") : String(target);
  return `${cur} of ${tgt} ${unit}`;
}
