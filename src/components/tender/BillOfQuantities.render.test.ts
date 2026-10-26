import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pillar } from "@/lib/theme";
import type { LinkView } from "@/lib/tender/estimates/server";

// GCC tender deals, redesign 2026-10-27: the Bill of quantities is ONE table (the old BOQ tab and Lines tab merged). Rendered on the
// server with the real components: the desktop table and the phone cards share their data, so the checks are the ones that decide whether
// a phone fits (44 px targets, no table, no fixed widths), what each row must say (the client's item number, a source, chips), what
// the toolbar must NOT carry (the downloads), and what the panel must never do (award a supplier).

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

import BoqTab, { type BoqScreenState } from "./BoqTab";
import BoqDownloads, { AnswerSheetButton, PricedBoqButton } from "./BoqDownloads";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const noop = () => {};
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const base = {
  id: "", line_id: "l", row_no: 8, item_no: "A.1", cost_code: null, description: "", uom: "m3", qty: 10, rate: 0, amount: 0, priced: false, linked: true, removed: false,
  price_source: null, price_source_ref: null, price_as_of: null, stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null, file_rate: null,
};
const row = (over: Record<string, unknown>) => ({ ...base, ...over }) as BoqScreenState["lines"][number];
const LINES = [
  row({ id: "b1", row_no: 8, item_no: "A.1", description: "Excavation in ordinary soil", qty: 1200, rate: 20, amount: 24000, priced: true, price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes", price_as_of: "2025-12-01", stale: true, stale_text: "stale, 329 days old", unit_cost: 16, markup_pct: 25 }),
  row({ id: "b2", row_no: 9, item_no: "A.2", description: "Backfill", qty: 850.5 }),
  row({ id: "b3", row_no: 10, item_no: "A.3", description: "Precast wall panel", qty: 64, uom: "Nos", rate: 115, amount: 7360, priced: true, price_source: "estimate", price_source_ref: "EST-0016", price_as_of: "2026-10-20", unit_cost: 100, markup_pct: 15 }),
  row({ id: "b4", row_no: 11, item_no: "A.4", description: "Geotextile", qty: 30, rate: 9.5, amount: 285, priced: true, price_source: "manual", price_source_ref: "was Supplier · RFQ-0012 · Gulf Pipes", price_as_of: "2026-10-25" }),
  row({ id: "b5", row_no: 12, item_no: null, description: "Row without a number", qty: 1 }),
  row({ id: "b6", row_no: 13, item_no: "A.6", description: "Dropped in revision", removed: true, rate: 5, amount: 5, priced: true, price_source: "manual" }),
];
const state = (over: Partial<BoqScreenState> = {}): BoqScreenState => ({
  pending: false,
  source: { file_name: "ARB-4400123 BOQ.xlsx", sheet_name: "BOQ Bill 1", version: 2, uploaded_at: "2026-10-26T08:00:00Z", line_count: 5, added_columns: true },
  lines: LINES, validity_days: 180, today: "2026-10-26", default_markup_pct: 15,
  totals: { lines: 5, priced: 3, unpriced: 2, stale: 1, amount: 31645, no_product: 0 }, unpriced: [{ item: "A.2 Backfill", reason: "No rate yet" }],
  ...over,
} as BoqScreenState);
const link = (over: Partial<LinkView> = {}): LinkView => ({
  id: "99999999-9999-4999-8999-999999999991", boq_id: "b3", estimate_id: "e1", estimate_ref: "EST-0016", estimate_name: "Precast", output: "total", output_label: "Whole estimate", basis: "total", share_pct: 100,
  applied_cost: 100, waiting: false, stale: false, broken: false, needs_review: false, review_note: null, ...over,
});
const estimates = (links: LinkView[]) => ({ pending: false, estimates: [], links, today: "2026-10-26", valid_days: 180, bid_locked: false, stage: "estimating" });

const html = (p: Partial<Parameters<typeof BoqTab>[0]> = {}, search = "") => {
  nav.search = search;
  return clean(renderToString(createElement(BoqTab, { opportunityId: OPP, canEdit: true, onError: noop, onNotice: noop, initialData: state(), layout: "table", ...p } as never)));
};

describe("the table (desktop)", () => {
  it("is one table, one row per client line, with the client's item numbers as written and a row without a number named by its row in the file", () => {
    const out = html();
    expect(out).toContain("<table");
    for (const th of ["Item", "Description", "Qty", "Unit", "Source", "Cost", "Mk", "Rate", "Amount", "Linked"]) expect(out, th).toContain(`>${th}</th>`);
    for (const item of ["A.1", "A.2", "A.3", "A.4", "#12"]) expect(out, item).toContain(`aria-label="Open item ${item}"`);
    expect(out).not.toContain("Dropped in revision");
    expect(out.match(/data-guide="boq\.line"/g)?.length).toBe(5);
    expect(out).toContain("1,200");
    expect(out).toContain("850.5");
    expect(out).toContain("24,000.00");
  });

  it("the Source cell keeps its source: supplier with its reference, estimate, and a manual rate that remembers what it replaced", () => {
    const out = html();
    expect(out).toContain("Supplier");
    expect(out).toContain("RFQ-0012 · Gulf Pipes");
    expect(out).toContain("Tender estimate");
    expect(out).toContain("Manual");
    expect(out).toContain("was Supplier · RFQ-0012 · Gulf Pipes");
  });

  it("chips: the estimate, the RFQ, unpriced and stale, from the rate's source or the deal's estimate links", () => {
    const out = html();
    expect(out.match(/data-chip="rfq"/g)?.length).toBe(1);
    expect(out).toContain("RFQ-0012");
    expect(out.match(/data-chip="estimate"/g)?.length).toBe(1);
    expect(out).toContain("EST-0016");
    expect(out.match(/data-chip="unpriced"/g)?.length).toBe(2);
    expect(out.match(/data-chip="stale"/g)?.length).toBe(1);
    const changed = html({ initialEstimates: estimates([link({ stale: true })]) as never });
    expect(changed).toContain('data-chip="changed"');
    expect(changed).toContain("Estimate changed");
  });

  it("a click on the first cell is a button the keyboard can reach, at least 44 px tall", () => {
    const out = html();
    const buttons = [...out.matchAll(/<button[^>]*data-guide="boq\.open_row"[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBe(5);
    for (const b of buttons) expect(b).toMatch(/min-height:44px/);
  });
});

describe("the phone layout", () => {
  const out = html({ layout: "cards" });

  it("is a stack of cards, not a table, with the item number and the chips in each card", () => {
    expect(out).not.toContain("<table");
    expect(out).toContain('data-guide="boq.cards"');
    expect(out.match(/data-guide="boq\.line"/g)?.length).toBe(5);
    for (const item of ["A.1", "A.2", "#12"]) expect(out, item).toContain(`aria-label="Open item ${item}"`);
    expect(out).toContain('data-chip="rfq"');
    expect(out).toContain("was Supplier");
  });

  it("every card and every toolbar control is a 44 px target, and nothing has a fixed pixel width over 200", () => {
    for (const b of [...out.matchAll(/<button[^>]*data-guide="boq\.(?:line|price_all|upload|show_more)[^"]*"[^>]*>/g)].map((m) => m[0])) expect(b, b).toMatch(/min-height:44px/);
    expect(out).not.toMatch(/(?<![-\w])(?:min-)?width:\s*(?:[2-9]\d\d|\d{4,})px/);
  });
});

describe("the toolbar, the strip and the filters", () => {
  it("has Upload, Match (when lines have no product), Price all and the markup, and NO downloads", () => {
    const out = html({ initialData: state({ totals: { lines: 5, priced: 3, unpriced: 2, stale: 1, amount: 31645, no_product: 3 } }) });
    const bar = out.slice(out.indexOf('data-guide="boq.toolbar"'), out.indexOf('data-guide="boq.summary"'));
    expect(bar).toContain("Upload revised BOQ");
    expect(bar).toContain("Price all lines");
    expect(bar).toContain('data-guide="boq.markup"');
    expect(out).toContain('data-guide="boq.match.chip"');
    for (const w of ["Download priced BOQ", "Export answer sheet", "boq.download", "boq.answer_sheet"]) expect(out, w).not.toContain(w);
  });

  it("the markup starts at the workspace's default, 15 unless it says otherwise", () => {
    expect(html()).toMatch(/<input[^>]*value="15"/);
    expect(html({ initialData: state({ default_markup_pct: 22.5 }) })).toMatch(/<input[^>]*value="22.5"/);
    expect(html({ initialData: { ...state(), default_markup_pct: undefined } })).toMatch(/<input[^>]*value="15"/);
  });

  it("the strip says lines, the priced percent and the total at cost plus markup", () => {
    const out = html();
    expect(out).toContain('data-guide="boq.summary"');
    for (const w of ["Lines", "Priced", "Total", "60%", "3 of 5, 2 to price", "at cost + markup", "31,645.00"]) expect(out, w).toContain(w);
  });

  it("filters All, Unpriced and Stale carry their counts; the address picks one and shows only those rows", () => {
    const out = html();
    expect(out).toContain("All 5");
    expect(out).toContain("Unpriced 2");
    expect(out).toContain("Stale 1");
    const unpriced = html({}, "boqfilter=unpriced");
    expect(unpriced.match(/data-guide="boq\.line"/g)?.length).toBe(2);
    expect(unpriced).toContain("Backfill");
    expect(unpriced).not.toContain("Excavation in ordinary soil");
    const stale = html({}, "boqfilter=stale");
    expect(stale.match(/data-guide="boq\.line"/g)?.length).toBe(1);
    expect(stale).toContain("Excavation in ordinary soil");
    expect(html({}, "boqfilter=nonsense").match(/data-guide="boq\.line"/g)?.length).toBe(5);
    for (const f of [...out.matchAll(/<button[^>]*data-guide="boq\.filter\.[a-z]+"[^>]*>/g)].map((m) => m[0])) expect(f).toMatch(/min-height:44px/);
  });

  it("says so when a filter leaves no rows", () => {
    const none = html({ initialData: state({ lines: LINES.filter((l) => l.priced), totals: { lines: 3, priced: 3, unpriced: 0, stale: 0, amount: 1, no_product: 0 } }) }, "boqfilter=unpriced");
    expect(none).toContain("No unpriced rows");
    expect(none).not.toContain("<table");
  });

  it("long BOQs are paged: 50 rows and 'Show 50 more'", () => {
    const many = Array.from({ length: 140 }, (_, i) => row({ id: `m${i}`, row_no: i + 1, item_no: `${i + 1}.0`, description: `Item number ${i + 1}` }));
    const out = html({ initialData: state({ lines: many, totals: { lines: 140, priced: 0, unpriced: 140, stale: 0, amount: 0, no_product: 0 } }) });
    expect(out.match(/data-guide="boq\.line"/g)?.length).toBe(50);
    expect(out).toContain("Show 50 more (90 not shown)");
    expect(out).toContain("Item number 50");
    expect(out).not.toContain("Item number 51<");
  });

  it("keeps its explanations behind the i and prints none as running text", () => {
    const out = html();
    for (const w of ["Open a row to change its quantity or rate", "Estimate and RFQ name what the cost comes from", "The priced rows added up at their rates"]) expect(out.split(w).length - 1, w).toBeLessThanOrEqual(0);
    expect(out).toContain('aria-label="About Bill of quantities"');
  });

  it("carries no colour literal and no coloured edge on its tiles", () => {
    const out = html();
    expect(Object.values(pillar).reduce((h, p) => h.split(p.base).join(""), out)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const f of ["src/components/tender/BoqTab.tsx", "src/components/tender/BoqRows.tsx", "src/components/tender/BoqRowPanel.tsx", "src/components/tender/BoqRows.module.css", "src/components/tender/BoqUpload.tsx", "src/components/tender/BoqDownloads.tsx"]) {
      expect(read(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("a view-only person sees the rows but no upload, price-all or markup", () => {
    const out = html({ canEdit: false });
    expect(out).toContain("Excavation in ordinary soil");
    for (const w of ["Upload revised BOQ", "Price all lines", 'data-guide="boq.markup"']) expect(out, w).not.toContain(w);
  });

  it("before any upload: the next step in words and the upload button; a pending migration says so", () => {
    const empty = html({ initialData: state({ source: null, lines: [], totals: { lines: 0, priced: 0, unpriced: 0, stale: 0, amount: 0 } }) });
    expect(empty).toContain("Upload the client&#x27;s Excel");
    expect(empty).toContain("Upload BOQ (.xlsx)");
    expect(empty).not.toContain('data-guide="boq.summary"');
    expect(html({ initialData: state({ pending: true }) })).toContain("migration 0223");
  });
});

describe("the row panel", () => {
  const open = (p: Partial<Parameters<typeof BoqTab>[0]> = {}, id = "b1") => html({ initialOpenRow: id, ...p });

  it("opens a dialog with the item number, quantity, rate and description to edit, and Save", () => {
    const out = open();
    expect(out).toContain('role="dialog"');
    expect(out).toContain("Item A.1");
    for (const g of ["boq.row.description", "boq.row.qty", "boq.row.rate", "boq.row.save"]) expect(out, g).toContain(`data-guide="${g}"`);
    expect(out).toContain("Excavation in ordinary soil");
    expect(out).toMatch(/<input[^>]*value="1200"/);
    expect(out).toMatch(/<input[^>]*value="20"/);
    for (const b of [...out.matchAll(/<button[^>]*data-guide="boq\.row\.(?:save|costing)"[^>]*>/g)].map((m) => m[0])) expect(b).toMatch(/min-height:44px/);
  });

  it("shows where the cost came from, read-only: source, date, cost plus markup, the RFQ it was awarded under", () => {
    const out = open();
    expect(out).toContain("Where the cost came from");
    expect(out).toContain("Cost 16.00 + 25% markup = rate 20.00");
    expect(out).toContain("stale, 329 days old");
    expect(out).toContain('data-guide="boq.row.rfq"');
    expect(out).toContain("Awarded under");
    expect(out).toContain("RFQ-0012");
  });

  it("shows the estimate that prices the row, and that it changed, and its quantity note", () => {
    const out = open({ initialEstimates: estimates([link({ stale: true, quantity: { status: "mismatch", needs_confirm: false, note: "Built for 10 m, the BOQ line is 12 m" } as never })]) as never }, "b3");
    expect(out).toContain('data-guide="boq.row.estimate"');
    expect(out).toContain("Whole estimate");
    expect(out).toContain("The estimate changed, re-price it in Costing");
    expect(out).toContain("Built for 10 m, the BOQ line is 12 m");
  });

  it("a manual rate shows the source it replaced", () => {
    const out = open({}, "b4");
    expect(out).toContain("Replaced: Supplier · RFQ-0012 · Gulf Pipes");
  });

  it("an unpriced row says there is no cost yet", () => {
    expect(open({}, "b2")).toContain("No cost yet.");
  });

  it("hands over to Costing through a callback, and draws the button only when the page gave one", () => {
    expect(open()).not.toContain('data-guide="boq.row.costing"');
    const out = open({ onOpenCosting: noop });
    expect(out).toContain('data-guide="boq.row.costing"');
    expect(out).toContain("Open in Costing");
  });

  it("never awards a supplier: no Award button, and the 'Award in Costing' note on an RFQ reply in the list", () => {
    const out = open({ onOpenCosting: noop });
    expect(out).not.toMatch(/<button[^>]*>[^<]*Award/);
    const src = read("src/components/tender/BoqRowPanel.tsx");
    expect(src).toMatch(/rfqCand/);
    expect(src).toContain("Award in Costing");
    expect(src).not.toMatch(/\/award|source: "supplier"/);
  });

  it("a view-only person sees the values but cannot save", () => {
    const out = open({ canEdit: false });
    expect(out).toContain("Item A.1");
    expect(out).not.toContain('data-guide="boq.row.save"');
    expect(out).toMatch(/<input[^>]*disabled=""/);
  });
});

describe("the downloads moved to the Bid tab and stay reusable", () => {
  it("export the two buttons and a pair, with the same ids, for the Bid tab to mount", () => {
    const priced = clean(renderToString(createElement(PricedBoqButton, { opportunityId: OPP })));
    const answer = clean(renderToString(createElement(AnswerSheetButton, { opportunityId: OPP })));
    const both = clean(renderToString(createElement(BoqDownloads, { opportunityId: OPP })));
    expect(priced).toContain("Download priced BOQ");
    expect(priced).toContain('data-guide="boq.download"');
    expect(answer).toContain("Export answer sheet");
    expect(answer).toContain('data-guide="boq.answer_sheet"');
    expect(both).toContain("Download priced BOQ");
    expect(both).toContain("Export answer sheet");
    for (const b of [...both.matchAll(/<button[^>]*data-guide="boq\.(?:download|answer_sheet)"[^>]*>/g)].map((m) => m[0])) expect(b).toMatch(/min-height:44px/);
  });

  it("go through the unchanged export route and ask about unpriced lines first", () => {
    const src = read("src/components/tender/BoqDownloads.tsx");
    expect(src).toMatch(/\/export\?kind=\$\{kind\}/);
    expect(src).toMatch(/Download anyway/);
    expect(read("src/app/api/opportunities/[id]/boq/export/route.ts")).toMatch(/kind/);
  });
});
