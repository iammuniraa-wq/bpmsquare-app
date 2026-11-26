import { describe, expect, it } from "vitest";
import type { Candidate } from "@/lib/tender/boq/price";
import { CHECK_TOP, median, rankChecks, type CheckItem } from "./check";

// price_check: which BOQ lines are furthest from what our own history says. A row priced from a cost is compared with costs, a row with only a
// selling rate with selling rates. Checked by hand.

const DEAL = "90000000-0000-4000-8000-000000000001";
const cand = (kind: "cost" | "sell", price: number, asOf: string | null = "2026-10-01", label = `ref ${price}`): Candidate => ({ source: kind === "cost" ? "supplier" : "past_project", ref: label, label, price, kind, as_of: asOf });
const item = (over: Partial<CheckItem> & { item: string }): CheckItem => ({
  description: `Line ${over.item}`, rate: 0, unitCost: null, priceSource: null, priceAsOf: null, staleAccepted: false, candidates: [], ...over,
});
const rank = (items: CheckItem[], top?: number) => rankChecks(items, { today: "2026-11-26", validityDays: 180, dealId: DEAL, top });

describe("the median of the references", () => {
  it("is the middle one, or the mean of the two in the middle", () => {
    expect(median([10])).toBe(10);
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20, 40, 100])).toBe(30);
  });
});

describe("ranking the lines", () => {
  it("compares a cost with costs and a rate with selling rates, never one with the other", () => {
    const r = rank([
      // cost 120 against cost references 100, 100, 100 (median 100): +20.0; the selling references (500) are ignored
      item({ item: "1.1", rate: 138, unitCost: 120, priceSource: "supplier", priceAsOf: "2026-11-01", candidates: [cand("cost", 100), cand("cost", 100), cand("cost", 100), cand("sell", 500)] }),
      // no cost on the row, a rate of 90 against selling references 100 and 120 (median 110): -18.2
      item({ item: "2.1", rate: 90, candidates: [cand("sell", 100), cand("sell", 120), cand("cost", 1)] }),
    ]);
    expect(r.rows.map((x) => [x.item, x.basis, x.current, x.reference, x.referenceCount, x.pct])).toEqual([["1.1", "cost", 120, 100, 3, 20], ["2.1", "rate", 90, 110, 2, -18.2]]);
    expect(r.checked).toBe(2);
    expect(r.noReference).toBe(0);
  });
  it("ranks by the size of the gap, either way, and keeps the newest reference's label", () => {
    const r = rank([
      item({ item: "A", rate: 100, unitCost: 100, candidates: [cand("cost", 80, "2026-01-01", "Old RFQ"), cand("cost", 80, "2026-10-20", "RFQ-0009 · Gulf Pipes")] }), // +25
      item({ item: "B", rate: 30, unitCost: 30, candidates: [cand("cost", 100)] }), // -70
      item({ item: "C", rate: 105, unitCost: 105, candidates: [cand("cost", 100)] }), // +5
    ]);
    expect(r.rows.map((x) => [x.item, x.pct])).toEqual([["B", -70], ["A", 25], ["C", 5]]);
    expect(r.rows[1].nearest).toBe("RFQ-0009 · Gulf Pipes");
  });
  it("leaves out lines within one percent, lines with nothing priced, and counts the lines that have no history", () => {
    const r = rank([
      item({ item: "close", rate: 100.5, unitCost: 100.5, candidates: [cand("cost", 100)] }),
      item({ item: "unpriced", rate: 0, candidates: [cand("cost", 100)] }),
      item({ item: "no history", rate: 50, unitCost: 50, candidates: [] }),
      item({ item: "wrong kind", rate: 50, unitCost: 50, candidates: [cand("sell", 10)] }),
    ]);
    expect(r.rows).toEqual([]);
    expect(r.checked).toBe(3);
    expect(r.noReference).toBe(2);
  });
  it("shows the top eight, and says which rows are stale unless the person accepted them knowingly", () => {
    const many = Array.from({ length: 12 }, (_, i) => item({ item: `L${i + 1}`, rate: 100 + (i + 1) * 3, unitCost: 100 + (i + 1) * 3, priceSource: "supplier", priceAsOf: "2026-01-01", candidates: [cand("cost", 100)] }));
    const r = rank(many);
    expect(CHECK_TOP).toBe(8);
    expect(r.rows).toHaveLength(8);
    expect(r.rows[0]).toMatchObject({ item: "L12", pct: 36, stale: true });
    expect(r.checked).toBe(12);
    const accepted = rank([{ ...many[0], staleAccepted: true }]);
    expect(accepted.rows[0].stale).toBe(false);
    const fresh = rank([{ ...many[0], priceAsOf: "2026-11-01" }]);
    expect(fresh.rows[0].stale).toBe(false);
    const manual = rank([{ ...many[0], priceSource: "manual" }]);
    expect(manual.rows[0].stale).toBe(false);
  });
  it("every row points at the deal's bill of quantities", () => {
    expect(rank([item({ item: "1", rate: 200, unitCost: 200, candidates: [cand("cost", 100)] })]).rows[0].href).toBe(`/pipeline/${DEAL}?tab=boq`);
  });
});
