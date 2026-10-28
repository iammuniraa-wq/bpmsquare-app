import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
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

import { tenderBlockSpec } from "./TenderBlocks";
import { tileFigures, TILE_KINDS, joinFigure } from "./TenderTiles";
import { clientHref, clientSlices } from "./ClientDonut";
import { tenderDesk, dashLook } from "@/lib/theme";
import { ROUTES, type AnalyticsMetricId } from "@/lib/constants";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { TENDER_BLOCKS } from "@/lib/dashboardBlocks";
import { EMPTY_LISTS, FULL, NO_OPEN, PENDING, STAGE_COLOURS } from "./testFixtures";

// The tender blocks are drawn from the data slice and a look, server-rendered here from fixtures. The layout rules (one column under 900 px, the
// vertical deadline list under 640 px) are CSS and are checked in the browser.

const ID = (n: string) => n as AnalyticsMetricId;
const LOOKS: TenderDeskStyle[] = ["bold", "control"];

function render(node: ReactNode): string {
  return renderToString(createElement("div", null, node)).replace(/<!-- -->/g, "");
}
/** A block as the dashboard draws it: a tile alone, or a titled card (title, "i" and body). */
function block(id: string, data: TenderDeskData | null, look: TenderDeskStyle = "bold"): string {
  const spec = tenderBlockSpec(ID(id), data, look);
  if (!spec) throw new Error(`no block ${id}`);
  return render(spec.kind === "tile" ? spec.node : createElement("section", null, createElement("h2", null, spec.title), spec.body));
}
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

const TAB = "/pipeline?tab=tenders";

describe("the five tiles", () => {
  it("state the same figures and sub-lines the Bold tiles always had", () => {
    const f = Object.fromEntries(TILE_KINDS.map((k) => [k, tileFigures(k, FULL)]));
    expect(f.pipeline).toMatchObject({ label: "Open pipeline", value: "92.6", unit: "M SAR", note: "10 open tenders" });
    expect(f.weighted).toMatchObject({ label: "Weighted by chance", value: "26.2", unit: "M SAR", note: "28% of the open value" });
    expect(f.closing).toMatchObject({ label: "Closing in 14 days", value: "5", unit: " bids", note: "56.5M SAR still to finish" });
    expect(f.win).toMatchObject({ label: "Win rate, 12 months", value: "55", unit: "%", note: "18 won, 15 lost" });
    expect(f.buyout).toMatchObject({ label: "Buy-out committed", value: "5.8", unit: "M SAR", note: "59% of the package budget" });
  });

  it("each tile goes to its place in the navigation map", () => {
    expect(tileFigures("pipeline", FULL).href).toBe(TAB);
    expect(tileFigures("weighted", FULL).href).toBe(TAB);
    expect(tileFigures("closing", FULL).href).toBe(`${TAB}&closing=14`);
    expect(tileFigures("win", FULL).href).toBe(`${TAB}&outcome=won`);
    expect(tileFigures("buyout", FULL).href).toBe("/contract-projects/p1?tab=buyout");
    expect(tileFigures("buyout", { ...FULL, buyout: null }).href).toBe(ROUTES.contractProjects);
  });

  it("are links with the figures in their aria label, and a hover/focus lift in the style sheet", () => {
    for (const look of LOOKS) {
      const out = block("tender_open_pipeline", FULL, look);
      expect(out).toContain('aria-label="Open pipeline: 92.6M SAR, 10 open tenders"');
      expect(out).toContain(`href="${TAB}"`);
      expect(out).toContain("92.6<small>M SAR</small>");
      expect(out).toContain('data-guide="tender.dash.tile.pipeline"');
    }
    expect(block("tender_closing_soon", FULL)).toContain('aria-label="Closing in 14 days: 5 bids, 56.5M SAR still to finish"');
    expect(block("tender_win_rate", FULL)).toContain('aria-label="Win rate, 12 months: 55%, 18 won, 15 lost"');
    const css = readFileSync(path.join(__dirname, "tenderBlocks.module.css"), "utf8");
    expect(css).toMatch(/\.tile:hover[^{]*\{[^}]*translateY\(-3px\)/);
    expect(css).toMatch(/\.cover:focus-visible\s*\{[^}]*outline: 3px solid/);
  });

  it("keep the explanation behind an i, outside the link", () => {
    const out = block("tender_weighted", FULL);
    expect(out).toContain('aria-label="About Weighted by chance"');
    expect(out).not.toContain("added up");
    expect(block("tender_open_pipeline", FULL)).not.toContain("About");
  });

  it("say '—' and a short reason when the data is missing, never a zero", () => {
    expect(tileFigures("pipeline", PENDING)).toMatchObject({ value: "—", unit: "", note: "Not set up yet" });
    expect(tileFigures("pipeline", null)).toMatchObject({ value: "—", note: "Not available right now" });
    expect(tileFigures("win", NO_OPEN)).toMatchObject({ value: "—", unit: "", note: "Nothing decided yet" });
    expect(tileFigures("closing", NO_OPEN)).toMatchObject({ value: "0", note: "Nothing due soon" });
    expect(tileFigures("buyout", NO_OPEN)).toMatchObject({ note: "No buy-out packages yet" });
    expect(tileFigures("weighted", NO_OPEN).note).toBe("No open value yet");
    expect(tileFigures("closing", { ...FULL, kpis: { ...FULL.kpis, closingSoonCount: 1 } }).unit).toBe(" bid");
  });

  it("join a figure and its unit into one phrase", () => {
    expect(joinFigure("92.6", "M SAR")).toBe("92.6M SAR");
    expect(joinFigure("5", " bids")).toBe("5 bids");
    expect(joinFigure("55", "%")).toBe("55%");
    expect(joinFigure("4,200", "SAR")).toBe("4,200 SAR");
    expect(joinFigure("—", "")).toBe("—");
  });
});

describe("pipeline by stage", () => {
  it("is a list of links, one per open stage, each to the Tenders tab on that stage", () => {
    for (const look of LOOKS) {
      const out = block("tender_by_stage", FULL, look);
      for (const [stage, label] of [["received", "Received"], ["bid_no_bid", "Bid/No-bid"], ["estimating", "Estimating"], ["submitted", "Submitted"], ["clarifications", "Clarifications"]]) {
        expect(out).toContain(`href="${TAB}&amp;stage=${stage}"`);
        expect(out).toContain(label);
      }
      expect((out.match(/data-guide="tender\.dash\.stage"/g) ?? []).length).toBe(5);
      expect(out).toContain("<b>35.4M</b> (3)");
      expect(out).toContain('aria-label="Estimating: 35.4M SAR, 3 tenders"');
      expect(out).toContain("Open pipeline by stage, SAR. Received 10.2M, 2 tenders;");
    }
  });

  it("draws bars in the stage's own colour and keeps the explanation behind the card's i", () => {
    const out = block("tender_by_stage", FULL);
    for (const c of STAGE_COLOURS) expect(out).toContain(c);
    expect(out).not.toContain("The bar is the value in millions");
  });

  it("says so when nothing is open, with the next step as a link", () => {
    const out = block("tender_by_stage", NO_OPEN);
    expect(out).toContain("No open tenders yet.");
    expect(out).toContain(`href="${ROUTES.pipelineNewTender}"`);
    expect(block("tender_by_stage", EMPTY_LISTS)).toContain("No open stages.");
  });
});

describe("bids closing soonest", () => {
  it("is a link per bid to the deal, soonest first, with a chip that says the days in words", () => {
    for (const look of LOOKS) {
      const out = block("tender_closing_list", FULL, look);
      for (const c of FULL.closing) expect(out).toContain(`href="${c.href}"`);
      expect((out.match(/data-guide="tender\.dash\.closing"/g) ?? []).length).toBe(6);
      expect(out).toContain("3<small>days</small>");
      expect(out).toContain("20<small>days</small>");
      expect(out).toContain("TND-0022 · National Water Company");
      expect(out).toContain("18.5M");
      expect(out).toContain('aria-label="Desalination feed pipeline, closes in 3 days, 18.5M SAR"');
      expect(out.indexOf("TND-0022")).toBeLessThan(out.indexOf("TND-0017"));
    }
  });

  it("copes with none", () => {
    expect(block("tender_closing_list", EMPTY_LISTS)).toContain("No bid is waiting for its end date.");
  });
});

describe("won and lost by month", () => {
  it("makes every column a link to the tenders decided that way, and the totals links too", () => {
    for (const look of LOOKS) {
      const out = block("tender_won_lost", FULL, look);
      const links = hrefs(out);
      for (const m of FULL.months) {
        if (m.won > 0) expect(links).toContain(`${TAB}&outcome=won&month=${m.key}`);
        if (m.lost > 0) expect(links).toContain(`${TAB}&outcome=lost&month=${m.key}`);
      }
      expect(links).toContain(`${TAB}&outcome=won`);
      expect(links).toContain(`${TAB}&outcome=lost`);
      expect(out).toContain('aria-label="Oct: 2 won"');
      expect(out).toContain('aria-label="Won: 18 in the last 12 months"');
      expect(out).toContain("Won and lost tenders by month. Nov 1 won, 1 lost;");
    }
  });

  it("copes with a year without decisions", () => {
    expect(block("tender_won_lost", EMPTY_LISTS)).toContain("No tender was decided in the last 12 months.");
  });
});

describe("open value by client", () => {
  it("is the app's hover donut: a wedge and a legend row per client, each a link to that client's tenders; Others goes to all tenders", () => {
    for (const look of LOOKS) {
      const out = block("tender_by_client", FULL, look);
      for (const c of FULL.clients) {
        expect(out).toContain(c.name);
        expect(hrefs(out)).toContain(clientHref(c));
      }
      expect(hrefs(out)).toContain(`${TAB}&client=c1000000-0000-0000-0000-000000000001`);
      expect(hrefs(out)).toContain(TAB);
      expect((out.match(/class="donut-hit"/g) ?? []).length).toBe(5);
      expect((out.match(/class="donut-legend-row is-interactive"/g) ?? []).length).toBe(5);
      expect(out).toContain(">92.6M<");
      expect(out).toContain("SAR open");
      expect(out).toContain('aria-label="National Water Company: 34.3M SAR, 3 tenders"');
      expect(out).toContain("Open value by client, SAR. National Water Company 34.3M;");
    }
  });

  it("colours the slices from the look's own palette", () => {
    const bold = clientSlices(FULL.clients, "bold", "SAR").map((s) => s.color);
    const control = clientSlices(FULL.clients, "control", "SAR").map((s) => s.color);
    expect(bold.slice(0, 4)).toEqual([...tenderDesk.bold.clients].slice(0, 4));
    expect(bold[4]).toBe(tenderDesk.bold.others);
    expect(control.slice(0, 4)).toEqual([tenderDesk.control.violet, tenderDesk.control.teal, tenderDesk.control.amber, tenderDesk.control.rose]);
    expect(control[4]).toBe(tenderDesk.control.others);
  });

  it("copes with no client value", () => {
    expect(block("tender_by_client", EMPTY_LISTS)).toContain("No open value to show.");
  });
});

describe("needs you today", () => {
  it("is a link per item to its record, most urgent first, saying the urgency in words", () => {
    for (const look of LOOKS) {
      const out = block("tender_attention", FULL, look);
      for (const a of FULL.attention) expect(hrefs(out)).toContain(a.href);
      expect(out).toContain("Urgent: </span>Decide bid or no-bid on TND-0017");
      expect(out).toContain(">Decide<");
      expect(out).toContain('aria-label="Soon. Remind: Two of four suppliers have not replied. RFQ for Package B"');
      expect(out.indexOf("Urgent:")).toBeLessThan(out.indexOf("Soon:"));
      expect(out.indexOf("Soon:")).toBeLessThan(out.indexOf("When you can:"));
      expect((out.match(/data-guide="tender\.dash\.attention"/g) ?? []).length).toBe(3);
    }
  });

  it("copes with none", () => {
    expect(block("tender_attention", EMPTY_LISTS)).toContain("Nothing needs you today.");
  });
});

describe("open pipeline trend", () => {
  it("is one link to the tenders with the figure, the 12-week change and the chart's figures in its label", () => {
    for (const look of LOOKS) {
      const out = block("tender_trend", FULL, look);
      expect(hrefs(out)).toEqual([TAB]);
      expect(out).toContain("92.6<small>M SAR</small>");
      expect(out).toContain("+31.6M since 4 Aug");
      expect(out).toContain("Open pipeline over the last 12 weeks, SAR: from 61.0M on 4 Aug to 92.6M on 20 Oct.");
    }
  });

  it("copes with no history", () => {
    expect(block("tender_trend", EMPTY_LISTS)).toContain("Not enough history yet to draw the trend.");
  });
});

describe("bid deadlines", () => {
  it("puts the bids inside 28 days on the line, each marker a link to the deal, and counts the later ones", () => {
    for (const look of LOOKS) {
      const out = block("tender_deadlines", FULL, look);
      expect((out.match(/data-guide="tender\.dash\.deadline"/g) ?? []).length).toBe(5);
      for (const c of FULL.closing.slice(0, 5)) expect(hrefs(out)).toContain(c.href);
      expect(hrefs(out)).not.toContain("/pipeline/a6");
      expect(out).toContain("TND-0022 · 3 days");
      expect(out).toContain("TND-0014 · 20 days");
      expect(out).toContain("1 more bid ends after 28 days.");
      expect(out).toContain("--x:10.7%");
      expect(out).toContain("+28 days");
      expect(out).toContain('aria-label="Desalination feed pipeline, closes in 3 days, 18.5M SAR"');
    }
  });

  it("copes with none", () => {
    expect(block("tender_deadlines", EMPTY_LISTS)).toContain("No bid ends in the next 28 days.");
  });
});

describe("buy-out against budget", () => {
  it("links the title and every package to the project's Buy-out tab", () => {
    for (const look of LOOKS) {
      const out = block("tender_buyout", FULL, look);
      const links = hrefs(out);
      expect(links).toHaveLength(4);
      for (const l of links) expect(l).toBe("/contract-projects/p1?tab=buyout");
      for (const p of ["Pipes and fittings", "Precast chambers", "Valves and covers"]) expect(out).toContain(p);
      for (const status of ["Awarded", "Quotes in", "Waiting"]) expect(out).toContain(status);
      expect(out).toContain("0.25M under");
      expect(out).toContain("0.10M over");
      expect(out).toContain("no quote yet");
      expect(out).toContain("Wadi crossing project");
    }
  });

  it("is a quiet line when the workspace has no buy-out yet", () => {
    expect(block("tender_buyout", EMPTY_LISTS)).toContain("No buy-out packages yet.");
  });
});

describe("a block whose data is missing", () => {
  const CARDS = TENDER_BLOCKS.map((b) => b.id).slice(5);
  it("says the tables are not set up when the data is pending, in every card, and draws no figure", () => {
    for (const id of CARDS) {
      const out = block(id, PENDING);
      expect(out).toContain("Tender data is not set up yet");
      expect(out).not.toContain("M SAR");
    }
  });

  it("says the data could not be read when it is null, in every card", () => {
    for (const id of CARDS) expect(block(id, null)).toContain("Tender data could not be read just now");
  });

  it("is null for an id that is not a tender block", () => {
    expect(tenderBlockSpec(ID("accounts"), FULL, "bold")).toBeNull();
  });
});

describe("every tender block, in both looks", () => {
  it("renders from every fixture without throwing, with no heading from the old Tender desk, and every interactive element a link", () => {
    for (const { id } of TENDER_BLOCKS) {
      for (const look of LOOKS) {
        for (const data of [FULL, EMPTY_LISTS, NO_OPEN, PENDING, null]) {
          const out = block(id, data, look);
          expect(out).not.toContain("Tender desk");
          expect(out).not.toContain("Tender control room");
          expect(out).not.toMatch(/<button(?![^>]*bpm-tip)/);
        }
      }
    }
  });

  it("every row, bar, tile, slice, marker and item in the full fixture has an address", () => {
    const expectedLinks: Record<string, number> = {
      tender_open_pipeline: 1, tender_weighted: 1, tender_closing_soon: 1, tender_win_rate: 1, tender_buyout_committed: 1,
      tender_by_stage: 5, tender_closing_list: 6, tender_won_lost: 2 + 23, tender_by_client: 10, tender_attention: 3, tender_trend: 1,
      tender_deadlines: 5, tender_buyout: 4,
    };
    for (const [id, n] of Object.entries(expectedLinks)) expect(hrefs(block(id, FULL))).toHaveLength(n);
  });
});

describe("colour lives in theme.ts only", () => {
  const stringsOf = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(stringsOf) : []);
  /** What is left of the markup once every theme token and every stage colour (tenant data) is taken out. */
  const withoutTokens = (html: string) =>
    [...stringsOf(tenderDesk), ...stringsOf(dashLook), ...STAGE_COLOURS].sort((a, b) => b.length - a.length).reduce((h, t) => h.split(t).join(""), html);

  for (const { id } of TENDER_BLOCKS) {
    for (const look of LOOKS) {
      it(`${id} (${look}): no hex or rgb colour in the markup outside the theme tokens and the tenant's stage colours`, () => {
        const rest = withoutTokens(block(id, FULL, look));
        expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(rest).not.toMatch(/\brgba?\(/);
      });
    }
  }

  const dir = path.resolve(__dirname);
  for (const f of ["AttentionList.tsx", "BuyoutBars.tsx", "ClientDonut.tsx", "ClosingList.tsx", "DashLook.tsx", "DeadlineTimeline.tsx", "StageBars.tsx", "TenderBlocks.tsx",
    "TenderTiles.tsx", "TrendArea.tsx", "WonLost.tsx", "dashLookCss.ts", "look.ts", "format.ts", "tenderBlocks.module.css"]) {
    it(`${f} holds no colour literal`, () => {
      const text = readFileSync(path.join(dir, f), "utf8");
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text).not.toMatch(/\brgba?\(/);
    });
  }
});
