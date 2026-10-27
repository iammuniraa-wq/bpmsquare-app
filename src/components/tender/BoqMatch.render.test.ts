import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { MatchState } from "@/lib/tender/boq/matchServer";
import BoqMatch from "./BoqMatch";
import BoqTab, { type BoqScreenState } from "./BoqTab";

// "Match to products" on the Bill of quantities: the chip, the open panel with its suggestions, and what it must never show.

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

const data = (over: Partial<MatchState> = {}): MatchState => ({
  enabled: true, lines_version: "v1", strong: 1,
  rows: [
    { boq_id: "b1", item_no: "1.1", description: "Supply and install gate valve 100mm DN100", cost_code: "31 23", uom: "no", qty: 4, suggestions: [
      { product_id: "p1", name: "Gate valve 100mm DN100", sku: "GV-100", uom: "Nos", score: 95, band: "strong", reason: "6 of 6 words match the name; same unit" },
      { product_id: "p2", name: "Gate valve 50mm DN50", sku: "GV-050", uom: "Nos", score: 58, band: "possible", reason: "4 of 6 words match the name" },
    ] },
    { boq_id: "b2", item_no: "1.4", description: "Mobilisation", cost_code: null, uom: "lot", qty: 1, suggestions: [] },
  ],
  ...over,
});
const html = (props: Partial<Parameters<typeof BoqMatch>[0]> = {}) =>
  renderToString(createElement(BoqMatch, { base: "/api/opportunities/o1/boq", count: 2, canEdit: true, onChanged: () => {}, onError: () => {}, onNotice: () => {}, initialData: data(), initialOpen: true, ...props })).replace(/<!-- -->/g, "");

describe("the Match to products chip and panel", () => {
  it("shows a chip with the number of lines without a product, and nothing at all when there are none", () => {
    const closed = html({ initialOpen: false });
    expect(closed).toContain("2 lines without a product");
    expect(closed).toContain('data-guide="boq.match.chip"');
    expect(closed).not.toContain('data-guide="boq.match.panel"');
    expect(html({ count: 1, initialOpen: false })).toContain("1 line without a product");
    expect(html({ count: 0, initialOpen: false })).toBe("");
  });

  it("open, lists each line with its ranked suggestions, their band, SKU and unit", () => {
    const out = html();
    expect(out).toContain('data-guide="boq.match.panel"');
    expect(out).toContain("Supply and install gate valve 100mm DN100");
    expect(out).toContain("Gate valve 100mm DN100");
    expect(out).toContain("GV-100 · Nos");
    expect(out).toContain(">Strong<");
    expect(out).toContain(">Possible<");
    expect(out.indexOf("GV-100")).toBeLessThan(out.indexOf("GV-050"));
    expect(out).toContain("No close product found.");
  });

  it("offers Accept strong matches with the count, and each line a way to pick another product or leave it as free text", () => {
    const out = html();
    expect(out).toContain("Accept 1 strong match");
    expect(out).toContain('data-guide="boq.match.accept_strong"');
    expect(out).toContain("Pick another product");
    expect(out).toContain("Leave as free text");
    expect(html({ initialData: data({ strong: 0 }) })).not.toContain("Accept ");
    expect(html({ initialData: data({ strong: 3 }) })).toContain("Accept 3 strong matches");
  });

  it("a view-only person sees the suggestions but no way to link, search or accept", () => {
    const out = html({ canEdit: false });
    expect(out).toContain("Gate valve 100mm DN100");
    expect(out).not.toContain("Accept ");
    expect(out).not.toContain("Pick another product");
    expect(out).not.toContain("Leave as free text");
    expect(out).toMatch(/data-guide="boq\.match\.suggestion"[^>]*disabled=""/);
  });

  it("every suggestion is a 44 px target, long lists page, and a workspace without products says so", () => {
    expect(html()).toMatch(/min-height:44px/);
    const many = data({ rows: Array.from({ length: 14 }, (_, i) => ({ boq_id: `b${i}`, item_no: `${i}`, description: `Line ${i}`, cost_code: null, uom: null, qty: 1, suggestions: [] })) });
    const out = html({ initialData: many });
    expect(out).toContain("Line 9");
    expect(out).not.toContain("Line 10");
    expect(out).toContain("Show all 14 lines");
    expect(html({ initialData: data({ enabled: false, rows: [], strong: 0 }) })).toContain("no product catalog");
  });

  it("shows the product's name, SKU and unit and never a cost or a price", () => {
    const src = readFileSync("src/components/tender/BoqMatch.tsx", "utf8");
    expect(src.replace(/\/\/[^\n]*/g, "")).not.toMatch(/cost_price|list_price|unit_cost|markup/);
    expect(html()).not.toMatch(/cost_price|list_price|unit_cost/);
  });

  it("keeps its explanations behind the i and within the limit", () => {
    for (const k of ["boqMatch", "boqMatchBands"] as const) {
      expect(tipTextProblems(TENDER_TIPS[k]), k).toEqual([]);
      expect(html().split(TENDER_TIPS[k]).length - 1, k).toBeLessThanOrEqual(0);
    }
  });

  it("carries guide ids on its controls", () => {
    const src = readFileSync("src/components/tender/BoqMatch.tsx", "utf8");
    const ids = new Set([...src.matchAll(/"(boq\.match[a-z_.]*)"/g)].map((m) => m[1]));
    for (const id of ["boq.match.chip", "boq.match.panel", "boq.match.accept_strong", "boq.match.suggestion", "boq.match.search", "boq.match.hit", "boq.match.skip", "boq.match.show_all"]) expect(ids, id).toContain(id);
  });

  it("links through the one route with the version it was decided from, and bulk accept is the server's choice", () => {
    const src = readFileSync("src/components/tender/BoqMatch.tsx", "utf8");
    expect(src).toMatch(/JSON\.stringify\(\{ base_version: data\?\.lines_version, \.\.\.body \}\)/);
    expect(src).toMatch(/send\(\{ accept_strong: true \}\)/);
    expect(src).toMatch(/send\(\{ links: \[\{ line: boqId, product_id: productId \}\] \}\)/);
    // A stale list is reloaded, and the Lines tab and header are told.
    expect(src).toMatch(/j\.code === "lines_changed"/);
  });
});

describe("on the Bill of quantities", () => {
  const base: BoqScreenState = {
    pending: false,
    source: { file_name: "x.xlsx", sheet_name: "BOQ", version: 1, uploaded_at: "2026-10-26T08:00:00Z", line_count: 1, added_columns: false },
    lines: [{ id: "b1", line_id: "l1", row_no: 8, item_no: "A.1", cost_code: null, description: "Excavation", uom: "m3", qty: 10, rate: 0, amount: 0, priced: false, linked: true, removed: false, price_source: null, price_source_ref: null, price_as_of: null, stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null } as never],
    validity_days: 180, today: "2026-10-26", totals: { lines: 1, priced: 0, unpriced: 1, stale: 0, amount: 0 }, unpriced: [],
  } as BoqScreenState;
  const render = (totals: BoqScreenState["totals"]) => { nav.search = ""; return renderToString(createElement(BoqTab, { opportunityId: "o1", canEdit: true, onError: () => {}, onNotice: () => {}, initialData: { ...base, totals } })).replace(/<!-- -->/g, ""); };

  it("shows the chip when some lines have no product, and none when all have one or the server did not say", () => {
    expect(render({ ...base.totals, no_product: 3 })).toContain("3 lines without a product");
    expect(render({ ...base.totals, no_product: 0 })).not.toContain("without a product");
    expect(render(base.totals)).not.toContain("without a product");
  });

  it("the chip does not change the Priced figure", () => {
    expect(render({ ...base.totals, no_product: 3 })).toContain("0%");
    expect(render({ ...base.totals, no_product: 3 })).toContain("0 of 1, 1 to price");
  });
});
