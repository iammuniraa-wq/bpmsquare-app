import { describe, expect, it } from "vitest";
import { computeComparison } from "./compute";
import { MAX_AWARD_LINES, awardNotices, canonicalPlan, chooseLines, matchSupplier } from "./plan";
import { LINE_ID, RS, SUPPLIERS, fixtureInput, money, responses, rid, T0 } from "./fixture";

// Which lines an award covers and which answer wins each, from the same comparison the card showed. The rule for "needs a reason" is
// the award route's own (awardDecision), so a line this file marks is a line the route would refuse without one.

const comparison = () => computeComparison(fixtureInput());
const data = (over: { awards?: { rfq_line_id: string; response_id: string }[]; lineStatus?: Map<string, string> } = {}) => ({
  responses: responses(), suppliers: SUPPLIERS.map((s) => ({ id: s.id, status: s.status })), awards: over.awards ?? [], lineStatus: over.lineStatus ?? new Map<string, string>(),
});
const run = (mode: "single" | "split", supplierIndex: number | null, over = {}) =>
  chooseLines({ comparison: comparison(), data: data(over), mode, supplierIndex, today: T0, staleDays: 180, tenantCurrency: "SAR" });

describe("matching the supplier a person named", () => {
  const names = SUPPLIERS.map((s) => ({ name: s.name }));
  it("by the whole name, a word of it, or a part of it at least four letters long", () => {
    expect(matchSupplier(names, "Alpha Supply")).toEqual({ kind: "ok", index: 0 });
    expect(matchSupplier(names, "beta")).toEqual({ kind: "ok", index: 1 });
    expect(matchSupplier(names, "Gamma Ind")).toEqual({ kind: "ok", index: 2 });
  });
  it("two suppliers that match is a question, none is none, and a short fragment never matches by accident", () => {
    expect(matchSupplier([{ name: "Gulf Pipes" }, { name: "Gulf Rebar" }], "Gulf")).toEqual({ kind: "ask", names: ["Gulf Pipes", "Gulf Rebar"] });
    expect(matchSupplier(names, "Delta")).toEqual({ kind: "none" });
    expect(matchSupplier(names, "al")).toEqual({ kind: "none" });
    expect(matchSupplier(names, "  ")).toEqual({ kind: "none" });
  });
});

describe("every line to one supplier", () => {
  const { picks, left } = run("single", 0);
  it("takes each line that supplier quoted, at its landed price", () => {
    expect(picks.map((p) => [p.item, p.cost])).toEqual([["1", 10], ["2", 5], ["3", 20], ["4", 100], ["5", 200], ["6", 50], ["7", 3000], ["8", 3200]]);
    expect(left).toEqual([]);
    expect(new Set(picks.map((p) => p.supplier))).toEqual(new Set(["Alpha Supply"]));
  });
  it("marks the lines that are not the lowest valid price, or that are themselves past validity: those need a reason", () => {
    expect(picks.filter((p) => p.decision.notLowest).map((p) => [p.item, p.decision.why])).toEqual([["2", "higher"], ["4", "higher"], ["5", "higher"], ["8", "expired"]]);
  });
  it("says so in words, naming the lines and what is wrong with them", () => {
    const n = awardNotices(picks, { staleDays: 180, money, mode: "single", supplier: "Alpha Supply", coverage: { quoted: 8, asked: 8 } });
    expect(n).toContain("Item 2, 4, 5 are not the lowest valid price. A reason is needed.");
    expect(n).toContain("Item 8: the price is past its validity date or older than 180 days. A reason is needed.");
    expect(n.some((x) => x.startsWith("Item 4 is 25% above your own price of 80.00") && x.includes("stale: 12 months old"))).toBe(true);
  });
  it("a supplier that skipped a line leaves it open and says how many it quoted", () => {
    const c = run("single", 2);
    expect(c.picks).toHaveLength(7);
    expect(c.left).toEqual([{ item: "6", reason: "Gamma Industrial did not quote it" }]);
    const n = awardNotices(c.picks, { staleDays: 180, money, mode: "single", supplier: "Gamma Industrial", coverage: { quoted: 7, asked: 8 } });
    expect(n).toContain("Gamma Industrial quoted 7 of 8 lines. The others stay open.");
    expect(n.some((x) => x.startsWith("Item 7 is 40% above your own price of 3,000.00"))).toBe(true);
  });
});

describe("each line to its cheapest valid supplier", () => {
  const { picks, left } = run("split", null);
  it("picks the cheapest valid answer on every line and needs no reason for any", () => {
    expect(picks.map((p) => [p.item, p.supplier, p.cost])).toEqual([
      ["1", "Alpha Supply", 10], ["2", "Beta Trading", 4.5], ["3", "Alpha Supply", 20], ["4", "Beta Trading", 90],
      ["5", "Gamma Industrial", 190], ["6", "Alpha Supply", 50], ["7", "Alpha Supply", 3000], ["8", "Beta Trading", 3000],
    ]);
    expect(left).toEqual([]);
    expect(picks.some((p) => p.decision.notLowest)).toBe(false);
    expect(picks.reduce((s, p) => s + p.cost * (p.qty ?? 1), 0)).toBe(35100);
  });
});

describe("an award that already stands", () => {
  it("the same answer is left as it is; a different one is a replacement the card must say", () => {
    const awards = [{ rfq_line_id: LINE_ID(1), response_id: rid("A", 1) }, { rfq_line_id: LINE_ID(2), response_id: rid("B", 2) }];
    const c = run("single", 0, { awards });
    expect(c.left).toEqual([{ item: "1", reason: "already awarded to Alpha Supply" }]);
    expect(c.picks.find((p) => p.item === "2")!.alreadyAwarded).toBe(true);
    expect(c.picks.find((p) => p.item === "3")!.alreadyAwarded).toBe(false);
    const n = awardNotices(c.picks.filter((p) => p.alreadyAwarded), { staleDays: 180, money, mode: "single" });
    expect(n).toContain("Item 2 already has an award. Pressing the button replaces it.");
  });
  it("a line marked awarded with no award row still counts as one to replace", () => {
    const c = run("single", 0, { lineStatus: new Map([[LINE_ID(3), "awarded"]]) });
    expect(c.picks.find((p) => p.item === "3")!.alreadyAwarded).toBe(true);
  });
});

describe("the signed plan", () => {
  const valid = () => ({
    rfqId: "50000000-0000-4000-8000-000000000001", route: "rfq", dealId: null, mode: "single",
    targets: [{ lineId: LINE_ID(1), responseId: rid("A", 1), rfqSupplierId: RS.A, item: "1" }],
  });
  it("is read into one fixed key order, whatever order it arrived in", () => {
    const reordered = { targets: valid().targets.map((t) => ({ item: t.item, rfqSupplierId: t.rfqSupplierId, responseId: t.responseId, lineId: t.lineId })), mode: "single", dealId: null, route: "rfq", rfqId: valid().rfqId };
    expect(JSON.stringify(canonicalPlan(reordered))).toBe(JSON.stringify(canonicalPlan(valid())));
  });
  it("is refused when anything is not exactly a plan", () => {
    expect(canonicalPlan(null)).toBeNull();
    expect(canonicalPlan({ ...valid(), rfqId: "nope" })).toBeNull();
    expect(canonicalPlan({ ...valid(), route: "other" })).toBeNull();
    expect(canonicalPlan({ ...valid(), mode: "all" })).toBeNull();
    expect(canonicalPlan({ ...valid(), dealId: "40000000-0000-4000-8000-000000000001" })).toBeNull(); // a plain RFQ has no deal
    expect(canonicalPlan({ ...valid(), route: "tender", dealId: null })).toBeNull(); // a tender needs one
    expect(canonicalPlan({ ...valid(), targets: [] })).toBeNull();
    expect(canonicalPlan({ ...valid(), targets: [{ ...valid().targets[0], responseId: "x" }] })).toBeNull();
    expect(canonicalPlan({ ...valid(), targets: Array.from({ length: MAX_AWARD_LINES + 1 }, () => valid().targets[0]) })).toBeNull();
  });
  it("drops anything extra a client added", () => {
    const plan = canonicalPlan({ ...valid(), tenantId: "t2", targets: [{ ...valid().targets[0], price: 1 }] })!;
    expect(Object.keys(plan)).toEqual(["rfqId", "route", "dealId", "mode", "targets"]);
    expect(Object.keys(plan.targets[0])).toEqual(["lineId", "responseId", "rfqSupplierId", "item"]);
  });
});
