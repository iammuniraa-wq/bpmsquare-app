import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import InvoicePrintDocument from "@/components/InvoicePrintDocument";
import EntitiesTab from "@/app/(app)/settings/company/EntitiesTab";
import EinvoiceSellerFields from "@/app/(app)/settings/company/EinvoiceSellerFields";
import EinvoicePanel, { type EinvoicePanelProps } from "@/app/(app)/invoices/[id]/EinvoicePanel";
import { evaluateInvoice } from "./evaluate";
import { buildKsaPrintData } from "./printData";
import type { Invoice, InvoiceLine } from "@/lib/types";
import type { TenantEntity } from "@/lib/constants";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

const entity: TenantEntity = {
  id: "e1", name: "Acme Co", short_name: "A", address: "Riyadh", is_default: true,
  vat_number: "300000000000003", crn: "1010000000", name_ar: "شركة أكمي", building_number: "1234", street: "King Fahd Rd", district: "Olaya", city: "Riyadh", postal_code: "12214", country: "SA",
};
const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: "i1", tenant_id: "t1", account_id: "a1", contact_id: null, ref: "INV-2026-0001", work_order_id: null, quote_id: null, case_id: null, contract_id: null,
  entity_id: "e1", status: "sent", total: 200, paid_amount: 0, due_date: null, discount_type: "pct", discount_pct: 0, discount_fixed: 0, notes: null, terms: null,
  custom_data: null, created_by: null, created_at: "2026-10-25T08:00:00Z", issued_at: "2026-10-25T09:30:00Z", ...over,
});
const lines: InvoiceLine[] = [
  { id: "l1", tenant_id: "t1", invoice_id: "i1", sl_no: "1", description: "Maintenance", uom: "hr", qty: 2, rate: 50, amount: 100, vat_category: "S", vat_rate: 15 },
  { id: "l2", tenant_id: "t1", invoice_id: "i1", sl_no: "2", description: "Exported part", uom: null, qty: 1, rate: 100, amount: 100, vat_category: "Z", vat_rate: 0, vat_exemption_reason: "Export of goods" },
];
const account = { id: "a1", name: "Buyer Co", name_ar: "شركة المشتري", vat_number: "310122393500003", address_line1: "Main St", address_building: "4321", address_district: "Rawdah", city: "Jeddah", postal_code: "21442", country: "SA" } as never;

function print(over: Partial<Invoice> = {}, withKsa = true) {
  const inv = invoice(over);
  const ev = evaluateInvoice({ invoice: inv, lines, account, entities: [entity], config: undefined, currency: "SAR" });
  const ksa = buildKsaPrintData(ev, { ...inv, einvoice_uuid: "7c1d3b5e-0000-4000-8000-000000000001", einvoice_seq: 7 }, null);
  return html(createElement(InvoicePrintDocument, {
    invoice: inv, lines, payments: [], account, contact: null, companyInfo: { name: "Acme Co" }, currency: "SAR",
    tenantEntities: [entity], tenantTax: { label: "GST", rate: 18, inclusive: false }, ...(withKsa ? { ksa } : {}),
  }));
}

describe("the printed invoice", () => {
  it("a workspace without e-invoicing prints the layout it always had: no Arabic, no QR box, no e-invoice marker", () => {
    const out = print({}, false);
    expect(hasArabic(out)).toBe(false);
    expect(out).not.toContain("data-einvoice");
    expect(out).not.toContain("einvoice-qr");
    expect(out).toContain("Tax Invoice");
    expect(out).toContain("GST @ 18%");
  });

  it("a Saudi e-invoicing workspace prints the bilingual layout", () => {
    const out = print();
    expect(out).toContain('data-einvoice="ksa"');
    expect(out).toContain("Tax Invoice");
    expect(out).toContain("فاتورة ضريبية");
    expect(out).toContain('dir="rtl"');
    expect(out).toContain("شركة أكمي");
    expect(out).toContain("شركة المشتري");
    expect(out).toContain("300000000000003");
    expect(out).toContain("310122393500003");
    // not the legacy tax line
    expect(out).not.toContain("GST @ 18%");
  });

  it("shows the VAT by rate with the zero-rate reason, and totals to the halala", () => {
    const out = print();
    expect(out).toContain("VAT by rate");
    expect(out).toContain("الضريبة حسب النسبة");
    expect(out).toContain("Standard rate");
    expect(out).toContain("Zero rated");
    expect(out).toContain("Export of goods");
    expect(out).toContain("15%");
    expect(out).toContain("15.00"); // VAT of the standard group (15% of 100.00)
    expect(out).toContain("215.00"); // grand total: 200.00 taxable + 15.00 VAT
  });

  it("marks the QR as a placeholder and prints the UUID and counter small", () => {
    const out = print();
    expect(out).toContain('data-einvoice-qr="placeholder"');
    expect(out).toContain("Not yet issued to ZATCA");
    expect(out).toContain("7c1d3b5e-0000-4000-8000-000000000001");
    expect(out).toMatch(/Invoice counter[\s\S]*>7</);
  });

  it("titles a simplified invoice and a credit note", () => {
    const inv = invoice({ einvoice_doc_type: "simplified" });
    const ev = evaluateInvoice({ invoice: inv, lines, account: { name: "Walk-in" }, entities: [entity], config: undefined, currency: "SAR" });
    const simple = html(createElement(InvoicePrintDocument, { invoice: inv, lines, payments: [], account: null, contact: null, currency: "SAR", ksa: buildKsaPrintData(ev, inv, null) }));
    expect(simple).toContain("Simplified Tax Invoice");
    expect(simple).toContain("فاتورة ضريبية مبسطة");

    const cn = invoice({ einvoice_doc_type: "credit_note", original_invoice_id: "i0", credit_reason: "Goods returned" });
    const ev2 = evaluateInvoice({ invoice: cn, lines, account, entities: [entity], config: undefined, currency: "SAR" });
    const note = html(createElement(InvoicePrintDocument, { invoice: cn, lines, payments: [], account, contact: null, currency: "SAR", ksa: buildKsaPrintData(ev2, cn, "INV-2026-0000") }));
    expect(note).toContain("Credit Note");
    expect(note).toContain("إشعار دائن");
    expect(note).toContain("INV-2026-0000");
    expect(note).toContain("Goods returned");
  });

  it("prints the issue date and time in the Kingdom's time zone", () => {
    const out = print({ issued_at: "2026-10-25T21:30:00Z" });
    expect(out).toContain("26 Oct 2026");
    expect(out).toContain("00:30");
  });
});

describe("the entity panel", () => {
  const e: TenantEntity = { id: "e1", name: "Acme", short_name: "A", address: "", is_default: true };
  it("the seller fields are one block of ten labelled controls, with the Arabic name right-to-left", () => {
    const out = html(createElement(EinvoiceSellerFields, { entity: e, onPatch: () => {} }));
    for (const label of ["VAT number", "Commercial registration (CRN)", "Legal name in Arabic", "Building number", "Street", "District", "City", "Postal code", "Country"]) expect(out).toContain(label);
    expect(out).toContain('dir="rtl"');
    expect(out).toContain("About VAT number");
    expect(out).not.toMatch(/<p[ >]/);
  });
  it("opens by default only while the VAT number is missing", () => {
    expect(html(createElement(EinvoiceSellerFields, { entity: e, onPatch: () => {} }))).toMatch(/<details[^>]* open/);
    expect(html(createElement(EinvoiceSellerFields, { entity: { ...e, vat_number: "300000000000003" }, onPatch: () => {} }))).not.toMatch(/<details[^>]* open/);
    expect(html(createElement(EinvoiceSellerFields, { entity: { ...e, gstin: "300000000000003" }, onPatch: () => {} }))).not.toMatch(/<details[^>]* open/);
  });
  it("the entities tab still renders exactly as before when e-invoicing is off", () => {
    const off = html(createElement(EntitiesTab, { entities: [e], onChange: () => {} }));
    expect(off).not.toContain("Saudi e-invoicing");
    expect(hasArabic(off)).toBe(false);
  });
});

describe("the invoice's Saudi e-invoice section", () => {
  const base: EinvoicePanelProps = {
    invoiceId: "i1", basePath: "/invoices/i1", editable: true, docType: "standard", typeLocked: false, ready: false,
    issues: [
      { field: "seller.crn", area: "seller", message: "Seller commercial registration number (CRN) is missing." },
      { field: "buyer.vat_number", area: "buyer", message: "Buyer VAT number is missing (a Standard invoice needs it)." },
      { field: "lines.vat_category", area: "lines", message: "Line 1: VAT category is missing (Standard, Zero rated, Exempt or Out of scope).", line: "l1" },
    ],
    accountHref: "/accounts/a1", uuid: null, seq: null, original: null, creditNotes: [], canCreditNote: false,
    lines: [{ id: "l1", label: "1", description: "Maintenance", vat_category: null, vat_rate: null, vat_exemption_reason: null }],
    groups: [{ label: "Not set", rate: "", taxable: "100.00", vat: "0.00" }],
    totals: { subtotal: "100.00", discount: null, taxable: "100.00", vat: "0.00", grand: "100.00" },
  };

  it("says Not ready with the count, lists each missing item in plain words and links each to where it is fixed", () => {
    const out = html(createElement(EinvoicePanel, base));
    expect(out).toContain("Not ready · 3");
    expect(out).toContain("Seller commercial registration number (CRN) is missing.");
    expect(out).toContain('href="/settings/company?tab=entities"');
    expect(out).toContain('href="/accounts/a1"');
    expect(out).toContain('href="#einv-line-l1"');
    expect(out).toContain('id="einv-line-l1"');
    expect(out).toContain("Set standard VAT on all lines");
  });

  it("says Ready when nothing is missing, and hides the missing list", () => {
    const out = html(createElement(EinvoicePanel, { ...base, ready: true, issues: [], lines: [{ ...base.lines[0], vat_category: "S", vat_rate: 15 }] }));
    expect(out).toContain("Ready");
    expect(out).not.toContain("Not ready");
    expect(out).not.toContain("data-guide=\"invoice.einvoice.missing\"");
    expect(out).not.toContain("Set standard VAT on all lines");
  });

  it("is read-only once the invoice is sent: no selects, no credit note unless allowed", () => {
    const sent = html(createElement(EinvoicePanel, { ...base, editable: false, typeLocked: true, ready: true, issues: [], uuid: "u-1", seq: 4 }));
    expect(sent).not.toContain("<select");
    expect(sent).not.toContain("Create credit note");
    expect(sent).toContain("u-1");
    const withCredit = html(createElement(EinvoicePanel, { ...base, editable: false, typeLocked: true, ready: true, issues: [], canCreditNote: true }));
    expect(withCredit).toContain("Create credit note");
  });

  it("keeps explanations behind an i: no hint paragraphs", () => {
    const out = html(createElement(EinvoicePanel, base));
    expect(out).not.toMatch(/<p[ >]/);
    expect(out).toContain("About Saudi e-invoice");
  });
});
