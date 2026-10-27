import { describe, expect, it } from "vitest";
import { tenderPrimary, type PrimaryFacts } from "./headerAction";
import { resolveTenderTab, TENDER_TAB_ORDER, type TenderTabId } from "./tabs";

// Redesign 2026-10-27 (docs/design/gcc-tender-deals.md section 26): the primary button of a tender's header follows the stage, and the six
// tabs are the only tabs. The bug this fixes: a tender's primary button was "Convert to Standard Quote", so Won gave a quote, not a project.

const facts = (over: Partial<PrimaryFacts> = {}): PrimaryFacts => ({ stage: "estimating", outcome: "open", bids: 0, approvedGo: true, canEdit: true, project: null, ...over });
const label = (over: Partial<PrimaryFacts>) => tenderPrimary(facts(over))?.label ?? null;

describe("the primary header button of a tender, by stage", () => {
  it("Received proposes the bid decision", () => {
    expect(label({ stage: "received", approvedGo: false })).toBe("Propose bid decision");
    expect(tenderPrimary(facts({ stage: "received" }))?.key).toBe("propose_decision");
  });

  it("Bid/No-bid proposes until a go is approved, then it is Submit bid", () => {
    expect(label({ stage: "bid_no_bid", approvedGo: false })).toBe("Propose bid decision");
    expect(label({ stage: "bid_no_bid", approvedGo: null })).toBe("Propose bid decision");
    expect(label({ stage: "bid_no_bid", approvedGo: true })).toBe("Submit bid");
  });

  it("Estimating is Submit bid, and Revise bid once a version has been submitted (the bid was reopened)", () => {
    expect(label({ stage: "estimating" })).toBe("Submit bid");
    expect(label({ stage: "estimating", bids: 2 })).toBe("Revise bid");
    expect(tenderPrimary(facts({ stage: "estimating", bids: 2 }))?.key).toBe("revise_bid");
  });

  it("Submitted and Clarifications record the outcome", () => {
    expect(label({ stage: "submitted", bids: 1 })).toBe("Record the outcome");
    expect(label({ stage: "clarifications", bids: 1 })).toBe("Record the outcome");
  });

  it("Awarded and won: Create contract project, or Open contract project once it exists, never a Standard Quote", () => {
    expect(label({ stage: "awarded", outcome: "won", project: { existing: false, canCreate: true } })).toBe("Create contract project");
    expect(label({ stage: "awarded", outcome: "won", project: { existing: true, canCreate: true } })).toBe("Open contract project");
    expect(label({ stage: "awarded", outcome: "won", project: { existing: true, canCreate: false } })).toBe("Open contract project");
  });

  it("nothing to push: a won tender that cannot make a project, a lost one, a no-bid, and a view-only person on an open one", () => {
    expect(label({ stage: "awarded", outcome: "won", project: null })).toBeNull();
    expect(label({ stage: "awarded", outcome: "won", project: { existing: false, canCreate: false } })).toBeNull();
    expect(label({ stage: "bid_lost", outcome: "lost" })).toBeNull();
    expect(label({ stage: "no_bid", outcome: "dropped" })).toBeNull();
    expect(label({ stage: "estimating", canEdit: false })).toBeNull();
  });

  it("no stage ever gives a convert-to-quote button", () => {
    for (const stage of ["received", "bid_no_bid", "estimating", "submitted", "clarifications", "awarded", "bid_lost", "no_bid"]) {
      for (const outcome of ["open", "won", "lost"]) {
        for (const bids of [0, 3]) {
          const l = tenderPrimary(facts({ stage, outcome, bids, project: { existing: false, canCreate: true } }))?.label ?? "";
          expect(l, `${stage}/${outcome}/${bids}`).not.toMatch(/quote|convert/i);
        }
      }
    }
  });

  it("every button carries a guide id for the assistant", () => {
    for (const stage of ["received", "estimating", "submitted"]) expect(tenderPrimary(facts({ stage }))?.guide).toMatch(/^tender\.primary\./);
  });
});

describe("the tabs of a tender and where an old link lands", () => {
  const all: TenderTabId[] = ["overview", "boq", "costing", "bid", "room", "competitors"];
  const land = (raw: string | null | undefined, available: TenderTabId[] = all) => resolveTenderTab(raw, available);

  it("the order is Overview, Bill of quantities, Costing, Bid, Room, Competitors", () => {
    expect(TENDER_TAB_ORDER).toEqual(all);
  });

  it("a current tab opens as itself and nothing else opens History", () => {
    for (const t of all) expect(land(t)).toEqual({ tab: t, history: false });
  });

  it("an old name lands on the nearest tab: lines to the BOQ, estimates and related to Costing, bids and quotes to Bid, tender to Overview", () => {
    expect(land("lines").tab).toBe("boq");
    expect(land("estimates").tab).toBe("costing");
    expect(land("related").tab).toBe("costing");
    expect(land("bids").tab).toBe("bid");
    expect(land("quotes").tab).toBe("bid");
    expect(land("tender").tab).toBe("overview");
  });

  it("activity opens the History panel over the Overview", () => {
    expect(land("activity")).toEqual({ tab: "overview", history: true });
    expect(land("history")).toEqual({ tab: "overview", history: true });
  });

  it("a missing or unknown value is the Overview", () => {
    expect(land(undefined).tab).toBe("overview");
    expect(land("").tab).toBe("overview");
    expect(land("nonsense").tab).toBe("overview");
  });

  it("a tab the deal does not have falls back: Costing to the BOQ, anything else to the Overview", () => {
    const noCosting = all.filter((t) => t !== "costing");
    expect(land("costing", noCosting).tab).toBe("boq");
    expect(land("estimates", noCosting).tab).toBe("boq");
    expect(land("bid", all.filter((t) => t !== "bid")).tab).toBe("overview");
    expect(land("room", all.filter((t) => t !== "room")).tab).toBe("overview");
  });
});
