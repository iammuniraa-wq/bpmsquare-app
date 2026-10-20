import { countRatings, needsChange } from "./ratings";
import { schedulePhases, totalWorkingDays, todayIso, type ScheduledPhase } from "./plan";
import type { ChangeRow, CommentRow, FitRow, StepRow, StudyRow, TaskRow } from "./types";
import { PHASES } from "./types";

// Counts, totals and the summary on the "Talk to us" step are assembled by
// code from the stored rows, never by the model (doc section 6.1, step 6).

/** Lanes in use: those on steps first, in order of first appearance, then lanes the client added with no steps yet. */
export function lanesOf(steps: readonly Pick<StepRow, "lane" | "sort_order">[], extra: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of [...steps].sort((a, b) => a.sort_order - b.sort_order)) if (!out.includes(s.lane)) out.push(s.lane);
  for (const l of extra) if (!out.includes(l)) out.push(l);
  return out;
}

export function phaseTicks(comments: readonly CommentRow[]): Set<string> {
  const ticked = new Set<string>();
  // The latest tick row per phase wins.
  const rows = comments.filter((c) => c.phase_ok !== null).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const state = new Map<string, boolean>();
  for (const r of rows) state.set(r.phase, r.phase_ok === true);
  for (const [p, v] of state) if (v) ticked.add(p);
  return ticked;
}

export function schedule(study: Pick<StudyRow, "plan_start_date" | "weekend">, tasks: readonly TaskRow[]): ScheduledPhase[] {
  return schedulePhases(tasks, study.plan_start_date ?? todayIso(), study.weekend);
}

export type StudySummary = {
  steps: number;
  roles: number;
  standardOrSetup: number;
  needChange: number;
  changesKept: number;
  changesTotal: number;
  planDays: number;
  phasesTicked: number;
  phasesTotal: number;
  fit: ReturnType<typeof countRatings>;
};

export function studySummary(input: {
  study: Pick<StudyRow, "plan_start_date" | "weekend" | "lanes">;
  steps: readonly StepRow[];
  fit: readonly FitRow[];
  changes: readonly ChangeRow[];
  tasks: readonly TaskRow[];
  comments: readonly CommentRow[];
}): StudySummary {
  const fit = countRatings(input.fit);
  const phases = schedule(input.study, input.tasks);
  const ticked = phaseTicks(input.comments);
  return {
    steps: input.steps.length,
    roles: lanesOf(input.steps, input.study.lanes).length,
    standardOrSetup: fit.standard + fit.needs_setup,
    needChange: input.fit.filter((r) => needsChange(r.rating)).length,
    changesKept: input.changes.filter((c) => c.kept).length,
    changesTotal: input.changes.length,
    planDays: totalWorkingDays(phases),
    phasesTicked: phases.filter((p) => ticked.has(p.phase)).length,
    phasesTotal: phases.length,
    fit,
  };
}

/** Phases in plan order that actually have tasks. */
export const phasesWithTasks = (tasks: readonly TaskRow[]) => PHASES.filter((p) => tasks.some((t) => t.phase === p));
