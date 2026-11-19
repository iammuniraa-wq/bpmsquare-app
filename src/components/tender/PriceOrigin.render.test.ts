// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { priceKind, PRICE_KIND_TIP } from "@/lib/tender/boq/price";
import { tipTextProblems } from "@/lib/infoTip";
import type { CostingData } from "@/lib/tender/costing/rules";
import { SourceCell, sourceHref, type BoqRow } from "./BoqRows";
import { SourceBar, SourceCard } from "./boq/SourceChip";
import { mixPartText, sourceChip, sourceGroupOf, sourceMix, type SourceGroup } from "@/lib/tender/boq/origin";
import CostingTab from "./CostingTab";

const costing = (boq: CostingData["boq"]): string => {
  const d: CostingData = {
    pending_estimates: false, pending_rfqs: false, estimates_on: true, rfqs_on: true, can_edit: true, can_create_estimate: true, can_award: true,
    items: [], boq, tiles: { priced: boq.priced, unpriced: boq.unpriced, rfqs_out: 0, replies_in: 0 }, templates: [], rfq_lines: [],
    rfq_origin_label: "Deal OPP-2", markup_default: 15, currency: "SAR", today: "2026-10-27", stage: "estimating", bid_locked: false,
  };
  return renderToString(createElement(CostingTab, { opportunityId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", canEdit: true, onError: () => {}, initialData: d })).replace(/<!-- -->/g, "");
};

describe("the Costing tiles", () => {
  it("twelve rows priced from past-project rates are priced, and none has a known cost", () => {
    const out = costing({ rows: 12, priced: 12, unpriced: 0, stale: 0, costed: 0 });
    expect(out).toContain("of 12 BOQ rows · 0 with a known cost");
    expect(out).toContain("12 with a rate only");
    expect(out).toContain("12 priced rows have a selling rate only, no known cost");
    expect(out).not.toContain("every row has a rate");
    expect(out).not.toContain("every row has a known cost");
  });

  it("says every row has a known cost only when each priced row carries one", () => {
    const out = costing({ rows: 12, priced: 12, unpriced: 0, stale: 0, costed: 12 });
    expect(out).toContain("12 with a known cost");
    expect(out).toContain("every row has a known cost");
    expect(out).not.toContain("costing.rate_only");
  });
});

// Owner walkthrough 2026-11-19: a rate copied from a past project must never read as a cost, and the Cost from cell says where a price
// came from and links to the record where its id is known.

const row = (over: Partial<BoqRow> = {}): BoqRow => ({
  id: "b1", line_id: "l1", row_no: 1, item_no: "1.1", cost_code: null, description: "Pipe", uom: "m", qty: 10, rate: 100, amount: 1000, priced: true, linked: true, removed: false,
  price_source: "past_project", price_source_ref: "OPP-0029 · E2E-WBS-001", price_as_of: "2026-10-01", stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null, ...over,
});
const cell = (r: BoqRow, links: Parameters<typeof sourceHref>[1] = []) => renderToString(createElement(SourceCell, { row: r, links })).replace(/<!-- -->/g, "");

describe("priced is not costed", () => {
  it("supplier, BOM and estimate figures are costs; past-project, client and typed rates are selling prices", () => {
    expect(priceKind("supplier", 80)).toBe("cost");
    expect(priceKind("bom", null)).toBe("cost");
    expect(priceKind("estimate", null)).toBe("cost");
    expect(priceKind("past_project", null)).toBe("sell");
    expect(priceKind("boq_rate", null)).toBe("sell");
    expect(priceKind("manual", null)).toBe("sell");
    expect(priceKind("manual", 50)).toBe("cost");
    expect(priceKind(null, null)).toBeNull();
  });

  it("the explanations keep to the InfoTip limit", () => {
    for (const t of Object.values(PRICE_KIND_TIP)) expect(tipTextProblems(t), t).toEqual([]);
  });
});

describe("the Cost from cell", () => {
  it("is one chip: a past bid in the rate-only tone, its short reference on the row and the whole of it in the name", () => {
    const out = cell(row());
    expect(out).toContain('data-guide="boq.source.chip"');
    expect(out).toContain('data-price-kind="sell"');
    expect(out).toContain("Past bid · OPP-0029");
    expect(out).toContain('title="Past bid · OPP-0029 · E2E-WBS-001, a selling rate only, no known cost"');
    expect(out).toMatch(/<svg/);
    // Nothing is stacked under the chip: no pill, no "i", no second line, and the card is not drawn until the chip is pressed.
    expect(out).not.toContain("Selling price");
    expect(out).not.toContain("bpm-tip");
    expect(out).not.toContain("boq.source.card");
    expect(out).toContain('aria-expanded="false"');
  });

  it("a supplier price is in the cost tone and names its RFQ", () => {
    const r = row({ price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes", unit_cost: 80, markup_pct: 15 });
    expect(sourceHref(r, [])).toBe("/rfqs?q=RFQ-0012");
    const out = cell(r);
    expect(out).toContain('data-price-kind="cost"');
    expect(out).toContain("Supplier · RFQ-0012");
    expect(out).not.toContain("Gulf Pipes</span>");
  });

  it("links an estimate price to the estimate through the row's link", () => {
    const r = row({ price_source: "estimate", price_source_ref: "EST-0016", unit_cost: 80 });
    expect(sourceHref(r, [{ boq_id: "b1", estimate_ref: "EST-0016", estimate_name: "Tiles", estimate_id: "e1" }])).toBe("/estimates/e1");
    expect(sourceHref(r, [])).toBeNull();
    expect(cell(r)).toContain("Estimate · EST-0016");
  });

  it("an unpriced row has no chip", () => {
    const out = cell(row({ priced: false, price_source: null, price_source_ref: null, price_as_of: null }));
    expect(out).not.toContain("data-price-kind");
    expect(out).toContain("Not priced");
  });
});

const card = (r: BoqRow, over: Partial<Parameters<typeof SourceCard>[0]> = {}) => renderToString(createElement(SourceCard, { row: r, ...over })).replace(/<!-- -->/g, "");

describe("the card behind the chip", () => {
  it("a supplier cost: the RFQ as a link, the date, the cost and the rate, and the way to another price", () => {
    const out = card(row({ price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes", unit_cost: 80, markup_pct: 15, rate: 92 }), { onChoose: () => {} });
    expect(out).toContain('data-guide="boq.source.card"');
    expect(out).toContain('<a href="/rfqs?q=RFQ-0012" data-guide="boq.source_link">RFQ-0012 · Gulf Pipes</a>');
    expect(out).toContain("01 Oct 2026");
    expect(out).toContain("80.00 + 15%");
    expect(out).toContain("92.00");
    expect(out).toContain('data-kind="cost"');
    expect(out).toContain("Use a different price");
  });

  it("a past bid: rate only, why it matched and the other past bids, once the candidates are read", () => {
    const cands = [
      { source: "past_project", ref: "OPP-0029 · E2E-WBS-001", label: "OPP-0029 · E2E-WBS-001 (same cost code)", price: 100, kind: "sell" as const, as_of: "2026-10-01" },
      { source: "past_project", ref: "OPP-0027", label: "OPP-0027 (same description)", price: 96.5, kind: "sell" as const, as_of: "2026-06-12" },
      { source: "supplier", ref: "Cost price of Pipe", label: "Product cost price", price: 70, kind: "cost" as const, as_of: null },
    ];
    const out = card(row(), { cands });
    expect(out).toContain("<b>Past bid</b>");
    expect(out).toContain("Rate only");
    expect(out).toContain("same cost code");
    expect(out).toContain("Other past bids (1)");
    expect(out).toContain("OPP-0027");
    expect(out).toContain("96.50");
    expect(out).not.toContain("Cost / unit");
    expect(out).not.toContain("Use a different price");
    expect(out).not.toContain("boq.source_link");
  });

  it("before the candidates are read it shows what the row stores", () => {
    const out = card(row());
    expect(out).toContain("OPP-0029 · E2E-WBS-001");
    expect(out).not.toContain("Matched on");
    expect(out).not.toContain("Other past bids");
  });
});

const mixRows = [
  row({ id: "a", price_source: "supplier", price_source_ref: "RFQ-0008 · Gulf", unit_cost: 10, amount: 120 }),
  row({ id: "b", amount: 500 }),
  row({ id: "c", amount: 380 }),
  row({ id: "d", priced: false, price_source: null, price_source_ref: null, amount: 0 }),
  row({ id: "e", amount: 9999, removed: true }),
];
const bar = (active: SourceGroup | null, onPick: (g: SourceGroup | null) => void = () => {}) =>
  renderToString(createElement(SourceBar, { lines: mixRows, active, onPick })).replace(/<!-- -->/g, "");

describe("the price-source bar", () => {
  it("splits the BOQ amount by source and counts the unpriced rows", () => {
    expect(sourceMix(mixRows)).toEqual([
      { group: "supplier", rows: 1, amount: 120, pct: 12 },
      { group: "past", rows: 2, amount: 880, pct: 88 },
      { group: "unpriced", rows: 1, amount: 0, pct: 0 },
    ]);
    expect(sourceMix(mixRows).map(mixPartText).join(" · ")).toBe("Supplier 12% · Past bids 88% · Unpriced 1 row");
  });

  it("draws a named button per segment and per legend item", () => {
    const out = bar(null);
    expect(out).toContain('data-guide="boq.source.bar"');
    expect(out).toContain('aria-label="Supplier cost: 12% of the BOQ amount, 1 row. Filter the table"');
    expect(out).toContain('aria-label="Past bids, rate only: 88% of the BOQ amount, 2 rows. Filter the table"');
    expect(out).toContain("Past bids 88%");
    expect(out).toContain("Unpriced 1 row");
    expect((out.match(/aria-pressed="false"/g) ?? []).length).toBe(5);
  });

  it("marks the active source and dims the others", () => {
    const out = bar("past");
    expect((out.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
    expect(out).toMatch(/data-group="supplier" data-dim="true"/);
  });

  it("groups each source, and a row with a source but no price is unpriced", () => {
    expect(sourceGroupOf({ priced: true, price_source: "bom" })).toBe("estimate");
    expect(sourceGroupOf({ priced: true, price_source: "estimate" })).toBe("estimate");
    expect(sourceGroupOf({ priced: true, price_source: "boq_rate" })).toBe("client");
    expect(sourceGroupOf({ priced: true, price_source: "manual" })).toBe("typed");
    expect(sourceGroupOf({ priced: false, price_source: "supplier" })).toBe("unpriced");
    expect(sourceChip({ price_source: "manual", price_source_ref: "was Supplier · RFQ-0012", unit_cost: null })?.full).toBe("Typed · was Supplier · RFQ-0012, a selling rate only, no known cost");
    expect(sourceChip({ price_source: "boq_rate", price_source_ref: "boq.xlsx", unit_cost: null })?.text).toBe("Client rate");
  });
});
