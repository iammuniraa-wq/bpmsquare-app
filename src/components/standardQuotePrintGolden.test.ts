import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import StandardQuotePrintDocument from "./StandardQuotePrintDocument";
import type { StandardQuote, StandardQuoteLine, Account, Contact } from "@/lib/types";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;

// PDF redesign slice 1: a workspace with no pdf_design must print the Standard Quote exactly as before. The golden file
// was captured from the component before the frame existed; this fails if the default markup changes by one byte.

const quote = {
  id: "q1", tenant_id: "t1", ref: "SQ-2026-0001", account_id: "a1", contact_id: "c1", status: "draft",
  valid_until: "2026-12-30T12:00:00Z", terms: "Payment in 30 days.", notes: "Ex-works.", subtotal: 1000, total: 1180,
  created_at: "2026-11-10T12:00:00Z", updated_at: "2026-11-10T12:00:00Z", sent_at: null, template_id: null,
  header_discount_pct: 0, tax_pct: 18, shipping_amount: 0, intro_text: "Thank you for your enquiry.", inquiry_date: "2026-11-01T12:00:00Z",
  closed_at: null, print_options: null, created_by: null,
} as unknown as StandardQuote;
const line = (n: number, d: string, qty: number, rate: number) => ({
  id: `l${n}`, tenant_id: "t1", standard_quote_id: "q1", sl_no: String(n), description: d, uom: "Nos", qty, rate, discount_pct: 0, amount: qty * rate,
  is_selected: true, show_on_pdf: true, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null,
}) as unknown as StandardQuoteLine;
const lines = [line(1, "Precast foundation 1000 x 1000", 2, 400), line(2, "Delivery", 1, 200)];
const account = { id: "a1", name: "Test Customer", city: "Dammam", phone: "+966 1", email: "a@x.test" } as unknown as Account;
const contact = { id: "c1", name: "Haidi" } as unknown as Contact;

const render = () => renderToStaticMarkup(createElement(StandardQuotePrintDocument, {
  quote, lines, account, contact, companyInfo: { name: "Acme", address: "1 Road", email: "i@acme.test", web: "acme.test" }, logoUrl: null, template: null, currency: "INR",
}));

describe("Standard Quote print, workspace without a pdf design", () => {
  it("renders the same markup as before the frame existed", () => {
    const golden = path.join(__dirname, "__golden__", "standard-quote-default.html");
    if (!fs.existsSync(golden)) fs.writeFileSync(golden, render());
    expect(render()).toBe(fs.readFileSync(golden, "utf8"));
  });
});
