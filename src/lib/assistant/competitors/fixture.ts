import type { AnalysisInput, CompetitorInput, DealInput, PastTender } from "./compute";

// A small, hand-checkable workspace for the tests: twelve decided tenders (five won, seven lost) whose margins add up to 120, so
// their mean is exactly 10, three competitors with different patterns, and two open tenders. Not a test file.

const bid = (b: number, margin: number) => ({ ourBid: b, ourCost: Math.round(b * (1 - margin / 100) * 100) / 100 });

export const ALPHA = "Alpha Builders";
export const BETA = "Beta Contracting";
export const GAMMA = "Gamma Works";

export const WON: PastTender[] = [
  { outcome: "won", currency: "SAR", ...bid(1000, 6), awardValue: null, winner: null, competitors: [ALPHA, BETA] },
  { outcome: "won", currency: "SAR", ...bid(1000, 7), awardValue: null, winner: null, competitors: [ALPHA] },
  { outcome: "won", currency: "SAR", ...bid(1000, 8), awardValue: null, winner: null, competitors: [BETA] },
  { outcome: "won", currency: "SAR", ...bid(1000, 9), awardValue: null, winner: null, competitors: [ALPHA] },
  { outcome: "won", currency: "SAR", ...bid(1000, 10), awardValue: null, winner: null, competitors: [] },
];

export const LOST: PastTender[] = [
  { outcome: "lost", currency: "SAR", ...bid(1050, 8), awardValue: 1000, winner: ALPHA, competitors: [ALPHA, BETA] },
  { outcome: "lost", currency: "SAR", ...bid(1080, 9), awardValue: 1000, winner: ALPHA, competitors: [ALPHA] },
  { outcome: "lost", currency: "SAR", ...bid(1020, 10), awardValue: 1000, winner: ALPHA, competitors: [ALPHA] },
  { outcome: "lost", currency: "SAR", ...bid(1000, 11), awardValue: 940, winner: BETA, competitors: [BETA] },
  { outcome: "lost", currency: "SAR", ...bid(1000, 12), awardValue: 960, winner: BETA, competitors: [BETA, ALPHA] },
  { outcome: "lost", currency: "SAR", ...bid(1000, 14), awardValue: null, winner: BETA, competitors: [BETA] },
  { outcome: "lost", currency: "SAR", ...bid(1000, 16), awardValue: null, winner: "Delta Co", competitors: [] },
];

export const OPEN: PastTender[] = [
  { outcome: "open", currency: "SAR", ourBid: null, ourCost: null, awardValue: null, winner: null, competitors: [ALPHA, GAMMA] },
  { outcome: "open", currency: "SAR", ourBid: null, ourCost: null, awardValue: null, winner: null, competitors: [ALPHA] },
];

export const DEAL: DealInput = {
  ref: "OPP-0034", title: "Riyadh precast package", href: "/pipeline/11111111-aaaa-4aaa-8aaa-000000000034", closingAt: "2026-12-03T12:00:00.000Z",
  currency: "SAR", price: 2_000_000, cost: 1_800_000, costedAmount: 2_000_000, costedLines: 10, totalLines: 10, state: "open",
};

export const COMPETITORS: CompetitorInput[] = [
  { name: ALPHA, country: "Saudi Arabia", expectedPrice: "lower", evidence: {
    facts: [{ text: "Won a SAR 90 m precast housing package in 2026.", kind: "award", source_url: "https://example.com/a" }, { text: "Founded 1998.", kind: "profile", source_url: "https://example.com/b" }],
    price: null, wins: null, researchedAt: "2026-10-01T00:00:00.000Z",
  } },
  { name: BETA, country: null, expectedPrice: "similar", evidence: null },
  { name: GAMMA, country: "UAE", expectedPrice: null, evidence: null },
];

export const NOW = new Date("2026-11-26T09:00:00.000Z");

export function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return { deal: DEAL, competitors: COMPETITORS, past: [...WON, ...LOST, ...OPEN], proposed: 0, focus: null, costVisible: true, now: NOW, ...over };
}
