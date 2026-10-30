import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { STEP_LABEL, STEP_ORDER, tenderSteps, type StepFacts } from "./steps";
import { TENDER_TIPS } from "./tips";

const facts = (over: Partial<StepFacts> = {}): StepFacts => ({
  stage: "estimating", outcome: "open", bids: 0, approvedGo: true, canEdit: true, project: null,
  hasBoq: true, boqLines: 10, unpriced: 0, stale: 0, decisionStanding: "go", closingAt: null, projectId: null, ...over,
});
const out = (over: Partial<StepFacts> = {}) => tenderSteps(facts(over));
const states = (over: Partial<StepFacts> = {}) => out(over).steps.map((s) => `${s.id}:${s.state}`).join(" ");

describe("the steps of a tender", () => {
  it("run Received, Decision, BOQ, Costing, Bid, Submitted, Won or lost", () => {
    expect(STEP_ORDER.map((id) => STEP_LABEL[id])).toEqual(["Received", "Decision", "BOQ", "Costing", "Bid", "Submitted", "Won or lost"]);
  });

  it("each stage has one current step", () => {
    const at = (over: Partial<StepFacts>) => out(over).current;
    expect(at({ stage: "received" })).toBe("received");
    expect(at({ stage: "bid_no_bid" })).toBe("decision");
    expect(at({ stage: "estimating", hasBoq: false, boqLines: 0 })).toBe("boq");
    expect(at({ stage: "estimating", unpriced: 3 })).toBe("costing");
    expect(at({ stage: "estimating", unpriced: 0 })).toBe("bid");
    expect(at({ stage: "submitted" })).toBe("submitted");
    expect(at({ stage: "clarifications" })).toBe("submitted");
    for (const stage of ["awarded", "bid_lost", "no_bid"]) expect(at({ stage, outcome: stage === "awarded" ? "won" : "lost" })).toBe("outcome");
  });

  it("steps before the current one are done, after it are to do", () => {
    expect(states({ stage: "estimating", unpriced: 2 })).toBe("received:done decision:done boq:done costing:current bid:todo submitted:todo outcome:todo");
    expect(states({ stage: "received" })).toBe("received:current decision:todo boq:todo costing:todo bid:todo submitted:todo outcome:todo");
  });

  it("a no-bid skips everything after the decision", () => {
    expect(states({ stage: "no_bid", outcome: "dropped", hasBoq: false })).toBe("received:done decision:done boq:skipped costing:skipped bid:skipped submitted:skipped outcome:skipped");
    expect(out({ stage: "no_bid", outcome: "dropped" }).next).toMatchObject({ title: "No-bid", primary: null });
  });

  it("an awarded tender has every step done", () => {
    expect(states({ stage: "awarded", outcome: "won" })).toBe("received:done decision:done boq:done costing:done bid:done submitted:done outcome:done");
  });
});

describe("the next step", () => {
  it("Received proposes the bid decision through the header button", () => {
    const n = out({ stage: "received", approvedGo: false }).next;
    expect(n.title).toBe("Next: decide bid or no-bid");
    expect(n.primary).toEqual({ kind: "header", key: "propose_decision" });
  });

  it("a waiting proposal asks for approval and a person who cannot edit has no button", () => {
    expect(out({ stage: "bid_no_bid", approvedGo: false, proposalPending: true }).next).toMatchObject({ title: "Next: get the bid decision approved", primary: { kind: "header", key: "review_decision" } });
    expect(out({ stage: "received", approvedGo: false, canEdit: false }).next.primary).toBeNull();
  });

  it("an approved go in Bid/No-bid points at the BOQ", () => {
    const n = out({ stage: "bid_no_bid", approvedGo: true }).next;
    expect(n.title).toBe("Next: upload the client's BOQ");
    expect(n.primary).toMatchObject({ kind: "tab", tab: "boq", label: "Open the BOQ", guide: "tender.next.boq" });
  });

  it("Estimating without a BOQ asks for the upload", () => {
    expect(out({ hasBoq: false, boqLines: 0 }).next.primary).toMatchObject({ kind: "tab", tab: "boq", guide: "tender.next.boq" });
  });

  it("Costing opens the unpriced lines in the BOQ, with Costing as the second button", () => {
    const n = out({ boqLines: 10, unpriced: 3 }).next;
    expect(n.title).toBe("Next: price every BOQ line");
    expect(n.detail).toBe("7 of 10 lines have a cost. 3 still need one.");
    expect(n.primary).toEqual({ kind: "tab", tab: "boq", filter: "unpriced", label: "Open the 3 lines", guide: "tender.next.unpriced" });
    expect(n.secondary).toEqual({ tab: "costing", label: "Open Costing", guide: "tender.next.costing" });
    expect(out({ boqLines: 4, unpriced: 1 }).next.primary).toMatchObject({ label: "Open the 1 line" });
    expect(out({ boqLines: 4, unpriced: 1 }).next.detail).toBe("3 of 4 lines have a cost. 1 still needs one.");
  });

  it("Bid submits (or revises) through the header button and shows the total", () => {
    const n = tenderSteps(facts({ boqLines: 12, boqAmount: 5000 }), (v) => `SAR ${v}`).next;
    expect(n.title).toBe("Next: submit the bid");
    expect(n.detail).toBe("12 lines priced, total SAR 5000.");
    expect(n.primary).toEqual({ kind: "header", key: "submit_bid" });
    expect(out({ bids: 1 }).next.primary).toEqual({ kind: "header", key: "revise_bid" });
  });

  it("Submitted records the outcome", () => {
    expect(out({ stage: "submitted" }).next).toMatchObject({ title: "Next: record the outcome", primary: { kind: "header", key: "record_outcome" } });
  });

  it("Won creates the contract project, or opens it once it exists; Lost has no button", () => {
    const won = { stage: "awarded", outcome: "won" } as const;
    expect(out({ ...won, project: { existing: false, canCreate: true } }).next).toMatchObject({ title: "Won", detail: "Create the contract project to plan the budget.", primary: { kind: "header", key: "create_project" } });
    expect(out({ ...won, project: { existing: true, canCreate: true }, projectId: "p1" }).next.primary).toEqual({ kind: "header", key: "open_project" });
    expect(out({ stage: "bid_lost", outcome: "lost" }).next).toMatchObject({ title: "Lost", primary: null });
  });

  it("there is no project link before Won", () => {
    for (const stage of ["received", "bid_no_bid", "estimating", "submitted", "clarifications"]) {
      const p = out({ stage, project: { existing: false, canCreate: true } }).next.primary;
      expect(p === null || p.kind === "tab" || (p.key !== "create_project" && p.key !== "open_project"), stage).toBe(true);
    }
  });
});

describe("the checklist", () => {
  it("follows the current step", () => {
    expect(out({ stage: "received", detailsFilled: true, decisionStanding: null, approvedGo: false }).checklist).toEqual([{ label: "Tender number, issuer and bid end date filled", done: true }, { label: "Bid decision proposed", done: false }]);
    expect(out({ stage: "bid_no_bid", approvedGo: false, proposalPending: true, decisionStanding: null }).checklist).toEqual([{ label: "Proposal made", done: true }, { label: "Approved", done: false }]);
    expect(out({ hasBoq: true, boqLines: 5, unpriced: 5, noProduct: 2 }).checklist).toEqual([{ label: "Every line has a cost", done: false }, { label: "No stale price", done: true }]);
    expect(out({ hasBoq: false, boqLines: 0 }).checklist).toEqual([{ label: "BOQ uploaded", done: false }, { label: "Lines linked to products", done: false }]);
    expect(out({ guaranteeSubmitted: true }).checklist).toEqual([{ label: "Approved go decision", done: true }, { label: "Bid guarantee submitted", done: true }, { label: "Every line priced", done: true }]);
    expect(out({ stage: "awarded", outcome: "won", projectId: "p1" }).checklist).toEqual([{ label: "Contract project created", done: true }]);
  });
});

describe("the explanations", () => {
  it("every next step points at a tip that fits behind an i", () => {
    const stages = ["received", "bid_no_bid", "estimating", "submitted", "awarded", "bid_lost", "no_bid"];
    for (const stage of stages) for (const hasBoq of [true, false]) {
      const tip = TENDER_TIPS[out({ stage, hasBoq, unpriced: hasBoq ? 2 : 0 }).next.tipKey];
      expect(tipTextProblems(tip), stage).toEqual([]);
    }
  });
});
