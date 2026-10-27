import { describe, expect, it } from "vitest";
import { buildNoteFromInvoice, ledgerSign } from "./creditNote";
import { ACCOUNT_EINVOICE_KEYS, cleanAccountEinvoice, hasAccountEinvoiceKeys, shapeAccountForApi } from "./accountFields";
import { INVOICE_EINVOICE_KEYS, LINE_EINVOICE_KEYS, cleanInvoiceEinvoicePatch, cleanLineVat, shapeInvoiceForApi, shapeLineForApi } from "./invoiceFields";
import { einvoicingOn, einvoicingScheme } from "./gate";
import { fixTarget, lineAnchor, SELLER_FIX_HREF } from "./fixLinks";
import { EINVOICE_TIPS } from "./tips";
import { DOC_TITLE, PRINT_LABELS, VAT_CATEGORY_LABEL } from "./labels";
import { tipTextProblems } from "@/lib/infoTip";
import { printDate, printTime } from "./printData";
import { computeVatTotals } from "./totals";
import type { EinvoiceLineInput, ReadinessIssue } from "./rules";

const original = { id: "inv-1", ref: "INV-2026-0001", account_id: "a1", contact_id: "c1", entity_id: "e1", discount_type: "pct", discount_pct: 10, discount_fixed: 0 };
const lines: EinvoiceLineInput[] = [
  { sl_no: "1", description: "Service", uom: "hr", qty: 2, rate: 50, amount: 100, vat_category: "S", vat_rate: 15 },
  { sl_no: "2", description: "Export goods", uom: null, qty: 1, rate: 200.5, amount: 200.5, vat_category: "Z", vat_rate: 0, vat_exemption_reason: "Export" },
];

describe("credit note builder", () => {
  it("copies every line with its VAT category, positive, linked to the original, with the reason", () => {
    const n = buildNoteFromInvoice(original, lines, "  Goods returned  ");
    expect(n.header).toMatchObject({
      account_id: "a1", contact_id: "c1", entity_id: "e1", discount_type: "pct", discount_pct: 10,
      einvoice_doc_type: "credit_note", original_invoice_id: "inv-1", credit_reason: "Goods returned",
    });
    expect(n.header.notes).toBe("Credit note for INV-2026-0001");
    expect(n.lines).toHaveLength(2);
    expect(n.lines[1]).toMatchObject({ description: "Export goods", qty: 1, rate: 200.5, amount: 200.5, vat_category: "Z", vat_rate: 0, vat_exemption_reason: "Export" });
    expect(n.total).toBe(300.5);
  });
  it("keeps every amount positive even if the source carried a sign", () => {
    const n = buildNoteFromInvoice(original, [{ description: "x", qty: -1, rate: -5, amount: -5 }], "Reason");
    expect(n.lines[0]).toMatchObject({ qty: 1, rate: 5, amount: 5 });
    expect(n.total).toBe(5);
  });
  it("refuses an empty or oversized reason", () => {
    expect(() => buildNoteFromInvoice(original, lines, "  ")).toThrow(/reason/i);
    expect(() => buildNoteFromInvoice(original, lines, "x".repeat(501))).toThrow(/too long/i);
  });
  it("can build a debit note", () => {
    expect(buildNoteFromInvoice(original, lines, "Price adjustment", "debit_note").header.einvoice_doc_type).toBe("debit_note");
  });
  it("totals of the note equal the totals of the original, so it cancels it exactly", () => {
    const orig = computeVatTotals(original, lines);
    const note = buildNoteFromInvoice(original, lines, "Reason");
    const t = computeVatTotals(note.header, note.lines);
    expect(t.grandTotal).toBe(orig.grandTotal);
    expect(t.vatTotal).toBe(orig.vatTotal);
  });
  it("a credit note counts against the ledger, everything else for it", () => {
    expect(ledgerSign("credit_note")).toBe(-1);
    for (const t of ["standard", "simplified", "debit_note", null, undefined] as const) expect(ledgerSign(t)).toBe(1);
  });
});

describe("account fields", () => {
  it("only the keys sent come back, cleaned", () => {
    expect(cleanAccountEinvoice({ vat_number: " 3000 0000 0000 03 ", name_ar: "  شركة  ", buyer_type: "individual", unrelated: 1 })).toEqual({
      vat_number: "30000000000003", name_ar: "شركة", buyer_type: "individual",
    });
    expect(cleanAccountEinvoice({})).toEqual({});
  });
  it("enums are reduced to their set, empty text to null", () => {
    expect(cleanAccountEinvoice({ buyer_type: "robot", buyer_id_scheme: "XYZ", crn: "", address_building: "   " })).toEqual({
      buyer_type: null, buyer_id_scheme: null, crn: null, address_building: null,
    });
    expect(cleanAccountEinvoice({ buyer_id_scheme: "IQA" })).toEqual({ buyer_id_scheme: "IQA" });
  });
  it("knows whether a body carries any of them", () => {
    expect(hasAccountEinvoiceKeys({ name: "x" })).toBe(false);
    expect(hasAccountEinvoiceKeys({ crn: "1" })).toBe(true);
  });
  it("an API response drops them all for a workspace without e-invoicing, and always drops the personal ID", () => {
    const row = Object.fromEntries([["id", "a"], ["name", "A"], ...ACCOUNT_EINVOICE_KEYS.map((k) => [k, "v"])]);
    expect(Object.keys(shapeAccountForApi(row, false))).toEqual(["id", "name"]);
    const on = shapeAccountForApi(row, true);
    expect(on).not.toHaveProperty("buyer_id_number");
    expect(on).toHaveProperty("vat_number");
  });
});

describe("invoice and line fields", () => {
  it("a PATCH can set only the supply date, a note's reason and standard/simplified", () => {
    expect(cleanInvoiceEinvoicePatch({ einvoice_uuid: "x", einvoice_seq: 9, einvoice_unit: "u", original_invoice_id: "o", supply_date: "2026-10-25", credit_reason: " Late " }, null)).toEqual({
      supply_date: "2026-10-25", credit_reason: "Late",
    });
    expect(cleanInvoiceEinvoicePatch({ einvoice_doc_type: "simplified" }, "standard")).toEqual({ einvoice_doc_type: "simplified" });
  });
  it("a body can never turn an invoice into a note, nor change a note's type", () => {
    expect(cleanInvoiceEinvoicePatch({ einvoice_doc_type: "credit_note" }, "standard")).toEqual({});
    expect(cleanInvoiceEinvoicePatch({ einvoice_doc_type: "standard" }, "credit_note")).toEqual({});
  });
  it("a bad supply date becomes null, not garbage", () => {
    expect(cleanInvoiceEinvoicePatch({ supply_date: "tomorrow" }, null)).toEqual({ supply_date: null });
  });
  describe("line VAT", () => {
    it("does nothing when the body does not mention VAT", () => {
      expect(cleanLineVat({ qty: 3 })).toEqual({});
    });
    it("Z, E and O are always 0% whatever rate is sent", () => {
      expect(cleanLineVat({ vat_category: "Z", vat_rate: 15, vat_exemption_reason: " Export " })).toEqual({ vat_category: "Z", vat_rate: 0, vat_exemption_reason: "Export" });
      expect(cleanLineVat({ vat_category: "E" })).toEqual({ vat_category: "E", vat_rate: 0, vat_exemption_reason: null });
    });
    it("a standard line without a rate gets 15%, and never carries a reason", () => {
      expect(cleanLineVat({ vat_category: "S" })).toEqual({ vat_category: "S", vat_rate: 15, vat_exemption_reason: null });
      expect(cleanLineVat({ vat_category: "S", vat_rate: "5", vat_exemption_reason: "x" })).toEqual({ vat_category: "S", vat_rate: 5, vat_exemption_reason: null });
    });
    it("clearing the category clears the rate and the reason", () => {
      expect(cleanLineVat({ vat_category: "" }, { vat_category: "S", vat_rate: 15 })).toEqual({ vat_category: null, vat_rate: null, vat_exemption_reason: null });
    });
    it("a rate-only change keeps the category the line already has", () => {
      expect(cleanLineVat({ vat_rate: "7.5" }, { vat_category: "S", vat_rate: 15 })).toEqual({ vat_category: "S", vat_rate: 7.5, vat_exemption_reason: null });
      expect(cleanLineVat({ vat_rate: "7.5" }, null)).toEqual({ vat_category: null, vat_rate: null, vat_exemption_reason: null });
    });
    it("a reason-only change keeps an exempt line's category", () => {
      expect(cleanLineVat({ vat_exemption_reason: "New reason" }, { vat_category: "E", vat_rate: 0, vat_exemption_reason: "Old" })).toEqual({ vat_category: "E", vat_rate: 0, vat_exemption_reason: "New reason" });
    });
    it("a rate is clamped to 0..100 and to two decimals", () => {
      expect(cleanLineVat({ vat_category: "S", vat_rate: 250 }).vat_rate).toBe(100);
      expect(cleanLineVat({ vat_category: "S", vat_rate: -3 }).vat_rate).toBe(0);
      expect(cleanLineVat({ vat_category: "S", vat_rate: 2.555 }).vat_rate).toBe(2.56);
    });
  });
  it("an API response drops the e-invoice keys for a workspace without e-invoicing", () => {
    const inv = Object.fromEntries([["id", "i"], ["ref", "R"], ...INVOICE_EINVOICE_KEYS.map((k) => [k, null])]);
    expect(Object.keys(shapeInvoiceForApi(inv, false))).toEqual(["id", "ref"]);
    expect(Object.keys(shapeInvoiceForApi(inv, true))).toHaveLength(2 + INVOICE_EINVOICE_KEYS.length);
    const l = Object.fromEntries([["id", "l"], ...LINE_EINVOICE_KEYS.map((k) => [k, null])]);
    expect(Object.keys(shapeLineForApi(l, false))).toEqual(["id"]);
    expect(Object.keys(shapeLineForApi(l, true))).toHaveLength(1 + LINE_EINVOICE_KEYS.length);
  });
});

describe("the gate", () => {
  it("needs the platform-admin flag", () => {
    expect(einvoicingOn(undefined, undefined)).toBe(false);
    expect(einvoicingOn({}, undefined)).toBe(false);
    expect(einvoicingOn({ einvoicing_ksa: false }, { einvoicing: { scheme: "ksa_zatca" } })).toBe(false);
  });
  it("flag on with no stored scheme is the Saudi scheme", () => {
    expect(einvoicingScheme({ einvoicing_ksa: true }, undefined)).toBe("ksa_zatca");
    expect(einvoicingScheme({ einvoicing_ksa: true }, {})).toBe("ksa_zatca");
    expect(einvoicingScheme({ einvoicing_ksa: true }, { einvoicing: { scheme: "ksa_zatca" } })).toBe("ksa_zatca");
  });
  it("a scheme of null switches it off even with the flag on", () => {
    expect(einvoicingOn({ einvoicing_ksa: true }, { einvoicing: { scheme: null } })).toBe(false);
  });
});

describe("where each missing item is fixed", () => {
  const ctx = { basePath: "/invoices/i1", accountHref: "/accounts/a1" };
  const issue = (over: Partial<ReadinessIssue>): ReadinessIssue => ({ field: "x", area: "invoice", message: "m", ...over });
  it("seller items go to the entities tab, buyer items to the account", () => {
    expect(fixTarget(issue({ area: "seller", field: "seller.crn" }), ctx)?.href).toBe(SELLER_FIX_HREF);
    expect(fixTarget(issue({ area: "buyer", field: "buyer.vat_number" }), ctx)?.href).toBe("/accounts/a1");
    expect(fixTarget(issue({ area: "buyer" }), { ...ctx, accountHref: null })).toBeNull();
  });
  it("a line item anchors to its own row", () => {
    expect(fixTarget(issue({ area: "lines", field: "lines.vat_category", line: "l9" }), ctx)?.href).toBe(`#${lineAnchor("l9")}`);
  });
  it("invoice items go where they are edited; the ones the server fills have no link", () => {
    expect(fixTarget(issue({ field: "invoice.supply_date" }), ctx)?.href).toBe("/invoices/i1?tab=overview");
    expect(fixTarget(issue({ field: "invoice.total" }), ctx)?.href).toBe("/invoices/i1?tab=lines");
    expect(fixTarget(issue({ field: "invoice.currency" }), ctx)?.href).toBe("/settings/company?tab=tax");
    expect(fixTarget(issue({ field: "invoice.issued_at" }), ctx)).toBeNull();
    expect(fixTarget(issue({ field: "invoice.original_invoice_id" }), ctx)).toBeNull();
  });
});

describe("texts", () => {
  it("every explanation behind an i holds to the limit", () => {
    for (const [key, text] of Object.entries(EINVOICE_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
  it("every printed label has both languages, and the document titles are the ZATCA ones", () => {
    for (const l of Object.values(PRINT_LABELS)) { expect(l.en.length).toBeGreaterThan(0); expect(l.ar.length).toBeGreaterThan(0); }
    for (const l of Object.values(VAT_CATEGORY_LABEL)) { expect(l.en).toBeTruthy(); expect(l.ar).toBeTruthy(); }
    expect(DOC_TITLE.standard).toEqual({ en: "Tax Invoice", ar: "فاتورة ضريبية" });
    expect(DOC_TITLE.simplified).toEqual({ en: "Simplified Tax Invoice", ar: "فاتورة ضريبية مبسطة" });
    expect(DOC_TITLE.credit_note).toEqual({ en: "Credit Note", ar: "إشعار دائن" });
  });
  it("dates and times print in the Kingdom's time zone", () => {
    expect(printDate("2026-10-25T21:30:00Z")).toBe("26 Oct 2026"); // 00:30 the next day in Riyadh
    expect(printTime("2026-10-25T21:30:00Z")).toBe("00:30");
    expect(printDate(null)).toBe("");
    expect(printTime("not a date")).toBe("");
  });
});
