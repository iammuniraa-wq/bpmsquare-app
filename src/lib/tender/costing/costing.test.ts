import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { tipTextProblems } from "@/lib/infoTip";
import { rateFor } from "@/lib/tender/boq/price";
import {
  ageText, awardMarkup, awardRate, awardSourceRef, awardSum, awardedFields, daysSince, estimateState, lineAmount, parseMarkup, rfqIsOut, rfqState,
  rowsRef, rowsText, tenderMarkupDefault, unpricedAwards, DEFAULT_AWARD_MARKUP_PCT,
} from "./rules";
import { COSTING_TIPS } from "./tips";

// The rules behind the Costing tab (docs/design/gcc-tender-deals.md section 25). The one that moves money: "Award and price" stores the
// supplier's price as the COST and adds the row markup, so cost 100 with 15 percent is a rate of 115 and the source reads "RFQ-0012, awarded".

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("the markup an award adds", () => {
  it("cost 100 with the default 15 percent is a rate of 115; 22 gives 25.30", () => {
    expect(DEFAULT_AWARD_MARKUP_PCT).toBe(15);
    expect(awardRate(100, 15)).toBe(115);
    expect(awardRate(22, 15)).toBe(25.3);
    expect(awardSum(22, 15)).toBe("Cost 22.00 + 15% = rate 25.30");
    expect(awardSum(100, 15)).toBe("Cost 100.00 + 15% = rate 115.00");
  });

  it("rounds the rate to 2 places and agrees with the BOQ's own cost-plus-markup rule", () => {
    expect(awardRate(33.333, 15)).toBe(38.33);
    expect(awardRate(10.01, 15)).toBe(11.51);
    expect(awardRate(0.01, 15)).toBe(0.01);
    expect(awardRate(100, 0)).toBe(100);
    for (const [cost, m] of [[100, 15], [22, 15], [33.333, 12.5], [4.8, 7.25], [1999.99, 15], [0.5, 33]] as const) {
      expect(awardRate(cost, m), `${cost} @ ${m}`).toBe(rateFor({ kind: "cost", price: cost }, m));
    }
  });

  it("the amount follows the deal's own rule: quantity times rate, less the line discount", () => {
    expect(lineAmount(120, 25.3, 0)).toBe(3036);
    expect(lineAmount(10, 115, 10)).toBe(1035);
    expect(lineAmount(3, 0.1, undefined)).toBe(0.3);
  });

  it("reads a markup only when it is a number from 0 to 1000, to 2 places", () => {
    expect(parseMarkup(15)).toBe(15);
    expect(parseMarkup("12.345")).toBe(12.35);
    expect(parseMarkup(0)).toBe(0);
    expect(parseMarkup(1000)).toBe(1000);
    for (const bad of [-1, 1000.01, "abc", "", null, undefined, NaN, Infinity, {}, []]) expect(parseMarkup(bad), String(bad)).toBeNull();
  });

  it("starts from the workspace default, which is 15 until Settings says otherwise", () => {
    expect(tenderMarkupDefault(null)).toBe(15);
    expect(tenderMarkupDefault({})).toBe(15);
    expect(tenderMarkupDefault({ tender: {} })).toBe(15);
    expect(tenderMarkupDefault({ tender: { default_markup_pct: 20 } })).toBe(20);
    expect(tenderMarkupDefault({ tender: { default_markup_pct: 0 } })).toBe(0);
    expect(tenderMarkupDefault({ tender: { default_markup_pct: "x" } })).toBe(15);
    expect(tenderMarkupDefault({ tender: { default_markup_pct: 5000 } })).toBe(15);
  });

  it("uses what the person typed, else the row's own markup, else the default", () => {
    expect(awardMarkup({ requested: 10, rowMarkup: 20, fallback: 15 })).toBe(10);
    expect(awardMarkup({ requested: 0, rowMarkup: 20, fallback: 15 })).toBe(0); // typed 0 = sell at cost, kept
    expect(awardMarkup({ requested: null, rowMarkup: 20, fallback: 15 })).toBe(20);
    expect(awardMarkup({ requested: null, rowMarkup: 0, fallback: 15 })).toBe(15); // an unset (zero) row markup is not a choice
    expect(awardMarkup({ requested: null, rowMarkup: null, fallback: 15 })).toBe(15);
    expect(awardMarkup({ requested: null, rowMarkup: undefined, fallback: 12 })).toBe(12);
  });
});

describe("what an award writes on the BOQ row", () => {
  const base = { cost: 100, markupPct: 15, rfqRef: "RFQ-0012", answeredOn: "2026-10-20", validity: "ok" as const, today: "2026-10-27", validityDays: 180 };

  it("stores the supplier price as the cost, adds the markup, and names the RFQ as the source", () => {
    expect(awardedFields(base)).toEqual({
      rate: 115, price_source: "supplier", price_source_ref: "RFQ-0012, awarded", price_as_of: "2026-10-20", stale_accepted: false, unit_cost: 100, markup_pct: 15,
    });
  });

  it("the source text reads 'RFQ-0012, awarded' and never the word commission", () => {
    expect(awardSourceRef("RFQ-0012")).toBe("RFQ-0012, awarded");
    expect(awardSourceRef(null)).toBe("RFQ, awarded");
    expect(awardSourceRef("  ")).toBe("RFQ, awarded");
    expect(JSON.stringify(awardedFields(base)).toLowerCase()).not.toContain("commission");
  });

  it("keeps the date the supplier gave the price, so the 180 day clock runs from the answer and not from the award", () => {
    expect(awardedFields({ ...base, answeredOn: "2026-04-01T08:00:00Z" }).price_as_of).toBe("2026-04-01");
    expect(awardedFields({ ...base, answeredOn: null }).price_as_of).toBeNull();
  });

  it("marks a price the person chose knowingly: expired or stale answer, older than the limit, or with no date", () => {
    expect(awardedFields({ ...base, validity: "expired" }).stale_accepted).toBe(true);
    expect(awardedFields({ ...base, validity: "stale" }).stale_accepted).toBe(true);
    expect(awardedFields({ ...base, answeredOn: "2026-04-30" }).stale_accepted).toBe(false); // 180 days old, still inside the limit
    expect(awardedFields({ ...base, answeredOn: "2026-04-29" }).stale_accepted).toBe(true); // 181 days
    expect(awardedFields({ ...base, answeredOn: null }).stale_accepted).toBe(true);
    expect(awardedFields({ ...base, answeredOn: "2026-04-29", validityDays: 365 }).stale_accepted).toBe(false);
  });

  it("keeps the cost to 4 places (the column) and the markup to 2", () => {
    const f = awardedFields({ ...base, cost: 12.345678, markupPct: 12.345 });
    expect(f.unit_cost).toBe(12.3457);
    expect(f.markup_pct).toBe(12.35);
    expect(f.rate).toBe(awardRate(12.3457, 12.345));
  });

  it("counts days without going negative", () => {
    expect(daysSince("2026-10-20", "2026-10-27")).toBe(7);
    expect(daysSince("2026-10-28", "2026-10-27")).toBe(0);
    expect(daysSince(null, "2026-10-27")).toBeNull();
    expect(ageText("2026-10-27T05:00:00Z", "2026-10-27")).toBe("today");
    expect(ageText("2026-10-24", "2026-10-27")).toBe("3 d ago");
    expect(ageText("2026-09-27", "2026-10-27")).toBe("4 wk ago");
    expect(ageText("2026-03-27", "2026-10-27")).toBe("7 mo ago");
    expect(ageText(null, "2026-10-27")).toBe("");
  });
});

describe("the list", () => {
  it("shows the rows a record prices as a short line", () => {
    expect(rowsText(rowsRef([]))).toBe("No BOQ row yet");
    expect(rowsText(rowsRef(["1.2", "1.3"]))).toBe("1.2 · 1.3");
    expect(rowsText(rowsRef(["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"]))).toBe("1.1 · 1.2 · 1.3 · 1.4 · +2");
    expect(rowsRef(["1.2", "1.2", " ", "1.3"]).count).toBe(2);
  });

  it("gives an estimate one honest state", () => {
    expect(estimateState({ status: "draft", stale_links: 2, missing_count: 1, linked_rows: 3 })).toEqual({ label: "Changed, re-price", tone: "amber" });
    expect(estimateState({ status: "draft", stale_links: 0, missing_count: 3, linked_rows: 3 }).label).toBe("3 costs missing");
    expect(estimateState({ status: "draft", stale_links: 0, missing_count: 1, linked_rows: 3 }).label).toBe("1 cost missing");
    expect(estimateState({ status: "draft", stale_links: 0, missing_count: 0, linked_rows: 3 }).label).toBe("Applied");
    expect(estimateState({ status: "draft", stale_links: 0, missing_count: 0, linked_rows: 0 }).label).toBe("Not used yet");
    expect(estimateState({ status: "quoted", stale_links: 0, missing_count: 0, linked_rows: 0 }).label).toBe("Quoted");
  });

  it("gives an RFQ one honest state", () => {
    const r = (o: Partial<Parameters<typeof rfqState>[0]>) => rfqState({ status: "sent", suppliers_total: 3, suppliers_replied: 0, lines_total: 2, lines_awarded: 0, ...o });
    expect(r({}).label).toBe("Sent");
    expect(r({ suppliers_replied: 2 }).label).toBe("2 of 3 replied");
    expect(r({ suppliers_replied: 3 }).tone).toBe("teal");
    expect(r({ lines_awarded: 1 }).label).toBe("1 of 2 awarded");
    expect(r({ lines_awarded: 2 }).label).toBe("Awarded");
    expect(r({ status: "draft" }).label).toBe("Draft");
    expect(r({ suppliers_total: 0 }).label).toBe("No suppliers");
    expect(r({ status: "cancelled" }).tone).toBe("red");
    expect(rfqIsOut("sent")).toBe(true);
    expect(rfqIsOut("partially_replied")).toBe(true);
    for (const s of ["draft", "awarded", "closed", "cancelled"]) expect(rfqIsOut(s), s).toBe(false);
  });

  it("counts the awards that are not on a BOQ row yet", () => {
    expect(unpricedAwards([{ applied_to_deal_at: null }, { applied_to_deal_at: "2026-10-27T00:00:00Z" }, { applied_to_deal_at: null }])).toBe(2);
    expect(unpricedAwards([])).toBe(0);
  });
});

describe("words and wiring", () => {
  it("every explanation fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(COSTING_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });

  it("the word commission appears nowhere in the Costing code (in tenders it means an agent fee)", () => {
    const files = [
      ...readdirSync(path.join(ROOT, "src/lib/tender/costing")).filter((f) => !f.endsWith(".test.ts")).map((f) => `src/lib/tender/costing/${f}`),
      ...readdirSync(path.join(ROOT, "src/components/tender/costing")).filter((f) => !f.endsWith(".test.ts")).map((f) => `src/components/tender/costing/${f}`),
      "src/components/tender/CostingTab.tsx",
    ];
    for (const f of files) expect(read(f).toLowerCase(), f).not.toContain("commission");
  });

  it("cost and markup never reach the priced Excel, the answer sheet or a bid version: those writers do not import the Costing code", () => {
    for (const f of ["src/lib/tender/boq/write.ts", "src/lib/tender/boq/workbook.ts", "src/lib/tender/bids/rules.ts", "src/lib/tender/bids/server.ts"]) {
      expect(read(f), f).not.toMatch(/tender\/costing|unit_cost|markup_pct/);
    }
    for (const f of readdirSync(path.join(ROOT, "src/lib/tender/costing")).filter((x) => !x.endsWith(".test.ts"))) {
      expect(read(`src/lib/tender/costing/${f}`), f).not.toMatch(/writePricedWorkbook|buildAnswerSheet|exportPriced|exportAnswerSheet/);
    }
  });

  it("no cost or markup is written to the change history; only the rate and its source are", () => {
    const server = read("src/lib/tender/costing/server.ts");
    const log = server.slice(server.indexOf("await logChange("));
    expect(log).toContain("BOQ rate source");
    expect(log).not.toMatch(/unit_cost|markup/);
  });

  it("every query on the service-role client in the server file is tenant-scoped", () => {
    const server = read("src/lib/tender/costing/server.ts");
    // Every admin.from(...) statement carries a tenant_id filter somewhere on the same statement (the statement ends at ';').
    const stmts = server.split(";").filter((s) => /admin\.from\(/.test(s));
    expect(stmts.length).toBeGreaterThan(10);
    for (const s of stmts) {
      if (/admin\.from\("tenants"\)/.test(s)) { expect(s).toMatch(/\.eq\("id", tenantId\)/); continue; } // the workspace row is keyed by its own id
      if (/\.insert\(|\.update\(|\.delete\(|\.select\(|\.upsert\(/.test(s)) expect(s, s.slice(0, 120)).toMatch(/tenant_id|\.eq\("tenant_id"/);
    }
  });
});
