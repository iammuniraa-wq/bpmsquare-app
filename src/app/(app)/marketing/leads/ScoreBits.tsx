import { c, pillar, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import { stageDefOf, type LeadStageKey } from "@/lib/marketing/leadStages";
import { SCORE_LABEL, stageForScore, type ScoringThresholds } from "@/lib/marketing/scoring";
import { ASSIGNMENT_GAPS, ASSIGNMENT_WORDS } from "@/lib/marketing/leads/assignmentWords";
import { describeDue, isLeadOverdue } from "@/lib/marketing/leads/timing";

export const STAGE_TONE: Record<LeadStageKey, PillarKey> = {
  new: "blue", engaged: "purple", ready: "green", working: "teal",
  deal: "green", customer: "green", not_now: "amber", not_fit: "red",
};

export function StagePill({ stage }: { stage: LeadStageKey }) {
  return <StatusPill label={stageDefOf(stage).label} tone={STAGE_TONE[stage]} />;
}

const BAND_TONE = { new: "blue", engaged: "purple", ready: "green" } as const;

/** The score as a number and a small bar, in the colour of its band. */
export function ScoreMeter({ score, thresholds, width = 84 }: { score: number | null; thresholds: ScoringThresholds; width?: number }) {
  if (score == null) return <span style={{ color: c.hint }} title="Not scored yet">—</span>;
  const band = stageForScore(score, thresholds);
  const tone = pillar[BAND_TONE[band]];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }} title={`${score} of 100: ${SCORE_LABEL[band]}`}>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 24, textAlign: "right", color: c.ink }}>{score}</span>
      <span aria-hidden="true" style={{ width, height: 6, borderRadius: 3, background: c.panel2, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.max(2, Math.min(100, score))}%`, background: tone.base }} />
      </span>
    </span>
  );
}

/** "Respond by" with an overdue marker. Only a ready lead is ever overdue. */
export function DueChip({ stage, slaDueAt, now }: { stage: LeadStageKey; slaDueAt: string | null; now: Date }) {
  if (!slaDueAt) return <span style={{ color: c.hint }}>—</span>;
  const overdue = isLeadOverdue(stage, slaDueAt, now);
  const text = describeDue(slaDueAt, now);
  if (stage !== "ready") {
    return <span style={{ color: c.hint, fontSize: 12.5 }}>{stage === "working" || stage === "deal" || stage === "customer" ? "Picked up" : "—"}</span>;
  }
  return <StatusPill label={overdue ? `Overdue: ${text}` : `Respond ${text}`} tone={overdue ? "red" : "amber"} />;
}

export function AssignmentChip({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return <StatusPill label={ASSIGNMENT_WORDS[reason] ?? reason} tone={ASSIGNMENT_GAPS.has(reason) ? "amber" : "blue"} />;
}
