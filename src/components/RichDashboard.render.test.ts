import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { href: string; children: unknown }) => createElement("a", rest, children as never),
}));

import DashboardLayout from "./DashboardLayout";
import RichDashboard from "./RichDashboard";
import { TenantProvider } from "@/lib/tenant-context";
import { buildRichDashboard, bidRingPercent, stageWeights, type RichDashModel } from "@/lib/richDashboard";
import { FULL } from "./tenderDesk/testFixtures";
import { CURRENCIES } from "@/lib/currency";
import type { AnalyticsData } from "@/lib/data/labels";
import type { TenantFeatures } from "@/lib/constants";

// The Rich dashboard (step 2a): what it draws from the same data the classic dashboard gets, that it is only ever drawn for a Rich tenant, and
// that the classic dashboard (switches, Adapt, every card) stays reachable behind More.

const NOW = Date.parse("2026-11-05T10:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const analytics = (over: Partial<AnalyticsData> = {}): AnalyticsData => ({
  totals: { accounts: 4, contacts: 0, customerAssets: 0, openCases: 16, workOrders: 0, activeContracts: 0, leads: 0, technicians: 0, products: 0, openDeals: 3, openDealValue: 900_000, weightedDealValue: 0, openRfqs: 0, rfqsToAward: 0, draftEstimates: 0, quotedEstimates: 0, abmTargets: 0, abmEngaged: 0, draftOrders: 0, openOrders: 0, openOrderValue: 0 },
  casesByStatus: [], quoteTrend: [], topAccountsByRevenue: [], invoiceTotals: { invoiced: 500_000, paid: 260_000, outstanding: 240_960 }, tender: null,
  quotesByStatus: [
    { status: "draft", label: "Draft", count: 4, value: 1_000_000 },
    { status: "sent", label: "Sent", count: 9, value: 10_700_209 },
    { status: "approved", label: "Approved", count: 2, value: 5_000_000 },
  ],
  quoteOutcomeCounts: { open: 13, won: 6, lost: 6, dropped: 0 }, quoteOverdueCount: 2,
  ...over,
} as unknown as AnalyticsData);

const CRM = { quotations: true, cases: true, accounts: true, invoices: true, pipeline: true } as TenantFeatures;
const TENDER = { ...CRM, gcc_tender: true } as TenantFeatures;

const caseRow = (id: string, ref: string, daysAgo: number) => ({ serviceCase: { id, ref, intake_at: day(daysAgo) }, account: { name: "Acme" } });
const inv = (id: string, ref: string, daysLate: number) => ({ id, ref, due_date: day(daysLate), total: 1000, paid_amount: 0 });

const input = (over: Record<string, unknown> = {}) => ({
  features: CRM, analytics: analytics(), kpis: { openCases: 16, openQuoteValue: 0 }, attention: [], workOrderRows: [], overdueInvoices: [], now: NOW, ...over,
}) as Parameters<typeof buildRichDashboard>[0];

describe("the view-model, for a workspace with quotations", () => {
  const m = buildRichDashboard(input({ attention: [caseRow("c1", "C-1187", 6)], overdueInvoices: [inv("i1", "INV-2201", 12)] }));

  it("has the four hero numbers from the data already on the page", () => {
    expect(m.kpis.map((k) => k.key)).toEqual(["pipeline", "win", "unpaid", "cases"]);
    const by = Object.fromEntries(m.kpis.map((k) => [k.key, k]));
    expect(by.pipeline).toMatchObject({ label: "Open quotations", value: 11_700_209, sub: "13 quotations" });
    expect(by.win).toMatchObject({ value: 50, kind: "percent", sub: "of 12 decided" });
    expect(by.unpaid).toMatchObject({ value: 240_960, sub: "1 past due", subTone: "hot" });
    expect(by.cases).toMatchObject({ value: 16, sub: "1 waiting 3+ days" });
  });

  it("draws the open stages only, in the tenant's order, with the total of exactly those", () => {
    expect(m.pipeline?.stages.map((s) => s.label)).toEqual(["Draft", "Sent"]);
    expect(m.pipeline?.total).toBe(11_700_209);
    expect(m.pipeline?.stages.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(100, 0);
  });

  it("ranks what needs the person and counts all of it, drawing at most three", () => {
    const big = buildRichDashboard(input({ attention: [caseRow("c1", "C-1", 9), caseRow("c2", "C-2", 5)], overdueInvoices: [inv("i1", "INV-1", 12), inv("i2", "INV-2", 3)] }));
    expect(big.attention).toHaveLength(3);
    expect(big.attention[0].text).toBe("Invoice INV-1 is 12 days late");
    expect(big.attentionTotal).toBe(5);
    expect(big.attention.every((a) => a.href.startsWith("/"))).toBe(true);
    expect(big.bids).toBeNull();
  });

  it("leaves out what the workspace did not buy", () => {
    const small = buildRichDashboard(input({ features: { accounts: true } as TenantFeatures }));
    expect(small.kpis).toEqual([]);
    expect(small.pipeline).toBeNull();
    expect(small.attention).toEqual([]);
  });

  it("falls back to the open-deal total, with no stage picture, when there are no quotations", () => {
    const deals = buildRichDashboard(input({ features: { pipeline: true } as TenantFeatures }));
    expect(deals.kpis[0]).toMatchObject({ label: "Open pipeline", value: 900_000, sub: "3 deals" });
    expect(deals.pipeline).toBeNull();
  });
});

describe("the view-model, for a workspace with the tender edition", () => {
  const m = buildRichDashboard(input({ features: TENDER, analytics: analytics({ tender: FULL }) }));

  it("takes pipeline and win rate from the tenders", () => {
    expect(m.kpis[0]).toMatchObject({ label: "Open pipeline", value: 92_600_000, sub: "10 tenders" });
    expect(m.kpis[1]).toMatchObject({ value: 55, sub: "18 won, 15 lost" });
    expect(m.pipeline?.stages.map((s) => s.label)).toEqual(["Received", "Bid/No-bid", "Estimating", "Submitted", "Clarifications"]);
    expect(m.pipeline?.stages[0].href).toBe("/pipeline?tab=tenders&stage=received");
  });

  it("shows the three bids closing soonest with a ring that fills as the day nears", () => {
    expect(m.bids?.map((b) => b.daysLeft)).toEqual([3, 6, 9]);
    expect(m.bids?.[0]).toMatchObject({ tone: "warm", pct: bidRingPercent(3) });
    expect(m.bids?.[2].tone).toBe("violet");
    expect(bidRingPercent(0)).toBe(100);
    expect(bidRingPercent(28)).toBe(6);
    expect(bidRingPercent(400)).toBe(6);
  });

  it("brings the tender attention items in first when they are urgent", () => {
    expect(m.attention[0].text).toBe("Decide bid or no-bid on TND-0017");
  });

  it("falls back to quotations, and draws no bids, when the tender data could not be read", () => {
    const none = buildRichDashboard(input({ features: TENDER, analytics: analytics({ tender: null }) }));
    expect(none.bids).toBeNull();
    expect(none.kpis[0].label).toBe("Open quotations");
  });

  it("keeps a thin stage tappable", () => {
    const w = stageWeights([{ count: 1, value: 1 }, { count: 50, value: 999 }]);
    expect(w[0]).toBeGreaterThanOrEqual(9);
    expect(w[0] + w[1]).toBeCloseTo(100, 0);
  });
});

const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const cur = CURRENCIES.INR;
const model: RichDashModel = buildRichDashboard(input({ features: TENDER, analytics: analytics({ tender: FULL }), attention: [caseRow("c1", "C-1187", 6)] }));
const rich = (over: Record<string, unknown> = {}) =>
  html(createElement(RichDashboard, { greeting: "Good evening", userName: "Abdul", dateLabel: "Thursday", model, cur, more: createElement("p", null, "CLASSIC-BODY"), ...over }));

describe("the Rich dashboard screen", () => {
  const out = rich();

  it("opens with the greeting, one sentence, and a Customise pill", () => {
    expect(out).toContain("Good evening, Abdul");
    expect(out).toMatch(/\d+ things need you today\.|One thing needs you today\./);
    expect(out).toContain(">Customise<");
    expect(out.indexOf("Good evening")).toBeLessThan(out.indexOf('aria-label="Key numbers"'));
  });

  it("draws the hero numbers as links with the figure in the label", () => {
    expect(out).toContain('aria-label="Key numbers"');
    expect(out).toMatch(/aria-label="Open pipeline: ₹9,26,00,000, 10 tenders"/);
    expect(out).toContain('href="/pipeline?tab=tenders"');
  });

  it("draws the pipeline flow, the attention strip and three bid cards, in that order", () => {
    const at = (s: string) => out.indexOf(s);
    const order = ['aria-label="Key numbers"', 'data-guide="dashboard.rich.pipeline"', 'data-guide="dashboard.rich.attention"', 'data-guide="dashboard.rich.bids"'];
    order.forEach((s) => expect(at(s)).toBeGreaterThan(-1));
    expect([...order.map(at)].sort((a, b) => a - b)).toEqual(order.map(at));
    expect((out.match(/class="rd-bid"/g) ?? []).length).toBe(3);
    expect(out).toContain("rich-ring");
    expect(out).toContain("rich-photo");
    expect(out).toContain("About Bids closing soonest");
  });

  it("keeps the classic dashboard behind More: closed on first paint, not mounted, reachable by Customise", () => {
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('aria-controls="rd-more-body"');
    expect(out).toContain('aria-controls="rd-more"');
    expect(out).not.toContain("CLASSIC-BODY");
  });

  it("has a calm empty state for each part instead of a blank", () => {
    const empty = rich({ model: { kpis: [], pipeline: { title: "Pipeline", noun: "tender", total: 0, count: 0, stages: [], emptyText: "No open tenders yet.", emptyAction: "Open the pipeline", emptyHref: "/pipeline" }, attention: [], attentionTotal: 0, bids: [] } });
    expect(empty).toContain("You are all caught up.");
    expect(empty).toContain("No open tenders yet.");
    expect(empty).toContain("Nothing is waiting on you.");
    expect(empty).toContain("No bid is closing in the next few weeks.");
  });

  it("uses no hard-coded colour", () => {
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("only a Rich workspace gets it", () => {
  const props = {
    kpis: { openCases: 0, inRepair: 0, awaitingApproval: 0, activeContracts: 0, openQuoteValue: 0, activeWorkOrders: 0 },
    attention: [], readyCases: [], workOrderRows: [], recentActivity: [], overdueInvoices: [],
    analytics: analytics(), features: CRM, dashLayout: [], isAdmin: true, hasPersonalOverride: false, userName: "Abdul",
  };
  const inTenant = (appearance: Record<string, unknown>, flags: Record<string, unknown>) =>
    html(createElement(TenantProvider, {
      tenant: { id: "t", slug: "s", name: "S", features: flags, config: { appearance } } as never, userRole: "admin", children: createElement(DashboardLayout, props as never),
    }));

  it("a Rich workspace sees the new dashboard", () => {
    const out = inTenant({ ui_theme: "nextgen2", rich_ui: true }, { ...CRM, next_experience: true });
    expect(out).toContain('data-guide="dashboard.rich"');
    expect(out).toContain("Abdul");
  });

  it("every other workspace sees the dashboard it always had", () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ ui_theme: "nextgen2", rich_ui: true }, {}],                       // switch left over, flag removed
      [{ ui_theme: "nextgen2" }, { next_experience: true }],                // Nova without the Rich switch
      [{ ui_theme: "nextgen", rich_ui: true }, { next_experience: true }],  // not on Nova
    ];
    for (const [appearance, flags] of cases) {
      const out = inTenant(appearance, flags);
      expect(out).not.toContain("dashboard.rich");
      expect(out).not.toContain('class="rd');
      expect(out).toContain("Curated");
      expect(out).toContain("Adapt dashboard");
    }
    expect(html(createElement(DashboardLayout, props as never))).not.toContain("dashboard.rich");
  });
});
