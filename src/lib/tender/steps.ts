// The path of a tender from the email to the outcome (KAMCO feedback slice 2, docs/design/kamco-feedback-build-spec.md section 4). PURE.
//
// One current step, one next-step button and a checklist of what is done. The button is the stage's header button (headerAction.ts) or a
// jump to the tab where the work is done; this file only decides which, so the screen never branches on a stage itself.

import { tenderPrimary, type PrimaryFacts, type TenderPrimaryKey } from "./headerAction";
import type { TenderTabId } from "./tabs";
import type { TenderTipKey } from "./tips";
import type { BoqFilter } from "./boq/table";

export type StepId = "received" | "decision" | "boq" | "costing" | "bid" | "submitted" | "outcome";
export const STEP_ORDER: readonly StepId[] = ["received", "decision", "boq", "costing", "bid", "submitted", "outcome"];
export const STEP_LABEL: Record<StepId, string> = { received: "Received", decision: "Decision", boq: "BOQ", costing: "Costing", bid: "Bid", submitted: "Submitted", outcome: "Won or lost" };

export type StepFacts = PrimaryFacts & {
  hasBoq: boolean;
  boqLines: number;
  unpriced: number;
  stale: number;
  decisionStanding: "go" | "no_go" | null;
  closingAt: string | null;
  projectId: string | null;
  /** BOQ lines still free text (no catalog product). Absent = unknown, treated as none. */
  noProduct?: number;
  /** Tender number, issuer and bid end date are all filled. */
  detailsFilled?: boolean;
  /** The bid guarantee has been submitted with the bid (or released afterwards). */
  guaranteeSubmitted?: boolean;
  /** The priced total of the BOQ, shown in the Bid step. */
  boqAmount?: number;
};

export type StepState = "done" | "current" | "todo" | "skipped";
export type TabJump = { tab: TenderTabId; filter?: BoqFilter; label: string; guide: string };
export type NextStep = {
  title: string;
  detail: string;
  tipKey: TenderTipKey;
  primary: { kind: "header"; key: TenderPrimaryKey } | ({ kind: "tab" } & TabJump) | null;
  secondary?: TabJump;
};
export type Checklist = { label: string; done: boolean }[];

export function currentStep(f: Pick<StepFacts, "stage" | "hasBoq" | "unpriced">): StepId {
  switch (f.stage) {
    case "received": return "received";
    case "bid_no_bid": return "decision";
    case "estimating": return !f.hasBoq ? "boq" : f.unpriced > 0 ? "costing" : "bid";
    case "submitted":
    case "clarifications": return "submitted";
    case "awarded":
    case "bid_lost":
    case "no_bid": return "outcome";
    default: return "received";
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function tenderSteps(f: StepFacts, fmt: (n: number) => string = (n) => String(n)): { steps: { id: StepId; state: StepState }[]; current: StepId; next: NextStep; checklist: Checklist } {
  const current = currentStep(f);
  const at = STEP_ORDER.indexOf(current);
  const noBid = f.stage === "no_bid";
  const steps = STEP_ORDER.map((id, i) => {
    let state: StepState = i < at ? "done" : i === at ? "current" : "todo";
    // The outcome step is the end of the path: once it is reached it is done, it has no "next".
    if (id === "outcome" && current === "outcome") state = "done";
    if (noBid && i > STEP_ORDER.indexOf("decision")) state = "skipped";
    if (noBid && id === "decision") state = "done";
    return { id, state };
  });

  const header = tenderPrimary(f);
  const headerPrimary = header ? ({ kind: "header", key: header.key } as const) : null;
  const uploadBoq: TabJump = { tab: "boq", label: "Open the BOQ", guide: "tender.next.boq" };
  const filled = f.detailsFilled !== false;
  const proposed = f.proposalPending === true || f.decisionStanding !== null;
  const approved = f.approvedGo === true;
  const priced = Math.max(0, f.boqLines - f.unpriced);
  const noProduct = f.noProduct ?? 0;

  let next: NextStep;
  let checklist: Checklist;
  switch (current) {
    case "received":
      next = { title: "Next: decide bid or no-bid", detail: "Propose go or no-go with a reason; an approver decides.", tipKey: "decision", primary: headerPrimary };
      checklist = [{ label: "Tender number, issuer and bid end date filled", done: filled }, { label: "Bid decision proposed", done: proposed }];
      break;
    case "decision":
      next = approved
        ? { title: "Next: upload the client's BOQ", detail: "The go is approved. Upload the client's Excel to start pricing.", tipKey: "boqTab", primary: { kind: "tab", ...uploadBoq } }
        : f.proposalPending === true
          ? { title: "Next: get the bid decision approved", detail: "A proposal is waiting for an approver.", tipKey: "decision", primary: headerPrimary }
          : { title: "Next: decide bid or no-bid", detail: "Propose go or no-go with a reason; an approver decides.", tipKey: "decision", primary: headerPrimary };
      checklist = [{ label: "Proposal made", done: proposed }, { label: "Approved", done: approved }];
      break;
    case "boq":
      next = { title: "Next: upload the client's BOQ", detail: "The lines come from the client's own Excel file.", tipKey: "nextStep", primary: { kind: "tab", ...uploadBoq } };
      checklist = [{ label: "BOQ uploaded", done: f.hasBoq }, { label: "Lines linked to products", done: f.hasBoq && noProduct === 0 }];
      break;
    case "costing":
      next = {
        title: "Next: price every BOQ line",
        detail: `${priced} of ${f.boqLines} lines have a cost. ${f.unpriced} still ${plural(f.unpriced, "needs", "need")} one.`,
        tipKey: "boqPriceAll",
        primary: { kind: "tab", tab: "boq", filter: "unpriced", label: `Open the ${f.unpriced} ${plural(f.unpriced, "line", "lines")}`, guide: "tender.next.unpriced" },
        secondary: { tab: "costing", label: "Open Costing", guide: "tender.next.costing" },
      };
      checklist = [{ label: "Every line has a cost", done: f.unpriced === 0 }, { label: "No stale price", done: f.stale === 0 }];
      break;
    case "bid":
      next = { title: "Next: submit the bid", detail: `${f.boqLines} ${plural(f.boqLines, "line", "lines")} priced, total ${fmt(f.boqAmount ?? 0)}.`, tipKey: "bidSubmit", primary: headerPrimary };
      checklist = [{ label: "Approved go decision", done: approved }, { label: "Bid guarantee submitted", done: f.guaranteeSubmitted === true }, { label: "Every line priced", done: f.hasBoq && f.unpriced === 0 }];
      break;
    case "submitted":
      next = { title: "Next: record the outcome", detail: "When the issuer answers, record who won and the awarded value.", tipKey: "outcome", primary: headerPrimary };
      checklist = [{ label: "Outcome recorded", done: false }];
      break;
    default: {
      const won = f.stage === "awarded" && f.outcome === "won";
      if (won) {
        next = { title: "Won", detail: "Create the contract project to plan the budget.", tipKey: "outcome", primary: headerPrimary };
        checklist = [{ label: "Contract project created", done: f.projectId !== null }];
      } else {
        next = { title: noBid ? "No-bid" : "Lost", detail: noBid ? "This tender was not bid." : "The tender was not awarded to us.", tipKey: "outcome", primary: null };
        checklist = [{ label: "Outcome recorded", done: true }];
      }
    }
  }
  return { steps, current, next, checklist };
}
