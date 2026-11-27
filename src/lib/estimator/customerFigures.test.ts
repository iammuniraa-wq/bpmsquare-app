import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}) }));

import { customerFigures, printedFigures, buildQuoteLines } from "./quoteLines";
import { buildPriceView } from "./preview";
import { shapeEstimateRow } from "./apiRows";
import { buildReviewFacts } from "./aiFacts";
import { buildCostModel, whatIf } from "./simulation";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { CURRENCIES, formatMoney } from "@/lib/currency";

// One estimate, one customer price (tester, 2026-11-27): a stored price of 12,749.69 at 15% VAT is quoted as 12,750 / 1,913 /
// 14,663 everywhere, never 14,662 from the stored price_incl_vat of 14,662.14.

const COST = 11590.63;
const MARGIN = 10;
const STORED = { price: 12749.69, vat_pct: 15, price_incl_vat: 14662.14 };
const sar = (n: number) => formatMoney(n, CURRENCIES.SAR, { maximumFractionDigits: 0 });
const SHOWN = ["SAR 12,750", "SAR 1,913", "SAR 14,663"];

describe("the customer's figures of an estimate", () => {
  const f = customerFigures(STORED.price, STORED.vat_pct);

  it("rounds the price to whole units and works VAT and the total from that", () => {
    expect(f).toEqual({ price: 12750, vat: 1912.5, total: 14662.5 });
    expect([f.price, f.vat, f.total].map(sar)).toEqual(SHOWN);
    expect(printedFigures(f)).toEqual({ price: 12750, vat: 1913, total: 14663 });
  });

  it("is what the Standard Quote made from it works out", () => {
    const built = buildQuoteLines([{ description: "Excavate", uom: "m3", qty: 800, group: "Earthworks", group_key: "earth", cost_total: COST }], { granularity: "group", margin_pct: MARGIN });
    expect(built.ok && built.price).toBe(12750);
    const quote = computeStandardQuoteTotals(12750, 0, 15, 0);
    expect([quote.subtotal, quote.taxAmount, quote.total].map(sar)).toEqual(SHOWN);
  });

  it("is what the price card and the customer preview show", () => {
    const view = buildPriceView([{ description: "Excavate", uom: "m3", qty: 800, group: "Earthworks", group_key: "earth", cost_total: COST }], { granularity: "group", margin_pct: MARGIN, vat_pct: 15 });
    expect([view.price, view.vat, view.total].map(sar)).toEqual(SHOWN);
  });

  it("is what Schedule and risk shows before any slider moves, with no price change", () => {
    const model = buildCostModel([{ code: null, group_key: "earth", component: "other", uom: "m3", qty: 800, cost_total: COST, source: "manual" }], [], []);
    const w = whatIf(model, {}, { margin_pct: MARGIN, vat_pct: 15, base_price: STORED.price });
    expect(w.cost).toBe(COST);
    expect([w.price, w.price_incl_vat].map(sar)).toEqual(["SAR 12,750", "SAR 14,663"]);
    expect(w.price_delta).toBe(0);
  });

  it("is what the API and the lists built on it give, for an estimate saved before", () => {
    const row = shapeEstimateRow({ id: "e1", name: "x", status: "draft", quoted_total: STORED.price, quoted_total_incl_vat: STORED.price_incl_vat, quoted_vat_pct: 15 });
    expect(row).toMatchObject({ quoted_total: 12750, quoted_total_incl_vat: 14662.5 });
    expect(row).not.toHaveProperty("quoted_vat_pct");
  });

  it("is the price the AI review is told, with the cost left exactly as stored", () => {
    const totals = { cost_total: COST, margin_pct: MARGIN, price: STORED.price, vat_pct: 15, by_group: [], by_component: {} };
    const facts = buildReviewFacts({ name: "x", params: {}, totals: totals as never, model: null, margin_pct: MARGIN }, [], null);
    expect(facts.totals).toMatchObject({ cost_total: COST, margin_pct: MARGIN, price: 12750 });
  });
});
