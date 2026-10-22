import {
  GROUPS, GROUP_ORDER, KINDS, type Factor, type IntentResult, type RawSignal, type SignalGroup, type SignalKind, type Stage, type TopSignal,
} from "./types";

// The in-market score: a fixed, decaying, capped rubric (docs/signals-
// architecture.md section 5). Pure. It is never an AI call -- a number a rep is
// told to act on must be the same on every reload and defensible line by line,
// the same contract as Account 360's rating (bpmsquarecore.md 10a).

const DAY = 86_400_000;
export const NOT_IN_MARKET_DAYS = 30;
export const RECENT_ASK_DAYS = 30;
/** A signal older than this is gone, whatever it was (negatives hold longer, see KINDS). */
export const HORIZON_DAYS = 60;
/** How many of the newest counted signals are stored: the first two explain a list row, all of them are the account's timeline. */
export const TIMELINE_LIMIT = 15;

/** 1 for two weeks, then 1/2, 1/4, 1/8 until the horizon, then gone. A negative holds at full weight for its own hold time. */
export function fade(ageDays: number, negative: boolean, holdDays?: number): number {
  if (negative) return ageDays <= (holdDays ?? 90) ? 1 : 0;
  if (ageDays <= 14) return 1;
  if (ageDays <= 28) return 0.5;
  if (ageDays <= 42) return 0.25;
  if (ageDays <= HORIZON_DAYS) return 0.125;
  return 0;
}

const FADE_WORD: Record<number, string> = { 0.5: "half", 0.25: "a quarter", 0.125: "an eighth" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Groups that have at least one kind today. The doc's thresholds assume all four; the shell only has two. */
export function liveGroups(): SignalGroup[] {
  const used = new Set<SignalGroup>(Object.values(KINDS).filter((k) => !k.offLine).map((k) => k.group));
  return GROUP_ORDER.filter((g) => used.has(g));
}

/** The highest score the live sources can reach. 100 once every group has a source. */
export function reachableMax(): number {
  return liveGroups().reduce((t, g) => t + GROUPS[g].cap, 0);
}

/**
 * Stage thresholds. The architecture's 65 / 40 / 15 are for a rubric whose four
 * groups all have sources (a maximum of 100); with fewer live groups they scale
 * down by the same fraction, so "Deciding" stays as reachable as the design
 * meant it to be. Adding the Moving and Visited sources moves them back to
 * 65 / 40 / 15 with no change here.
 */
export function thresholds(max: number = reachableMax()): { deciding: number; comparing: number; looking: number } {
  const k = max / 100;
  return { deciding: Math.round(65 * k), comparing: Math.round(40 * k), looking: Math.round(15 * k) };
}

export function stageFor(score: number, recentAsk: boolean, t = thresholds()): Stage {
  if (score >= t.deciding && recentAsk) return "deciding";
  if (score >= t.comparing || recentAsk) return "comparing";
  if (score >= t.looking) return "looking";
  return "quiet";
}

type Counted = { s: RawSignal; group: SignalGroup; pts: number; age: number; weight: number };

function ageNote(c: Counted): string {
  if (c.weight >= 1) return "";
  return ` (${FADE_WORD[c.weight] ?? "faded"}, ${Math.round(c.age)} days old)`;
}

export function computeIntent(signals: RawSignal[], opts: { now: Date; notInMarketAt?: string | null }): IntentResult {
  const now = opts.now.getTime();
  const seen = new Set<string>();
  const counted: Counted[] = [];

  for (const s of signals) {
    const def = KINDS[s.kind];
    if (!def) continue;
    const k = `${s.kind}:${s.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const t = new Date(s.occurredAt).getTime();
    if (Number.isNaN(t)) continue;
    const age = Math.max(0, (now - t) / DAY);
    const weight = fade(age, def.points < 0, def.holdDays);
    if (weight <= 0) continue;
    const pts = Math.round(def.points * weight);
    if (pts === 0) continue;
    counted.push({ s, group: def.group, pts, age, weight });
  }

  // Per kind, only the strongest few count (two opened links, not twenty).
  const kept: Counted[] = [];
  const kinds = new Map<SignalKind, Counted[]>();
  for (const c of counted) kinds.set(c.s.kind, [...(kinds.get(c.s.kind) ?? []), c]);
  for (const [kind, list] of kinds) {
    const max = KINDS[kind].maxItems ?? list.length;
    list.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts) || new Date(b.s.occurredAt).getTime() - new Date(a.s.occurredAt).getTime() || a.s.key.localeCompare(b.s.key));
    kept.push(...list.slice(0, max));
  }

  const factors: Factor[] = [];
  let score = 0;
  for (const g of GROUP_ORDER) {
    const items = kept.filter((c) => c.group === g).sort((a, b) => b.pts - a.pts || a.s.key.localeCompare(b.s.key));
    if (items.length === 0) continue;
    let sum = 0;
    for (const c of items) {
      sum += c.pts;
      factors.push({
        group: g, label: KINDS[c.s.kind].label, points: c.pts,
        detail: `${c.s.headline} · ${dayLabel(c.s.occurredAt)}${ageNote(c)}`,
      });
    }
    const cap = GROUPS[g].cap;
    if (sum > cap) {
      factors.push({ group: g, label: `Limit for "${GROUPS[g].label}"`, points: cap - sum, detail: `This group counts for at most ${cap} points so one source cannot decide the score alone.` });
      sum = cap;
    } else if (sum < 0) {
      factors.push({ group: g, label: `"${GROUPS[g].label}" cannot go below zero`, points: -sum, detail: "Negative signals only cancel out what this group earned." });
      sum = 0;
    }
    score += sum;
  }
  score = Math.max(0, Math.min(100, score));

  const recentAsk = kept.some((c) => c.group === "asked" && c.pts > 0 && c.age <= RECENT_ASK_DAYS);

  const topSignals: TopSignal[] = [...kept]
    .sort((a, b) => new Date(b.s.occurredAt).getTime() - new Date(a.s.occurredAt).getTime() || b.pts - a.pts)
    .slice(0, TIMELINE_LIMIT)
    .map((c) => ({
      kind: c.s.kind, group: c.group, source: c.s.source, headline: c.s.headline,
      occurred_at: c.s.occurredAt, points: c.pts, ...(c.s.href ? { href: c.s.href } : {}),
    }));

  const marked = opts.notInMarketAt ? new Date(opts.notInMarketAt).getTime() : NaN;
  if (!Number.isNaN(marked) && now - marked <= NOT_IN_MARKET_DAYS * DAY) {
    const until = new Date(marked + NOT_IN_MARKET_DAYS * DAY).toISOString();
    return {
      score: 0, stage: "quiet", recentAsk: false, topSignals, signalCount: kept.length, topics: [],
      factors: [{ group: "note", label: "Marked not in market", points: 0, detail: `Your team marked this account on ${dayLabel(opts.notInMarketAt!)}; it stays at zero until ${dayLabel(until)} unless you clear the mark.` }],
    };
  }

  const topics = [...new Set(kept.map((c) => c.s.topic).filter((x): x is string => !!x))];
  return { score, stage: stageFor(score, recentAsk), factors, topSignals, signalCount: kept.length, topics, recentAsk };
}
