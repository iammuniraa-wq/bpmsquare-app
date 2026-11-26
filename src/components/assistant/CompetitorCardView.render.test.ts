import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import CompetitorCardView, { expectedCell, metTextOf } from "./CompetitorCardView";
import { buildCard } from "@/lib/assistant/competitors/card";
import { computeAnalysis } from "@/lib/assistant/competitors/compute";
import { rulesNarrative } from "@/lib/assistant/competitors/narrative";
import { COMPETITORS, DEAL, LOST, WON, input } from "@/lib/assistant/competitors/fixture";
import type { DockCompetitors } from "@/lib/assistant/competitors/types";

// The competitor card as the dock draws it: who you are up against, the margin ladder with the recommended rows marked and the
// basis said in words, the risks, and the steps. Every figure is a field; the web line is a text node with its source count.

const card = (over: Parameters<typeof input>[0] = {}, o = { canEdit: true, webOn: true }): DockCompetitors => {
  const c = computeAnalysis(input(over));
  return buildCard(c, { ...rulesNarrative(c), writtenBy: "rules" }, o);
};
const html = (d: DockCompetitors, extra: Record<string, unknown> = {}) =>
  renderToString(createElement(CompetitorCardView, { data: d, busy: false, onOpen: () => {}, onAsk: () => {}, ...extra } as never)).replace(/<!-- -->/g, "");

describe("with a history behind it", () => {
  const out = html(card());

  it("names the tender, and the two texts", () => {
    expect(out).toContain("Competitors · OPP-0034");
    expect(out).toContain("How to position");
    expect(out).toContain("bid ends in 8 days");
    expect(out).toContain("margin 10%");
  });

  it("shows each competitor with the times met, the times they won and the usual gap, and the web line with its source count", () => {
    expect(out).toContain("Alpha Builders");
    expect(out).toContain("Met 7 · beat us 3 · we won 3");
    expect(out).toContain("usually 5% above their price");
    expect(out).toContain("Won a SAR 90 m precast housing package in 2026.");
    expect(out).toContain("web, 2 sources");
    expect(out).toContain("Expected: Below us");
  });

  it("the ladder says it comes from the workspace's own bids, marks the recommended rows and today's price, and gives the range and its reason", () => {
    expect(out).toContain("From your history · 12 bids");
    expect(out).toContain('data-guide="competitors.ladder"');
    expect(out.match(/data-guide="competitors\.ladder\.row"/g)).toHaveLength(9);
    expect(out).toContain("Aim for 8% to 10%.");
    expect(out).toContain("4 of 9 nearby past bids won");
    expect(out).toContain("43.6%");
    expect(out).toContain("SAR 87K");
    expect(out).toContain("marks where your price stands now (10%)");
  });

  it("every control carries a guide id and the steps are chips", () => {
    expect(out).toContain('data-guide="competitors.step.open_tab"');
    expect(out).toContain('data-guide="competitors.step.add"');
    expect(out).toContain('data-guide="competitors.step.research"');
    expect(out).toContain("Research Beta Contracting on the web");
  });

  it("chips and the add box are at least 44 px high, and long text wraps", () => {
    expect(out).toMatch(/min-height:44px/);
    expect(out).toContain("overflow-wrap:anywhere");
  });

  it("shows only three competitors until asked for more", () => {
    const many = card({ competitors: [...COMPETITORS, { name: "Zeta Ltd", country: null, expectedPrice: null, evidence: null }] });
    expect(html(many)).not.toContain("Zeta Ltd");
    expect(html(many)).toContain("Show all 4");
  });
});

describe("with little history", () => {
  const thin = html(card({ past: [WON[2], LOST[0], LOST[5]] }));

  it("labels the starting assumption, says why, and keeps the warning visible", () => {
    expect(thin).toContain("Starting assumption");
    expect(thin).toContain("Starting assumption, not your history: only 3 decided bids have a recorded margin (at least 5 are needed)");
    expect(thin).toContain('role="status"');
    expect(thin).not.toContain("From your history");
  });

  it("lists the risks and what would sharpen it, behind a button", () => {
    expect(thin).toContain("Worth knowing");
    expect(thin).toContain("What would sharpen this");
    expect(thin).not.toContain("Close out each tender");
  });
});

describe("with nothing recorded", () => {
  it("says there are no competitors and offers adding one and the web", () => {
    const out = html(card({ competitors: [], past: [] }));
    expect(out).toContain("No competitors are recorded on this tender yet.");
    expect(out).toContain("Research the web");
    expect(out).not.toContain("Open the Competitors tab");
  });

  it("with no cost, the last column reads profit per 100 of cost", () => {
    const out = html(card({ deal: { ...DEAL, cost: null, costedLines: 0 } }));
    expect(out).toContain("per 100");
    expect(out).not.toContain("SAR 87K");
  });

  it("without an edit grant there is no add button", () => {
    expect(html(card({}, { canEdit: false, webOn: false }))).not.toContain("competitors.step.add");
  });
});

describe("small pieces", () => {
  it("writes the met line and the expected cell", () => {
    expect(metTextOf({ met: 0, openElsewhere: 2 } as never)).toBe("Not met on a decided tender · on 2 open");
    expect(metTextOf({ met: 0, openElsewhere: 0 } as never)).toBe("Not met before");
    expect(expectedCell({ expected: 87_200, expectedPer100: 4.8 } as never, "SAR")).toBe("SAR 87K");
    expect(expectedCell({ expected: null, expectedPer100: 4.8 } as never, "SAR")).toBe("4.8 per 100");
  });

  it("text from the web is a text node, never markup", () => {
    const c = card({ competitors: [{ ...COMPETITORS[0], evidence: { ...COMPETITORS[0].evidence!, facts: [{ text: "<img src=x onerror=alert(1)> won a job", kind: "award", source_url: "https://example.com/a" }] } }] });
    const out = html(c);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});
