import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { LinkView } from "@/lib/tender/estimates/server";
import type { EstimateTenderContext } from "@/lib/tender/estimates/context";
import { SEVERAL_PARTS_TEXT } from "@/lib/tender/estimates/rules";

// The rehearsal of the tender flow (2026-11-26), rendered on the server with the real components: the way off a wrong link, the whole
// scope that is never applied to one line, the chip that says "Re-price" beside the rate, and one markup for every way of pricing.

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), usePathname: () => "/pipeline/x" }));

import BoqTab, { type BoqScreenState } from "./BoqTab";
import TenderEstimateStrip from "./TenderEstimateStrip";
import { PanelLinkActions, SharedLineNote } from "./BoqEstimates";

const clean = (h: string) => h.replace(/<!-- -->/g, "");
const noop = () => {};
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const EST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const EST2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";

const base = {
  id: "", line_id: "l", row_no: 8, item_no: "A.1", cost_code: null, description: "", uom: "m3", qty: 10, rate: 0, amount: 0, priced: false, linked: true, removed: false,
  price_source: null, price_source_ref: null, price_as_of: null, stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null, file_rate: null,
};
const row = (over: Record<string, unknown>) => ({ ...base, ...over }) as BoqScreenState["lines"][number];
const priced = { priced: true, rate: 57.56, amount: 575.6, price_source: "estimate", price_source_ref: "EST-0001", price_as_of: "2026-11-26", unit_cost: 50.05, markup_pct: 15 };
const LINES = [
  row({ id: "b1", row_no: 8, item_no: "A.1", description: "Soil replacement", qty: 10, ...priced }),
  row({ id: "b2", row_no: 9, item_no: "A.2", description: "Backfill", qty: 5, ...priced }),
  row({ id: "b3", row_no: 10, item_no: "A.3", description: "Blockwork", qty: 5, rate: 9, amount: 45, priced: true, price_source: "manual" }),
];
const state = (): BoqScreenState => ({
  pending: false, source: { file_name: "BOQ.xlsx", sheet_name: "Bill 1", version: 1, uploaded_at: "2026-11-26T08:00:00Z", line_count: 3, added_columns: true },
  lines: LINES, validity_days: 180, today: "2026-11-26", default_markup_pct: 15, totals: { lines: 3, priced: 3, unpriced: 0, stale: 0, amount: 1196.2, no_product: 0 }, unpriced: [],
} as BoqScreenState);
const link = (over: Partial<LinkView> = {}): LinkView => ({
  id: "99999999-9999-4999-8999-999999999991", boq_id: "b1", estimate_id: EST, estimate_ref: "EST-0001", estimate_name: "Plant", output: "total", output_label: "Whole estimate", basis: "total", share_pct: 100,
  applied_cost: 50.05, waiting: false, stale: false, broken: false, needs_review: false, review_note: null, ...over,
});
const estimates = (links: LinkView[]) => ({ pending: false, estimates: [], links, today: "2026-11-26", valid_days: 180, bid_locked: false, stage: "estimating" });
const html = (p: Partial<Parameters<typeof BoqTab>[0]> = {}, search = "") => {
  nav.search = search;
  return clean(renderToString(createElement(BoqTab, { opportunityId: OPP, canEdit: true, onError: noop, onNotice: noop, initialData: state(), layout: "table", ...p } as never)));
};

describe("Re-price beside the rate (defect 6)", () => {
  const stale = estimates([link({ boq_id: "b1", stale: true })]);

  it("a row whose estimate changed carries a Re-price chip in the Rate cell, in the table and on a phone, and others carry none", () => {
    const table = html({ initialEstimates: stale as never });
    expect(table.match(/data-chip="reprice"/g)).toHaveLength(1);
    expect(table).toContain("Re-price");
    expect(table).toMatch(/<td class="[^"]*num[^"]*"><span[^>]*><b>57\.56<\/b><span data-chip="reprice"/);
    const cards = html({ initialEstimates: stale as never, layout: "cards" });
    expect(cards.match(/data-chip="reprice"/g)).toHaveLength(1);
  });

  it("a build-up still waiting, a broken link, or a current estimate shows nothing", () => {
    for (const l of [link({ boq_id: "b1", stale: true, waiting: true }), link({ boq_id: "b1", stale: true, broken: true }), link({ boq_id: "b1" })]) {
      expect(html({ initialEstimates: estimates([l]) as never })).not.toContain('data-chip="reprice"');
    }
  });

  it("the Stale button counts it, and filtering by Stale lists it", () => {
    const out = html({ initialEstimates: stale as never });
    expect(out).toMatch(/data-guide="boq\.filter\.stale"[^>]*>\s*Stale 1/);
    expect(html({ initialEstimates: stale as never }, "boqfilter=stale")).toContain("Soil replacement");
    expect(html({ initialEstimates: stale as never }, "boqfilter=stale")).not.toContain("Blockwork");
    expect(html({ initialEstimates: estimates([]) as never })).toMatch(/data-guide="boq\.filter\.stale"[^>]*>\s*Stale 0/);
  });
});

describe("the row panel (defects 1 and 2)", () => {
  const open = (links: LinkView[], p: Partial<Parameters<typeof BoqTab>[0]> = {}, id = "b1") => html({ initialOpenRow: id, initialEstimates: estimates(links) as never, ...p });

  it("every estimate link in the drawer has an Unlink button, a 44 px target", () => {
    const out = open([link(), link({ id: "99999999-9999-4999-8999-999999999992", estimate_id: EST2, estimate_ref: "EST-0002" })]);
    expect(out.match(/data-guide="boq\.estimate\.unlink"/g)).toHaveLength(2);
    for (const b of [...out.matchAll(/<button[^>]*data-guide="boq\.estimate\.unlink"[^>]*>/g)].map((m) => m[0])) expect(b).toMatch(/min-height:44px/);
  });

  it("a person who may only look sees no Unlink", () => {
    expect(open([link()], { canEdit: false })).not.toContain('data-guide="boq.estimate.unlink"');
  });

  it("two estimates on one line are said once, in plain words", () => {
    const out = open([link(), link({ id: "99999999-9999-4999-8999-999999999992", estimate_id: EST2, estimate_ref: "EST-0002" })]);
    expect(out).toContain("Priced from 2 estimates: their costs add up.");
    expect(open([link()])).not.toContain("their costs add up");
  });

  it("a whole-scope estimate waiting for the line says to pick the part and offers the picker", () => {
    const out = open([link({ waiting: true, applied_cost: null, several_parts: true })]);
    expect(out).toContain(SEVERAL_PARTS_TEXT);
    expect(out).toContain('data-guide="boq.estimate.pick_part"');
    const plain = open([link({ waiting: true, applied_cost: null })]);
    expect(plain).not.toContain(SEVERAL_PARTS_TEXT);
    expect(plain).not.toContain('data-guide="boq.estimate.pick_part"');
  });

  it("the actions component alone: Unlink always (for an editor), the picker only for a waiting whole scope", () => {
    const render = (l: LinkView, canEdit = true) => clean(renderToString(createElement(PanelLinkActions, { l, base: "/x", canEdit, bidLocked: false, onPick: noop, onChanged: noop, onError: noop, onNotice: noop })));
    expect(render(link())).toContain("Unlink");
    expect(render(link())).not.toContain("Pick the part");
    expect(render(link({ waiting: true, several_parts: true }))).toContain("Pick the part");
    expect(render(link(), false)).toBe("");
  });

  it("the shared-line note needs two different estimates, and ignores a broken link", () => {
    const render = (ls: LinkView[]) => clean(renderToString(createElement(SharedLineNote, { links: ls })));
    expect(render([link(), link({ estimate_id: EST2 })])).toContain("Priced from 2 estimates");
    expect(render([link(), link({ output: "wbs:2" })])).toBe("");
    expect(render([link(), link({ estimate_id: EST2, broken: true })])).toBe("");
  });
});

describe("the strip on the estimate page (defect 1)", () => {
  const ctx = (links: EstimateTenderContext["links"]): EstimateTenderContext => ({
    deal: { id: OPP, ref: "OPP-0014", title: "Wastewater tender", stage: "estimating" }, bid_locked: false, links, missing: [], origin_label: "Estimate EST-0001 (Tender OPP-0014)",
    valid_days: 180, rfq_enabled: true, locked: false,
  });
  const waiting = (over: Partial<EstimateTenderContext["links"][number]> = {}): EstimateTenderContext["links"][number] => ({
    link_id: "l1", boq_id: "b1", item_no: "A1005", item: "A1005 Soil replacement", qty: 62400, uom: "m3", waiting: true, stale: false, needs_review: false, review_note: null, output_label: "Whole estimate", ...over,
  });
  const strip = (c: EstimateTenderContext) => clean(renderToString(createElement(TenderEstimateStrip, { ctx: c, estimateId: EST, canEdit: true })));

  it("an estimate that prices several parts gets no Apply, the sentence, and a way to the part picker on that BOQ line", () => {
    const out = strip(ctx([waiting({ several_parts: true })]));
    expect(out).not.toContain("Apply to BOQ line");
    expect(out).toContain(SEVERAL_PARTS_TEXT);
    expect(out).toContain('data-guide="tender.estimate.pick_part"');
    expect(out).toContain(`href="/pipeline/${OPP}?tab=boq&amp;row=b1"`);
    expect(out).toMatch(/<a style="min-height:44px"[^>]*data-guide="tender\.estimate\.pick_part"/);
  });

  it("a single-output build-up keeps Apply", () => {
    const out = strip(ctx([waiting({ several_parts: false })]));
    expect(out).toContain("Apply to BOQ line A1005");
    expect(out).not.toContain(SEVERAL_PARTS_TEXT);
  });

  it("the 'not filled in automatically' sentence is not printed beside the several-parts one", () => {
    const quantity = { status: "unknown" as const, measured: null, boq_qty: 62400, uom: "m3", item: "A1005", needs_confirm: true, note: "The quantity was not filled in automatically. Make this estimate for 62,400 m3, then confirm." };
    const out = strip(ctx([waiting({ several_parts: true, quantity })]));
    expect(out).not.toContain("not filled in automatically");
  });
});

describe("the template picker (defect 5)", () => {
  const source = readFileSync(path.resolve(__dirname, "BoqEstimates.tsx"), "utf8");

  it("preselects the template that fits the line's words and unit, and never the first one of the list", () => {
    expect(source).toContain("suggestTemplate(list, line.description, line.uom)");
    expect(source).not.toMatch(/setTemplateId\(j\.templates\?\.\[0\]/);
    expect(source).toContain('<option value="">Choose a template</option>');
  });
});
