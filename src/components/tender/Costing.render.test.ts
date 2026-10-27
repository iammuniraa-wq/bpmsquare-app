import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import type { OpportunityStageDef } from "@/lib/constants";
import type { CompareView, CostingData, CostingEstimateItem, CostingRfqItem } from "@/lib/tender/costing/rules";
import type { TenderView } from "@/lib/tender/views";

// The Costing tab, rendered on the server (docs/design/gcc-tender-deals.md section 25): the four figures, the list of estimates and RFQs,
// the compare-and-award screen, the award panel, and the tab on the deal page. 375 px and PC share one markup: the lists are wrapping
// flex rows, the suppliers sit in an auto-fit grid (side by side on a PC, stacked on a phone), the panels are the shared SidePanel (a bottom
// sheet under 780 px). So the checks here are the ones that decide whether a phone fits: 44 px targets, no fixed widths, no literal colour,
// long lists paged, the explanations behind an "i".

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));

import CostingTab from "./CostingTab";
import CostingRow from "./costing/CostingRow";
import CompareAward from "./costing/CompareAward";
import PriceRowsPanel from "./costing/PriceRowsPanel";
import OpportunityDetailClient from "@/app/(app)/pipeline/[id]/OpportunityDetailClient";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const noop = () => {};
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const est = (over: Partial<CostingEstimateItem> = {}): CostingEstimateItem => ({
  kind: "estimate", id: "e1", ref: "EST-0016", name: "Floor tiles", template_name: "Floor tiles", status: "draft", cost_total: 1905.49, price: 2100, currency: "SAR",
  updated_at: "2026-10-24T08:00:00Z", rows: { count: 3, items: ["1.1", "1.3", "1.4"], more: 0 }, linked_rows: 3, stale_links: 1, missing_count: 0, stale_link_ids: ["l1"],
  state: { label: "Changed, re-price", tone: "amber" }, rfqs: [], locked: false, ...over,
});
const rfq = (over: Partial<CostingRfqItem> = {}): CostingRfqItem => ({
  kind: "rfq", id: "r1", ref: "RFQ-0012", title: "Skirting, membrane", status: "partially_replied", created_at: "2026-10-21T08:00:00Z", respond_by: "2026-11-05", origin: "deal", origin_label: "Deal OPP-2",
  rows: { count: 2, items: ["1.2", "1.3"], more: 0 }, suppliers_total: 3, suppliers_replied: 2, lines_total: 2, lines_awarded: 0, total: 12350, total_is_awarded: false,
  state: { label: "2 of 3 replied", tone: "amber" }, awarded_unpriced: 0, ...over,
});
const data = (over: Partial<CostingData> = {}): CostingData => ({
  pending_estimates: false, pending_rfqs: false, estimates_on: true, rfqs_on: true, can_edit: true, can_create_estimate: true, can_award: true,
  items: [est(), rfq()], boq: { rows: 148, priced: 136, unpriced: 12, stale: 3 }, tiles: { priced: 136, unpriced: 12, rfqs_out: 1, replies_in: 2 },
  templates: [{ id: "t1", name: "Floor tiles" }], rfq_lines: [{ source_line_id: "d1", description: "Skirting", uom: "m", qty: 120, include: true, hint: "no price yet" }],
  rfq_origin_label: "Deal OPP-2", markup_default: 15, currency: "SAR", today: "2026-10-27", stage: "estimating", bid_locked: false, ...over,
});
const tab = (d: CostingData, props: Partial<Parameters<typeof CostingTab>[0]> = {}) =>
  clean(renderToString(createElement(CostingTab, { opportunityId: OPP, canEdit: true, onError: noop, initialData: d, ...props })));

const buttonsOf = (html: string, prefix: string) => [...html.matchAll(/<(?:button|a)\b[^>]*data-guide="([a-z_.]+)"[^>]*>/g)].filter((m) => m[1].startsWith(prefix)).map((m) => m[0]);

describe("the Costing tab", () => {
  it("shows the four figures: rows priced, rows that still need a cost, RFQs out and replies in", () => {
    const out = tab(data());
    expect(out).toContain('data-guide="costing.tab"');
    expect(out).toContain('data-guide="costing.strip"');
    for (const w of ["Rows priced", "Still need a cost", "RFQs out", "Replies in", "of 148 BOQ rows", "rows without a rate"]) expect(out, w).toContain(w);
    expect(out).toContain(">136<");
    expect(out).toContain(">12<");
  });

  it("lists estimates and RFQs together, each with the rows it prices, its state, its total and its age", () => {
    const out = tab(data());
    expect(out).toContain("EST-0016 · Floor tiles");
    expect(out).toContain("RFQ-0012 · Skirting, membrane");
    expect(out).toContain("1.1 · 1.3 · 1.4");
    expect(out).toContain("1.2 · 1.3");
    expect(out).toContain("Changed, re-price");
    expect(out).toContain("2 of 3 replied");
    expect(out).toContain("1,905.49");
    expect(out).toContain("12,350.00");
    expect(out).toContain("Changed 3 d ago");
    expect(out).toContain("Raised 6 d ago");
    expect(out.indexOf("EST-0016")).toBeLessThan(out.indexOf("RFQ-0012"));
    expect(out).toContain(">Estimate<");
    expect(out).toContain(">RFQ<");
  });

  it("'N rows still need a cost' leads to the Bill of quantities, filtered to the unpriced rows, through the optional callback", () => {
    const withBoq = tab(data(), { onOpenBoq: () => {} });
    expect(withBoq).toContain("12 rows still need a cost");
    expect(withBoq).toContain("Show them in the Bill of quantities");
    expect(withBoq).toContain('data-guide="costing.unpriced.open"');
    expect(withBoq).toContain("3 prices are out of date");
    expect(withBoq).toContain('data-guide="costing.stale.open"');
    expect(withBoq).toContain('data-guide="costing.rows.open"');
    const without = tab(data());
    expect(without).toContain("12 rows still need a cost");
    expect(without).not.toContain("Show them in the Bill of quantities");
    expect(without).not.toContain('data-guide="costing.rows.open"');
    const none = tab(data({ boq: { rows: 10, priced: 10, unpriced: 0, stale: 0 }, tiles: { priced: 10, unpriced: 0, rfqs_out: 0, replies_in: 0 } }), { onOpenBoq: () => {} });
    expect(none).not.toContain("still need a cost</b>");
    expect(none).toContain("every row has a rate");
  });

  it("one New RFQ form and New estimate are offered to a person who can edit, and not to one who cannot", () => {
    const out = tab(data());
    expect(out).toContain('data-guide="costing.rfq.new"');
    expect(out).toContain(">New RFQ<");
    expect(out).toContain('data-guide="costing.estimate.new"');
    const view = tab(data(), { canEdit: false });
    expect(view).not.toContain('data-guide="costing.rfq.new"');
    expect(view).not.toContain('data-guide="costing.estimate.new"');
    expect(view).not.toContain("Price the BOQ rows");
    expect(view).not.toContain("Re-price 1 row");
    const noRfq = tab(data({ rfqs_on: false, items: [est()] }));
    expect(noRfq).not.toContain('data-guide="costing.rfq.new"');
  });

  it("New RFQ is disabled while the deal has no row to ask about", () => {
    expect(tab(data({ rfq_lines: [] }))).toMatch(/<button[^>]*data-guide="costing\.rfq\.new"[^>]*disabled/);
    expect(tab(data())).not.toMatch(/<button[^>]*data-guide="costing\.rfq\.new"[^>]*disabled/);
  });

  it("an estimate offers Open, Price the BOQ rows and Re-price when its estimate changed; an RFQ offers Compare and award", () => {
    const out = tab(data());
    expect(out).toContain('data-guide="costing.estimate.open"');
    expect(out).toContain('data-guide="costing.estimate.price_rows"');
    expect(out).toContain("Price more BOQ rows");
    expect(out).toContain("Re-price 1 row");
    expect(out).toContain('data-guide="costing.rfq.compare"');
    expect(out).toContain("Compare and award");
    expect(out).toContain('data-guide="costing.rfq.open"');
  });

  it("a quoted estimate cannot be re-priced and a draft RFQ has nothing to compare", () => {
    const out = tab(data({ items: [est({ locked: true }), rfq({ status: "draft", state: { label: "Draft", tone: "purple" } })] }));
    expect(out).not.toContain('data-guide="costing.estimate.price_rows"');
    expect(out).not.toContain('data-guide="costing.rfq.compare"');
  });

  it("an RFQ raised for an estimate also shows on that estimate, and says where it came from in its own line", () => {
    const out = tab(data({ items: [est({ rfqs: [{ id: "r2", ref: "RFQ-0013", status_label: "Sent", tone: "blue" }] }), rfq({ id: "r2", ref: "RFQ-0013", origin: "estimate", origin_label: "Estimate EST-0016", state: { label: "Sent", tone: "blue" } })] }));
    expect(out).toContain('data-guide="costing.estimate.rfq_chip"');
    expect(out).toContain("RFQ-0013");
    expect(out).toContain("Estimate EST-0016");
  });

  it("an RFQ with awards not yet on a BOQ row offers to price them", () => {
    const out = tab(data({ items: [rfq({ awarded_unpriced: 2 })] }));
    expect(out).toContain("Price 2 awarded rows");
    expect(tab(data({ items: [rfq({ awarded_unpriced: 2 })], can_award: false }))).not.toContain("Price 2 awarded rows");
  });

  it("an empty tab says what to do next", () => {
    const out = tab(data({ items: [], boq: { rows: 4, priced: 0, unpriced: 4, stale: 0 }, tiles: { priced: 0, unpriced: 4, rfqs_out: 0, replies_in: 0 } }));
    expect(out).toContain("Nothing costed yet");
    expect(out).toContain("Build an estimate from a template or ask suppliers for prices");
    expect(out).toContain('data-guide="costing.empty.estimate"');
    expect(out).toContain('data-guide="costing.empty.rfq"');
  });

  it("says plainly when a database update is waiting, and still shows the rest", () => {
    const a = tab(data({ pending_estimates: true, items: [rfq()] }));
    expect(a).toContain("migration 0227");
    expect(a).toContain("RFQ-0012");
    expect(a).not.toContain('data-guide="costing.estimate.new"');
    expect(tab(data({ pending_rfqs: true, items: [est()] }))).toContain("migration 0128");
  });

  it("pages a long list: eight rows, then 'Show all'", () => {
    const many = Array.from({ length: 11 }, (_, i) => est({ id: `e${i}`, ref: `EST-${100 + i}`, name: `Estimate ${i}` }));
    const out = tab(data({ items: many }));
    expect(out).toContain("EST-107");
    expect(out).not.toContain("EST-108");
    expect(out).toContain("Show all 11");
  });

  it("never prints running text: the explanations are behind an i", () => {
    const out = tab(data());
    for (const w of ["Everything that gives your BOQ rows a cost", "Cost 100 with 15 percent", "An estimate shows its total cost"]) expect(out, w).not.toContain(w);
    expect(out.match(/aria-label="About /g)?.length ?? 0).toBeGreaterThan(4);
  });

  it("every control is 44 px tall, nothing has a fixed width, and there is no colour of its own", () => {
    const out = tab(data({ items: [est({ rfqs: [{ id: "r2", ref: "RFQ-0013", status_label: "Sent", tone: "blue" }] }), rfq({ awarded_unpriced: 1 })] }), { onOpenBoq: () => {} });
    for (const b of buttonsOf(out, "costing.")) expect(b, b).toMatch(/min-height:\s?44px|class="[^"]*bpm-btn/);
    for (const b of buttonsOf(out, "costing.").filter((x) => x.includes("style="))) expect(b, b).toMatch(/min-height:44px/);
    expect(out).not.toMatch(/(?<!min-|max-)width:\s?\d{3,}px/);
    const files = [
      "src/components/tender/CostingTab.tsx", ...readdirSync(path.join(ROOT, "src/components/tender/costing")).filter((f) => f.endsWith(".tsx")).map((f) => `src/components/tender/costing/${f}`),
    ];
    for (const f of files) expect(read(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/);
  });

  it("the row component alone: an RFQ opens its compare screen and an estimate its page", () => {
    const html = clean(renderToString(createElement(CostingRow, {
      item: rfq(), opportunityId: OPP, today: "2026-10-27", canEdit: true, canAward: true, rfqsOn: true, onCompare: noop, onPriceRows: noop, onReprice: noop, onPriceAwarded: noop,
    })));
    expect(html).toContain('href="/rfqs/r1"');
    expect(html).toContain("RFQ-0012");
  });
});

// ── The compare and award screen ────────────────────────────────────────────────────────────────────────────────────────────

const view = (over: Partial<CompareView> = {}): CompareView => ({
  rfq: { id: "r1", ref: "RFQ-0012", title: "Skirting, membrane", status: "partially_replied", respond_by: "2026-11-05", origin: "deal" },
  lines: [
    { id: "L1", sl_no: 1, description: "Skirting", uom: "m", qty: 120, status: "open", awarded_unit_cost: null, rows: ["1.2"] },
    { id: "L2", sl_no: 2, description: "Membrane", uom: "m2", qty: 10, status: "open", awarded_unit_cost: null, rows: ["1.3"] },
  ],
  suppliers: [
    { id: "SA", supplier_id: "s1", name: "Supplier A", status: "replied", currency: "SAR", incoterm: null, reminder_count: 0, last_reminded_at: null },
    { id: "SB", supplier_id: "s2", name: "Supplier B", status: "replied", currency: "SAR", incoterm: null, reminder_count: 0, last_reminded_at: null },
    { id: "SC", supplier_id: "s3", name: "Supplier C", status: "sent", currency: null, incoterm: null, reminder_count: 0, last_reminded_at: null },
  ],
  responses: [
    { id: "a1", rfq_supplier_id: "SA", rfq_line_id: "L1", status: "quoted", unit_price: 22, fx_rate: null, currency: "SAR", lead_time_days: 21, moq: null, valid_until: "2026-12-20", note: null, submitted_at: "2026-10-20T08:00:00Z", is_awarded: false, offered_description: null },
    { id: "b1", rfq_supplier_id: "SB", rfq_line_id: "L1", status: "quoted", unit_price: 24, fx_rate: null, currency: "SAR", lead_time_days: 14, moq: null, valid_until: "2026-12-15", note: null, submitted_at: "2026-10-20T08:00:00Z", is_awarded: false, offered_description: null },
    { id: "a2", rfq_supplier_id: "SA", rfq_line_id: "L2", status: "quoted", unit_price: 40, fx_rate: null, currency: "SAR", lead_time_days: null, moq: null, valid_until: "2026-09-01", note: null, submitted_at: "2026-07-20T08:00:00Z", is_awarded: false, offered_description: null },
    { id: "b2", rfq_supplier_id: "SB", rfq_line_id: "L2", status: "quoted", unit_price: 35, fx_rate: null, currency: "SAR", lead_time_days: 10, moq: null, valid_until: "2026-12-15", note: "Ex works", submitted_at: "2026-10-20T08:00:00Z", is_awarded: false, offered_description: null },
  ],
  awards: [], awards_pending: false, today: "2026-10-27", stale_days: 180, max_reminders: 2, tenant_currency: "SAR", markup_default: 15, can_award: true, bid_locked: false, prices_rows: true,
  ...over,
});
const compare = (v: CompareView, extra: Record<string, unknown> = {}) =>
  clean(renderToString(createElement(CompareAward, { opportunityId: OPP, rfqId: "r1", onClose: noop, onChanged: noop, onError: noop, onNotice: noop, initialView: v, ...extra } as never)));

describe("the compare and award screen", () => {
  it("shows the suppliers side by side for each line, with their price, lead time and validity", () => {
    const out = compare(view());
    expect(out).toContain('data-guide="costing.compare"');
    for (const w of ["RFQ-0012 · Skirting, membrane", "Supplier A", "Supplier B", "Supplier C", "22.00 SAR", "24.00 SAR", "21 d lead", "Valid to 20 Dec 2026", "Ex works", "1.2 Skirting", "1.3 Membrane", "No reply"]) expect(out, w).toContain(w);
    expect(out).toMatch(/grid-template-columns:repeat\(auto-fit, ?minmax\(min\(100%, ?200px\), ?1fr\)\)/);
  });

  it("marks the cheapest valid price, and an expired answer in amber even when it is dearer or cheaper", () => {
    const out = compare(view());
    expect(out).toContain(">Lowest valid<");
    expect(out).toContain(">Expired<");
    // line 1: A 22 is the lowest valid; line 2: A's 40 expired, B's 35 is the lowest valid
    expect(out.match(/Lowest valid/g)?.length).toBeGreaterThanOrEqual(3); // legend + two cells
    expect(out).toContain("var(--bluebg)");
  });

  it("offers Award and price on every answer, as the only way to award, and never a bare Award", () => {
    const out = compare(view());
    expect(buttonsOf(out, "costing.compare.award").filter((b) => b.includes('data-guide="costing.compare.award"'))).toHaveLength(4);
    expect(out).toContain(">Award and price<");
    expect(out).not.toMatch(/>Award<\/button>/);
    expect(out).toContain("Award all 2 lines");
  });

  it("a person who cannot award sees the answers and no award button", () => {
    const out = compare(view({ can_award: false }));
    expect(out).toContain("22.00 SAR");
    expect(out).not.toContain('data-guide="costing.compare.award"');
    expect(out).not.toContain("Award all");
  });

  it("shows an award with who chose it, the price it carries onto the row and when a row is still waiting", () => {
    const v = view({
      lines: [{ ...view().lines[0], status: "awarded", awarded_unit_cost: 22 }, view().lines[1]],
      awards: [{ id: "w1", rfq_line_id: "L1", rfq_supplier_id: "SA", response_id: "a1", chosen_at: "2026-10-26T08:00:00Z", chosen_by_name: "S. Khan", reason: null, not_lowest: false, landed_unit: 22, applied_to_deal_at: "2026-10-26T08:00:00Z", applied_rate: 25.3 }],
    });
    const out = compare(v);
    expect(out).toContain("Awarded · 22.00 SAR");
    expect(out).toContain("S. Khan");
    expect(out).toContain("On the row at");
    expect(out).toContain("25.30");
    expect(out).not.toContain("Not on the row yet");
    const waiting = compare(view({ awards: [{ id: "w2", rfq_line_id: "L1", rfq_supplier_id: "SA", response_id: "a1", chosen_at: "2026-10-26T08:00:00Z", chosen_by_name: null, reason: null, not_lowest: false, landed_unit: 22, applied_to_deal_at: null, applied_rate: null }] }));
    expect(waiting).toContain("Not on the row yet");
    expect(waiting).toContain("1 awarded line not on its BOQ row yet");
    expect(waiting).toContain('data-guide="costing.compare.price_awarded"');
  });

  it("says when awarding needs a database update, when the bid is already in, and that an estimate RFQ goes through the estimate", () => {
    expect(compare(view({ awards_pending: true, can_award: false }))).toContain("migration 0224");
    expect(compare(view({ bid_locked: true }))).toContain("A new rate does not change a version you submitted");
    const estimateRfq = compare(view({ prices_rows: false, rfq: { ...view().rfq, origin: "estimate" } }));
    expect(estimateRfq).toContain("raised for an estimate");
    expect(estimateRfq).not.toContain('data-guide="costing.compare.waiting"');
  });

  it("the award panel states the sum: cost, markup and rate", () => {
    const v = view();
    const out = compare(v, { initialPanel: { supplierId: "SA", picks: [{ line: v.lines[0], resp: v.responses[0] }] } });
    expect(out).toContain('data-guide="costing.award"');
    expect(out).toContain("Cost 22.00 + 15% = rate 25.30");
    expect(out).toContain("Markup %");
    expect(out).toContain('data-guide="costing.award.confirm"');
    expect(out).toContain(">Award and price<");
    expect(out).not.toContain('data-guide="costing.award.reason"'); // the lowest valid price needs no reason
  });

  it("a price that is not the lowest valid one asks for a reason, and a replacement says what it replaces", () => {
    const v = view({
      lines: [{ ...view().lines[0], status: "awarded", awarded_unit_cost: 22 }, view().lines[1]],
      awards: [{ id: "w1", rfq_line_id: "L1", rfq_supplier_id: "SA", response_id: "a1", chosen_at: "2026-10-26T08:00:00Z", chosen_by_name: null, reason: null, not_lowest: false, landed_unit: 22, applied_to_deal_at: "2026-10-26T08:00:00Z", applied_rate: 25.3 }],
    });
    const out = compare(v, { initialPanel: { supplierId: "SB", picks: [{ line: v.lines[0], resp: v.responses[1] }] } });
    expect(out).toContain("Not the lowest valid price. A reason is needed.");
    expect(out).toContain('data-guide="costing.award.reason"');
    expect(out).toContain("Replaces the award to Supplier A.");
    expect(out).toContain("Replace and price");
    expect(out).toContain("Cost 24.00 + 15% = rate 27.60");
  });

  it("a foreign price asks for the exchange rate", () => {
    const v = view();
    const usd = { ...v.responses[0], currency: "USD", unit_price: 6 };
    const out = compare(view({ responses: [usd, ...v.responses.slice(1)] }), { initialPanel: { supplierId: "SA", picks: [{ line: v.lines[0], resp: usd }] } });
    expect(out).toContain('data-guide="costing.award.fx"');
    expect(out).toContain("Exchange rate to SAR");
  });

  it("an estimate RFQ's award panel has no markup (the estimate prices the rows)", () => {
    const v = view({ prices_rows: false });
    const out = compare(v, { initialPanel: { supplierId: "SA", picks: [{ line: v.lines[0], resp: v.responses[0] }] } });
    expect(out).not.toContain('data-guide="costing.award.markup"');
    expect(out).not.toContain("= rate");
  });

  it("controls are 44 px tall and nothing in the screen carries the word commission", () => {
    const v = view();
    const out = compare(v, { initialPanel: { supplierId: "SA", picks: [{ line: v.lines[0], resp: v.responses[0] }] } });
    for (const b of buttonsOf(out, "costing.").filter((x) => x.includes("style="))) expect(b, b).toMatch(/min-height:44px/);
    expect(out.toLowerCase()).not.toContain("commission");
  });
});

describe("price the BOQ rows from an estimate", () => {
  it("shows the proposal with a tick, the share and the cost per unit, and the markup that starts at the workspace default", () => {
    const html = clean(renderToString(createElement(PriceRowsPanel, {
      opportunityId: OPP, estimate: { id: "e1", ref: "EST-0016", name: "Floor tiles" }, markupDefault: 15, bidLocked: false, onClose: noop, onDone: noop, onError: noop,
      initialData: {
        estimate: { id: "e1", ref: "EST-0016", name: "Floor tiles" }, outputs: [{ key: "total", label: "Whole estimate", cost: 1000 }], existing: [],
        rows: [{ boq_id: "b1", item_no: "1.1", row_no: 8, description: "Supply tiles", qty: 100, uom: "m2", amount: 0, output: "total", output_label: "Whole estimate", output_cost: 1000, band: "spread", score: null, share_pct: 100 }],
      },
    })));
    expect(html).toContain("Price the BOQ rows from EST-0016");
    expect(html).toContain('data-guide="costing.price_rows.row"');
    expect(html).toContain("100% · 10.00 / m2");
    expect(html).toContain('value="15"');
    expect(html).toContain("Apply to 1 row");
    expect(html).toContain("Unallocated");
    expect(html.toLowerCase()).not.toContain("commission");
  });
});

// ── The tab on the deal page ────────────────────────────────────────────────────────────────────────────────────────────────

const opp = { id: OPP, tenant_id: "t1", ref: "OPP-2", title: "Valves", account_id: "acc", contact_id: null, stage: "estimating", outcome: "open", amount: 0, probability: 25, owner_id: "u1", team: [], source: "direct", created_at: "2026-10-01T00:00:00Z", stage_since: "2026-10-01T00:00:00Z", expected_close: "2026-10-30", description: "", competitor: null, closed_at: null, loss_reason: null, probability_override: null, probability_override_reason: null } as unknown as Opportunity & { stage_since: string };
const stages = [{ value: "estimating", label: "Estimating", probability_hint: 25 }] as unknown as OpportunityStageDef[];
const tview: TenderView = {
  tender_no: "ARB-1", issuer_name: "Aramco", issuer_account_id: null, portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z", bid_bond_amount: null, bid_bond_currency: null,
  bid_bond_expiry: null, addenda_count: 0, decision: null, decision_reason: null, decided_by_name: null, decided_at: null, source_email_id: null, bond_status: "issued", bond_released_at: null, bond_released_by_name: null,
};
const page = (tender: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => clean(renderToString(createElement(OpportunityDetailClient, {
  opp, accountName: "Aramco", contacts: [], initialLines: [] as OpportunityLine[], linesVersion: "v1", quotes: [], stages, members: [], products: [], pricingEnabled: false, standardQuotesEnabled: false,
  todayKey: "2026-10-27", currentUserId: "u1", activity: createElement("div", null, "H"),
  tender: tender === null ? null : { view: tview, room: null, approval: null, accounts: [], nowIso: "2026-10-27T00:00:00Z", timezone: "Asia/Riyadh", ...tender },
  ...extra,
} as never)));
const tabLabels = (html: string) => [...html.matchAll(/role="tab"[^>]*>([^<]*)/g)].map((m) => m[1].replace(/\d+$/, ""));

describe("the Costing tab on the deal page", () => {
  it("sits right after the BOQ tab and replaces Estimates", () => {
    const labels = tabLabels(page({ costing: { canEdit: true } }));
    expect(labels).toContain("Costing");
    expect(labels).not.toContain("Estimates");
    expect(labels.indexOf("Costing")).toBe(labels.indexOf("BOQ") + 1);
  });

  it("is absent when the person may see neither Estimates nor RFQs, and a standard deal never has it", () => {
    expect(tabLabels(page({}))).not.toContain("Costing");
    expect(tabLabels(page(null))).not.toContain("Costing");
  });

  it("opens on its own tab with the loading note until the list arrives", () => {
    const out = page({ costing: { canEdit: true } }, { initialTab: "costing" });
    expect(out).toContain("Loading Costing");
  });

  it("the deal client wires the tab by the tender's own flag and hands it the callbacks; the page maps ?tab=estimates to it", () => {
    const client = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(client).toMatch(/tender\?\.costing \? \[\{ id: "costing" as Tab, label: "Costing" \}\]/);
    expect(client).toMatch(/tab === "costing" && tender\?\.costing && <CostingTab/);
    expect(client).toContain('onOpenBoq={() => setTab("boq")}');
    expect(client).not.toContain("EstimatesTab");
    const pageSrc = read("src/app/(app)/pipeline/[id]/page.tsx");
    expect(pageSrc).toMatch(/costing: costingTab/);
    expect(pageSrc).toMatch(/wantedTab === "costing" \|\| wantedTab === "estimates"/);
    expect(pageSrc).toMatch(/related=\{rfqOn && !tender \?/);
  });

  it("the standard deal's RFQ card is untouched: it still gets its Related tab", () => {
    const labels = tabLabels(page(null, { related: createElement("div", null, "RFQ"), initialTab: "overview" }));
    expect(labels).toContain("Related");
  });
});

describe("the RFQ page for a tender RFQ", () => {
  it("points to the Costing tab instead of awarding, and the standard RFQ is unchanged", () => {
    const cmp = read("src/components/rfq/RfqCompare.tsx");
    expect(cmp).toContain("costing_href");
    expect(cmp).toMatch(/!b\.awards_pending && !b\.costing_href/);
    const route = read("src/app/api/rfqs/[id]/route.ts");
    expect(route).toMatch(/tenant\?\.features\?\.gcc_tender === true/);
    expect(route).toContain("?tab=costing");
  });
});
