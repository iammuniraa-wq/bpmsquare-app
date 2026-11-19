import { describe, it, expect } from "vitest";
import { budgetTotals, coverageOf, coverageText, marginCoverage, marginView, unclassifiedAmount, type TotalsLine } from "./budget";
import { ASK_WARNING_BODY, askProblem, askWarning, requestReason } from "./approval";
import { marginWords } from "./format";
import { hasDraftInvoice, milestoneTotals } from "./milestones";

// The owner-watched run on KAMCO (2026-11-19, project CPR-0008): a budget where 2 of 12 lines had a cost read as a finished one. These are
// the rules that stop that: what a margin may say while lines wait for a cost, what asking for approval says, how costs copied from a tender
// are labelled, and what counts as invoiced.

const l = (over: Partial<TotalsLine> = {}): TotalsLine => ({ amount: 0, resource_code: "11", cost_code: null, reserve: false, allocated: false, client_amount: 1000, source_line_id: "d", ...over });
/** 12 tender lines, the first two costed, as in the run. */
const run = [l({ amount: 90650, allocated: true, client_amount: 150000 }), l({ amount: 594287.2, allocated: true, client_amount: 600000 }), ...Array.from({ length: 10 }, () => l({ client_amount: 70000 }))];

describe("what a margin may say while lines still wait for a cost", () => {
  it("counts the lines that carry a cost, apart from the lines that are allocated", () => {
    const t = budgetTotals([l({ amount: 500, allocated: true }), l({ amount: 0, allocated: true }), l()]);
    expect(t).toMatchObject({ lineCount: 3, allocatedCount: 2, unallocatedCount: 1, costedCount: 1 });
    expect(budgetTotals(run)).toMatchObject({ lineCount: 12, allocatedCount: 2, costedCount: 2, total: 684937.2 });
  });

  it("is the margin of the allocated lines only: what the client pays for them less their cost", () => {
    const cov = marginCoverage(run);
    expect(cov).toMatchObject({ allocated: 2, of: 12, complete: false });
    expect(cov.pct).toBe(8.7); // (750,000 - 684,937.20) / 750,000, not the 53.1% of the whole contract
    expect(cov.amount).toBe(65062.8);
    expect(coverageText(cov)).toBe("on 2 of 12 lines");
    expect(coverageText(cov, "WBS items")).toBe("on 2 of 12 WBS items");
  });

  it("the tile never shows a bare percentage for a part-allocated budget", () => {
    const totals = budgetTotals(run);
    const margin = marginView(1_460_000, totals, null);
    expect(margin.pct).toBe(53.1); // what the screen used to print
    expect(marginWords(margin, marginCoverage(run))).toEqual({ value: "8.7%", sub: "on 2 of 12 lines · not complete", partial: true });
  });

  it("says Not complete when an allocated line does not know what the client pays (a line made by hand)", () => {
    const lines = [l({ amount: 500, allocated: true, client_amount: null }), l()];
    const cov = marginCoverage(lines);
    expect(cov.pct).toBeNull();
    expect(marginWords(marginView(5000, budgetTotals(lines), null), cov)).toEqual({ value: "Not complete", sub: "1 of 2 lines allocated", partial: true });
  });

  it("a deliberate 0 is a decision: once every line is allocated the margin is the project's, with no qualifier", () => {
    const lines = [l({ amount: 600, allocated: true }), l({ amount: 0, allocated: true })];
    const cov = marginCoverage(lines);
    expect(cov.complete).toBe(true);
    expect(marginWords(marginView(2000, budgetTotals(lines), null), cov)).toEqual({ value: "70%", sub: null, partial: false });
  });

  it("nothing allocated still reads Not allocated yet, and a project without a contract value shows a dash", () => {
    const none = [l(), l()];
    expect(marginWords(marginView(2000, budgetTotals(none), null), marginCoverage(none)).value).toBe("Not allocated yet");
    const full = [l({ amount: 600, allocated: true })];
    expect(marginWords(marginView(0, budgetTotals(full), null), marginCoverage(full)).value).toBe("—");
  });

  it("a line saved before the allocation existed (no allocated flag) counts as allocated", () => {
    expect(coverageOf([{ client: 100, cost: 60 }, { client: 100, cost: null }])).toMatchObject({ allocated: 1, of: 2, pct: 40 });
    expect(marginCoverage([{ amount: 60, resource_code: "11", cost_code: null, reserve: false }]).complete).toBe(true);
  });
});

describe("asking for approval with lines that have no cost", () => {
  it("warns with the count and never blocks; an all-zero budget stays blocked", () => {
    expect(askWarning({ lineCount: 12, costedCount: 2 })).toBe("10 of 12 lines have no cost yet");
    expect(askWarning({ lineCount: 2, costedCount: 1 })).toBe("1 of 2 lines has no cost yet");
    expect(askWarning({ lineCount: 12, costedCount: 12 })).toBeNull();
    expect(askWarning({ lineCount: 12, costedCount: 0 })).toBeNull(); // askProblem refuses that one
    expect(ASK_WARNING_BODY).toBe("The approved budget will understate the cost. Send anyway?");
    const revision = { status: "draft" as const, rev_no: 0, justification_code: null, justification_text: null };
    expect(askProblem({ revision, lineCount: 12, linesWithoutResource: 0, deciders: ["boss"], projectClosed: false, total: 684937.2 })).toBeNull();
    expect(askProblem({ revision, lineCount: 12, linesWithoutResource: 0, deciders: ["boss"], projectClosed: false, total: 0 })).toContain("The budget is 0");
  });

  it("the request the approver reads says how many lines are costed, only when some are not", () => {
    const base = { rev_no: 0, justification_code: null, justification_text: null };
    expect(requestReason(base, null, 684937.2, "SAR", { costed: 2, of: 12 })).toBe("Baseline budget, SAR 684,937.2 (2 of 12 lines costed)");
    expect(requestReason(base, null, 684937.2, "SAR", { costed: 12, of: 12 })).toBe("Baseline budget, SAR 684,937.2");
    expect(requestReason(base, null, 684937.2, "SAR")).toBe("Baseline budget, SAR 684,937.2");
    expect(requestReason({ rev_no: 2, justification_code: "scope_change", justification_text: "More fence" }, "Scope change", 5000, "SAR", { costed: 1, of: 3 })).toBe("Revision 2, SAR 5,000 (1 of 3 lines costed): Scope change: More fence");
  });
});

describe("costs copied from a tender are Not classified until a person chooses a resource type", () => {
  it("while every tender line still carries the default resource, their cost is not called Material", () => {
    expect(unclassifiedAmount(run)).toBe(684937.2);
  });

  it("once a person sets another resource type on any tender line, the breakdown is theirs", () => {
    expect(unclassifiedAmount([...run.slice(0, 11), l({ resource_code: "41" })])).toBe(0);
  });

  it("a project made by hand is never unclassified, and a hand-made line beside tender lines keeps its own type", () => {
    expect(unclassifiedAmount([l({ amount: 500, allocated: true, source_line_id: null })])).toBe(0);
    expect(unclassifiedAmount([l({ amount: 500, allocated: true }), l({ amount: 300, allocated: true, source_line_id: null, resource_code: "31" })])).toBe(500);
  });
});

describe("a draft invoice is not invoiced", () => {
  const m = (over: Record<string, unknown> = {}) => ({ basis: "percent" as const, percent: 30, fixed_amount: null, status: "invoiced" as const, invoice_id: "i1", invoice_status: "draft" as string | null, ...over });

  it("counts only issued invoices as invoiced and reports drafts apart", () => {
    const t = milestoneTotals([m(), m({ percent: 20, invoice_id: "i2", invoice_status: "sent" }), m({ percent: 10, invoice_id: "i3", invoice_status: "paid" }), m({ percent: 40, status: "planned", invoice_id: null, invoice_status: null })], 1_459_160);
    expect(t).toMatchObject({ invoiced: 437748, paid: 145916, draftCount: 1, draftAmount: 437748, toInvoice: 1021412 });
  });

  it("partial and overdue are issued; a cancelled one is neither invoiced nor a draft; an invoice whose status cannot be read stays invoiced", () => {
    for (const st of ["sent", "partial", "overdue", "paid"]) expect(milestoneTotals([m({ invoice_status: st })], 1000), st).toMatchObject({ invoiced: 300, draftCount: 0 });
    expect(milestoneTotals([m({ invoice_status: "cancelled" })], 1000)).toMatchObject({ invoiced: 0, draftCount: 0 });
    expect(milestoneTotals([m({ invoice_status: null })], 1000)).toMatchObject({ invoiced: 300, draftCount: 0 });
    expect(hasDraftInvoice({ status: "invoiced", invoice_id: "i1" }, "draft")).toBe(true);
    expect(hasDraftInvoice({ status: "planned", invoice_id: null }, "draft")).toBe(false);
  });
});
