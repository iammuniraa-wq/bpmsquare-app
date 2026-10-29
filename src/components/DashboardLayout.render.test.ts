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
import { DashLookScope } from "./tenderDesk/DashLook";
import { dashLookCss } from "./tenderDesk/dashLookCss";
import { TENDER_BLOCKS } from "@/lib/dashboardBlocks";
import type { AnalyticsData } from "@/lib/data/labels";
import type { DashLayoutItem, TenantFeatures } from "@/lib/constants";
import { FULL } from "./tenderDesk/testFixtures";
import { dashLook } from "@/lib/theme";

// The dashboard as one screen: what a workspace without the tender edition sees (nothing new), and what one with it sees (the tender blocks as
// ordinary dashboard blocks, the look switch, and the dark look scoped to the page that asked for it).

const analytics = (tender: AnalyticsData["tender"]): AnalyticsData => ({
  totals: { accounts: 4, contacts: 0, customerAssets: 0, openCases: 0, workOrders: 0, activeContracts: 0, leads: 0, technicians: 0, products: 0, openDeals: 0, openDealValue: 0, weightedDealValue: 0, openRfqs: 0, rfqsToAward: 0, draftEstimates: 0, quotedEstimates: 0, abmTargets: 0, abmEngaged: 0, draftOrders: 0, openOrders: 0, openOrderValue: 0 },
  casesByStatus: [], quoteTrend: [], topAccountsByRevenue: [], invoiceTotals: { invoiced: 0, paid: 0, outstanding: 0 }, tender,
} as unknown as AnalyticsData);

const CRM = { quotations: true, cases: true, accounts: true, work_orders: true, pipeline: true } as TenantFeatures;
const TENDER = { ...CRM, gcc_tender: true, pipeline: true, contract_projects: true } as TenantFeatures;

type Over = Partial<Parameters<typeof DashboardLayout>[0]>;
const dash = (over: Over = {}) =>
  renderToString(createElement(DashboardLayout, {
    kpis: { openCases: 0, inRepair: 0, awaitingApproval: 0, activeContracts: 0, openQuoteValue: 0, activeWorkOrders: 0 },
    attention: [], readyCases: [], workOrderRows: [], recentActivity: [], overdueInvoices: [],
    analytics: analytics(null), features: CRM, dashLayout: [], isAdmin: true, hasPersonalOverride: false, userName: "Abdul",
    ...over,
  })).replace(/<!-- -->/g, "");

const NEW_THINGS = ["data-dash-look", "Dashboard look", "tender.dash", "tender_", "bpm_tender", "Control room", "Tender desk", "Tender control room"];

describe("a workspace without the tender edition", () => {
  const plain = dash();

  it("renders the dashboard it always had: the greeting, the Curated | My layout switch, Adapt, and none of the tender additions", () => {
    expect(plain).toContain("Abdul");
    expect(plain).toContain("Curated");
    expect(plain).toContain("My layout");
    expect(plain).toContain("Adapt dashboard");
    for (const s of NEW_THINGS) expect(plain).not.toContain(s);
    expect(plain).not.toContain("<style data-dash-look");
  });

  it("is identical whether the page passes no look or null", () => {
    expect(dash({ tenderLook: null })).toBe(plain);
    expect(dash({ tenderLook: undefined })).toBe(plain);
  });

  it("shows no tender block even if the analytics hold tender data or the saved layout names one", () => {
    const withData = dash({ analytics: analytics(FULL), dashLayout: [{ id: "tender_open_pipeline" }, { id: "tender_by_stage" }, { id: "overview_strip" }] });
    for (const s of ["tender.dash", "Weighted by chance", "Pipeline by stage", "92.6", "Bids closing soonest"]) expect(withData).not.toContain(s);
  });
});

describe("a workspace with the tender edition, Bold look", () => {
  const out = dash({ features: TENDER, analytics: analytics(FULL), tenderLook: "bold" });

  it("is the same dashboard: the greeting header stays, with Curated | My layout and Adapt", () => {
    expect(out).toContain("Abdul");
    expect(out).toContain("Curated");
    expect(out).toContain("My layout");
    expect(out).toContain("Adapt dashboard");
  });

  it("has no 'Tender desk' or 'Tender control room' heading anywhere", () => {
    expect(out).not.toContain("Tender desk");
    expect(out).not.toContain("Tender control room");
    expect(out.toLowerCase()).not.toContain("tender desk");
  });

  it("opens on the tender blocks in order: five tiles, stage and closing, won/lost and clients, attention and trend, deadlines, buy-out", () => {
    const at = (needle: string) => out.indexOf(needle);
    const order = [
      'data-guide="tender.dash.tile.pipeline"', 'data-guide="tender.dash.tile.weighted"', 'data-guide="tender.dash.tile.closing"', 'data-guide="tender.dash.tile.win"',
      'data-guide="tender.dash.tile.buyout"', 'data-guide="tender.dash.stages"', 'data-guide="tender.dash.closing"', 'data-guide="tender.dash.wonlost"',
      'data-guide="tender.dash.clients"', 'data-guide="tender.dash.attention"', 'data-guide="tender.dash.trend"', 'data-guide="tender.dash.deadlines"', 'data-guide="tender.dash.buyout"',
    ];
    const positions = order.map(at);
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // the usual blocks follow
    expect(at("Case resolution")).toBeGreaterThan(positions[positions.length - 1]);
  });

  it("offers the look switch, Bold chosen, next to Curated | My layout, and sets no dark marker or style", () => {
    expect(out).toContain('role="radiogroup" aria-label="Dashboard look"');
    expect(out).toMatch(/aria-checked="true"[^>]*data-guide="tender\.dash\.look\.bold"/);
    expect(out).toMatch(/aria-checked="false"[^>]*data-guide="tender\.dash\.look\.control"/);
    expect(out).toContain(">Control room<");
    expect(out.indexOf("Curated")).toBeLessThan(out.indexOf('aria-label="Dashboard look"'));
    expect(out.indexOf('aria-label="Dashboard look"')).toBeLessThan(out.indexOf("Adapt dashboard"));
    expect(out).not.toContain("data-dash-look=");
    expect(out).not.toContain("data-dash-look-style");
    expect(out).not.toContain("--app-bg");
  });

  it("draws the five tiles as links with their figures", () => {
    for (const label of ["Open pipeline", "Weighted by chance", "Closing in 14 days", "Win rate, 12 months", "Buy-out committed"]) expect(out).toContain(label);
    expect(out).toContain('aria-label="Open pipeline: 92.6M SAR, 10 open tenders"');
    expect(out).toContain('href="/pipeline?tab=tenders&amp;closing=14"');
  });

  it("saved layouts from before the tender blocks lead with them; a layout that already names them is kept", () => {
    const before = dash({ features: TENDER, analytics: analytics(FULL), tenderLook: "bold", dashLayout: [{ id: "overview_strip" }] });
    expect(before.indexOf('data-guide="tender.dash.tile.pipeline"')).toBeGreaterThan(-1);
    expect(before.indexOf('data-guide="tender.dash.tile.pipeline"')).toBeLessThan(before.indexOf("Case resolution"));
    const own: DashLayoutItem[] = [{ id: "tender_by_stage", size: "full" }, { id: "tender_open_pipeline", hidden: true }];
    const kept = dash({ features: TENDER, analytics: analytics(FULL), tenderLook: "bold", dashLayout: own });
    expect(kept).toContain('data-guide="tender.dash.stages"');
    expect(kept).not.toContain('data-guide="tender.dash.tile.pipeline"');
    expect(kept).not.toContain('data-guide="tender.dash.trend"');
  });

  it("every block can be hidden: a layout with all of them hidden draws none", () => {
    const hidden = dash({ features: TENDER, analytics: analytics(FULL), tenderLook: "bold", dashLayout: TENDER_BLOCKS.map((b) => ({ id: b.id, hidden: true })) });
    expect(hidden).not.toContain("tender.dash.tile");
    expect(hidden).not.toContain("tender.dash.stages");
  });

  it("copes with the tender data being unavailable: the dashboard stands and the cards say so", () => {
    const none = dash({ features: TENDER, analytics: analytics(null), tenderLook: "bold" });
    expect(none).toContain("Tender data could not be read just now");
    expect(none).toContain("Abdul");
    expect(none).toContain('aria-label="Open pipeline: —, Not available right now"');
  });
});

describe("a workspace with the tender edition, Control room look", () => {
  const out = dash({ features: TENDER, analytics: analytics(FULL), tenderLook: "control" });

  it("marks the page and carries the dark style in the server render, so the first paint is already dark", () => {
    expect(out).toContain('data-dash-look="control"');
    expect(out).toContain("<style data-dash-look-style");
    expect(out).toContain("--app-bg:");
    expect(out).toMatch(/aria-checked="true"[^>]*data-guide="tender\.dash\.look\.control"/);
    expect(out).toContain('data-guide="tender.dash.tile.pipeline"');
    expect(out).not.toContain("Tender control room");
  });

  it("the marker and the style are the only things that make it dark, and they are in the dashboard component (not in a shared stylesheet)", () => {
    expect((out.match(/data-dash-look="control"/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(dash({ features: TENDER, analytics: analytics(FULL), tenderLook: "bold" })).not.toContain('data-dash-look="control"');
  });
});

describe("the dark look is scoped to the dashboard", () => {
  const html = (look: "bold" | "control" | null) => renderToString(createElement(DashLookScope, { look })).replace(/<!-- -->/g, "");

  it("renders nothing for Bold or for a workspace without the edition", () => {
    expect(html("bold")).toBe("");
    expect(html(null)).toBe("");
  });

  it("renders a marker and a style for Control room; both leave the page with the component", () => {
    const out = html("control");
    expect(out).toMatch(/^<style data-dash-look-style="">/);
    expect(out).toContain('<span hidden="" data-dash-look="control"></span>');
  });

  it("the style only ever reaches the shell inside the page: every rule starts at the themed shell element, and none names body, html or :root", () => {
    const css = dashLookCss();
    const rules = css.split("\n");
    expect(rules.length).toBeGreaterThanOrEqual(8);
    for (const rule of rules) {
      expect(rule.startsWith("[data-theme][data-theme][data-theme]")).toBe(true);
      expect(rule).not.toMatch(/(^|[\s,])(body|html|:root)\b/);
    }
  });

  it("darkens the shell behind the panel, the panel itself and the neutral tokens inside it, with and without :has()", () => {
    const css = dashLookCss();
    for (const scope of ['[data-theme]:has([data-dash-look="control"])', '[data-theme][data-dash-look="control"]']) {
      expect(css).toContain(`${scope}{--app-bg:${dashLook.shell} !important;`);
      expect(css).toContain(`${scope} .bpm-main{`);
      expect(css).toContain(`${scope}[data-spectacular="true"] .bpm-main{background:${dashLook.sheet} !important;}`);
    }
    for (const token of ["--ink", "--muted", "--line", "--card-bg", "--panel2", "--bluebg", "--ledger-accent", "--ledger-warn"]) expect(css).toContain(`${token}:`);
    expect(css).toContain("background-image:none !important");
  });
});

describe("the Weighted tile on the Pipeline card", () => {
  it("explains itself behind an i, outside the link", () => {
    const out = dash({ features: CRM, dashLayout: [{ id: "pipeline_open_value" }] });
    expect(out).toContain("About Weighted");
    expect(out).toMatch(/Weighted<\/span><button[^>]*aria-label="About Weighted"/);
  });
});
