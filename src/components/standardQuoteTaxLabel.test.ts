import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StandardQuotePrintDocument from "./StandardQuotePrintDocument";
import StandardQuoteLinesTotals from "./StandardQuoteLinesTotals";
import { quoteTaxLabel } from "@/lib/standardQuoteTotals";
import { CURRENCIES, moneyFormatter } from "@/lib/currency";
import type { StandardQuote, StandardQuoteLine } from "@/lib/types";

const createElement = create as unknown as (c: unknown, p: object | null) => ReactElement;

const quote = (over: Partial<StandardQuote> = {}) => ({
  id: "q1", ref: "SQ-1", status: "draft", header_discount_pct: 0, tax_pct: 15, shipping_amount: 0, total: 14662.5, created_at: "2026-11-27T00:00:00Z", ...over,
}) as unknown as StandardQuote;
const lines = [{ id: "l1", sl_no: "1", description: "Earthworks", uom: "lot", qty: 1, rate: 12750, discount_pct: 0, amount: 12750, is_selected: true, show_on_pdf: true }] as unknown as StandardQuoteLine[];
const money = moneyFormatter(CURRENCIES.SAR, { maximumFractionDigits: 0 });
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

describe("the workspace's name for the tax line", () => {
  it("is the company override, else the workspace tax setting, else Tax as before", () => {
    expect(quoteTaxLabel({ tax_label: "GST" }, { label: "VAT" })).toBe("GST");
    expect(quoteTaxLabel({}, { label: "VAT" })).toBe("VAT");
    expect(quoteTaxLabel(null, { label: "  " })).toBe("Tax");
    expect(quoteTaxLabel(undefined, undefined)).toBe("Tax");
  });

  it("is printed on the Standard Quote", () => {
    const render = (taxLabel?: string) => renderToStaticMarkup(createElement(StandardQuotePrintDocument, { quote: quote(), lines, account: null, contact: null, currency: "SAR", taxLabel }));
    expect(text(render("VAT"))).toContain("VAT (15%)");
    expect(text(render("VAT"))).not.toContain("Tax (15%)");
    expect(text(render())).toContain("Tax (15%)");
  });
});

describe("the Lines tab total", () => {
  const render = (q: StandardQuote) => text(renderToStaticMarkup(createElement(StandardQuoteLinesTotals, { quote: q, lines, taxLabel: "VAT", money })));

  it("shows the subtotal and the tax line above the total, with the PDF's figures", () => {
    const out = render(quote());
    for (const part of ["Subtotal: SAR 12,750", "VAT (15%): SAR 1,913", "Total: SAR 14,663"]) expect(out).toContain(part);
    expect(out).not.toMatch(/Discount|Shipping/);
  });

  it("shows discount and shipping when the quote has them", () => {
    const out = render(quote({ header_discount_pct: 10, shipping_amount: 100, total: 13296 }));
    for (const part of ["Discount (10%): − SAR 1,275", "VAT (15%): SAR 1,721", "Shipping / Handling: SAR 100", "Total: SAR 13,296"]) expect(out).toContain(part);
  });

  it("shows only the total when nothing makes it differ", () => {
    const out = render(quote({ tax_pct: 0, total: 12750 }));
    expect(out).toContain("Total: SAR 12,750");
    expect(out).not.toContain("Subtotal");
  });
});
