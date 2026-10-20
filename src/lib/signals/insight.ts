import { NOT_IN_MARKET_DAYS } from "./rubric";
import { STAGE_LABEL, stageRank, type Stage, type TopSignal } from "./types";

// What a row says about itself, built by code from rows already stored
// (account_intent, account_intent_history). No new score, no new data source and
// no AI: the words are the top signals' own headlines (docs/signals-architecture.md
// section 3 -- AI never moves or explains a point).

const DAY = 86_400_000;

export const isHeld = (markedAt: string | null | undefined, now: Date): boolean => {
  if (!markedAt) return false;
  const t = new Date(markedAt).getTime();
  return !Number.isNaN(t) && now.getTime() - t <= NOT_IN_MARKET_DAYS * DAY;
};

const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** "Comparing: asked for a quote (QT-0042) and clicked a link about Precast". */
export function reasonLine(stage: Stage, top: TopSignal[], held = false): string {
  if (held) return "Quiet: your team marked this account not in market";
  const lead = top.filter((s) => s.points > 0).sort((a, b) => b.points - a.points || b.occurred_at.localeCompare(a.occurred_at)).slice(0, 2);
  if (lead.length === 0) return `${STAGE_LABEL[stage]}: nothing recent to go on`;
  return `${STAGE_LABEL[stage]}: ${lead.map((s) => lower(s.headline)).join(" and ")}`;
}

export type HistoryPoint = { day: string; score: number };

/**
 * Eight weekly samples, oldest first, the last one being today: for each week
 * the latest stored day at or before it. Before an account's first stored day
 * it was Quiet, so those weeks read 0.
 */
export function weeklySeries(history: HistoryPoint[], now: Date): number[] {
  const sorted = [...history].sort((a, b) => a.day.localeCompare(b.day));
  const out: number[] = [];
  for (let i = 7; i >= 0; i--) {
    const cut = new Date(now.getTime() - i * 7 * DAY).toISOString().slice(0, 10);
    let v = 0;
    for (const h of sorted) { if (h.day <= cut) v = h.score; else break; }
    out.push(v);
  }
  return out;
}

export type Movement = {
  direction: "warming" | "cooling" | "steady";
  /** Text and arrow together: the cue never rests on colour alone. */
  label: string;
  arrow: "▲" | "▼" | "–";
  /** "Moved to Comparing 2 days ago", only when the stage changed in the last 14 days. */
  movedText: string | null;
  /** True for an upward move in the last 7 days: the row gets the highlight. */
  fresh: boolean;
  daysInStage: number | null;
  scoreDelta: number | null;
};

const ago = (n: number) => (n <= 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`);

export function movement(
  row: { stage: Stage; previous_stage: Stage | null; stage_changed_at: string | null; score: number },
  series: number[],
  now: Date,
): Movement {
  const changed = row.stage_changed_at ? new Date(row.stage_changed_at).getTime() : NaN;
  const days = Number.isNaN(changed) ? null : Math.max(0, Math.floor((now.getTime() - changed) / DAY));
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  const scoreDelta = prev === null ? null : row.score - prev;

  let direction: Movement["direction"] = "steady";
  const recentMove = days !== null && days <= 14 && row.previous_stage !== null && row.previous_stage !== row.stage;
  if (recentMove) direction = stageRank(row.stage) > stageRank(row.previous_stage!) ? "warming" : "cooling";
  else if (scoreDelta !== null && scoreDelta >= 5) direction = "warming";
  else if (scoreDelta !== null && scoreDelta <= -5) direction = "cooling";

  const arrow = direction === "warming" ? "▲" : direction === "cooling" ? "▼" : "–";
  const word = direction === "warming" ? "Warming" : direction === "cooling" ? "Cooling" : "Steady";
  return {
    direction, arrow, label: `${arrow} ${word}`,
    movedText: recentMove ? `Moved to ${STAGE_LABEL[row.stage]} ${ago(days!)}` : null,
    fresh: recentMove && days! <= 7 && direction === "warming",
    daysInStage: days,
    scoreDelta,
  };
}

export type NextStep = { label: string; kind: "account" | "quote" | "campaign" | null };

/** One suggested next step per account, by fixed rule (doc 4.1). */
export function nextStep(stage: Stage, topKinds: string[]): NextStep {
  if (stage === "deciding") return { label: "Call", kind: "account" };
  if (stage === "comparing") {
    const open = topKinds.some((k) => k === "inquiry" || k === "quote_waiting" || k === "deal_opened");
    return open ? { label: "Follow up", kind: "account" } : { label: "Start a quote", kind: "quote" };
  }
  if (stage === "looking") return { label: "Add to a campaign", kind: "campaign" };
  return { label: "", kind: null };
}
