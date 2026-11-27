import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import PriceCardView, { moneyFor } from "./PriceCards";
import { computeComparison } from "@/lib/assistant/priceCompare/compute";
import { computedRecommendation } from "@/lib/assistant/priceCompare/facts";
import { LINE_ID, RS, fixtureInput, money, rid } from "@/lib/assistant/priceCompare/fixture";
import type { AwardLineView, DockAward, DockPriceCheck, DockPriceCompare, PriceCard } from "@/lib/assistant/priceCompare/types";

// The price cards as the dock draws them: the figures the server worked out, nothing else; a few rows and "show all"; one chip pattern for
// every button (44 px under 900 px); colours from tokens only; the award card cannot be pressed while something is missing.

const CUR = { symbol: "SAR", locale: "en-US", decimals: 2 };
const view = (card: PriceCard) => renderToString(createElement(PriceCardView, { card, onOpen: () => {}, onAsk: () => {} })).replace(/<!-- -->/g, "");

const compareCard = (over: Partial<DockPriceCompare> = {}): DockPriceCompare => {
  const comparison = computeComparison(fixtureInput());
  return {
    kind: "compare", id: "c1", comparison, recommendationText: computedRecommendation(comparison, money), recommendationBy: "computed", digest: "",
    notice: null, currency: CUR,
    next: [
      { id: "open-compare", label: "Open the compare screen", kind: "navigate", target: "/rfqs/x" },
      { id: "award-single", label: "Propose the award to Alpha Supply", kind: "ask", question: "Propose awarding RFQ-0014 to Alpha Supply." },
    ],
    ...over,
  };
};

const line = (n: number, over: Partial<AwardLineView> = {}): AwardLineView => ({
  lineId: LINE_ID(n), responseId: rid("B", n), rfqSupplierId: RS.B, item: String(n), description: `Line ${n}`, supplier: "Beta Trading", cost: 10 * n, qty: 2,
  markupPct: null, rate: null, needsReason: false, validity: "ok", alreadyAwarded: false, ...over,
});
const awardCard = (over: Partial<DockAward> = {}): DockAward => ({
  kind: "award", id: "a1", token: "t", title: "Award RFQ-0014 to Beta Trading", summary: "Award 2 lines of RFQ-0014 to Beta Trading at a cost of SAR 60.00. Nothing is awarded until you press the button.",
  rfq: { id: "r", ref: "RFQ-0014" }, plan: { rfqId: "r", route: "rfq", dealId: null, mode: "single", targets: [] }, lines: [line(1), line(2)], left: [], total: 60,
  pricesRows: false, markupDefaultPct: null, needsReason: false, needsReplace: false, notices: [], blocked: null, primaryLabel: "Award", currency: CUR, compareHref: "/rfqs/r", risk: "write", ...over,
});
const checkCard = (): DockPriceCheck => ({
  kind: "check", id: "k1", deal: { id: "d", ref: "OPP-0034", title: "Pipeline package" }, checked: 40, noReference: 6, digest: "", currency: CUR,
  next: [{ id: "open-boq", label: "Open the bill of quantities", kind: "navigate", target: "/pipeline/d?tab=boq" }],
  rows: [
    { item: "1.4", description: "Precast pipe 600 mm", basis: "cost", current: 120, reference: 88, referenceCount: 3, nearest: "RFQ-0009", pct: 36.4, stale: true, href: "/pipeline/d?tab=boq" },
    { item: "2.1", description: "Rebar T16", basis: "rate", current: 90, reference: 100, referenceCount: 1, nearest: "OPP-0010", pct: -10, stale: false, href: "/pipeline/d?tab=boq" },
  ],
});

describe("the comparison card", () => {
  const out = view(compareCard());
  it("opens with the recommendation, then the figures, the table, the risks and the next steps, in that order", () => {
    const at = ["Recommended: Alpha Supply · 94.1 of 100", "One supplier", "Split by line", "Lowest to highest", "Item", "Watch out", "Open the compare screen"].map((x) => out.indexOf(x));
    expect(at.every((n) => n > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("writes the figures the server made, in the workspace's currency", () => {
    const m = moneyFor(CUR);
    for (const n of [36300, 36400, 41400, 35100, 1200, 6650]) expect(out).toContain(m(n));
    expect(out).toContain("saves SAR 1,200.00 · 3.3%");
    expect(out).toContain("19.1%");
  });
  it("one column per supplier with how many lines it quoted, the partial one marked, the recommended one named", () => {
    expect(out).toContain("Alpha Supply");
    expect(out).toContain("8/8 lines");
    expect(out).toContain("7/8 lines");
    expect(out).toContain("Gamma Industr…");
  });
  it("highlights the cheapest cell on a line, flags an outlier and an expired price, and says what was not quoted", () => {
    expect(out).toMatch(/background:var\(--greenbg\)/);
    expect(out).toContain("▲ 25% stale ref");
    expect(out).toContain("not quoted");
    const base = compareCard();
    const tail = view({ ...base, comparison: { ...base.comparison, lines: base.comparison.lines.slice(2) } });
    expect(tail).toContain("▲ 40%");
    expect(tail).toContain("expired");
    expect(out).not.toContain("▲ 40%"); // item 7 is behind "Show all"
  });
  it("draws six lines and a button for the rest, three risks and a button for the rest", () => {
    expect(out).toContain("Show all 8 lines");
    expect(out).toContain("Show all 5");
    expect((out.match(/<tr>/g) ?? []).length).toBe(1 + 6 + 3); // header, six lines, total + like for like + score
    expect((out.match(/<li /g) ?? []).length).toBe(3);
  });
  it("prints the weights of the score and the flag threshold in one small line, and explains the score behind an i", () => {
    expect(out).toContain("Score out of 100: price 60, completeness 20, validity 10, lead time 10. Flag at 25% from your own price.");
    expect(out).toContain('aria-label="About the score"');
  });
  it("every control carries a data-guide id and the dock's chip class", () => {
    for (const id of ["assistant.price.compare", "assistant.price.recommendation", "assistant.price.table", "assistant.price.risks", "assistant.price.step.open-compare", "assistant.price.step.award-single"]) {
      expect(out, id).toContain(`data-guide="${id}"`);
    }
    expect(out.match(/<button[^>]*class="bms-dock-chip"/g)!.length).toBeGreaterThanOrEqual(4);
  });
  it("a lone supplier shows no split, no spread and no like-for-like row", () => {
    const one = computeComparison(fixtureInput({ suppliers: [fixtureInput().suppliers[0]] }));
    const o = view(compareCard({ comparison: one }));
    expect(o).not.toContain("Split by line");
    expect(o).not.toContain("Lowest to highest");
    expect(o).not.toContain("Like for like");
  });
  it("a notice is shown as text, and a model sentence cannot become markup", () => {
    const o = view(compareCard({ notice: 'No supplier on RFQ-0014 matches "Delta".', recommendationText: "Alpha <img src=x onerror=1> is **best**." }));
    expect(o).toContain("matches &quot;Delta&quot;");
    expect(o).not.toMatch(/<img/);
  });
});

describe("the award card", () => {
  it("shows the lines and the cost, the summary that says nothing is awarded yet, and a button named after the act", () => {
    const o = view(awardCard());
    expect(o).toContain("Award RFQ-0014 to Beta Trading");
    expect(o).toContain("Nothing is awarded until you press the button.");
    expect(o).toContain("SAR 10.00");
    expect(o).toContain("Cost of the lines");
    expect(o).toContain("SAR 60.00");
    expect(o).toMatch(/>Award<\/button>/);
    expect(o).not.toContain("Markup");
    expect(o).not.toContain("Reason");
  });
  it("a tender card adds the markup and the rate, and a box for a typed markup that starts at the workspace default", () => {
    const o = view(awardCard({ pricesRows: true, markupDefaultPct: 15, primaryLabel: "Award and price", lines: [line(1, { markupPct: 15, rate: 11.5, cost: 10 })] }));
    expect(o).toContain("Award and price");
    expect(o).toContain("15%");
    expect(o).toContain("SAR 11.50");
    expect(o).toContain('placeholder="15"');
    expect(o).toContain('data-guide="assistant.price.award.markup"');
  });
  it("a price that needs a reason shows the box and keeps the button locked until it is filled", () => {
    const o = view(awardCard({ needsReason: true, notices: ["Item 1 is not the lowest valid price. A reason is needed."] }));
    expect(o).toContain("Item 1 is not the lowest valid price. A reason is needed.");
    expect(o).toContain('data-guide="assistant.price.award.reason"');
    expect(o).toMatch(/<button[^>]*disabled=""[^>]*data-guide="assistant.price.award.press"|<button[^>]*data-guide="assistant.price.award.press"[^>]*disabled=""/);
  });
  it("an award that would replace one needs the box ticked first", () => {
    const o = view(awardCard({ needsReplace: true }));
    expect(o).toContain("Replace the award that stands on these lines");
    expect(o).toMatch(/<button[^>]*disabled=""[^>]*data-guide="assistant.price.award.press"|<button[^>]*data-guide="assistant.price.award.press"[^>]*disabled=""/);
  });
  it("a blocked card says why in an alert and cannot be pressed, but still opens the compare screen", () => {
    const o = view(awardCard({ blocked: "RFQ-0014 is closed, so it cannot be awarded." }));
    expect(o).toMatch(/role="alert"[^>]*>RFQ-0014 is closed, so it cannot be awarded\./);
    expect(o).toMatch(/<button[^>]*disabled=""[^>]*data-guide="assistant.price.award.press"|<button[^>]*data-guide="assistant.price.award.press"[^>]*disabled=""/);
    expect(o).toContain("Open the compare screen");
    expect(o).not.toContain("Markup");
  });
  it("draws six lines and a button for the rest; the inputs get the 44 px class", () => {
    const o = view(awardCard({ needsReason: true, lines: Array.from({ length: 9 }, (_, i) => line(i + 1)) }));
    expect(o).toContain("Show all 9 lines");
    expect(o).toContain('class="bms-card-input"');
    expect(o).toContain(".bms-card-input { min-height: 44px !important; }");
  });
});

describe("the price check card", () => {
  const o = view(checkCard());
  it("names the tender, how many lines were checked and how many had no history", () => {
    expect(o).toContain("OPP-0034 · Pipeline package");
    expect(o).toContain("40 checked, 6 with no history");
  });
  it("ranks the lines with now, history and the gap; a gap of 25 percent or more is in warning ink", () => {
    expect(o).toContain("+36.4%");
    expect(o).toContain("-10%");
    expect(o).toContain("cost · stale");
    expect(o).toContain("3 prices");
    expect(o).toContain("1 price<");
  });
  it("says so when nothing differs", () => {
    expect(view({ ...checkCard(), rows: [] })).toContain("No priced line differs from your own history by 1% or more.");
  });
});

describe("source hygiene", () => {
  it("holds no colour of its own: tokens and the theme only", () => {
    const src = readFileSync(path.resolve(__dirname, "PriceCards.tsx"), "utf8").replace(/var\([^)]*\)/g, "");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\brgba?\(/);
  });
});

describe("the award card on a flagged supplier", () => {
  const flagged = (verdict: "check_first" | "concerning") => [{ supplierId: "5a000000-0000-4000-8000-000000000001", name: "Beta Trading", verdict, findings: ["Shares a bank account with Other Co", "No tax number on file"], checkedAt: "2026-11-20T00:00:00Z" }];
  const press = /<button[^>]*disabled=""[^>]*data-guide="assistant.price.award.press"|<button[^>]*data-guide="assistant.price.award.press"[^>]*disabled=""/;

  it("shows the amber warning with the two findings and the link, and the button cannot be pressed until the reason is typed", () => {
    const o = view(awardCard({ supplierChecks: flagged("check_first") }));
    expect(o).toContain('data-guide="award.check.warning"');
    expect(o).toContain("is marked <b>Check first</b> in your Supplier check: Shares a bank account with Other Co. No tax number on file.");
    expect(o).toContain('href="/suppliers/5a000000-0000-4000-8000-000000000001?tab=check"');
    expect(o).toContain("Reason for awarding anyway");
    expect(o).not.toContain('data-guide="award.check.ack"');
    expect(o).toMatch(press);
  });

  it("a concerning supplier also shows the tick", () => {
    const o = view(awardCard({ supplierChecks: flagged("concerning") }));
    expect(o).toContain("I have reviewed the findings");
    expect(o).toMatch(press);
  });

  it("an unflagged card shows nothing of it and stays pressable", () => {
    const o = view(awardCard({ supplierChecks: [] }));
    expect(o).not.toContain("award.check");
    expect(o).not.toMatch(press);
  });
});

describe("an award card that has already ended, drawn again", () => {
  const redraw = (settled: Parameters<typeof PriceCardView>[0]["settled"]) =>
    renderToString(createElement(PriceCardView, { card: awardCard({ markupNote: "Markup 20%, set on the BOQ row." }), onOpen: () => {}, onAsk: () => {}, settled })).replace(/<!-- -->/g, "");

  it("an awarded card has no Award button left; a fresh one shows the markup note", () => {
    const out = redraw({ kind: "awarded", done: { awarded: 2, of: 2, next: [], warnings: [] } });
    expect(out).toContain("Awarded 2 of 2 lines on RFQ-0014.");
    expect(out).not.toContain("assistant.price.award.press");
    expect(redraw(undefined)).toContain("Markup 20%, set on the BOQ row.");
  });
});
