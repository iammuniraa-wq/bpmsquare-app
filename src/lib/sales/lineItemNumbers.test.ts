import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasClientItemNumbers, itemNumber } from "./lineItemNumbers";
import StandardQuotePrintDocument from "@/components/StandardQuotePrintDocument";
import type { StandardQuote, StandardQuoteLine } from "@/lib/types";

// A Standard Quote made from a tender bid keeps the client's item numbers in sl_no. An ordinary quote (1..n) must look exactly as before.

const ROOT = path.resolve(__dirname, "../../..");
const src = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const clean = (h: string) => h.replace(/<!-- -->/g, "");

const line = (sl_no: string | null, over: Partial<StandardQuoteLine> = {}): StandardQuoteLine => ({
  id: `l-${sl_no}-${over.description ?? ""}`, tenant_id: "t1", standard_quote_id: "q1", sl_no, description: `Work ${sl_no}`, uom: "m", qty: 2, rate: 100, discount_pct: 0, amount: 200,
  is_selected: true, show_on_pdf: true, ...over,
} as StandardQuoteLine);
const quote = { id: "q1", tenant_id: "t1", ref: "SQ-0001", account_id: "a1", contact_id: null, status: "draft", valid_until: null, terms: null, notes: null, subtotal: 600, total: 600, header_discount_pct: 0, tax_pct: 0, shipping_amount: 0, intro_text: null, inquiry_date: null, template_id: null, print_options: null } as unknown as StandardQuote;
const print = (lines: StandardQuoteLine[]) => clean(renderToString(createElement(StandardQuotePrintDocument, { quote, lines, account: null, contact: null })));

describe("hasClientItemNumbers", () => {
  it("is false for an ordinary quote: 1..n, in any order, or no numbers at all", () => {
    expect(hasClientItemNumbers([])).toBe(false);
    expect(hasClientItemNumbers([{ sl_no: "1" }, { sl_no: "2" }, { sl_no: "3" }])).toBe(false);
    expect(hasClientItemNumbers([{ sl_no: "10" }, { sl_no: "1" }, { sl_no: "2" }, { sl_no: "3" }, { sl_no: "4" }, { sl_no: "5" }, { sl_no: "6" }, { sl_no: "7" }, { sl_no: "8" }, { sl_no: "9" }])).toBe(false);
    expect(hasClientItemNumbers([{ sl_no: null }, { sl_no: "" }])).toBe(false);
  });
  it("is true when the client's numbers are there: dotted, lettered, gapped or repeated", () => {
    expect(hasClientItemNumbers([{ sl_no: "1.1" }, { sl_no: "1.2" }])).toBe(true);
    expect(hasClientItemNumbers([{ sl_no: "A-3" }, { sl_no: "A-4" }])).toBe(true);
    expect(hasClientItemNumbers([{ sl_no: "5" }, { sl_no: "9" }])).toBe(true);
    expect(hasClientItemNumbers([{ sl_no: "1" }, { sl_no: "1" }])).toBe(true);
  });
  it("itemNumber falls back to the position when a line has none", () => {
    expect(itemNumber({ sl_no: "2.4" }, 7, true)).toBe("2.4");
    expect(itemNumber({ sl_no: null }, 7, true)).toBe("7");
    expect(itemNumber({ sl_no: "2.4" }, 7, false)).toBe("7");
  });
});

describe("the Standard Quote PDF", () => {
  it("prints the client's item numbers under an Item heading", () => {
    const out = print([line("1.1"), line("1.2"), line("A-3")]);
    expect(out).toContain(">Item</th>");
    for (const n of ["1.1", "1.2", "A-3"]) expect(out, n).toMatch(new RegExp(`font-family:monospace[^>]*>${n.replace(".", "\\.")}</td>`));
  });
  it("is unchanged for an ordinary quote: a # heading and a running count, even with a hidden row", () => {
    const out = print([line("1"), line("2", { show_on_pdf: false }), line("3")]);
    expect(out).toContain(">#</th>");
    expect(out).not.toContain(">Item</th>");
    const nums = [...out.matchAll(/font-family:monospace[^>]*>(\d+)<\/td>/g)].map((m) => m[1]);
    expect(nums).toEqual(["1", "2"]);
  });
});

describe("the Standard Quote screens", () => {
  it("the Lines tab shows an Item column first, only when the quote carries client numbers", () => {
    const page = src("src/app/(app)/standard-quotes/[id]/page.tsx");
    expect(page).toContain("hasClientItemNumbers(lines)");
    expect(page).toMatch(/\.\.\.\(clientNumbers \? \[\{ label: "Item"[\s\S]*?\] : \[\]\),\s*\{\s*label: "Description"/);
  });
  it("saving from the editor keeps the client numbers (sent back as sl_no, never renumbered), and an ordinary quote still renumbers", () => {
    const form = src("src/app/(app)/standard-quotes/new/StandardQuoteForm.tsx");
    expect(form).toContain("sl_no: hasClientItemNumbers(editQuote.lines) ? l.sl_no ?? undefined : undefined");
    expect(form).toContain("sl_no: l.sl_no || undefined");
    const editor = src("src/components/sales/DocumentLinesEditor.tsx");
    expect(editor).toContain("{line.sl_no || no}");
    expect(editor).toContain('{hasItemNos ? "Item" : "#"}');
  });
});
