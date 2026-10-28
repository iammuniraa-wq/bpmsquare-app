import { describe, expect, it } from "vitest";
import { DEFAULT_TENDER_STAGES } from "@/lib/constants";
import {
  addDays, bondItems, buildBuyout, buildClients, buildClosing, buildKpis, buildMonths, buildStages, buildTrend, buyoutPackageStatus, buyoutTotals,
  composeTenderDesk, dealsClosingWithin, dealsWithOpenGuarantee, decisionItems, emptyTenderDesk, lastMonths, monthKeyOf, pickFeaturedProject,
  pricedDealIds, rankAttention, staleItems, staleLineCounts, supplierReplyItems, unpricedItems,
  type BoqPriceLine, type DeskInput, type DeskProject, type DeskTender,
} from "./rules";

const TZ = "Asia/Riyadh";
// 12:00 in Riyadh (UTC+3) on Wednesday 28 October 2026.
const NOW = new Date("2026-10-28T09:00:00Z");

let seq = 0;
function tender(over: Partial<DeskTender> = {}): DeskTender {
  seq++;
  return {
    id: `t${seq}`, ref: `OPP-${String(seq).padStart(4, "0")}`, title: `Tender ${seq}`, stage: "estimating", outcome: "open", amount: 1_000_000, probability: 50,
    closingAt: null, createdAt: "2026-09-01T08:00:00Z", closedAt: null, clientName: "Ministry", clientAccountId: "a1", ...over,
  };
}
/** A bid end date `n` local days from today at 12:00 Riyadh time. */
const inDays = (n: number) => new Date(Date.parse("2026-10-28T09:00:00Z") + n * 86_400_000).toISOString();

describe("days and months", () => {
  it("adds days to a plain date, across month and year ends", () => {
    expect(addDays("2026-10-28", 7)).toBe("2026-11-04");
    expect(addDays("2026-01-03", -7)).toBe("2025-12-27");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("lists twelve calendar months ending with the current one, oldest first, across a year end", () => {
    const m = lastMonths(NOW, TZ);
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ key: "2025-11", label: "Nov" });
    expect(m[2]).toEqual({ key: "2026-01", label: "Jan" });
    expect(m[11]).toEqual({ key: "2026-10", label: "Oct" });
  });

  it("reads the month in the workspace time zone, not UTC", () => {
    // 22:00 UTC on 30 September is 01:00 on 1 October in Riyadh.
    expect(monthKeyOf("2026-09-30T22:00:00Z", "Asia/Riyadh")).toBe("2026-10");
    expect(monthKeyOf("2026-09-30T22:00:00Z", "UTC")).toBe("2026-09");
    expect(monthKeyOf(null, TZ)).toBeNull();
    expect(monthKeyOf("not a date", TZ)).toBeNull();
  });

  it("takes the current month from the zone too (just after midnight on the 1st in Riyadh is still the old month in UTC)", () => {
    const edge = new Date("2026-10-31T22:30:00Z"); // 1 November 01:30 in Riyadh
    expect(lastMonths(edge, "Asia/Riyadh")[11].key).toBe("2026-11");
    expect(lastMonths(edge, "UTC")[11].key).toBe("2026-10");
  });
});

describe("kpis", () => {
  const none = { committed: 0, budget: null };

  it("is all zero, with no win rate, for an empty workspace", () => {
    expect(buildKpis([], NOW, TZ, none)).toEqual({
      openValue: 0, openCount: 0, weightedValue: 0, closingSoonCount: 0, closingSoonValue: 0, winRate: null, won12: 0, lost12: 0, buyoutCommitted: 0, buyoutBudget: null,
    });
  });

  it("adds open tenders only; a null amount is 0 and a null probability is 0", () => {
    const k = buildKpis([
      tender({ amount: 10_000_000, probability: 50 }),
      tender({ amount: 4_000_000, probability: null }),
      tender({ amount: null, probability: 90 }),
      tender({ outcome: "won", amount: 99_000_000, closedAt: "2026-10-01T08:00:00Z" }),
      tender({ outcome: "lost", amount: 99_000_000, closedAt: "2026-10-02T08:00:00Z" }),
      tender({ outcome: "dropped", amount: 99_000_000, closedAt: "2026-10-02T08:00:00Z" }),
    ], NOW, TZ, none);
    expect(k.openCount).toBe(3);
    expect(k.openValue).toBe(14_000_000);
    expect(k.weightedValue).toBe(5_000_000);
  });

  it("keeps a probability outside 0..100 inside it", () => {
    const k = buildKpis([tender({ amount: 1000, probability: 250 }), tender({ amount: 1000, probability: -40 })], NOW, TZ, none);
    expect(k.weightedValue).toBe(1000);
  });

  it("counts a bid ending today and one ending in 14 days, not yesterday and not day 15", () => {
    const k = buildKpis([
      tender({ amount: 1, closingAt: inDays(0) }),
      tender({ amount: 10, closingAt: inDays(14) }),
      tender({ amount: 100, closingAt: inDays(15) }),
      tender({ amount: 1000, closingAt: inDays(-1) }),
      tender({ amount: 10000, closingAt: null }),
    ], NOW, TZ, none);
    expect(k.closingSoonCount).toBe(2);
    expect(k.closingSoonValue).toBe(11);
  });

  it("does not count a closed tender as closing soon", () => {
    const k = buildKpis([tender({ outcome: "lost", closingAt: inDays(2), closedAt: "2026-10-20T08:00:00Z" })], NOW, TZ, none);
    expect(k.closingSoonCount).toBe(0);
  });

  it("works the win rate over the last twelve months, dropped being neither", () => {
    const k = buildKpis([
      tender({ outcome: "won", closedAt: "2026-10-05T08:00:00Z" }),
      tender({ outcome: "won", closedAt: "2026-03-05T08:00:00Z" }),
      tender({ outcome: "won", closedAt: "2025-11-02T08:00:00Z" }),
      tender({ outcome: "lost", closedAt: "2026-06-05T08:00:00Z" }),
      tender({ outcome: "dropped", closedAt: "2026-06-05T08:00:00Z" }),
      tender({ outcome: "won", closedAt: "2025-10-28T08:00:00Z" }), // 13 months ago: out
      tender({ outcome: "lost", closedAt: "2024-01-01T08:00:00Z" }), // out
      tender({ outcome: "won", closedAt: null }), // cannot be placed in time
    ], NOW, TZ, none);
    expect(k.won12).toBe(3);
    expect(k.lost12).toBe(1);
    expect(k.winRate).toBe(0.75);
  });

  it("has no win rate when only dropped tenders were decided", () => {
    const k = buildKpis([tender({ outcome: "dropped", closedAt: "2026-10-05T08:00:00Z" })], NOW, TZ, none);
    expect(k.winRate).toBeNull();
    expect(k.won12 + k.lost12).toBe(0);
  });

  it("is a 0% win rate (not null) when something was decided and all lost", () => {
    const k = buildKpis([tender({ outcome: "lost", closedAt: "2026-10-05T08:00:00Z" })], NOW, TZ, none);
    expect(k.winRate).toBe(0);
  });

  it("places a decision in the month of the zone: closed just after midnight on the 1st belongs to the new month", () => {
    const edge = new Date("2026-10-31T22:30:00Z"); // 1 November in Riyadh
    const decided = [tender({ outcome: "won", closedAt: "2025-11-30T22:30:00Z" })]; // 1 December 2025 in Riyadh: first month of the window (Dec 2025 to Nov 2026)
    expect(buildKpis(decided, edge, "Asia/Riyadh", none).won12).toBe(1);
  });

  it("passes the buy-out totals through, null budget included", () => {
    expect(buildKpis([], NOW, TZ, { committed: 5, budget: null }).buyoutBudget).toBeNull();
    const k = buildKpis([], NOW, TZ, { committed: 12.345, budget: 100 });
    expect(k.buyoutCommitted).toBe(12.35);
    expect(k.buyoutBudget).toBe(100);
  });
});

describe("stages", () => {
  it("lists the open stages in the workspace order with their own colour, empty ones included", () => {
    const s = buildStages([
      tender({ stage: "estimating", amount: 5 }), tender({ stage: "estimating", amount: 7 }), tender({ stage: "received", amount: 3 }),
      tender({ stage: "submitted", amount: null }),
    ], DEFAULT_TENDER_STAGES);
    expect(s.map((x) => x.stage)).toEqual(["received", "bid_no_bid", "estimating", "submitted", "clarifications"]);
    expect(s.find((x) => x.stage === "estimating")).toMatchObject({ count: 2, value: 12, color: "#3b82f6", label: "Estimating" });
    expect(s.find((x) => x.stage === "bid_no_bid")).toMatchObject({ count: 0, value: 0 });
    expect(s.find((x) => x.stage === "submitted")).toMatchObject({ count: 1, value: 0 });
  });

  it("leaves out closed stages, tenders that are not open, and a stage the workspace does not know", () => {
    const s = buildStages([
      tender({ stage: "awarded", outcome: "won", closedAt: "2026-10-01T00:00:00Z" }), tender({ stage: "estimating", outcome: "lost" }), tender({ stage: "mystery" }),
    ], DEFAULT_TENDER_STAGES);
    expect(s.every((x) => x.count === 0)).toBe(true);
    expect(s.map((x) => x.stage)).not.toContain("awarded");
  });

  it("is empty when the workspace has no stage list", () => {
    expect(buildStages([tender()], [])).toEqual([]);
  });
});

describe("closing soonest", () => {
  it("lists open tenders from today on, soonest first, with the whole days left", () => {
    const c = buildClosing([
      tender({ id: "late", closingAt: inDays(20), amount: 3 }), tender({ id: "today", closingAt: inDays(0), amount: 1 }), tender({ id: "soon", closingAt: inDays(2), amount: 2 }),
    ], NOW, TZ);
    expect(c.map((x) => [x.id, x.daysLeft])).toEqual([["today", 0], ["soon", 2], ["late", 20]]);
    expect(c[0]).toMatchObject({ value: 1, href: "/pipeline/today", client: "Ministry" });
  });

  it("lists a tender closing today, even when its hour has passed", () => {
    const earlier = new Date("2026-10-28T03:00:00Z").toISOString(); // 06:00 local today, before NOW
    expect(buildClosing([tender({ id: "x", closingAt: earlier })], NOW, TZ).map((x) => x.id)).toEqual(["x"]);
  });

  it("does not list a tender that closed yesterday, one that is not open, or one without a bid end date", () => {
    const c = buildClosing([
      tender({ id: "y", closingAt: inDays(-1) }), tender({ id: "won", outcome: "won", closingAt: inDays(3) }), tender({ id: "none", closingAt: null }),
    ], NOW, TZ);
    expect(c).toEqual([]);
  });

  it("decides today and yesterday by the workspace's calendar day", () => {
    const late = new Date("2026-10-27T21:30:00Z"); // 00:30 on 28 October in Riyadh
    const rows = [
      tender({ id: "ended-23h-local", closingAt: "2026-10-27T20:00:00Z" }), // 23:00 on the 27th: yesterday
      tender({ id: "ends-01h-local", closingAt: "2026-10-27T22:00:00Z" }), // 01:00 on the 28th: today
    ];
    expect(buildClosing(rows, late, "Asia/Riyadh").map((x) => [x.id, x.daysLeft])).toEqual([["ends-01h-local", 0]]);
    // In UTC the same instant is still the 27th, so both end today.
    expect(buildClosing(rows, late, "UTC").map((x) => x.id)).toEqual(["ended-23h-local", "ends-01h-local"]);
  });

  it("cuts the list to eight", () => {
    const rows = Array.from({ length: 11 }, (_, i) => tender({ closingAt: inDays(i) }));
    const c = buildClosing(rows, NOW, TZ);
    expect(c).toHaveLength(8);
    expect(c[7].daysLeft).toBe(7);
  });

  it("is empty with no tenders", () => {
    expect(buildClosing([], NOW, TZ)).toEqual([]);
  });
});

describe("months", () => {
  it("is twelve zero rows with nothing decided", () => {
    const m = buildMonths([], NOW, TZ);
    expect(m).toHaveLength(12);
    expect(m.every((x) => x.won === 0 && x.lost === 0)).toBe(true);
    expect(m[11]).toMatchObject({ key: "2026-10", label: "Oct" });
  });

  it("counts won and lost by the month of closed_at; dropped and undated are neither", () => {
    const m = buildMonths([
      tender({ outcome: "won", closedAt: "2026-10-02T08:00:00Z" }), tender({ outcome: "won", closedAt: "2026-10-20T08:00:00Z" }),
      tender({ outcome: "lost", closedAt: "2026-09-10T08:00:00Z" }), tender({ outcome: "dropped", closedAt: "2026-09-10T08:00:00Z" }),
      tender({ outcome: "won", closedAt: null }), tender({ outcome: "won", closedAt: "2024-01-01T00:00:00Z" }), tender({ outcome: "open", closedAt: "2026-10-02T08:00:00Z" }),
    ], NOW, TZ);
    expect(m.find((x) => x.key === "2026-10")).toMatchObject({ won: 2, lost: 0 });
    expect(m.find((x) => x.key === "2026-09")).toMatchObject({ won: 0, lost: 1 });
    expect(m.reduce((s, x) => s + x.won + x.lost, 0)).toBe(3);
  });

  it("puts a decision closed at 01:00 local on the 1st into the new month", () => {
    const m = buildMonths([tender({ outcome: "won", closedAt: "2026-09-30T22:00:00Z" })], NOW, "Asia/Riyadh");
    expect(m.find((x) => x.key === "2026-10")?.won).toBe(1);
    expect(m.find((x) => x.key === "2026-09")?.won).toBe(0);
  });
});

describe("clients", () => {
  const client = (name: string | null, amount: number | null, id: string | null = null) => tender({ clientName: name, amount, clientAccountId: id });

  it("is empty with no open tenders", () => {
    expect(buildClients([])).toEqual([]);
    expect(buildClients([tender({ outcome: "won" })])).toEqual([]);
  });

  it("adds a client's open tenders, largest first, telling names apart without caring for case or spacing", () => {
    const c = buildClients([client("Ministry", 5, "a1"), client("ministry  ", 7, "a1"), client("Water Co", 20, "a2"), client("Roads", null)]);
    expect(c).toEqual([
      { accountId: "a2", name: "Water Co", value: 20, count: 1 },
      { accountId: "a1", name: "Ministry", value: 12, count: 2 },
      { accountId: null, name: "Roads", value: 0, count: 1 },
    ]);
  });

  it("shows exactly five clients without an Others row", () => {
    const c = buildClients(["a", "b", "c", "d", "e"].map((n, i) => client(n, 10 - i)));
    expect(c).toHaveLength(5);
    expect(c.map((x) => x.name)).not.toContain("Others");
  });

  it("folds everything after the fifth into one Others row", () => {
    const c = buildClients(["a", "b", "c", "d", "e", "f", "g"].map((n, i) => client(n, 70 - i * 10)));
    expect(c.map((x) => x.name)).toEqual(["a", "b", "c", "d", "e", "Others"]);
    expect(c[5]).toEqual({ accountId: null, name: "Others", value: 30, count: 2 });
  });

  it("names a tender with no client rather than losing its value", () => {
    const c = buildClients([client(null, 9), client("  ", 1)]);
    expect(c).toEqual([{ accountId: null, name: "No client", value: 10, count: 2 }]);
  });
});

describe("trend", () => {
  it("is empty without tenders, or when no created date can be read", () => {
    expect(buildTrend([], NOW, TZ)).toEqual([]);
    expect(buildTrend([tender({ createdAt: "garbage" })], NOW, TZ)).toEqual([]);
  });

  it("has twelve weekly points ending today, oldest first", () => {
    const t = buildTrend([tender()], NOW, TZ);
    expect(t).toHaveLength(12);
    expect(t[11].weekEnd).toBe("2026-10-28");
    expect(t[10].weekEnd).toBe("2026-10-21");
    expect(t[0].weekEnd).toBe("2026-08-12");
  });

  it("rebuilds what was open at each week end from the created and closed dates", () => {
    const t = buildTrend([
      tender({ amount: 100, createdAt: "2026-08-01T08:00:00Z" }), // open the whole time
      tender({ amount: 50, createdAt: "2026-10-10T08:00:00Z" }), // appears mid-way
      tender({ amount: 30, outcome: "won", createdAt: "2026-08-01T08:00:00Z", closedAt: "2026-10-15T08:00:00Z" }), // leaves mid-way
    ], NOW, TZ);
    const at = (d: string) => t.find((p) => p.weekEnd === d)?.openValue;
    expect(at("2026-08-12")).toBe(130);
    expect(at("2026-10-07")).toBe(130);
    expect(at("2026-10-14")).toBe(180); // created on the 10th, closed on the 15th: still open on the 14th
    expect(at("2026-10-21")).toBe(150);
    expect(t[11].openValue).toBe(150);
  });

  it("ends on exactly today's open value", () => {
    const rows = [tender({ amount: 7 }), tender({ amount: null }), tender({ amount: 3, outcome: "lost", closedAt: "2026-09-01T00:00:00Z" })];
    expect(buildTrend(rows, NOW, TZ)[11].openValue).toBe(buildKpis(rows, NOW, TZ, { committed: 0, budget: null }).openValue);
  });

  it("leaves a tender created after a week end out of that week, and a decided tender with no closed date out of all", () => {
    const t = buildTrend([tender({ amount: 10, createdAt: "2026-10-28T05:00:00Z" }), tender({ amount: 99, outcome: "won", closedAt: null })], NOW, TZ);
    expect(t[10].openValue).toBe(0);
    expect(t[11].openValue).toBe(10);
  });

  it("dates a tender created just after midnight local by the local day", () => {
    // 22:00 UTC on 27 October is 01:00 on 28 October in Riyadh: not yet there on the 27th.
    const t = buildTrend([tender({ amount: 5, createdAt: "2026-10-27T22:00:00Z" })], NOW, TZ);
    expect(t[11].openValue).toBe(5);
    expect(buildTrend([tender({ amount: 5, createdAt: "2026-10-27T22:00:00Z" })], new Date("2026-10-28T20:00:00Z"), TZ)[10].openValue).toBe(0);
  });
});

describe("buy-out", () => {
  const pkg = (name: string, budget: number, best: number | null, committed: number | null) => ({ name, budget, best_quote: best, committed });
  const project = (id: string, packages: DeskProject["packages"], createdAt = "2026-09-01T00:00:00Z"): DeskProject => ({ id, name: `Project ${id}`, createdAt, packages });

  it("reads a package as awarded when committed is set, quotes in when a quote exists, else waiting", () => {
    expect(buyoutPackageStatus({ committed: 100, best_quote: 90 })).toBe("awarded");
    expect(buyoutPackageStatus({ committed: 0, best_quote: null })).toBe("awarded");
    expect(buyoutPackageStatus({ committed: null, best_quote: 90 })).toBe("quotes in");
    expect(buyoutPackageStatus({ committed: null, best_quote: null })).toBe("waiting");
  });

  it("is hidden (null) with no project or a project without packages", () => {
    expect(buildBuyout([])).toBeNull();
    expect(buildBuyout([project("p1", [])])).toBeNull();
  });

  it("totals every package of every project; the budget is null when there is no package at all", () => {
    expect(buyoutTotals([])).toEqual({ committed: 0, budget: null });
    expect(buyoutTotals([project("p1", [])])).toEqual({ committed: 0, budget: null });
    expect(buyoutTotals([project("p1", [pkg("a", 100, null, 80), pkg("b", 50, 40, null)]), project("p2", [pkg("c", 10, null, 9)])])).toEqual({ committed: 89, budget: 160 });
  });

  it("shows the project with the most packages that moved, then the most packages, then the newest", () => {
    const busy = project("busy", [pkg("a", 1, null, 1), pkg("b", 1, 1, null), pkg("c", 1, null, null)], "2026-01-01T00:00:00Z");
    const big = project("big", [pkg("a", 1, null, null), pkg("b", 1, null, null), pkg("c", 1, null, null), pkg("d", 1, 1, null)], "2026-09-01T00:00:00Z");
    expect(pickFeaturedProject([big, busy])?.id).toBe("busy");
    const x = project("x", [pkg("a", 1, null, null), pkg("b", 1, null, null)], "2026-01-01T00:00:00Z");
    const y = project("y", [pkg("a", 1, null, null)], "2026-09-01T00:00:00Z");
    expect(pickFeaturedProject([y, x])?.id).toBe("x");
    const older = project("older", [pkg("a", 1, null, null)], "2026-01-01T00:00:00Z");
    const newer = project("newer", [pkg("a", 1, null, null)], "2026-09-01T00:00:00Z");
    expect(pickFeaturedProject([older, newer])?.id).toBe("newer");
  });

  it("draws the featured project's packages with their status and a link to the project", () => {
    const b = buildBuyout([project("p1", [pkg("Pipes", 1000, 900, null), pkg("Steel", 500, null, 480), pkg("Valves", 200, null, null)])]);
    expect(b).toEqual({
      projectId: "p1", projectName: "Project p1", href: "/contract-projects/p1",
      packages: [
        { name: "Pipes", budget: 1000, bestQuote: 900, committed: null, status: "quotes in" },
        { name: "Steel", budget: 500, bestQuote: null, committed: 480, status: "awarded" },
        { name: "Valves", budget: 200, bestQuote: null, committed: null, status: "waiting" },
      ],
    });
  });
});

describe("attention items", () => {
  it("flags a bid decision waiting, high when the bid ends within two weeks", () => {
    const [soon, later] = decisionItems([
      { opportunityId: "o1", title: "Storm water", proposed: "go", createdAt: "2026-10-26T08:00:00Z", closingAt: inDays(5) },
      { opportunityId: "o2", title: "Culverts", proposed: "no_go", createdAt: "2026-10-28T06:00:00Z", closingAt: inDays(40) },
    ], NOW, TZ);
    expect(soon).toMatchObject({ kind: "decision", severity: "high", action: "Decide", href: "/pipeline/o1" });
    expect(soon.title).toBe("Bid decision: Storm water");
    expect(soon.sub).toBe("Go proposed 2 days ago, bid ends in 5 days");
    expect(later).toMatchObject({ severity: "medium" });
    expect(later.sub).toBe("No-go proposed today, bid ends in 40 days");
  });

  it("flags suppliers who have not replied after the reply date, not before it and not on it", () => {
    const items = supplierReplyItems([
      { rfqId: "r1", ref: "RFQ-0001", title: "Pipes", respondBy: "2026-10-25", waiting: 2 },
      { rfqId: "r2", ref: null, title: "Steel", respondBy: "2026-10-27", waiting: 1 },
      { rfqId: "r3", ref: "RFQ-0003", title: "Valves", respondBy: "2026-10-28", waiting: 3 }, // due today: not late yet
      { rfqId: "r4", ref: "RFQ-0004", title: "Cable", respondBy: "2026-10-30", waiting: 3 },
      { rfqId: "r5", ref: "RFQ-0005", title: "Paint", respondBy: "2026-10-01", waiting: 0 },
      { rfqId: "r6", ref: "RFQ-0006", title: "Old", respondBy: "2026-10-10", waiting: 4 },
    ], NOW, TZ);
    expect(items.map((i) => i.title)).toEqual(["Supplier reply overdue: RFQ-0001", "Supplier reply overdue: Steel", "Supplier reply overdue: RFQ-0006"]);
    expect(items[0]).toMatchObject({ sub: "2 suppliers not replied, due 3 days ago", action: "Remind", href: "/rfqs/r1", severity: "medium" });
    expect(items[1].sub).toBe("1 supplier not replied, due yesterday");
    expect(items[2].severity).toBe("high");
  });

  it("flags a bid guarantee expiring within 30 days or already expired, high within a week", () => {
    const items = bondItems([
      { opportunityId: "o1", title: "A", expiry: "2026-11-06", closingAt: null }, // 9 days
      { opportunityId: "o2", title: "B", expiry: "2026-11-27", closingAt: null }, // 30 days
      { opportunityId: "o3", title: "C", expiry: "2026-11-28", closingAt: null }, // 31: not yet
      { opportunityId: "o4", title: "D", expiry: "2026-10-28", closingAt: null }, // today
      { opportunityId: "o5", title: "E", expiry: "2026-10-27", closingAt: null }, // expired yesterday
      { opportunityId: "o6", title: "F", expiry: "2026-10-20", closingAt: null },
      { opportunityId: "o7", title: "G", expiry: "nonsense", closingAt: null },
    ], NOW, TZ);
    expect(items.map((i) => [i.title, i.sub, i.severity])).toEqual([
      ["Bid guarantee: A", "Expires in 9 days", "medium"], ["Bid guarantee: B", "Expires in 30 days", "medium"], ["Bid guarantee: D", "Expires today", "high"],
      ["Bid guarantee: E", "Expired yesterday", "high"], ["Bid guarantee: F", "Expired 8 days ago", "high"],
    ]);
    expect(items[0]).toMatchObject({ action: "Extend", href: "/pipeline/o1" });
  });

  it("flags stale prices on a bid closing within two weeks, and nothing past that or with no stale line", () => {
    const items = staleItems([
      { opportunityId: "o1", title: "A", closingAt: inDays(6), staleLines: 3 },
      { opportunityId: "o2", title: "B", closingAt: inDays(15), staleLines: 3 },
      { opportunityId: "o3", title: "C", closingAt: inDays(2), staleLines: 0 },
      { opportunityId: "o4", title: "D", closingAt: inDays(-1), staleLines: 2 },
      { opportunityId: "o5", title: "E", closingAt: inDays(0), staleLines: 1 },
    ], NOW, TZ, 180);
    expect(items.map((i) => i.title)).toEqual(["Old prices: A", "Old prices: E"]);
    expect(items[0]).toMatchObject({ action: "Review", href: "/pipeline/o1?tab=boq", severity: "medium", sub: "3 lines priced from a source older than 180 days, bid ends in 6 days" });
    expect(items[1].sub).toBe("1 line priced from a source older than 180 days, bid ends today");
  });

  it("flags a bid closing within three days with nothing priced", () => {
    const items = unpricedItems([
      { opportunityId: "o1", title: "A", closingAt: inDays(0) }, { opportunityId: "o2", title: "B", closingAt: inDays(1) }, { opportunityId: "o3", title: "C", closingAt: inDays(3) },
      { opportunityId: "o4", title: "D", closingAt: inDays(4) }, { opportunityId: "o5", title: "E", closingAt: inDays(-1) }, { opportunityId: "o6", title: "F", closingAt: null },
    ], NOW, TZ);
    expect(items.map((i) => [i.title, i.sub])).toEqual([
      ["Not priced yet: A", "Bid ends today"], ["Not priced yet: B", "Bid ends tomorrow"], ["Not priced yet: C", "Bid ends in 3 days"],
    ]);
    expect(items[0]).toMatchObject({ action: "Price", severity: "high", href: "/pipeline/o1?tab=boq" });
  });

  it("puts the most severe first, then the order of the kinds, then the soonest; and shows at most five", () => {
    const items = [
      ...decisionItems([{ opportunityId: "d-far", title: "Far", proposed: "go", createdAt: "2026-10-28T06:00:00Z", closingAt: inDays(60) }], NOW, TZ), // medium
      ...staleItems([{ opportunityId: "s1", title: "S", closingAt: inDays(3), staleLines: 1 }], NOW, TZ, 180), // medium
      ...supplierReplyItems([{ rfqId: "r1", ref: "RFQ-1", title: "R", respondBy: "2026-10-27", waiting: 1 }], NOW, TZ), // medium
      ...unpricedItems([{ opportunityId: "u1", title: "U", closingAt: inDays(2) }, { opportunityId: "u2", title: "U2", closingAt: inDays(1) }], NOW, TZ), // high
      ...bondItems([{ opportunityId: "b1", title: "B", expiry: "2026-11-02", closingAt: null }], NOW, TZ), // high
      ...decisionItems([{ opportunityId: "d-near", title: "Near", proposed: "go", createdAt: "2026-10-28T06:00:00Z", closingAt: inDays(4) }], NOW, TZ), // high
    ];
    const ranked = rankAttention(items);
    expect(ranked).toHaveLength(5);
    expect(ranked.map((a) => a.title)).toEqual([
      "Bid decision: Near", "Bid guarantee: B", "Not priced yet: U2", "Not priced yet: U", "Bid decision: Far",
    ]);
    expect(rankAttention(items, 10)).toHaveLength(7);
    expect(ranked[0]).not.toHaveProperty("urgency");
  });

  it("is empty with nothing to flag", () => {
    expect(rankAttention([])).toEqual([]);
  });
});

describe("BOQ price checks", () => {
  const line = (opportunityId: string, over: Partial<BoqPriceLine> = {}): BoqPriceLine => ({ opportunityId, priceSource: "supplier", priceAsOf: "2026-10-01", staleAccepted: false, removed: false, ...over });

  it("counts supplier and past-project prices older than the limit, per deal", () => {
    const m = staleLineCounts([
      line("o1", { priceAsOf: "2026-01-01" }), // 300 days
      line("o1", { priceSource: "past_project", priceAsOf: "2025-01-01" }),
      line("o1", { priceAsOf: "2026-10-01" }), // fresh
      line("o2", { priceAsOf: null }), // no date counts as stale
      line("o2", { priceSource: "manual", priceAsOf: "2020-01-01" }), // manual prices do not expire
      line("o2", { priceSource: "boq_rate", priceAsOf: "2020-01-01" }),
      line("o3", { priceAsOf: "2026-01-01", staleAccepted: true }), // chosen knowingly
      line("o3", { priceAsOf: "2026-01-01", removed: true }),
      line("o3", { priceSource: null, priceAsOf: null }),
    ], "2026-10-28", 180);
    expect([...m.entries()]).toEqual([["o1", 2], ["o2", 1]]);
  });

  it("follows the workspace's own limit", () => {
    expect(staleLineCounts([line("o1", { priceAsOf: "2026-08-01" })], "2026-10-28", 30).get("o1")).toBe(1);
    expect(staleLineCounts([line("o1", { priceAsOf: "2026-08-01" })], "2026-10-28", 180).get("o1")).toBeUndefined();
  });

  it("knows which deals have a priced line", () => {
    const ids = pricedDealIds([line("o1"), line("o2", { priceSource: null }), line("o3", { removed: true }), line("o4", { priceSource: "manual", priceAsOf: null })]);
    expect([...ids].sort()).toEqual(["o1", "o4"]);
  });

  it("selects the open pre-submission tenders ending within the window", () => {
    const rows = [
      tender({ id: "a", stage: "estimating", closingAt: inDays(2) }), tender({ id: "b", stage: "submitted", closingAt: inDays(2) }), tender({ id: "c", stage: "received", closingAt: inDays(20) }),
      tender({ id: "d", stage: "received", closingAt: inDays(-1) }), tender({ id: "e", stage: "bid_no_bid", closingAt: inDays(0) }), tender({ id: "f", stage: "received", outcome: "lost", closingAt: inDays(1) }),
    ];
    expect(dealsClosingWithin(rows, NOW, TZ, 3).map((t) => t.id)).toEqual(["a", "e"]);
  });

  it("selects open tenders with an unreleased guarantee that has an expiry", () => {
    const rows = [
      { ...tender({ id: "a" }), bondExpiry: "2026-11-05", bondReleased: false }, { ...tender({ id: "b" }), bondExpiry: "2026-11-05", bondReleased: true },
      { ...tender({ id: "c" }), bondExpiry: null, bondReleased: false }, { ...tender({ id: "d", outcome: "lost" }), bondExpiry: "2026-11-05", bondReleased: false },
    ];
    expect(dealsWithOpenGuarantee(rows).map((b) => b.opportunityId)).toEqual(["a"]);
  });
});

describe("composeTenderDesk", () => {
  const base: DeskInput = {
    now: NOW, timezone: TZ, currency: "SAR", pending: false, stageDefs: DEFAULT_TENDER_STAGES, tenders: [], projects: [],
    decisions: [], rfqWaits: [], bonds: [], stale: [], unpriced: [], validityDays: 180,
  };

  it("answers a pending database with the calm empty data and the flag set", () => {
    const d = composeTenderDesk({ ...base, pending: true, tenders: [tender()] });
    expect(d.pending).toBe(true);
    expect(d).toEqual(emptyTenderDesk({ now: NOW, currency: "SAR", pending: true }));
  });

  it("is complete and empty with no data at all", () => {
    const d = composeTenderDesk(base);
    expect(d.pending).toBe(false);
    expect(d.currency).toBe("SAR");
    expect(d.asOf).toBe(NOW.toISOString());
    expect(d.kpis.openCount).toBe(0);
    expect(d.stages).toHaveLength(5);
    expect(d.months).toHaveLength(12);
    expect(d.closing).toEqual([]);
    expect(d.clients).toEqual([]);
    expect(d.trend).toEqual([]);
    expect(d.buyout).toBeNull();
    expect(d.attention).toEqual([]);
  });

  it("builds every piece from the same rows", () => {
    const rows = [
      tender({ id: "o1", stage: "estimating", amount: 8_000_000, probability: 50, closingAt: inDays(2), clientName: "Ministry" }),
      tender({ id: "o2", stage: "received", amount: 2_000_000, probability: 10, closingAt: inDays(30), clientName: "Water Co" }),
      tender({ id: "o3", stage: "awarded", outcome: "won", closedAt: "2026-10-10T08:00:00Z" }),
    ];
    const d = composeTenderDesk({
      ...base, tenders: rows,
      decisions: [{ opportunityId: "o2", title: "Culverts", proposed: "go", createdAt: "2026-10-27T08:00:00Z", closingAt: inDays(30) }],
      unpriced: [{ opportunityId: "o1", title: "Storm", closingAt: inDays(2) }],
      projects: [{ id: "p1", name: "P", createdAt: "2026-10-11T00:00:00Z", packages: [{ name: "Pipes", budget: 100, best_quote: null, committed: 90 }] }],
    });
    expect(d.kpis).toMatchObject({ openValue: 10_000_000, openCount: 2, weightedValue: 4_200_000, closingSoonCount: 1, won12: 1, buyoutCommitted: 90, buyoutBudget: 100 });
    expect(d.closing.map((c) => c.id)).toEqual(["o1", "o2"]);
    expect(d.clients.map((c) => c.name)).toEqual(["Ministry", "Water Co"]);
    expect(d.attention.map((a) => a.kind)).toEqual(["closing_unpriced", "decision"]);
    expect(d.buyout?.projectId).toBe("p1");
    expect(d.trend[11].openValue).toBe(10_000_000);
  });

  it("drops attention items that belong to a tender that is no longer open", () => {
    const d = composeTenderDesk({
      ...base, tenders: [tender({ id: "gone", outcome: "lost", closedAt: "2026-10-20T08:00:00Z" })],
      decisions: [{ opportunityId: "gone", title: "X", proposed: "go", createdAt: "2026-10-27T08:00:00Z", closingAt: null }],
      bonds: [{ opportunityId: "gone", title: "X", expiry: "2026-11-01", closingAt: null }],
      stale: [{ opportunityId: "gone", title: "X", closingAt: inDays(2), staleLines: 2 }],
      unpriced: [{ opportunityId: "gone", title: "X", closingAt: inDays(1) }],
    });
    expect(d.attention).toEqual([]);
  });
});
