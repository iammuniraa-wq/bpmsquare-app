import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { href: string; children: unknown }) => createElement("a", rest, children as never),
}));

import TenderDesk from "./TenderDesk";
import BoldTiles from "./BoldTiles";
import ControlRoom from "./ControlRoom";
import { tenderDesk } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import { EMPTY_TENDER_DESK, type TenderDeskData } from "@/lib/tenderDesk/types";

// Both styles draw the same data. These are server renders of the real components from a sample; the layout rules (one column
// under 900 px, the vertical deadline list under 640 px) are CSS and are checked in the browser.

const STAGE_COLOURS = ["#64748b", "#8b5cf6", "#3b82f6", "#f59e0b", "#0ea5e9"];
const stage = (i: number, stageKey: string, label: string, count: number, value: number) => ({ stage: stageKey, label, color: STAGE_COLOURS[i], count, value });
const closing = (id: string, ref: string, title: string, client: string, daysLeft: number, value: number) => ({
  id, ref, title, client, closesAt: "2026-11-01", daysLeft, value, href: `/pipeline/${id}`,
});

const FULL: TenderDeskData = {
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
  months: ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((label, i) => ({ key: `m${i}`, label, won: [1, 1, 1, 2, 1, 2, 2, 1, 2, 1, 2, 2][i], lost: [1, 0, 2, 1, 2, 1, 2, 1, 1, 2, 1, 1][i] })),
  clients: [
    { accountId: "c1", name: "National Water Company", value: 34_300_000, count: 3 },
    { accountId: "c2", name: "Municipality Roads Authority", value: 19_100_000, count: 2 },
    { accountId: "c3", name: "Coastal Developments", value: 18_000_000, count: 2 },
    { accountId: "c4", name: "Ministry of Public Works", value: 11_500_000, count: 2 },
    { accountId: null, name: "Others", value: 9_700_000, count: 1 },
  ],
  trend: [61, 63, 62, 67, 71, 69, 75, 79, 77, 84, 87, 92.6].map((v, i) => ({ weekEnd: new Date(Date.UTC(2026, 7, 4 + i * 7)).toISOString().slice(0, 10), openValue: v * 1_000_000 })),
  buyout: {
    projectId: "p1", projectName: "Wadi crossing project", href: "/projects/p1/buyout",
    packages: [
      { name: "Pipes and fittings", budget: 4_200_000, bestQuote: 3_950_000, committed: 3_950_000, status: "awarded" },
      { name: "Precast chambers", budget: 2_800_000, bestQuote: 2_900_000, committed: null, status: "quotes in" },
      { name: "Valves and covers", budget: 900_000, bestQuote: null, committed: null, status: "waiting" },
    ],
  },
  attention: [
    { kind: "decision", title: "Decide bid or no-bid on TND-0017", sub: "Coastal outfall, 14.2M, closes in 6 days", action: "Decide", href: "/pipeline/a2", severity: "high" },
    { kind: "supplier_reply", title: "Two of four suppliers have not replied", sub: "RFQ for Package B", action: "Remind", href: "/rfq/r1", severity: "medium" },
    { kind: "stale_price", title: "Review price list used on TND-0030", sub: "4 BOQ lines priced from an old list", action: "Review", href: "/pipeline/a3", severity: "low" },
  ],
};

const EMPTY_LISTS: TenderDeskData = { ...FULL, stages: [], closing: [], months: [], clients: [], trend: [], buyout: null, attention: [] };
const NO_OPEN: TenderDeskData = { ...EMPTY_TENDER_DESK, kpis: { ...EMPTY_TENDER_DESK.kpis, openCount: 0 } };
const PENDING: TenderDeskData = { ...EMPTY_TENDER_DESK, pending: true };

const bold = (data: TenderDeskData, over: Partial<{ userName: string | null; greeting: string; dateLabel: string }> = {}) =>
  renderToString(createElement(BoldTiles, { data, userName: "Abdul", greeting: "Good afternoon", dateLabel: "Tuesday, 27 October 2026", ...over })).replace(/<!-- -->/g, "");
const control = (data: TenderDeskData) => renderToString(createElement(ControlRoom, { data, dateLabel: "Tuesday, 27 October 2026" })).replace(/<!-- -->/g, "");
const desk = (data: TenderDeskData, style: "bold" | "control") =>
  renderToString(createElement(TenderDesk, { data, style, userName: "Abdul", greeting: "Good afternoon", dateLabel: "Tuesday, 27 October 2026" })).replace(/<!-- -->/g, "");

const stringsOf = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(stringsOf) : []);
/** What is left of the markup once every theme token and every stage colour (tenant data) is taken out. */
const withoutTokens = (html: string) =>
  [...stringsOf(tenderDesk), ...STAGE_COLOURS].sort((a, b) => b.length - a.length).reduce((h, t) => h.split(t).join(""), html);

describe("Bold tiles", () => {
  const out = bold(FULL);

  it("greets by name and states the figures in one sentence", () => {
    expect(out).toContain("Good afternoon, Abdul");
    expect(out).toContain("Tuesday, 27 October 2026");
    expect(out).toContain("<b>SAR 92.6M</b>");
    expect(out).toContain("<b>10 tenders</b>");
    expect(out).toContain("<b>5 bids</b>");
    expect(out).toContain("<b>in 3 days</b>");
    expect(bold(FULL, { userName: null })).toContain("<h1>Good afternoon</h1>");
  });

  it("draws the five tiles with their headline figures", () => {
    for (const label of ["Open pipeline", "Weighted by chance", "Closing in 14 days", "Win rate, 12 months", "Buy-out committed"]) expect(out).toContain(label);
    expect(out).toContain(">92.6<small>M SAR</small>");
    expect(out).toContain(">26.2<small>M SAR</small>");
    expect(out).toContain(">5<small> bids</small>");
    expect(out).toContain(">55<small>%</small>");
    expect(out).toContain(">5.8<small>M SAR</small>");
    expect(out).toContain("10 open tenders");
    expect(out).toContain("56.5M SAR still to finish");
    expect(out).toContain("18 won, 15 lost");
    expect(out).toContain("59% of the package budget");
    expect(out).toContain("28% of the open value");
    expect((out.match(/data-guide="tender\.desk\.tile\./g) ?? []).length).toBe(5);
  });

  it("lists every stage with its value and count", () => {
    for (const row of ["Received", "Bid/No-bid", "Estimating", "Submitted", "Clarifications"]) expect(out).toContain(row);
    expect(out).toContain("<b>35.4M</b> (3)");
    expect(out).toContain("<b>9.7M</b> (1)");
  });

  it("lists the closing bids as links with a chip that says the days, soonest first", () => {
    expect(out).toContain('href="/pipeline/a1"');
    expect(out).toContain("Desalination feed pipeline");
    expect(out).toContain("TND-0022 · National Water Company");
    expect(out).toContain("3<small>days</small>");
    expect(out).toContain("20<small>days</small>");
    expect(out).toContain("18.5M");
    expect(out.indexOf("TND-0022")).toBeLessThan(out.indexOf("TND-0017"));
    expect((out.match(/data-guide="tender\.desk\.closing"/g) ?? []).length).toBe(6);
  });

  it("draws the won and lost chart with the figures in its label, and the client donut with a legend", () => {
    expect(out).toContain("Won and lost tenders by month. Nov 1 won, 1 lost;");
    expect(out).toContain("Oct 2 won, 1 lost.");
    expect(out).toContain("Open value by client, SAR. National Water Company 34.3M;");
    for (const name of ["National Water Company", "Municipality Roads Authority", "Coastal Developments", "Ministry of Public Works", "Others"]) expect(out).toContain(name);
    expect(out).toContain(">92.6M<");
    expect((out.match(/role="img"/g) ?? []).length).toBe(2);
  });

  it("draws the buy-out card with its packages, statuses and gaps, and links to the project", () => {
    expect(out).toContain("Buy-out against budget, Wadi crossing project");
    expect(out).toContain('href="/projects/p1/buyout"');
    for (const p of ["Pipes and fittings", "Precast chambers", "Valves and covers"]) expect(out).toContain(p);
    for (const status of ["Awarded", "Quotes in", "Waiting"]) expect(out).toContain(status);
    expect(out).toContain("0.25M under");
    expect(out).toContain("0.10M over");
    expect(out).toContain("no quote yet");
  });

  it("puts every explanation behind an i and prints none of it", () => {
    expect(out).toContain('aria-label="About Weighted by chance"');
    expect(out).not.toContain("added up");
    expect(out).not.toContain("The bar is the budget");
  });

  it("shows no 'needs you' list: that belongs to the Control room", () => {
    expect(out).not.toContain("Needs you today");
  });

  it("copes with every list empty: quiet lines, no crash, no buy-out card", () => {
    const e = bold(EMPTY_LISTS);
    expect(e).toContain("No open stages.");
    expect(e).toContain("No bid is waiting for its end date.");
    expect(e).toContain("No tender was decided in the last 12 months.");
    expect(e).toContain("No open value to show.");
    expect(e).not.toContain("Buy-out against budget");
  });

  it("with no open tender, points at the next step and still shows the tiles", () => {
    const e = bold(NO_OPEN);
    expect(e).toContain("No open tenders yet");
    expect(e).toContain(`href="${ROUTES.pipelineNewTender}"`);
    expect(e).toContain("No tenders are open right now.");
    expect(e).toContain("Nothing decided yet");
    expect(e).toContain("No buy-out packages yet");
    expect(e).not.toContain("Pipeline by stage");
  });

  it("with the tender tables missing, shows one calm card and no figures", () => {
    const e = bold(PENDING);
    expect(e).toContain("Tender data is not set up yet");
    expect(e).not.toContain("Open pipeline");
    expect(e).not.toContain("<h1>");
  });
});

describe("Control room", () => {
  const out = control(FULL);

  it("has a header with the date and the bids closing", () => {
    expect(out).toContain("Tender control room");
    expect(out).toContain("Tuesday, 27 October 2026 · 5 bids close within 14 days");
  });

  it("shows the open pipeline as one big number with the 12-week change", () => {
    expect(out).toContain("Open pipeline, last 12 weeks");
    expect(out).toContain(">92.6<small>M SAR</small>");
    expect(out).toContain("+31.6M since 4 Aug");
    expect(out).toContain("Open pipeline over the last 12 weeks, SAR: from 61.0M on 4 Aug to 92.6M on 20 Oct.");
  });

  it("shows the three health rings with their figures", () => {
    expect(out).toContain("Health");
    expect(out).toContain("Win rate, 12 months: 55%, 18 won and 15 lost");
    expect(out).toContain("Weighted by chance: 26.2M of 92.6M open");
    expect(out).toContain("Buy-out committed: 59% of the package budget");
  });

  it("shows the stage bar and its legend", () => {
    expect(out).toContain("Open pipeline by stage, SAR. Received 10.2M, 2 tenders;");
    expect(out).toContain("<b class=\"");
    for (const label of ["Received", "Bid/No-bid", "Estimating", "Submitted", "Clarifications"]) expect(out).toContain(label);
    expect(out).toContain("1 tender<");
  });

  it("places the bids inside 28 days on the timeline, with days in words, and counts the later ones", () => {
    expect((out.match(/data-guide="tender\.desk\.closing"/g) ?? []).length).toBe(5);
    expect(out).toContain("TND-0022 · 3 days");
    expect(out).toContain("TND-0014 · 20 days");
    expect(out).not.toContain("TND-0040 ·");
    expect(out).toContain("1 more bid ends after 28 days.");
    expect(out).toContain('href="/pipeline/a1"');
    expect(out).toContain("--x:10.7%");
    expect(out).toContain("+28 days");
  });

  it("lists what needs the person, most severe first, each with its action button", () => {
    expect(out).toContain("Needs you today");
    expect(out).toContain("Urgent: </span>Decide bid or no-bid on TND-0017");
    expect(out).toContain(">Decide<");
    expect(out).toContain('href="/pipeline/a2"');
    expect(out).toContain('aria-label="Remind: Two of four suppliers have not replied"');
    expect(out.indexOf("Urgent:")).toBeLessThan(out.indexOf("Soon:"));
    expect(out.indexOf("Soon:")).toBeLessThan(out.indexOf("When you can:"));
    expect((out.match(/data-guide="tender\.desk\.attention"/g) ?? []).length).toBe(3);
  });

  it("shows open value by client as bars", () => {
    expect(out).toContain("Open value by client");
    expect(out).toContain("National Water Company");
    expect(out).toContain(">34.3M<");
    expect(out).toContain("Others");
  });

  it("copes with every list empty", () => {
    const e = control(EMPTY_LISTS);
    expect(e).toContain("Not enough history yet to draw the trend.");
    expect(e).toContain("No open stages.");
    expect(e).toContain("No bid ends in the next 28 days.");
    expect(e).toContain("Nothing needs you today.");
    expect(e).toContain("No open value to show.");
  });

  it("with no open tender, points at the next step", () => {
    const e = control(NO_OPEN);
    expect(e).toContain("No open tenders yet");
    expect(e).toContain(`href="${ROUTES.pipelineNewTender}"`);
    expect(e).toContain("Buy-out committed: no packages yet");
    expect(e).toContain("Win rate, 12 months: nothing decided yet");
  });

  it("with the tender tables missing, shows one calm card and no figures", () => {
    const e = control(PENDING);
    expect(e).toContain("Tender data is not set up yet");
    expect(e).not.toContain("Health");
    expect(e).not.toContain("Open pipeline, last 12 weeks");
  });
});

describe("the Tender desk shell and its switch", () => {
  it("offers exactly two views as radios, marks the chosen one, and has no classic option", () => {
    const out = desk(FULL, "bold");
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-label="Home view"');
    expect((out.match(/role="radio"/g) ?? []).length).toBe(2);
    expect(out).toMatch(/aria-checked="true"[^>]*data-guide="tender\.desk\.switch\.bold"/);
    expect(out).toMatch(/aria-checked="false"[^>]*data-guide="tender\.desk\.switch\.control"/);
    expect(out).toContain("Bold tiles");
    expect(out).toContain("Control room");
    expect(out.toLowerCase()).not.toContain("classic");
    expect(out).toContain('data-guide="tender.desk.switch"');
  });

  it("draws the chosen style under the switch", () => {
    const b = desk(FULL, "bold");
    expect(b).toContain("Good afternoon, Abdul");
    expect(b).not.toContain("Tender control room");
    const c = desk(FULL, "control");
    expect(c).toContain("Tender control room");
    expect(c).not.toContain("Good afternoon, Abdul");
    expect(c).toMatch(/aria-checked="true"[^>]*data-guide="tender\.desk\.switch\.control"/);
  });

  it("keeps one h1 whichever style is shown", () => {
    expect((desk(FULL, "bold").match(/<h1/g) ?? []).length).toBe(1);
    expect((desk(FULL, "control").match(/<h1/g) ?? []).length).toBe(1);
  });
});

describe("colour lives in theme.ts only", () => {
  const renders: [string, string][] = [
    ["bold full", bold(FULL)], ["bold empty lists", bold(EMPTY_LISTS)], ["bold no open", bold(NO_OPEN)], ["bold pending", bold(PENDING)],
    ["control full", control(FULL)], ["control empty lists", control(EMPTY_LISTS)], ["control no open", control(NO_OPEN)], ["control pending", control(PENDING)],
    ["shell control", desk(FULL, "control")],
  ];
  for (const [name, html] of renders) {
    it(`${name}: no hex or rgb colour in the markup outside the theme tokens and the tenant's stage colours`, () => {
      const rest = withoutTokens(html);
      expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rest).not.toMatch(/\brgba?\(/);
    });
  }

  const dir = path.resolve(__dirname);
  for (const f of ["TenderDesk.tsx", "BoldTiles.tsx", "ControlRoom.tsx", "deskParts.tsx", "format.ts", "TenderDesk.module.css"]) {
    it(`${f} holds no colour literal`, () => {
      const text = readFileSync(path.join(dir, f), "utf8");
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text).not.toMatch(/\brgba?\(/);
    });
  }
});
