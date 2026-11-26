import { describe, expect, it } from "vitest";
import { computeComparison, ageText, dateWords } from "./compute";
import { LINE_ID, RS, fixtureInput, money, responses, rid } from "./fixture";

// Three suppliers by eight lines, checked by hand. Prices (A, B, C) and quantities:
//   1: 10 / 12 / 11 x100   2: 5 / 4.5 / 6 x200   3: 20 / 25 / 22 x50   4: 100 / 90 / 95 x20
//   5: 200 / 210 / 190 x10  6: 50 / 55 / -  x30   7: 3000 / 3100 / 4200 x5   8: 3200 (expired) / 3000 / 3300 x4
// Own totals:  A 1000+1000+1000+2000+2000+1500+15000+12800 = 36,300   B 1200+900+1250+1800+2100+1650+15500+12000 = 36,400
//              C 1100+1200+1100+1900+1900+21000+13200 (no line 6) = 41,400
// Lines all three quoted: 7 (every line but 6). Like for like: A 34,800  B 34,750  C 41,400  -> spread 6,650 (19.1 percent of 34,750).
// Cheapest valid per line: A on 1,3,6,7; B on 2,4,8; C on 5. Split by line = 1000+900+1000+1800+1900+1500+15000+12000 = 35,100,
// against the best single supplier (A, 36,300): saving 1,200 (3.3 percent), over 3 suppliers.
// Scores: price 60 x (best on its lines / its own cost): A 60x35100/36300 = 58.0, B 60x35100/36400 = 57.9, C 60x33600/41400 = 48.7;
//   completeness 20 x quoted/8: 20, 20, 17.5; validity 10 x valid/quoted: A 7/8 = 8.8 (one expired), 10, 10;
//   lead (10 x (1+10)/(1+longest lead)): A 14 days = 7.3, B 28 days = 3.8, C 10 days = 10.
//   Totals: A 58.0+20+8.8+7.3 = 94.1, B 57.9+20+10+3.8 = 91.7, C 48.7+17.5+10+10 = 86.2.

const cmp = () => computeComparison(fixtureInput());

describe("totals, like for like, the spread", () => {
  it("each supplier's own total is the compare screen's own sum", () => {
    expect(cmp().suppliers.map((s) => [s.name, s.total])).toEqual([["Alpha Supply", 36300], ["Beta Trading", 36400], ["Gamma Industrial", 41400]]);
  });
  it("a partial quote is flagged, and every total beside it uses the lines everyone quoted", () => {
    const c = cmp();
    expect(c.suppliers.map((s) => [s.quoted, s.asked, s.partial])).toEqual([[8, 8, false], [8, 8, false], [7, 8, true]]);
    expect(c.suppliers[2].missingItems).toEqual(["6"]);
    expect(c.commonLines).toBe(7);
    expect(c.suppliers.map((s) => s.likeForLike)).toEqual([34800, 34750, 41400]);
    expect(c.spread).toEqual({ amount: 6650, pct: 19.1 });
  });
});

describe("cheapest per line, split against one supplier", () => {
  it("marks the lowest valid price on each line, the way the compare screen does", () => {
    const c = cmp();
    expect(c.lines.map((l) => l.cheapestIndex)).toEqual([0, 1, 0, 1, 2, 0, 0, 1]);
    expect(c.lines[7].cells.map((x) => x?.cheapest)).toEqual([false, true, false]);
    expect(c.lines.every((l) => !l.noValid)).toBe(true);
  });
  it("only a supplier that quoted every line can be the single award: the cheapest of those is A", () => {
    expect(cmp().bestSingle).toEqual({ index: 0, name: "Alpha Supply", total: 36300 });
  });
  it("split by line costs 35,100 across 3 suppliers: 1,200 (3.3 percent) under the best single supplier", () => {
    expect(cmp().split).toEqual({ total: 35100, lines: 8, suppliers: 3, saving: 1200, savingPct: 3.3 });
  });
  it("each line's spread is its dearest over its cheapest", () => {
    const c = cmp();
    expect(c.lines[0].spreadPct).toBe(20); // 12 over 10
    expect(c.lines[5].spreadPct).toBe(10); // two quotes: 55 over 50
    expect(c.lines[6].spreadPct).toBe(40); // 4200 over 3000
  });
  it("amounts per cell are the unit price times the quantity", () => {
    const c = cmp();
    expect(c.lines[0].cells[0]).toMatchObject({ unit: 10, amount: 1000 });
    expect(c.lines[1].cells[1]).toMatchObject({ unit: 4.5, amount: 900 });
    expect(c.lines[6].cells[2]).toMatchObject({ unit: 4200, amount: 21000 });
  });
});

describe("the score, with its weights", () => {
  it("is price 60, completeness 20, validity 10, lead time 10", () => {
    const c = cmp();
    expect(c.weights).toEqual({ price: 60, completeness: 20, validity: 10, lead: 10 });
    expect(c.suppliers.map((s) => s.parts)).toEqual([
      { price: 58, completeness: 20, validity: 8.8, lead: 7.3 },
      { price: 57.9, completeness: 20, validity: 10, lead: 3.8 },
      { price: 48.7, completeness: 17.5, validity: 10, lead: 10 },
    ]);
    expect(c.suppliers.map((s) => s.score)).toEqual([94.1, 91.7, 86.2]);
  });
  it("recommends the highest score", () => {
    const c = cmp();
    expect(c.recommendation).toEqual({ index: 0, name: "Alpha Supply" });
    expect(c.suppliers.map((s) => s.recommended)).toEqual([true, false, false]);
  });
  it("lead time and validity are shown where recorded", () => {
    const [a, b, cc] = cmp().suppliers;
    expect([a.leadMin, a.leadMax, a.expired, a.validUntil]).toEqual([14, 14, 1, "2026-11-01"]);
    expect([b.leadMin, b.leadMax, b.expired]).toEqual([21, 28, 0]);
    expect([cc.leadMin, cc.leadMax]).toEqual([10, 10]);
  });
  it("a supplier with no lead time recorded gets half the lead points, and with none recorded anywhere everyone does", () => {
    const none = responses().map((r) => ({ ...r, lead_time_days: null }));
    expect(computeComparison(fixtureInput({ responses: none })).suppliers.map((s) => s.parts.lead)).toEqual([5, 5, 5]);
    const onlyA = responses().map((r) => (r.rfq_supplier_id === RS.A ? r : { ...r, lead_time_days: null }));
    expect(computeComparison(fixtureInput({ responses: onlyA })).suppliers.map((s) => s.parts.lead)).toEqual([10, 5, 5]);
  });
});

describe("outliers against our own history", () => {
  it("flags the 40 percent one, and the 25 percent one against a stale reference, with the stale word", () => {
    const c = cmp();
    expect(c.lines[6].cells[2]!.outlier).toMatchObject({ pct: 40, refPrice: 3000, refLabel: "RFQ-0009 · Beta Trading", refAsOf: "2026-10-01", refStale: false });
    expect(c.lines[3].cells[0]!.outlier).toMatchObject({ pct: 25, refPrice: 80, refStale: true, refAgeDays: 360 });
    const flagged = c.lines.flatMap((l) => l.cells).filter((x) => x?.outlier);
    expect(flagged).toHaveLength(2);
  });
  it("uses the newest reference on a line, not the cheapest or the first", () => {
    expect(cmp().lines[6].cells[2]!.outlier!.refPrice).toBe(3000);
  });
  it("a price 25 percent or more BELOW history is flagged too", () => {
    const c = computeComparison(fixtureInput({ references: new Map([[LINE_ID(1), [{ label: "Product cost price", price: 14, asOf: "2026-10-30" }]]]) }));
    expect(c.lines[0].cells[0]!.outlier).toMatchObject({ pct: -28.6, refStale: false });
  });
  it("says them in words, biggest gap first, with the figures the table holds", () => {
    const texts = cmp().risks.filter((r) => r.kind === "outlier").map((r) => r.text);
    expect(texts).toEqual([
      "Item 7: Gamma Industrial at 4,200.00 is 40% above your own price of 3,000.00 (RFQ-0009 · Beta Trading, 1 Oct 2026).",
      "Item 4: Alpha Supply at 100.00 is 25% above your own price of 80.00 (Product cost price, 1 Dec 2025, stale: 12 months old).",
    ]);
  });
});

describe("what is in the risks", () => {
  const risks = () => cmp().risks;
  it("names the partial quote, the lines it missed and why its total is not comparable", () => {
    expect(risks().find((r) => r.kind === "partial")!.text).toBe("Gamma Industrial quoted 7 of 8 lines (missing 6), so its total of 41,400.00 is not comparable with a full quote.");
    expect(risks().find((r) => r.kind === "basis")!.text).toBe("Compared like for like on the 7 lines every supplier quoted.");
  });
  it("names the expired price", () => {
    expect(risks().find((r) => r.kind === "expired")!.text).toBe("Alpha Supply: 1 price is past its validity date or older than 180 days (item 8).");
  });
  it("tells a lone supplier there is nothing to compare, and recommends no split or spread", () => {
    const only = computeComparison(fixtureInput({ suppliers: [fixtureInput().suppliers[0]] }));
    expect(only.risks[0].text).toBe("Only Alpha Supply has given prices, so there is nothing to compare yet.");
    expect(only.split).toBeNull();
    expect(only.spread).toBeNull();
    expect(only.recommendation).toEqual({ index: 0, name: "Alpha Supply" });
  });
  it("lists a supplier that has not answered, declined, or quoted in another currency without a rate", () => {
    const sup = [...fixtureInput().suppliers, { id: "20000000-0000-4000-8000-0000000000d1", supplierId: "s", name: "Delta Co", status: "declined" },
      { id: "20000000-0000-4000-8000-0000000000d2", supplierId: "s2", name: "Echo Co", status: "sent" }];
    const c = computeComparison(fixtureInput({ suppliers: sup }));
    expect(c.suppliers).toHaveLength(3);
    expect(c.notPriced).toEqual([{ name: "Delta Co", reason: "declined to quote" }, { name: "Echo Co", reason: "has not answered yet" }]);
    const fx = responses().map((r) => (r.rfq_supplier_id === RS.B && r.rfq_line_id === LINE_ID(1) ? { ...r, currency: "USD", fx_rate: null } : r));
    const c2 = computeComparison(fixtureInput({ responses: fx }));
    expect(c2.lines[0].cells[1]).toMatchObject({ unit: null, left: "no_fx" });
    expect(c2.suppliers[1].quoted).toBe(7);
    expect(c2.risks.find((r) => r.kind === "no_fx")!.text).toContain("Beta Trading quoted item 1 in another currency");
  });
  it("a line with no valid price anywhere keeps its lowest price and says so", () => {
    const old = responses().map((r) => (r.rfq_line_id === LINE_ID(2) ? { ...r, valid_until: "2026-01-01" } : r));
    const c = computeComparison(fixtureInput({ responses: old }));
    expect(c.lines[1].noValid).toBe(true);
    expect(c.lines[1].cheapestIndex).toBe(1);
    expect(c.risks.find((r) => r.kind === "no_valid")!.text).toBe("Item 2 has no price that is still valid; the lowest of what exists is shown.");
  });
  it("an alternative offer and a standing award are noted", () => {
    const alt = responses().map((r) => (r.id === rid("B", 3) ? { ...r, status: "alternative" as const } : r));
    const c = computeComparison(fixtureInput({ responses: alt, awardedLineIds: new Set([LINE_ID(1)]) }));
    expect(c.risks.find((r) => r.kind === "alternative")!.text).toBe("Beta Trading offered something different on item 3: check what it is before awarding.");
    expect(c.risks.find((r) => r.kind === "awarded")!.text).toBe("Item 1 already has an award; a new one would replace it.");
  });
});

describe("a tie, a cancelled supplier, a cancelled answer", () => {
  it("both tied prices are highlighted, and the split goes to the first", () => {
    const tie = responses().map((r) => (r.id === rid("B", 1) ? { ...r, unit_price: 10 } : r));
    const c = computeComparison(fixtureInput({ responses: tie }));
    expect(c.lines[0].cells.map((x) => x?.cheapest)).toEqual([true, true, false]);
    expect(c.lines[0].cheapestIndex).toBe(0);
  });
  it("a removed supplier is not a column", () => {
    const sup = fixtureInput().suppliers.map((s) => (s.id === RS.C ? { ...s, status: "cancelled" } : s));
    const c = computeComparison(fixtureInput({ suppliers: sup }));
    expect(c.suppliers.map((s) => s.name)).toEqual(["Alpha Supply", "Beta Trading"]);
    expect(c.commonLines).toBe(8);
  });
  it("a no-quote counts as not quoted", () => {
    const nq = responses().map((r) => (r.id === rid("A", 2) ? { ...r, status: "no_quote" as const, unit_price: null } : r));
    const c = computeComparison(fixtureInput({ responses: nq }));
    expect(c.suppliers[0].quoted).toBe(7);
    expect(c.lines[1].cells[0]).toMatchObject({ unit: null, left: "no_quote" });
  });
  it("nobody priced: no recommendation, no figures", () => {
    const c = computeComparison(fixtureInput({ responses: [] }));
    expect(c.suppliers).toEqual([]);
    expect(c.recommendation).toBeNull();
    expect(c.bestSingle).toBeNull();
    expect(c.split).toBeNull();
    expect(c.notPriced).toHaveLength(3);
  });
});

describe("words", () => {
  it("dates and ages", () => {
    expect(dateWords("2026-03-05")).toBe("5 Mar 2026");
    expect(dateWords(null)).toBe("");
    expect(ageText(1)).toBe("1 day old");
    expect(ageText(45)).toBe("45 days old");
    expect(ageText(360)).toBe("12 months old");
    expect(ageText(null)).toBe("no date");
  });
  it("money in the risks comes through the formatter it was given", () => {
    expect(computeComparison(fixtureInput({ money: (n) => `SAR ${n}` })).risks.find((r) => r.kind === "partial")!.text).toContain("SAR 41400");
    expect(money(36300)).toBe("36,300.00");
  });
});
