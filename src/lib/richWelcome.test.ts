import { describe, expect, it } from "vitest";
import type { AnalyticsData } from "@/lib/data/labels";
import { buildWelcome, isFreshWorkspace } from "./richWelcome";

const totals = { accounts: 0, contacts: 0, customerAssets: 0, openCases: 0, workOrders: 0, activeContracts: 0, leads: 0, technicians: 0, products: 0, openDeals: 0, openDealValue: 0, weightedDealValue: 0, openRfqs: 0, rfqsToAward: 0, draftEstimates: 0, quotedEstimates: 0, abmTargets: 0, abmEngaged: 0, draftOrders: 0, openOrders: 0, openOrderValue: 0 };
const data = (over: Partial<AnalyticsData> = {}): AnalyticsData => ({
  totals, quotesByStatus: [], invoiceTotals: { invoiced: 0, paid: 0, outstanding: 0 }, tender: null,
  wfmWorkforceComposition: { totalActive: 0, supervisors: 0, fullTime: 0, contractors: 0 }, ...over,
} as unknown as AnalyticsData);

describe("the first-steps screen of a new workspace", () => {
  it("is fresh only when there is nothing at all", () => {
    expect(isFreshWorkspace(data())).toBe(true);
    expect(isFreshWorkspace(data({ totals: { ...totals, accounts: 1 } }))).toBe(false);
    expect(isFreshWorkspace(data({ quotesByStatus: [{ status: "draft", label: "Draft", count: 2, value: 0 }] }))).toBe(false);
    expect(isFreshWorkspace(data({ wfmWorkforceComposition: { totalActive: 3, supervisors: 0, fullTime: 3, contractors: 0 } }))).toBe(false);
  });

  it("offers the common steps plus the first records of the modules the client has, at most two", () => {
    const w = buildWelcome({ features: { accounts: true, quotations: true, cases: true }, analytics: data(), hasLogo: false, teamCount: 1 });
    expect(w.fresh).toBe(true);
    expect(w.steps.map((s) => s.key)).toEqual(["profile", "data", "team", "account", "quote"]);
    expect(w.doneCount).toBe(0);
  });

  it("ticks the steps that can be told from the workspace", () => {
    const w = buildWelcome({ features: { wfm: true }, analytics: data(), hasLogo: true, teamCount: 4 });
    expect(w.steps.find((s) => s.key === "profile")?.done).toBe(true);
    expect(w.steps.find((s) => s.key === "team")?.done).toBe(true);
    expect(w.steps.find((s) => s.key === "workforce")).toBeTruthy();
    expect(w.doneCount).toBe(2);
  });

  it("reads an uncounted team as not done, and a client with data as past the data steps", () => {
    const w = buildWelcome({ features: { accounts: true }, analytics: data({ totals: { ...totals, accounts: 5 } }), hasLogo: false, teamCount: null });
    expect(w.fresh).toBe(false);
    expect(w.steps.find((s) => s.key === "team")?.done).toBe(false);
    expect(w.steps.find((s) => s.key === "data")?.done).toBe(true);
  });
});
