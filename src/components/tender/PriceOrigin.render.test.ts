// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { priceKind, PRICE_KIND_TIP } from "@/lib/tender/boq/price";
import { tipTextProblems } from "@/lib/infoTip";
import type { CostingData } from "@/lib/tender/costing/rules";
import { SourceCell, sourceHref, type BoqRow } from "./BoqRows";
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
  it("tags a past-project rate as a selling price and shows its reference and date", () => {
    const out = cell(row());
    expect(out).toContain("Past project");
    expect(out).toContain('data-price-kind="sell"');
    expect(out).toContain("Selling price");
    expect(out).toContain("OPP-0029 · E2E-WBS-001");
    expect(out).not.toContain("boq.source_link");
  });

  it("links a supplier price to its RFQ and tags it as a cost", () => {
    const r = row({ price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes", unit_cost: 80, markup_pct: 15 });
    expect(sourceHref(r, [])).toBe("/rfqs?q=RFQ-0012");
    const out = cell(r);
    expect(out).toContain('data-price-kind="cost"');
    expect(out).toContain('href="/rfqs?q=RFQ-0012"');
  });

  it("links an estimate price to the estimate through the row's link", () => {
    const r = row({ price_source: "estimate", price_source_ref: "EST-0016", unit_cost: 80 });
    expect(sourceHref(r, [{ boq_id: "b1", estimate_ref: "EST-0016", estimate_name: "Tiles", estimate_id: "e1" }])).toBe("/estimates/e1");
    expect(sourceHref(r, [])).toBeNull();
  });

  it("an unpriced row has no tag", () => {
    expect(cell(row({ priced: false, price_source: null, price_source_ref: null, price_as_of: null }))).not.toContain("data-price-kind");
  });
});
