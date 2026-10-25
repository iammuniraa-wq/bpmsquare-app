import { describe, expect, it } from "vitest";
import {
  approverIds, canDecide, decidersFor, effectiveDecision, outcomeMessage, parseAction, parseProposal, proposalMessage, proposalProblem,
  stageGuard, tenderSettings,
} from "./approval";
import { BOND_WARN_DAYS, bondReminderLine, bondState, parseBondStatus } from "./bond";
import { reminderMessage } from "./rules";

const A = "a", B = "b", C = "c", GONE = "gone";

describe("who may approve", () => {
  it("reads the settings defensively", () => {
    expect(tenderSettings(undefined)).toEqual({ approvers: [], allowSelfApproval: false });
    expect(tenderSettings({ tender: { approvers: ["x", 5 as unknown as string, "x", ""], allow_self_approval: true } })).toEqual({ approvers: ["x"], allowSelfApproval: true });
    expect(tenderSettings({ tender: { allow_self_approval: "yes" as unknown as boolean } }).allowSelfApproval).toBe(false);
  });

  it("is the chosen list, limited to people still in the workspace", () => {
    expect(approverIds({ approvers: [A, GONE], allowSelfApproval: false }, [A, B, C], [C])).toEqual([A]);
  });

  it("is every workspace admin when nobody is chosen, or when none of the chosen is a member any more", () => {
    expect(approverIds({ approvers: [], allowSelfApproval: false }, [A, B, C], [B, C])).toEqual([B, C]);
    expect(approverIds({ approvers: [GONE], allowSelfApproval: false }, [A, B, C], [B])).toEqual([B]);
    expect(approverIds({ approvers: [], allowSelfApproval: false }, [A], [GONE])).toEqual([]);
  });

  it("one approval from any one approver is enough; the proposer is not one of them unless the workspace allows it", () => {
    const approvers = [A, B];
    expect(canDecide(B, approvers, A, false)).toBe(true);
    expect(canDecide(A, approvers, A, false)).toBe(false);
    expect(canDecide(A, approvers, A, true)).toBe(true);
    expect(canDecide(C, approvers, A, true)).toBe(false);
    expect(decidersFor(approvers, A, false)).toEqual([B]);
    expect(decidersFor(approvers, C, false)).toEqual([A, B]);
  });
});

describe("a proposal", () => {
  it("is go or no-go, and both carry a reason", () => {
    expect(parseProposal({ decision: "go", reason: "  strong fit " })).toEqual({ ok: true, decision: "go", reason: "strong fit" });
    expect(parseProposal({ decision: "no_go", reason: "Out of scope" })).toMatchObject({ ok: true, decision: "no_go" });
    expect(parseProposal({ decision: "go" })).toMatchObject({ ok: false });
    expect(parseProposal({ decision: "no_go", reason: "  " })).toMatchObject({ ok: false });
    expect(parseProposal({ decision: "maybe", reason: "x" })).toMatchObject({ ok: false });
  });

  it("can be made only while the tender is still deciding, one at a time, and only if someone can approve it", () => {
    const ok = { stage: "bid_no_bid", outcome: "open", hasPending: false, deciders: [B] };
    expect(proposalProblem(ok)).toBeNull();
    expect(proposalProblem({ ...ok, stage: "received" })).toBeNull();
    expect(proposalProblem({ ...ok, stage: "estimating" })).toMatch(/Received or Bid\/No-bid/);
    expect(proposalProblem({ ...ok, outcome: "won" })).toMatch(/closed/);
    expect(proposalProblem({ ...ok, hasPending: true })).toMatch(/already waiting/);
    expect(proposalProblem({ ...ok, deciders: [] })).toMatch(/Settings > Tenders/);
  });

  it("the decision on it is approve, reject (comment required) or withdraw", () => {
    expect(parseAction({ action: "approve" })).toEqual({ ok: true, action: "approve", comment: null });
    expect(parseAction({ action: "reject", comment: "Too risky" })).toEqual({ ok: true, action: "reject", comment: "Too risky" });
    expect(parseAction({ action: "reject", comment: " " })).toMatchObject({ ok: false });
    expect(parseAction({ action: "cancel" })).toMatchObject({ ok: true });
    expect(parseAction({ action: "delete" })).toMatchObject({ ok: false });
  });
});

describe("the decision that stands, and the stage guard", () => {
  const row = (status: string, value: "go" | "no_go", at: string) => ({ status: status as "approved", proposed_value: value, decided_at: at, created_at: at });

  it("is the latest approved proposal; pending, rejected and withdrawn ones never count", () => {
    expect(effectiveDecision([])).toBeNull();
    expect(effectiveDecision([row("pending", "go", "2026-10-02"), row("rejected", "go", "2026-10-03"), row("cancelled", "go", "2026-10-04")])).toBeNull();
    const rows = [row("approved", "go", "2026-10-01T00:00:00Z"), row("approved", "no_go", "2026-10-05T00:00:00Z"), row("rejected", "go", "2026-10-09T00:00:00Z")];
    expect(effectiveDecision(rows)?.proposed_value).toBe("no_go");
  });

  const go = { proposed_value: "go" as const }, noGo = { proposed_value: "no_go" as const };

  it("Bid/No-bid to Estimating needs an approved go", () => {
    expect(stageGuard({ from: "bid_no_bid", to: "estimating", effective: null })).toMatch(/approval/);
    expect(stageGuard({ from: "bid_no_bid", to: "estimating", effective: noGo })).toMatch(/approval/);
    expect(stageGuard({ from: "bid_no_bid", to: "estimating", effective: go })).toBeNull();
    expect(stageGuard({ from: "received", to: "submitted", effective: null })).toMatch(/approval/);
    expect(stageGuard({ from: "no_bid", to: "estimating", effective: null })).toMatch(/approval/);
  });

  it("any stage to No-bid needs an approved no-go", () => {
    expect(stageGuard({ from: "bid_no_bid", to: "no_bid", effective: null })).toMatch(/no-go/);
    expect(stageGuard({ from: "bid_no_bid", to: "no_bid", effective: go })).toMatch(/no-go/);
    expect(stageGuard({ from: "estimating", to: "no_bid", effective: go })).toMatch(/no-go/);
    expect(stageGuard({ from: "bid_no_bid", to: "no_bid", effective: noGo })).toBeNull();
  });

  it("asks for nothing when moving between bid stages, backwards, or nowhere", () => {
    expect(stageGuard({ from: "estimating", to: "submitted", effective: null })).toBeNull();
    expect(stageGuard({ from: "submitted", to: "clarifications", effective: null })).toBeNull();
    expect(stageGuard({ from: "estimating", to: "bid_no_bid", effective: null })).toBeNull();
    expect(stageGuard({ from: "bid_no_bid", to: "received", effective: null })).toBeNull();
    expect(stageGuard({ from: "no_bid", to: "bid_no_bid", effective: null })).toBeNull();
    expect(stageGuard({ from: "bid_no_bid", to: "bid_no_bid", effective: null })).toBeNull();
  });
});

describe("the notes", () => {
  it("the approver's note names the proposer, the decision and the reason, as plain text", () => {
    const m = proposalMessage({ title: "Pipes <b>2026</b>", proposer: "A. Nasser", decision: "go", reason: "Good margin", link: "https://kamco.test/pipeline/1" });
    expect(m.subject).toBe("Approval needed: bid (go) for Pipes <b>2026</b>");
    expect(m.text).toContain("A. Nasser proposes bid (go)");
    expect(m.text).toContain("Reason: Good margin");
    expect(m.text).toContain("https://kamco.test/pipeline/1");
    expect(m.comment.length).toBeLessThanOrEqual(600);
  });

  it("the proposer's note says how it went, and a rejection says the tender is back in Bid/No-bid", () => {
    const no = outcomeMessage({ title: "T", decider: "Boss", decision: "no_go", approved: false, comment: "Not now", link: null });
    expect(no.subject).toBe("Rejected: no-go for T");
    expect(no.text).toContain("Comment: Not now");
    expect(no.text).toContain("back in Bid/No-bid");
    const yes = outcomeMessage({ title: "T", decider: "Boss", decision: "go", approved: true, comment: null, link: null });
    expect(yes.text).not.toContain("back in Bid/No-bid");
  });
});

describe("the bid bond", () => {
  const TZ = "Asia/Riyadh";
  const now = new Date("2026-10-25T09:00:00Z");
  const held = (expiry: string | null, amount: number | null = 96000) => bondState({ bid_bond_amount: amount, bid_bond_expiry: expiry, bond_status: "held" }, now, TZ);

  it("is quiet when none is recorded", () => {
    expect(held(null, null)).toMatchObject({ tone: "none" });
  });

  it("warns amber inside 30 days and red once expired", () => {
    expect(held("2027-03-01").tone).toBe("ok");
    expect(held("2026-11-24")).toMatchObject({ tone: "amber", days: BOND_WARN_DAYS, label: "Expires in 30 days" });
    expect(held("2026-10-26")).toMatchObject({ tone: "amber", label: "Expires tomorrow" });
    expect(held("2026-10-25")).toMatchObject({ tone: "red", label: "Expires today" });
    expect(held("2026-10-20")).toMatchObject({ tone: "red", label: "Expired 5 days ago" });
    expect(held(null)).toMatchObject({ tone: "ok", label: "Held" });
  });

  it("a released bond stops the warning, even one long past its expiry", () => {
    const released = bondState({ bid_bond_amount: 96000, bid_bond_expiry: "2026-10-01", bond_status: "released" }, now, TZ);
    expect(released).toEqual({ tone: "ok", label: "Released", days: null });
  });

  it("the reminder carries a bond line only while the bond is held", () => {
    const facts = { bid_bond_amount: 96000, bid_bond_currency: "SAR", bid_bond_expiry: "2027-01-30" };
    expect(bondReminderLine({ ...facts, bond_status: "held" })).toBe("Bid bond: SAR 96,000, valid to 2027-01-30");
    expect(bondReminderLine({ ...facts, bond_status: "released" })).toBeNull();
    expect(bondReminderLine({ ...facts, bid_bond_amount: null, bond_status: "held" })).toBeNull();
    const m = reminderMessage({ title: "T", tenderNo: null, issuer: null, closingAt: "2026-10-30T09:00:00Z", days: 3, timezone: TZ, link: null, bondLine: "Bid bond: SAR 96,000" });
    expect(m.text).toContain("Bid bond: SAR 96,000");
    expect(reminderMessage({ title: "T", tenderNo: null, issuer: null, closingAt: "2026-10-30T09:00:00Z", days: 3, timezone: TZ, link: null, bondLine: null }).text).not.toContain("Bid bond");
  });

  it("reads an unknown or missing status as held", () => {
    expect(parseBondStatus(undefined)).toBe("held");
    expect(parseBondStatus("released")).toBe("released");
    expect(parseBondStatus("weird")).toBe("held");
  });
});
