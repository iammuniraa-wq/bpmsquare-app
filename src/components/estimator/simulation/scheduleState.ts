// Why the build schedule has nothing to show, and what the person can do about it. Pure.

export type ScheduleGap = "no_layout" | "calculate" | "locked" | "unsaved";

/**
 * The schedule is read from the estimate's stored model. A template with no layout module never has one, so telling the
 * person to calculate would send them in a circle; a saved estimate whose model was never stored can be calculated again,
 * unless a quote has locked it.
 */
export function scheduleGap(a: { hasLayout: boolean; saved: boolean; canEdit: boolean; locked: boolean }): ScheduleGap {
  if (!a.hasLayout) return "no_layout";
  if (!a.saved) return "unsaved";
  if (a.locked) return "locked";
  return a.canEdit ? "calculate" : "locked";
}
