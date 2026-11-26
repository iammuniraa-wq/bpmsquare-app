import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { LADDER, baseRate, bidMargin, buildLadder, computeAnalysis, daysUntil, ladderMargins, median, priorWin, winGap } from "./compute";
import { ALPHA, BETA, COMPETITORS, DEAL, GAMMA, LOST, NOW, OPEN, WON, input } from "./fixture";
import { moneyText, pctText } from "./format";
import { COMPETITOR_CARD_TIPS } from "./tips";

// The arithmetic is checked by hand against a workspace of twelve decided tenders: five won (margins 6, 7, 8, 9, 10) and seven lost
// (8, 9, 10, 11, 12, 14, 16). The margins add up to 120, so their mean is exactly 10 and the starting assumption is centred on 10.

const rowAt = (c: ReturnType<typeof computeAnalysis>, m: number) => c.ladder.rows.find((r) => r.marginPct === m)!;

describe("small pieces", () => {
  it("margin is on the price, in percent, and a slip is not a bid", () => {
    expect(bidMargin(1000, 900)).toBe(10);
    expect(bidMargin(1050, 966)).toBe(8);
    expect(bidMargin(1000, null)).toBeNull();
    expect(bidMargin(1000, 0)).toBeNull();
    expect(bidMargin(1000, 5000)).toBeNull();
  });

  it("the winning gap is how far above the winning price our bid sat", () => {
    expect(winGap(1050, 1000)).toBe(5);
    expect(winGap(1000, 940)).toBe(6.4);
    expect(winGap(950, 1000)).toBe(-5);
    expect(winGap(1000, null)).toBeNull();
    expect(winGap(null, 1000)).toBeNull();
  });

  it("median, days and the wording of figures", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 2])).toBe(3);
    expect(daysUntil("2026-12-03T12:00:00.000Z", NOW)).toBe(8);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(pctText(12)).toBe("12%");
    expect(pctText(12.54)).toBe("12.5%");
    expect(moneyText(2_000_000, "SAR")).toBe("SAR 2M");
    expect(moneyText(84_209, "SAR")).toBe("SAR 84K");
    expect(moneyText(900, null)).toBe("900");
  });

  it("the base rate is held back toward 30% while there are few tenders", () => {
    expect(baseRate(5, 12)).toBeCloseTo(0.4, 10);
    expect(baseRate(0, 0)).toBeCloseTo(0.3, 10);
    expect(baseRate(1, 3)).toBeCloseTo(0.32, 10);
  });

  it("the ladder covers 4% to 20% in steps of 2, and stretches to hold the current margin", () => {
    expect(ladderMargins(null)).toEqual([4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(ladderMargins(10)).toEqual([4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(ladderMargins(26.4)).toEqual([4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
    expect(ladderMargins(1.2)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });
});

describe("twelve decided tenders: the history", () => {
  const c = computeAnalysis(input());

  it("counts the decided tenders and the margins", () => {
    expect(c.history).toMatchObject({ decided: 12, wins: 5, losses: 7, winRatePct: 42, withMargin: 12, withGap: 5 });
    expect(c.history.avgMarginWinPct).toBe(8);
    expect(c.history.avgMarginLossPct).toBe(11.4);
  });

  it("splits win rate by value in thirds of our own bids", () => {
    // Twelve bids: 1000 x 9, 1020, 1050, 1080. The thirds start at the 5th and 9th smallest, both 1000, so they collapse into two bands.
    expect(c.history.bands!.map((b) => [b.decided, b.wins])).toEqual([[0, 0], [12, 5]]);
    expect(c.history.bands!.filter((b) => b.current)).toHaveLength(1);
  });

  it("with distinct bid values: under 300, 300 to 500, 500 and over, and says which band this tender is in", () => {
    const bids = [100, 200, 300, 400, 500, 600];
    const past = bids.map((b, i) => ({ ...WON[0], outcome: (i % 2 === 0 ? "won" : "lost") as "won" | "lost", ourBid: b, ourCost: null }));
    const c2 = computeAnalysis(input({ past, deal: { ...DEAL, price: 450 } }));
    expect(c2.history.bands!.map((b) => [b.label, b.decided, b.wins, b.current])).toEqual([
      ["Under SAR 300", 2, 1, false], ["SAR 300 to SAR 500", 2, 1, true], ["SAR 500 and over", 2, 1, false],
    ]);
  });
});

describe("twelve decided tenders: the margin ladder, by hand", () => {
  const c = computeAnalysis(input());

  it("reads the chances from our history, and says how many bids", () => {
    expect(c.ladder.basis).toBe("history");
    expect(c.ladder.sample).toBe(12);
    expect(c.ladder.note).toContain("12 decided bids");
  });

  it("10%: 9 bids within 3 points (4 won), the prior at the centre is the base rate 0.4, so (4 + 2 x 0.4) / (9 + 2) = 0.436", () => {
    const r = rowAt(c, 10);
    expect(r.nearby).toBe(9);
    expect(r.nearbyWins).toBe(4);
    expect(r.winPct).toBe(43.6);
    // Profit at 10% on a cost of 1,800,000: price 2,000,000, profit 200,000, expected 0.436 x 200,000.
    expect(r.price).toBe(2_000_000);
    expect(r.profit).toBe(200_000);
    expect(r.expected).toBe(87_200);
    // Per 100 of cost: 0.436 x 10 / 90 x 100 = 4.84.
    expect(r.expectedPer100).toBe(4.8);
    expect(r.current).toBe(true);
  });

  it("4%: only the 6% and 7% wins are near, so (2 + 2 x 0.5780) / (2 + 2) = 0.789", () => {
    // prior(4) = 1 / (1 + exp(-(ln(0.4 / 0.6) + 0.12 x 6))) = 0.5780
    expect(priorWin(4, 0.4, 10)).toBeCloseTo(0.57799, 4);
    const r = rowAt(c, 4);
    expect(r.nearby).toBe(2);
    expect(r.nearbyWins).toBe(2);
    expect(r.winPct).toBe(78.9);
  });

  it("8%: price is cost / 0.92 and the expected profit is chance x profit", () => {
    const r = rowAt(c, 8);
    expect(r.nearby).toBe(9);
    expect(r.nearbyWins).toBe(5);
    expect(r.winPct).toBe(53.8);
    expect(r.price).toBe(1_956_522);
    expect(r.profit).toBe(156_522);
    expect(r.expected).toBe(84_209);
  });

  it("never lets a higher margin look likelier to win than a lower one", () => {
    const p = c.ladder.rows.map((r) => r.winPct);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeLessThanOrEqual(p[i - 1]);
  });

  it("recommends 8% to 10%, best at 10%, because 8% is within a tenth of the best and 6% and 12% are not", () => {
    const rec = c.ladder.recommended!;
    expect(rec).toMatchObject({ fromPct: 8, toPct: 10, peakPct: 10 });
    expect(rec.reason).toContain("10% margin");
    expect(rec.reason).toContain("4 of 9 nearby past bids won");
    expect(c.ladder.rows.filter((r) => r.recommended).map((r) => r.marginPct)).toEqual([8, 10]);
  });
});

describe("a workspace with little history shows the starting assumption, labelled", () => {
  const thin = [WON[2], LOST[0], LOST[5]]; // margins 8, 8, 14; one win in three decided
  const c = computeAnalysis(input({ past: thin }));

  it("falls back to the prior below five decided bids with a margin", () => {
    expect(c.ladder.basis).toBe("prior");
    expect(c.ladder.sample).toBe(3);
    expect(c.ladder.note).toContain("Starting assumption, not your history");
    expect(c.ladder.note).toContain("only 3 decided bids have a recorded margin (at least 5 are needed)");
    expect(c.ladder.rows.every((r) => r.nearby === 0)).toBe(true);
  });

  it("is centred on the mean margin with the base rate (1 + 0.6) / (3 + 2) = 0.32", () => {
    // Mean of 8, 8, 14 is 10, so the chance at 10% is the base rate itself.
    expect(rowAt(c, 10).winPct).toBe(32);
  });

  it("says so in the risks, and what would sharpen it", () => {
    expect(c.risks.map((r) => r.id)).toContain("thin_history");
    expect(c.risks.find((r) => r.id === "thin_history")!.text).toContain("starting assumption");
    expect(c.sharpen.join(" ")).toContain("Close out each tender");
  });

  it("with no decided tender at all, the base is 30% and it still draws a ladder", () => {
    const none = computeAnalysis(input({ past: [] }));
    expect(none.ladder.basis).toBe("prior");
    expect(none.history).toMatchObject({ decided: 0, winRatePct: null, bands: null });
    expect(rowAt(none, 10).winPct).toBe(30);
    expect(none.ladder.recommended).not.toBeNull();
    expect(none.risks.map((r) => r.id)).toContain("no_history");
  });
});

describe("three competitors with different patterns", () => {
  const c = computeAnalysis(input());
  const by = (n: string) => c.competitors.find((r) => r.name === n)!;

  it("Alpha: met 7 times, beat us 3 times, we won 3, usually 5% above their price, two open tenders besides this one", () => {
    expect(by(ALPHA)).toMatchObject({ met: 7, theyWon: 3, weWon: 3, openElsewhere: 2, typicalGapPct: 5, gapSample: 3, expectedPrice: "lower" });
  });

  it("Beta: met 6 times, beat us 3 times, we won 2; one of their wins has no winning price so the gap rests on two", () => {
    expect(by(BETA)).toMatchObject({ met: 6, theyWon: 3, weWon: 2, gapSample: 2 });
    expect(by(BETA).typicalGapPct).toBeCloseTo(5.3, 5);
  });

  it("Gamma: never met on a decided tender, on one open tender", () => {
    expect(by(GAMMA)).toMatchObject({ met: 0, theyWon: 0, weWon: 0, openElsewhere: 1, typicalGapPct: null, gapSample: 0 });
  });

  it("carries one sourced line from the saved web research and counts its pages", () => {
    expect(by(ALPHA).web).toMatchObject({ line: "Won a SAR 90 m precast housing package in 2026.", sources: 2 });
    expect(by(BETA).web).toEqual({ line: null, sources: 0, researchedAt: null });
  });

  it("puts the competitor asked about first", () => {
    const f = computeAnalysis(input({ focus: "gamma works" }));
    expect(f.competitors[0]).toMatchObject({ name: GAMMA, focus: true });
    expect(f.competitors.filter((r) => r.focus)).toHaveLength(1);
  });

  it("matches a winner typed on the deal even when it was never listed as a competitor", () => {
    const delta = computeAnalysis(input({ competitors: [{ name: "delta  co", country: null, expectedPrice: null, evidence: null }] }));
    expect(delta.competitors[0]).toMatchObject({ met: 1, theyWon: 1 });
  });
});

describe("a tender with no competitors recorded", () => {
  const c = computeAnalysis(input({ competitors: [], proposed: 2 }));

  it("says so, and mentions the proposals nobody has accepted", () => {
    expect(c.competitors).toEqual([]);
    const risk = c.risks.find((r) => r.id === "no_competitors")!;
    expect(risk.level).toBe("warn");
    expect(risk.text).toContain("2 proposals from market research are not accepted yet");
  });

  it("still computes the ladder from our own history", () => {
    expect(c.ladder.basis).toBe("history");
    expect(c.ladder.recommended).not.toBeNull();
  });
});

describe("cost, price and dates", () => {
  it("no cost recorded: chances and profit per 100 of cost, no amounts", () => {
    const c = computeAnalysis(input({ deal: { ...DEAL, cost: null, costedLines: 0 } }));
    expect(c.ladder.rows.every((r) => r.price === null && r.expected === null)).toBe(true);
    expect(c.ladder.rows.every((r) => r.expectedPer100 > 0)).toBe(true);
    expect(c.risks.map((r) => r.id)).toContain("no_cost");
    expect(c.deal.marginPct).toBeNull();
    expect(c.ladder.rows.some((r) => r.current)).toBe(false);
  });

  it("part of the lines costed: says how many are missing", () => {
    const c = computeAnalysis(input({ deal: { ...DEAL, costedLines: 7 } }));
    expect(c.risks.find((r) => r.id === "partial_cost")!.text).toContain("3 of 10 lines have no recorded cost");
  });

  it("a person who may not see costs gets the starting assumption, no amounts and no margin", () => {
    const c = computeAnalysis(input({ costVisible: false }));
    expect(c.ladder.basis).toBe("prior");
    expect(c.ladder.note).toContain("not shown for your role");
    expect(c.deal.cost).toBeNull();
    expect(c.deal.marginPct).toBeNull();
    expect(c.ladder.rows.every((r) => r.price === null)).toBe(true);
    expect(c.risks.map((r) => r.id)).toContain("cost_hidden");
  });

  it("a bid end date that has passed, and a tender that is already decided", () => {
    expect(computeAnalysis(input({ now: new Date("2026-12-10T00:00:00Z") })).risks.find((r) => r.id === "past_end")!.text).toContain("passed 6 days ago");
    expect(computeAnalysis(input({ deal: { ...DEAL, state: "won" } })).risks.map((r) => r.id)).toContain("closed");
  });

  it("research older than 180 days is called out; none saved is called out once", () => {
    const old = computeAnalysis(input({ now: new Date("2027-06-01T00:00:00Z") }));
    expect(old.risks.find((r) => r.id === "stale_research")!.text).toContain(ALPHA);
    expect(computeAnalysis(input({ competitors: COMPETITORS.map((x) => ({ ...x, evidence: null })) })).risks.map((r) => r.id)).toContain("no_web");
  });

  it("a current margin above the ladder stretches it and marks the nearest row", () => {
    const { ladder, currentMargin } = buildLadder({ past: [...WON, ...LOST], deal: { ...DEAL, price: 2_000_000, cost: 1_480_000 }, costVisible: true });
    expect(currentMargin).toBe(26);
    expect(ladder.rows[ladder.rows.length - 1].marginPct).toBe(26);
    expect(ladder.rows.find((r) => r.current)!.marginPct).toBe(26);
  });
});

describe("what would sharpen it", () => {
  it("counts the gaps in the history", () => {
    const c = computeAnalysis(input());
    expect(c.decidedWithoutCompetitors).toBe(1);
    expect(c.lostWithoutWinnerPrice).toBe(2);
    expect(c.sharpen.join(" ")).toContain("Record the winning price on lost tenders: 2 have none.");
    expect(c.sharpen.join(" ")).toContain("List the competitors on each tender: 1 decided tender list none.");
  });
});

describe("the card's own explanations fit behind an i", () => {
  it.each(Object.entries(COMPETITOR_CARD_TIPS))("%s", (_k, text) => { expect(tipTextProblems(text)).toEqual([]); });
});

describe("the constants the wording quotes", () => {
  it("are the ones the arithmetic uses", () => {
    expect(LADDER.minBids).toBe(5);
    expect(LADDER.peakShare).toBe(0.9);
    expect(OPEN).toHaveLength(2);
  });
});
