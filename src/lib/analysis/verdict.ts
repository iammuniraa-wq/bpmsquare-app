import { computeIntent } from "@/lib/signals/rubric";
import type { Factor, Stage } from "@/lib/signals/types";
import { claimsToSignals } from "./toSignals";
import {
  FOLLOW_UP_FOR, TRIGGER_KINDS, TRIGGER_RECENT_DAYS, TRIGGER_WATCH_DAYS, VERDICT_TEXT,
  type AnalysisFactor, type Claim, type FitLabel, type Verdict, type VerdictLabel,
} from "./types";
import type { FitResult } from "./fit";

// Timing and the verdict (docs/design/account-analysis.md 6.2 and 6.3). Fixed rules, in order. The AI may word the one
// sentence from the factors; it never changes a point, a label or the answer. Pure and deterministic.

const DAY = 86_400_000;

export type IntentInput = { score: number; stage: Stage; factors: Factor[] };

export type Timing = { stage: Stage; score: number | null; from: "signals" | "web_only"; factors: AnalysisFactor[] };

/**
 * For an account, Timing is its stored Buying signals row, read and not recomputed. For a company that is not an account
 * it is the same rubric over the web signals alone: it can reach Looking at most, never Deciding, because there is no
 * first-party "asked" signal. That is correct: we have no history with them.
 */
export function computeTiming(i: { intent: IntentInput | null; claims: readonly Claim[]; now: Date }): Timing {
  if (i.intent) {
    return { stage: i.intent.stage, score: i.intent.score, from: "signals", factors: i.intent.factors.map((x) => ({ ...x, area: "timing" as const })) };
  }
  const r = computeIntent(claimsToSignals(i.claims), { now: i.now });
  return { stage: r.stage, score: r.score, from: "web_only", factors: r.factors.map((x) => ({ ...x, area: "timing" as const })) };
}

/** Age in days of the newest dated, found, attached trigger (award, project, tender, hiring, expansion, funding). Null when none. */
export function newestTriggerDays(claims: readonly Claim[], now: Date): number | null {
  let best: number | null = null;
  for (const c of claims) {
    if (!TRIGGER_KINDS.includes(c.kind) || c.confidence !== "found" || c.instructionLike || !c.publishedOn) continue;
    const age = Math.max(0, (now.getTime() - Date.parse(`${c.publishedOn}T00:00:00Z`)) / DAY);
    if (best === null || age < best) best = age;
  }
  return best;
}

export type Decision = { label: VerdictLabel; rule: 1 | 2 | 3 | 4; because: string };

const goodFit = (f: FitLabel) => f === "strong" || f === "partial";

/**
 * 1. Worth a call this week: a good fit and Comparing or Deciding, or a trigger from the last 30 days with a strong fit.
 * 2. Worth watching: a good fit and Looking, or any trigger from the last 90 days.
 * 3. Not a fit now: a weak fit.
 * 4. Not enough to say: everything else, including a good fit with nothing happening.
 */
export function decide(fit: FitLabel, stage: Stage, triggerDays: number | null): Decision {
  const stageHot = stage === "comparing" || stage === "deciding";
  if ((goodFit(fit) && stageHot) || (fit === "strong" && triggerDays !== null && triggerDays <= TRIGGER_RECENT_DAYS)) {
    return { label: "call_this_week", rule: 1, because: stageHot ? "A good fit that is comparing or deciding" : "A strong fit with news from the last 30 days" };
  }
  if ((goodFit(fit) && stage === "looking") || (triggerDays !== null && triggerDays <= TRIGGER_WATCH_DAYS)) {
    return { label: "watch", rule: 2, because: goodFit(fit) && stage === "looking" ? "A good fit that has shown some interest" : "News from the last 90 days" };
  }
  if (fit === "weak") return { label: "not_a_fit", rule: 3, because: "The fit is weak and nothing recent suggests otherwise" };
  return { label: "not_enough", rule: 4, because: fit === "unknown" ? "Too little is known to judge the fit" : "A fit, but nothing is happening yet" };
}

/** The reasons as one plain sentence, verbatim from the two biggest factors. No model involved. */
export function factorSentence(factors: readonly AnalysisFactor[]): string {
  const top = [...factors].filter((f) => f.points !== 0).sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || a.label.localeCompare(b.label)).slice(0, 2);
  if (top.length === 0) return "Not enough is known yet to say more.";
  return top.map((f) => `${f.label}: ${f.detail.replace(/[.\s]+$/, "")}.`).join(" ");
}

export function buildVerdict(i: { fit: FitResult; timing: Timing; claims: readonly Claim[]; now: Date }): Verdict {
  const d = decide(i.fit.label, i.timing.stage, newestTriggerDays(i.claims, i.now));
  const factors = [...i.fit.factors, ...i.timing.factors];
  return {
    followUp: FOLLOW_UP_FOR[d.label], label: d.label, fit: i.fit.label,
    timing: { stage: i.timing.stage, score: i.timing.score, from: i.timing.from },
    rule: d.rule, because: d.because, sentence: { text: factorSentence(factors), byAi: false }, factors,
  };
}

/** The labelled text of a verdict for logs and the assistant's follow-up context: "Worth a call this week". */
export const verdictText = (label: VerdictLabel): string => VERDICT_TEXT[label];

/**
 * The only input the sentence-writing call may see: the factor labels and their details (which come from the workspace's
 * own rules and records, or from claims already cleaned) with instruction-like claims removed. No claim text, no names.
 */
export function phraseInput(v: Verdict): { answer: string; reason: string; factors: { label: string; points: number; detail: string }[] } {
  return {
    answer: VERDICT_TEXT[v.label], reason: v.because,
    // A "They are moving" factor carries the text of a web item in its detail: only its label goes to the model.
    factors: v.factors.filter((f) => f.points !== 0).slice(0, 8).map((f) => ({
      label: f.label, points: f.points, detail: f.group === "moving" ? "" : f.detail.slice(0, 120),
    })),
  };
}
