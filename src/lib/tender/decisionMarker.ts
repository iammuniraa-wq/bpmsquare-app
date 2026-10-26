// The bid decision marker in the deal header (redesign step 1, docs/design/gcc-tender-deals.md section 21): one chip that says where the
// go / no-go stands, read from the same facts the approval screen holds. PURE; the tone is one of the shared tones (src/lib/ui/tone.ts).

import type { Tone } from "@/lib/ui/tone";
import type { ApprovalView } from "./approval";
import { TENDER_DECISION_LABEL, type TenderDecision } from "./rules";

export type DecisionMarkerKey = "pending" | "awaiting" | "go" | "no_go";
export type DecisionMarker = {
  key: DecisionMarkerKey;
  /** The words after "Bid decision:". */
  label: string;
  tone: Tone;
  /** A short line under the label: who proposed, who approved. */
  sub: string;
};

/**
 * Pending = no proposal; Awaiting approval = a proposal is waiting; Go / No-go = the decision that stands. A decision saved before
 * approval existed still reads as Go / No-go (the panel says it was recorded before approval). While migration 0221 is pending
 * (`approval` null) only that old decision can show.
 */
export function decisionMarker(approval: ApprovalView | null, recorded: TenderDecision | null): DecisionMarker {
  if (approval?.pending) {
    return { key: "awaiting", label: "Awaiting approval", tone: "warn", sub: `${TENDER_DECISION_LABEL[approval.pending.decision]} proposed${approval.pending.requested_by_name ? ` by ${approval.pending.requested_by_name}` : ""}` };
  }
  const decision: TenderDecision | null = approval?.standing?.decision ?? recorded;
  if (decision) {
    const who = approval?.standing?.decided_by_name;
    return {
      key: decision === "go" ? "go" : "no_go",
      label: TENDER_DECISION_LABEL[decision],
      tone: decision === "go" ? "good" : "bad",
      sub: approval?.standing ? `approved${who ? ` by ${who}` : ""}` : "recorded",
    };
  }
  return { key: "pending", label: "Pending", tone: "neutral", sub: "no proposal yet" };
}
