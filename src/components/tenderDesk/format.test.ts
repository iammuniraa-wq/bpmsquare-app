import { describe, expect, it } from "vitest";
import {
  barPercent, buyoutRow, compact, dayChip, dayTone, daysText, deskSentence, donutSegments, millions, monthsAria, monthsHaveData, monthsMax,
  percentOf, plural, ringDash, sentenceText, shortDate, tileMoney, timelinePosition, trendDeltaText, trendGeometry, winRateLabel,
} from "./format";

describe("money in millions", () => {
  it("writes millions with one decimal and a dash for a missing number", () => {
    expect(millions(92_600_000)).toBe("92.6M");
    expect(millions(3_950_000, 2)).toBe("3.95M");
    expect(millions(null)).toBe("—");
    expect(millions(Number.NaN)).toBe("—");
  });

  it("compact picks millions, thousands or the plain number", () => {
    expect(compact(18_500_000)).toBe("18.5M");
    expect(compact(750_000)).toBe("750K");
    expect(compact(4_200)).toBe("4,200");
    expect(compact(undefined)).toBe("—");
  });

  it("tileMoney splits the big figure from its unit", () => {
    expect(tileMoney(92_600_000, "SAR")).toEqual({ value: "92.6", unit: "M SAR" });
    expect(tileMoney(250_000, "SAR")).toEqual({ value: "250", unit: "K SAR" });
    expect(tileMoney(0, "SAR")).toEqual({ value: "0", unit: "SAR" });
    expect(tileMoney(null, "SAR")).toEqual({ value: "—", unit: "SAR" });
  });
});

describe("counts, rates and days", () => {
  it("plural and win rate", () => {
    expect(plural(1, "bid")).toBe("1 bid");
    expect(plural(5, "bid")).toBe("5 bids");
    expect(plural(0, "tender")).toBe("0 tenders");
    expect(winRateLabel(0.5454)).toBe("55%");
    expect(winRateLabel(0)).toBe("0%");
    expect(winRateLabel(null)).toBe("—");
  });

  it("percentOf is null without a whole", () => {
    expect(percentOf(5.8, 9.8)).toBe(59);
    expect(percentOf(1, 0)).toBeNull();
    expect(percentOf(1, null)).toBeNull();
  });

  it("day chips say the days in words, and tone steps at 3 and 10", () => {
    expect(dayChip(3)).toEqual({ big: "3", small: "days" });
    expect(dayChip(1)).toEqual({ big: "1", small: "day" });
    expect(dayChip(0)).toEqual({ big: "0", small: "today" });
    expect(daysText(3)).toBe("3 days");
    expect(daysText(0)).toBe("Today");
    expect([0, 3, 4, 10, 11, 28].map(dayTone)).toEqual(["red", "red", "amber", "amber", "green", "green"]);
  });
});

describe("bars and rings", () => {
  it("barPercent scales to the largest, never shows a non-zero value as nothing", () => {
    expect(barPercent(35.4, 35.4)).toBe(100);
    expect(barPercent(10.2, 35.4)).toBe(29);
    expect(barPercent(0.01, 100)).toBe(2);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
  });

  it("ringDash clamps the fraction", () => {
    expect(ringDash(0.5).dash).toBeCloseTo(113.1, 1);
    expect(ringDash(2).dash).toBe(ringDash(1).dash);
    expect(ringDash(-1).dash).toBe(0);
    expect(ringDash(null).dash).toBe(0);
  });

  it("donutSegments share the circle and offset each other", () => {
    const segs = donutSegments([50, 25, 25]);
    expect(segs.map((g) => Math.round(g.share * 100))).toEqual([50, 25, 25]);
    expect(segs[0].offset).toBe(0);
    expect(segs[1].offset).toBeCloseTo(-segs[0].dash, 1);
    expect(segs.reduce((n, g) => n + g.dash, 0)).toBeCloseTo(2 * Math.PI * 54, 0);
    expect(donutSegments([])).toEqual([]);
    expect(donutSegments([0, 0])).toEqual([]);
  });
});

describe("trend", () => {
  const pts = [10, 20, 15, 30].map((v, i) => ({ weekEnd: `2026-08-${String(4 + i * 7).padStart(2, "0")}`, openValue: v * 1_000_000 }));

  it("draws a line and a closed area, and locates the last point", () => {
    const g = trendGeometry(pts, 520, 120)!;
    expect(g.line.startsWith("M0 ")).toBe(true);
    expect(g.area.endsWith("L520 120 L0 120 Z")).toBe(true);
    expect(g.lastXPct).toBe(100);
    expect(g.lastYPct).toBeLessThan(50);
    expect(g.delta).toBe(20_000_000);
    expect(g.from).toBe("2026-08-04");
  });

  it("needs two points, and a flat series sits in the middle", () => {
    expect(trendGeometry([], 520, 120)).toBeNull();
    expect(trendGeometry([pts[0]], 520, 120)).toBeNull();
    const flat = trendGeometry([pts[0], { ...pts[1], openValue: pts[0].openValue }], 520, 120)!;
    expect(flat.lastYPct).toBe(50);
  });

  it("words the change", () => {
    expect(shortDate("2026-08-04")).toBe("4 Aug");
    expect(shortDate("2026-08-04T23:30:00Z")).toBe("4 Aug");
    expect(shortDate(null)).toBe("—");
    expect(trendDeltaText(31_600_000, "2026-08-04")).toBe("+31.6M since 4 Aug");
    expect(trendDeltaText(-5_200_000, "2026-08-04")).toBe("-5.2M since 4 Aug");
    expect(trendDeltaText(0, "2026-08-04")).toBe("no change since 4 Aug");
  });
});

describe("deadline timeline", () => {
  it("places a bid on the 28-day axis and anchors the label at the edges", () => {
    expect(timelinePosition(14)).toEqual({ pct: 50, align: "center" });
    expect(timelinePosition(0)).toEqual({ pct: 0, align: "start" });
    expect(timelinePosition(28)).toEqual({ pct: 100, align: "end" });
    expect(timelinePosition(40).pct).toBe(100);
    expect(timelinePosition(-2).pct).toBe(0);
  });
});

describe("buy-out rows", () => {
  const pkg = (over: object) => ({ name: "P", budget: 4_200_000, bestQuote: null, committed: null, status: "waiting" as const, ...over });

  it("an awarded package under budget fills to its share and reads 'under'", () => {
    const r = buyoutRow(pkg({ bestQuote: 3_950_000, committed: 3_950_000, status: "awarded" }), 4_200_000);
    expect(r.trackPct).toBe(100);
    expect(r.committedPct).toBe(94);
    expect(r.quotePct).toBe(94);
    expect(r.diff).toEqual({ text: "0.25M under", kind: "under" });
  });

  it("a quote above the budget reads 'over' and the marker stays inside the track", () => {
    const r = buyoutRow(pkg({ budget: 2_800_000, bestQuote: 2_900_000 }), 4_200_000);
    expect(r.diff).toEqual({ text: "0.10M over", kind: "over" });
    expect(r.committedPct).toBe(0);
    expect(r.trackPct).toBe(67);
    expect(buyoutRow(pkg({ budget: 1_000_000, bestQuote: 3_000_000 }), 4_200_000).quotePct).toBe(100);
  });

  it("no quote says so, with no marker", () => {
    const r = buyoutRow(pkg({}), 4_200_000);
    expect(r.quotePct).toBeNull();
    expect(r.diff).toEqual({ text: "no quote yet", kind: "none" });
  });
});

describe("the greeting sentence", () => {
  const base = { currency: "SAR", kpis: { openValue: 92_600_000, openCount: 10, weightedValue: 0, closingSoonCount: 5, closingSoonValue: 0, winRate: null, won12: 0, lost12: 0, buyoutCommitted: 0, buyoutBudget: null } };
  const closing = [{ id: "1", ref: "T1", title: "A", client: null, closesAt: "", daysLeft: 3, value: 1, href: "/x" }];

  it("states the pipeline, the bids closing and the first one", () => {
    expect(sentenceText(deskSentence({ ...base, closing }))).toBe("The open pipeline stands at SAR 92.6M across 10 tenders. 5 bids close within 14 days, the first in 3 days.");
  });

  it("handles one tender, one bid, none closing and nothing open", () => {
    const one = { ...base, kpis: { ...base.kpis, openCount: 1, closingSoonCount: 1 } };
    expect(sentenceText(deskSentence({ ...one, closing: [{ ...closing[0], daysLeft: 0 }] }))).toBe("The open pipeline stands at SAR 92.6M across 1 tender. 1 bid closes within 14 days, the first today.");
    expect(sentenceText(deskSentence({ ...base, kpis: { ...base.kpis, closingSoonCount: 0 }, closing: [] }))).toBe("The open pipeline stands at SAR 92.6M across 10 tenders. No bid closes within 14 days.");
    expect(sentenceText(deskSentence({ ...base, kpis: { ...base.kpis, openCount: 0 }, closing: [] }))).toBe("No tenders are open right now.");
  });

  it("marks the figures bold", () => {
    const bold = deskSentence({ ...base, closing }).filter((r) => r.bold).map((r) => r.text);
    expect(bold).toEqual(["SAR 92.6M", "10 tenders", "5 bids", "in 3 days"]);
  });
});

describe("months", () => {
  const months = [{ key: "2026-09", label: "Sep", won: 2, lost: 1 }, { key: "2026-10", label: "Oct", won: 0, lost: 3 }];
  it("finds the tallest column and says the figures for a screen reader", () => {
    expect(monthsMax(months)).toBe(3);
    expect(monthsHaveData(months)).toBe(true);
    expect(monthsHaveData([{ key: "k", label: "Jan", won: 0, lost: 0 }])).toBe(false);
    expect(monthsAria(months)).toBe("Won and lost tenders by month. Sep 2 won, 1 lost; Oct 0 won, 3 lost.");
  });
});
