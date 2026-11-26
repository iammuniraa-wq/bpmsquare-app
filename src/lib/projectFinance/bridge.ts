import type { BridgeStep, BridgeStepId } from "./rules";

// The geometry of the margin waterfall, apart from the drawing so it can be tested: where each bar starts and ends on one value scale. A step
// whose amount is missing is not drawn as a number: it is `hatched` ("Needs ERP cost") and stands at the running level, so the chart still reads.

export type BridgeBar = {
  id: BridgeStepId; label: string; kind: BridgeStep["kind"];
  /** The value the bar starts and ends at; both equal the running level when the step is unknown. */
  from: number; to: number;
  /** The signed amount of the step, or null when unknown. */
  amount: number | null;
  hatched: boolean;
  /** True when the step is unknown because the ERP cost is not connected (the label says "Needs ERP cost"). */
  needsErp: boolean;
};

export function bridgeBars(steps: readonly BridgeStep[]): BridgeBar[] {
  let running = 0;
  return steps.map((st) => {
    if (st.amount === null) return { id: st.id, label: st.label, kind: st.kind, from: running, to: running, amount: null, hatched: true, needsErp: st.needsErp };
    if (st.kind === "delta") {
      const from = running;
      running = Math.round((running + st.amount) * 100) / 100;
      return { id: st.id, label: st.label, kind: st.kind, from, to: running, amount: st.amount, hatched: false, needsErp: false };
    }
    running = st.amount;
    return { id: st.id, label: st.label, kind: st.kind, from: 0, to: st.amount, amount: st.amount, hatched: false, needsErp: false };
  });
}

/** The lowest and highest value any bar reaches, with zero always inside: the vertical scale. */
export function bridgeExtent(bars: readonly BridgeBar[]): { min: number; max: number } {
  let min = 0, max = 0;
  for (const b of bars) { min = Math.min(min, b.from, b.to); max = Math.max(max, b.from, b.to); }
  return { min, max: max === min ? min + 1 : max };
}
