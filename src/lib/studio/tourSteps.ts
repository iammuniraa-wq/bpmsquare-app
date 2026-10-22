// One list per studio, read by two things: the "Show me how" Tour (highlights `target`, runs the step's `before`) and
// the assistant's screen manifest (turns each target into a control and the list into a task). `label` is the short
// name of the thing the step points at. The `before` closures need the studio's state, so they stay in the studio
// and are attached by position with withBefore().

export type TourStepDef = { target: string; label: string; text: string };

export function withBefore(
  steps: readonly TourStepDef[],
  befores: readonly ((() => void | Promise<void>) | undefined)[],
): (TourStepDef & { before?: () => void | Promise<void> })[] {
  return steps.map((s, i) => ({ ...s, before: befores[i] }));
}
