import { EMPTY_TENDER_DESK, type TenderDeskData } from "@/lib/tenderDesk/types";

// Sample data for the tender blocks: the render tests and the temporary visual-check route use it. Not imported by the app.

export const STAGE_COLOURS = ["#64748b", "#8b5cf6", "#3b82f6", "#f59e0b", "#0ea5e9"];
const stage = (i: number, stageKey: string, label: string, count: number, value: number) => ({ stage: stageKey, label, color: STAGE_COLOURS[i], count, value });
const closing = (id: string, ref: string, title: string, client: string, daysLeft: number, value: number) => ({
  id, ref, title, client, closesAt: "2026-11-01", daysLeft, value, href: `/pipeline/${id}`,
});

export const FULL: TenderDeskData = {
  currency: "SAR",
  asOf: "2026-10-27T10:00:00.000Z",
  pending: false,
  kpis: {
    openValue: 92_600_000, openCount: 10, weightedValue: 26_200_000, closingSoonCount: 5, closingSoonValue: 56_500_000,
    winRate: 0.55, won12: 18, lost12: 15, buyoutCommitted: 5_800_000, buyoutBudget: 9_800_000,
  },
  stages: [
    stage(0, "received", "Received", 2, 10_200_000), stage(1, "bid_no_bid", "Bid/No-bid", 2, 21_100_000), stage(2, "estimating", "Estimating", 3, 35_400_000),
    stage(3, "submitted", "Submitted", 2, 16_200_000), stage(4, "clarifications", "Clarifications", 1, 9_700_000),
  ],
  closing: [
    closing("a1", "TND-0022", "Desalination feed pipeline", "National Water Company", 3, 18_500_000),
    closing("a2", "TND-0017", "Coastal outfall and pumping", "Coastal Developments", 6, 14_200_000),
    closing("a3", "TND-0030", "Reservoir inlet works", "Ministry of Public Works", 9, 5_100_000),
    closing("a4", "TND-0021", "Pipeline and culverts, Package B", "Municipality Roads Authority", 12, 11_800_000),
    closing("a5", "TND-0014", "Storm water Phase 1", "National Water Company", 20, 6_400_000),
    closing("a6", "TND-0040", "Far off lining works", "Eastern Industrial Authority", 40, 3_000_000),
  ],
  closingAfter28: 1,
  months: ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((label, i) => ({
    key: `${i < 2 ? 2025 : 2026}-${String(((i + 10) % 12) + 1).padStart(2, "0")}`, label,
    won: [1, 1, 1, 2, 1, 2, 2, 1, 2, 1, 2, 2][i], lost: [1, 0, 2, 1, 2, 1, 2, 1, 1, 2, 1, 1][i],
  })),
  clients: [
    { accountId: "c1000000-0000-0000-0000-000000000001", name: "National Water Company", value: 34_300_000, count: 3 },
    { accountId: "c1000000-0000-0000-0000-000000000002", name: "Municipality Roads Authority", value: 19_100_000, count: 2 },
    { accountId: "c1000000-0000-0000-0000-000000000003", name: "Coastal Developments", value: 18_000_000, count: 2 },
    { accountId: "c1000000-0000-0000-0000-000000000004", name: "Ministry of Public Works", value: 11_500_000, count: 2 },
    { accountId: null, name: "Others", value: 9_700_000, count: 1 },
  ],
  trend: [61, 63, 62, 67, 71, 69, 75, 79, 77, 84, 87, 92.6].map((v, i) => ({ weekEnd: new Date(Date.UTC(2026, 7, 4 + i * 7)).toISOString().slice(0, 10), openValue: v * 1_000_000 })),
  buyout: {
    projectId: "p1", projectName: "Wadi crossing project", href: "/contract-projects/p1",
    packages: [
      { name: "Pipes and fittings", budget: 4_200_000, bestQuote: 3_950_000, committed: 3_950_000, status: "awarded" },
      { name: "Precast chambers", budget: 2_800_000, bestQuote: 2_900_000, committed: null, status: "quotes in" },
      { name: "Valves and covers", budget: 900_000, bestQuote: null, committed: null, status: "waiting" },
    ],
  },
  attention: [
    { kind: "decision", title: "Decide bid or no-bid on TND-0017", sub: "Coastal outfall, 14.2M, closes in 6 days", action: "Decide", href: "/pipeline/a2", severity: "high" },
    { kind: "supplier_reply", title: "Two of four suppliers have not replied", sub: "RFQ for Package B", action: "Remind", href: "/rfqs/r1", severity: "medium" },
    { kind: "stale_price", title: "Review price list used on TND-0030", sub: "4 BOQ lines priced from an old list", action: "Review", href: "/pipeline/a3", severity: "low" },
  ],
};

export const EMPTY_LISTS: TenderDeskData = { ...FULL, stages: [], closing: [], months: [], clients: [], trend: [], buyout: null, attention: [] };
export const NO_OPEN: TenderDeskData = { ...EMPTY_TENDER_DESK, kpis: { ...EMPTY_TENDER_DESK.kpis, openCount: 0 } };
export const PENDING: TenderDeskData = { ...EMPTY_TENDER_DESK, pending: true };
