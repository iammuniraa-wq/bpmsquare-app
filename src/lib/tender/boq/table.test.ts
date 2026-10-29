import { describe, expect, it } from "vitest";
import { DEFAULT_MARKUP_PCT, defaultMarkupPct, isStale, type PriceSource } from "./price";
import {
  PAGE_SIZE, activeRows, costBreakdown, estimateRefsOf, filterCounts, filterRows, isStaleRow, isUnpricedRow, itemLabel, manualCostPlan, manualSourceRef, pageOf, parseFilter, parseMarkup,
  pricedPercent, rfqRefOf, rowChips, sourceView, type RowLike,
} from "./table";

// The rules the Bill of quantities table and its panel share: which rows a filter shows, what the Source cell and the chips say, what a
// manual rate records of the source it replaced, and how a long BOQ is paged.

type R = RowLike & { id: string };
const r = (over: Partial<R> = {}): R => ({ id: "x", item_no: "A.1", row_no: 8, priced: true, removed: false, price_source: null, price_source_ref: null, stale: false, stale_accepted: false, ...over });

describe("filters", () => {
  const rows = [
    r({ id: "1", price_source: "supplier", price_source_ref: "RFQ-0001", stale: true }),
    r({ id: "2", priced: false }),
    r({ id: "3", price_source: "manual" }),
    r({ id: "4", price_source: "supplier", stale: true, stale_accepted: true }),
    r({ id: "5", priced: false, removed: true }),
  ];

  it("All is every active row, Unpriced has no rate, Stale is priced, over the limit and not accepted knowingly", () => {
    expect(filterRows(rows, "all").map((x) => x.id)).toEqual(["1", "2", "3", "4"]);
    expect(filterRows(rows, "unpriced").map((x) => x.id)).toEqual(["2"]);
    expect(filterRows(rows, "stale").map((x) => x.id)).toEqual(["1"]);
    expect(filterCounts(rows)).toEqual({ all: 4, unpriced: 1, stale: 1 });
  });

  it("a row removed in a revised file is in no filter", () => {
    expect(activeRows(rows)).toHaveLength(4);
    expect(filterRows(rows, "unpriced").some((x) => x.removed)).toBe(false);
  });

  it("an unpriced row is never stale, whatever its leftover flag says", () => {
    expect(isStaleRow(r({ priced: false, stale: true }))).toBe(false);
    expect(isUnpricedRow(r({ priced: false }))).toBe(true);
  });

  it("anything that is not a filter is All", () => {
    for (const v of [undefined, null, "", "nonsense", 3]) expect(parseFilter(v)).toBe("all");
    expect(parseFilter("unpriced")).toBe("unpriced");
    expect(parseFilter("stale")).toBe("stale");
  });

  it("stale follows the existing rule: only supplier and past-project prices expire, and an undated one counts as stale", () => {
    expect(isStale("supplier", "2025-01-01", "2026-10-26", 180)).toBe(true);
    expect(isStale("manual", "2020-01-01", "2026-10-26", 180)).toBe(false);
    expect(isStale("estimate", "2020-01-01", "2026-10-26", 180)).toBe(false);
    expect(isStale("supplier", null, "2026-10-26", 180)).toBe(true);
  });
});

describe("the client's item number", () => {
  it("is shown as written, never renumbered; a row without one is named by its row in the file", () => {
    expect(itemLabel({ item_no: "1.2.3(a)", row_no: 40 })).toBe("1.2.3(a)");
    expect(itemLabel({ item_no: "  ", row_no: 40 })).toBe("#40");
    expect(itemLabel({ item_no: null, row_no: 12 })).toBe("#12");
  });
});

describe("the Source cell keeps its source whoever edits the rate", () => {
  it("a manual rate on a priced row records the source it replaced, with its reference", () => {
    expect(manualSourceRef({ price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes" })).toBe("was Supplier · RFQ-0012 · Gulf Pipes");
    expect(manualSourceRef({ price_source: "estimate", price_source_ref: "EST-0016" })).toBe("was Tender estimate · EST-0016");
    expect(manualSourceRef({ price_source: "boq_rate", price_source_ref: null })).toBe("was Client's rate");
  });

  it("a second manual edit does not erase the first source; a row never priced records nothing", () => {
    expect(manualSourceRef({ price_source: "manual", price_source_ref: "was Supplier · RFQ-0012" })).toBe("was Supplier · RFQ-0012");
    expect(manualSourceRef({ price_source: "manual", price_source_ref: null })).toBeNull();
    expect(manualSourceRef({ price_source: null, price_source_ref: null })).toBeNull();
  });

  it("the record is bounded, so a long reference cannot overflow the column", () => {
    expect(manualSourceRef({ price_source: "supplier", price_source_ref: "x".repeat(500) })!.length).toBeLessThanOrEqual(200);
  });

  it("reads back: the label, the detail, and what a manual rate replaced", () => {
    expect(sourceView({ price_source: null, price_source_ref: null })).toEqual({ label: "Not priced", detail: null, was: null });
    expect(sourceView({ price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf" })).toEqual({ label: "Supplier", detail: "RFQ-0012 · Gulf", was: null });
    expect(sourceView({ price_source: "manual", price_source_ref: "was Supplier · RFQ-0012" })).toEqual({ label: "Manual", detail: null, was: "Supplier · RFQ-0012" });
    expect(sourceView({ price_source: "manual", price_source_ref: null })).toEqual({ label: "Manual", detail: null, was: null });
  });

  it("every price source has a label", () => {
    for (const s of ["boq_rate", "bom", "past_project", "supplier", "manual", "estimate"] as PriceSource[]) expect(sourceView({ price_source: s, price_source_ref: null }).label).not.toBe("");
  });
});

describe("chips", () => {
  it("an RFQ chip is a supplier price whose reference starts with the RFQ's own", () => {
    expect(rfqRefOf({ price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes" })).toBe("RFQ-0012");
    expect(rfqRefOf({ price_source: "supplier", price_source_ref: "Cost price of Pipe · Gulf" })).toBeNull();
    expect(rfqRefOf({ price_source: "manual", price_source_ref: "RFQ-0012" })).toBeNull();
    expect(rfqRefOf({ price_source: "supplier", price_source_ref: null })).toBeNull();
  });

  it("an estimate chip comes from the deal's links, else from a rate set from an estimate", () => {
    const links = [{ boq_id: "x", estimate_ref: "EST-0016", estimate_name: "Floor" }, { boq_id: "y", estimate_ref: "EST-0002", estimate_name: "Other" }, { boq_id: "x", estimate_ref: null, estimate_name: "Unnamed ref" }];
    expect(estimateRefsOf(r({ id: "x" }), links)).toEqual(["EST-0016", "Unnamed ref"]);
    expect(estimateRefsOf(r({ id: "z", price_source: "estimate", price_source_ref: "EST-0007" }), links)).toEqual(["EST-0007"]);
    expect(estimateRefsOf(r({ id: "z" }), links)).toEqual([]);
    expect(estimateRefsOf(r({ id: "x" }), [{ boq_id: "x", estimate_ref: "EST-9", estimate_name: "n", broken: true }])).toEqual([]);
  });

  it("an unpriced row says Unpriced; a stale one says Stale, or Stale, accepted; a fresh priced row has none of those", () => {
    expect(rowChips(r({ priced: false })).map((c) => c.kind)).toEqual(["unpriced"]);
    expect(rowChips(r({ stale: true })).map((c) => c.label)).toEqual(["Stale"]);
    expect(rowChips(r({ stale: true, stale_accepted: true })).map((c) => c.label)).toEqual(["Stale, accepted"]);
    expect(rowChips(r({ price_source: "manual" }))).toEqual([]);
  });

  it("an estimate that changed adds a chip, in a fixed order after the estimate and the RFQ", () => {
    const row = r({ id: "x", price_source: "supplier", price_source_ref: "RFQ-1 · A", stale: true });
    const chips = rowChips(row, [{ boq_id: "x", estimate_ref: "EST-1", estimate_name: "e", stale: true }]);
    expect(chips.map((c) => c.kind)).toEqual(["estimate", "rfq", "stale", "changed"]);
    expect(rowChips(row, [{ boq_id: "other", estimate_ref: "EST-1", estimate_name: "e", stale: true }]).map((c) => c.kind)).toEqual(["rfq", "stale"]);
  });
});

describe("totals, paging and the markup box", () => {
  it("the priced percent is whole and safe on an empty BOQ", () => {
    expect(pricedPercent(136, 148)).toBe(92);
    expect(pricedPercent(1, 3)).toBe(33);
    expect(pricedPercent(0, 0)).toBe(0);
  });

  it("a long BOQ is shown a page at a time, and 'Show more' adds the next page", () => {
    const rows = Array.from({ length: 140 }, (_, i) => i);
    expect(pageOf(rows, 0)).toMatchObject({ hidden: 90, more: PAGE_SIZE });
    expect(pageOf(rows, 0).rows).toHaveLength(PAGE_SIZE);
    expect(pageOf(rows, 100)).toMatchObject({ hidden: 40, more: 40 });
    expect(pageOf(rows, 500)).toMatchObject({ hidden: 0, more: 0 });
    expect(pageOf([], 0)).toEqual({ rows: [], hidden: 0, more: 0 });
  });

  it("the markup box takes a number from 0 to 1000 and otherwise falls back", () => {
    expect(parseMarkup("12.5", 15)).toBe(12.5);
    expect(parseMarkup("", 15)).toBe(15);
    expect(parseMarkup("abc", 15)).toBe(15);
    expect(parseMarkup("-5", 15)).toBe(0);
    expect(parseMarkup("5000", 15)).toBe(1000);
  });

  it("the default markup is 15 unless the workspace set another", () => {
    expect(DEFAULT_MARKUP_PCT).toBe(15);
    expect(defaultMarkupPct(null)).toBe(15);
    expect(defaultMarkupPct({})).toBe(15);
    expect(defaultMarkupPct({ tender: {} })).toBe(15);
    expect(defaultMarkupPct({ tender: { default_markup_pct: 20 } })).toBe(20);
    expect(defaultMarkupPct({ tender: { default_markup_pct: 0 } })).toBe(0);
    expect(defaultMarkupPct({ tender: { default_markup_pct: "7.5" } })).toBe(7.5);
    for (const bad of [-1, 1001, "x", NaN, null]) expect(defaultMarkupPct({ tender: { default_markup_pct: bad } })).toBe(15);
  });

  it("cost plus markup is shown only for a rate built from a cost", () => {
    expect(costBreakdown({ unit_cost: 100, markup_pct: 15, rate: 115 })).toEqual({ cost: 100, markup: 15, rate: 115 });
    expect(costBreakdown({ unit_cost: null, markup_pct: null, rate: 20 })).toBeNull();
    expect(costBreakdown({ unit_cost: 0, markup_pct: 10, rate: 20 })).toBeNull();
  });
});

describe("a cost typed by hand (Edit cost in the row panel)", () => {
  it("sets the cost, the markup and the Manual source, and the rate is cost plus markup", () => {
    const p = manualCostPlan(22, 15, { price_source: null, price_source_ref: null }, "2026-10-29");
    expect(p.rate).toBe(25.3);
    expect(p.fields).toMatchObject({ price_source: "manual", unit_cost: 22, markup_pct: 15, price_as_of: "2026-10-29", stale_accepted: false, price_source_ref: null });
  });

  it("keeps the source it replaced, and a markup of 0 sells at cost", () => {
    const p = manualCostPlan(100, 0, { price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes" }, "2026-10-29");
    expect(p.rate).toBe(100);
    expect(p.fields.price_source_ref).toBe("was Supplier · RFQ-0012 · Gulf Pipes");
  });
});
