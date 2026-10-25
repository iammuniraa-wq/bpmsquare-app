import { describe, expect, it } from "vitest";
import { validateInvoiceForZatca, pathOf, isReady } from "./validate";
import { buyerFromAccount, normaliseTaxId, countryCode, pickEntity, resolveDocType, sellerFromEntity } from "./parties";
import { evaluateInvoice } from "./evaluate";
import { ZATCA_RULES, type EinvoiceBuyer, type EinvoiceInvoiceInput, type EinvoiceLineInput, type EinvoiceSeller } from "./rules";
import type { TenantEntity } from "@/lib/constants";

const VAT = "300000000000003";
const VAT2 = "310122393500003";

const address = { building_number: "1234", street: "King Fahd Rd", district: "Olaya", city: "Riyadh", postal_code: "12214", country: "SA" };
const seller = (over: Partial<EinvoiceSeller> = {}): EinvoiceSeller => ({
  key: "e1", name: "Acme Co", name_ar: "شركة أكمي", vat_number: VAT, crn: "1010000000", address: { ...address }, ...over,
});
const buyer = (over: Partial<EinvoiceBuyer> = {}): EinvoiceBuyer => ({
  name: "Buyer Co", name_ar: "شركة المشتري", buyer_type: "business", vat_number: VAT2, crn: null, address: { ...address }, id_number: null, id_scheme: null, ...over,
});
const line = (over: Partial<EinvoiceLineInput> = {}): EinvoiceLineInput => ({
  id: "l1", sl_no: "1", description: "Service", qty: 2, rate: 50, amount: 100, vat_category: "S", vat_rate: 15, vat_exemption_reason: null, ...over,
});
const invoice = (over: Partial<EinvoiceInvoiceInput> = {}): EinvoiceInvoiceInput => ({
  total: 100, discount_type: "pct", discount_pct: 0, discount_fixed: 0, issued_at: "2026-10-25T10:00:00Z", supply_date: "2026-10-25", ...over,
});

const fields = (issues: { field: string }[]) => issues.map((i) => i.field);
const run = (i = invoice(), l = [line()], s = seller(), b = buyer(), o = {}) => validateInvoiceForZatca(i, l, s, b, { docType: "standard", currency: "SAR", ...o });

describe("a complete standard invoice", () => {
  it("is ready: no issues", () => {
    const issues = run();
    expect(issues).toEqual([]);
    expect(isReady(issues)).toBe(true);
  });
});

describe("the VAT number rule lives in one constant", () => {
  it("is 15 digits, first and last 3", () => {
    expect(ZATCA_RULES.vatNumber.test(VAT)).toBe(true);
    expect(ZATCA_RULES.vatNumber.test("30000000000003")).toBe(false); // 14
    expect(ZATCA_RULES.vatNumber.test("3000000000000030")).toBe(false); // 16
    expect(ZATCA_RULES.vatNumber.test("200000000000003")).toBe(false); // starts with 2
    expect(ZATCA_RULES.vatNumber.test("300000000000002")).toBe(false); // ends with 2
    expect(ZATCA_RULES.vatNumber.test("30000000000000a")).toBe(false);
  });
});

describe("seller rules", () => {
  it.each([
    ["name", { name: null }, "seller.name"],
    ["name_ar", { name_ar: null }, "seller.name_ar"],
    ["vat missing", { vat_number: null }, "seller.vat_number"],
    ["vat wrong", { vat_number: "123" }, "seller.vat_number"],
    ["crn missing", { crn: null }, "seller.crn"],
    ["crn wrong", { crn: "12345" }, "seller.crn"],
  ])("%s is reported", (_n, over, field) => {
    const issues = run(invoice(), [line()], seller(over as Partial<EinvoiceSeller>));
    expect(fields(issues)).toContain(field);
    expect(issues.find((i) => i.field === field)!.area).toBe("seller");
  });

  it.each([
    ["building_number", null, "seller.building_number"],
    ["building_number", "12", "seller.building_number"],
    ["street", null, "seller.street"],
    ["district", null, "seller.district"],
    ["city", null, "seller.city"],
    ["postal_code", null, "seller.postal_code"],
    ["postal_code", "1234", "seller.postal_code"],
    ["postal_code", "123456", "seller.postal_code"],
    ["country", null, "seller.country"],
    ["country", "IN", "seller.country"],
  ])("address %s = %s is reported", (key, value, field) => {
    const issues = run(invoice(), [line()], seller({ address: { ...address, [key]: value } }));
    expect(fields(issues)).toContain(field);
  });

  it("says what is wrong in plain words", () => {
    const m = run(invoice(), [line()], seller({ vat_number: "123" })).find((i) => i.field === "seller.vat_number")!.message;
    expect(m).toBe("Seller VAT number must be 15 digits, starting and ending with 3.");
  });
});

describe("buyer rules by document path", () => {
  it("a standard invoice needs the buyer's name, Arabic name, VAT number and structured address", () => {
    const issues = run(invoice(), [line()], seller(), buyer({ name: null, name_ar: null, vat_number: null, address: { building_number: null, street: null, district: null, city: null, postal_code: null, country: null } }));
    for (const f of ["buyer.name", "buyer.name_ar", "buyer.vat_number", "buyer.building_number", "buyer.street", "buyer.district", "buyer.city", "buyer.postal_code", "buyer.country"]) expect(fields(issues)).toContain(f);
    expect(issues.filter((i) => i.area === "buyer").every((i) => i.message.startsWith("Buyer"))).toBe(true);
  });
  it("a malformed buyer VAT number is reported on a standard invoice", () => {
    expect(fields(run(invoice(), [line()], seller(), buyer({ vat_number: "999" })))).toContain("buyer.vat_number");
  });
  it("a standard invoice to an individual is contradictory", () => {
    expect(fields(run(invoice(), [line()], seller(), buyer({ buyer_type: "individual" })))).toContain("buyer.buyer_type");
  });
  it("a simplified invoice needs no buyer at all", () => {
    const blank = buyer({ name: null, name_ar: null, vat_number: null, address: { building_number: null, street: null, district: null, city: null, postal_code: null, country: null } });
    expect(run(invoice(), [line()], seller(), blank, { docType: "simplified" })).toEqual([]);
  });
  it("but what a simplified buyer does give must be well formed", () => {
    const issues = run(invoice(), [line()], seller(), buyer({ vat_number: "12", id_number: "1234567890", id_scheme: null, address: { ...address, postal_code: "12" } }), { docType: "simplified" });
    expect(fields(issues).sort()).toEqual(["buyer.id_scheme", "buyer.postal_code", "buyer.vat_number"]);
  });
  it("a note follows its buyer: a business with a VAT number takes the standard path", () => {
    expect(pathOf("credit_note", { buyer_type: "business", vat_number: VAT2 })).toBe("standard");
    expect(pathOf("credit_note", { buyer_type: "individual", vat_number: null })).toBe("simplified");
    expect(pathOf("debit_note", { buyer_type: "business", vat_number: null })).toBe("simplified");
    expect(pathOf("standard", { buyer_type: "individual", vat_number: null })).toBe("standard");
  });
});

describe("invoice rules", () => {
  it("currency other than SAR is reported, SAR is not", () => {
    expect(fields(run(invoice(), [line()], seller(), buyer(), { currency: "INR" }))).toContain("invoice.currency");
    expect(fields(run(invoice(), [line()], seller(), buyer(), { currency: "SAR" }))).not.toContain("invoice.currency");
  });
  it("issue date and time are required once issued, not on a draft", () => {
    expect(fields(run(invoice({ issued_at: null })))).toContain("invoice.issued_at");
    expect(fields(run(invoice({ issued_at: null }), [line()], seller(), buyer(), { draft: true }))).not.toContain("invoice.issued_at");
  });
  it("supply date is required on an issued standard invoice only", () => {
    expect(fields(run(invoice({ supply_date: null })))).toContain("invoice.supply_date");
    expect(fields(run(invoice({ supply_date: null }), [line()], seller(), buyer(), { docType: "simplified" }))).not.toContain("invoice.supply_date");
    expect(fields(run(invoice({ supply_date: null }), [line()], seller(), buyer(), { draft: true }))).not.toContain("invoice.supply_date");
  });
  it("credit and debit notes need the original and a reason", () => {
    const f = fields(run(invoice(), [line()], seller(), buyer(), { docType: "credit_note" }));
    expect(f).toContain("invoice.original_invoice_id");
    expect(f).toContain("invoice.credit_reason");
    const ok = run(invoice({ original_invoice_id: "x", credit_reason: "Returned goods" }), [line()], seller(), buyer(), { docType: "credit_note" });
    expect(ok).toEqual([]);
    expect(fields(run(invoice(), [line()], seller(), buyer(), { docType: "debit_note" }))).toContain("invoice.original_invoice_id");
  });
  it("an invoice with no lines is not ready", () => {
    expect(fields(run(invoice({ total: 0 }), []))).toContain("invoice.lines");
  });
  it("the stored total must match the lines to the halala", () => {
    expect(fields(run(invoice({ total: 100.01 })))).toContain("invoice.total");
    expect(fields(run(invoice({ total: 99.99 })))).toContain("invoice.total");
    expect(fields(run(invoice({ total: 100 })))).not.toContain("invoice.total");
  });
});

describe("line rules", () => {
  it("a missing category is reported on the line, with its anchor", () => {
    const issues = run(invoice(), [line({ vat_category: null })]);
    const i = issues.find((x) => x.field === "lines.vat_category")!;
    expect(i.area).toBe("lines");
    expect(i.line).toBe("l1");
    expect(i.message).toMatch(/^Line 1:/);
  });
  it.each([
    ["no rate on a standard line", { vat_category: "S" as const, vat_rate: null }, "lines.vat_rate"],
    ["0% on a standard line", { vat_category: "S" as const, vat_rate: 0 }, "lines.vat_rate"],
    ["rate above 100", { vat_category: "S" as const, vat_rate: 150 }, "lines.vat_rate"],
    ["15% on a zero rated line", { vat_category: "Z" as const, vat_rate: 15, vat_exemption_reason: "Export" }, "lines.vat_rate"],
    ["no reason on a zero rated line", { vat_category: "Z" as const, vat_rate: 0, vat_exemption_reason: null }, "lines.vat_exemption_reason"],
    ["no reason on an exempt line", { vat_category: "E" as const, vat_rate: 0, vat_exemption_reason: "  " }, "lines.vat_exemption_reason"],
    ["no reason on an out-of-scope line", { vat_category: "O" as const, vat_rate: 0, vat_exemption_reason: null }, "lines.vat_exemption_reason"],
    ["no description", { description: "" }, "lines.description"],
    ["zero quantity", { qty: 0, amount: 0 }, "lines.qty"],
    ["negative amount", { rate: -50, amount: -100 }, "lines.amount"],
    ["amount not qty x rate", { amount: 90 }, "lines.amount"],
  ])("%s is reported", (_n, over, field) => {
    const total = (over as { amount?: number }).amount ?? 100;
    expect(fields(run(invoice({ total }), [line(over as Partial<EinvoiceLineInput>)]))).toContain(field);
  });
  it("valid zero, exempt and out-of-scope lines pass", () => {
    const lines = [line({ id: "a", sl_no: "1" }), line({ id: "b", sl_no: "2", vat_category: "Z", vat_rate: 0, vat_exemption_reason: "Export" }), line({ id: "c", sl_no: "3", vat_category: "E", vat_rate: 0, vat_exemption_reason: "Financial" }), line({ id: "d", sl_no: "4", vat_category: "O", vat_rate: 0, vat_exemption_reason: "Outside scope" })];
    expect(run(invoice({ total: 400 }), lines)).toEqual([]);
  });
  it("one halala of rounding between amount and qty x rate is allowed", () => {
    expect(run(invoice({ total: 33.33 }), [line({ qty: 3, rate: 11.11, amount: 33.33 })])).toEqual([]);
    expect(run(invoice({ total: 0.33 }), [line({ qty: 1.5, rate: 0.22, amount: 0.33 })])).toEqual([]);
  });
});

describe("parties and the document type", () => {
  it("normalises registration numbers", () => {
    expect(normaliseTaxId(" 3000 0000-0000 003 ")).toBe(VAT);
    expect(normaliseTaxId("")).toBeNull();
    expect(normaliseTaxId(undefined)).toBeNull();
  });
  it("reads the country as the ISO code", () => {
    expect(countryCode("Saudi Arabia")).toBe("SA");
    expect(countryCode("KSA")).toBe("SA");
    expect(countryCode("sa")).toBe("SA");
    expect(countryCode("India")).toBe("India");
    expect(countryCode("in")).toBe("IN");
    expect(countryCode(null)).toBeNull();
  });
  it("the seller is the invoice's entity, else the default, else the first", () => {
    const e = (id: string, def = false): TenantEntity => ({ id, name: id, short_name: id, address: "", is_default: def });
    const list = [e("a"), e("b", true), e("c")];
    expect(pickEntity(list, "c")?.id).toBe("c");
    expect(pickEntity(list, null)?.id).toBe("b");
    expect(pickEntity(list, "gone")?.id).toBe("b");
    expect(pickEntity([e("a")], null)?.id).toBe("a");
    expect(pickEntity([], null)).toBeNull();
  });
  it("the seller VAT number falls back to the generic Tax ID", () => {
    const base: TenantEntity = { id: "e", name: "Acme", short_name: "A", address: "", is_default: true };
    expect(sellerFromEntity({ ...base, gstin: VAT }).vat_number).toBe(VAT);
    expect(sellerFromEntity({ ...base, gstin: "999", vat_number: VAT }).vat_number).toBe(VAT);
    expect(sellerFromEntity(null).key).toBe("");
  });
  it("the buyer VAT number falls back to the account's tax id and the street is address line 1", () => {
    const b = buyerFromAccount({ name: "B", gstin: VAT2, address_line1: "Main St", city: "Jeddah", postal_code: "21442", country: "Saudi Arabia", address_building: "4321", address_district: "Rawdah" });
    expect(b).toMatchObject({ vat_number: VAT2, buyer_type: "business" });
    expect(b.address).toEqual({ building_number: "4321", street: "Main St", district: "Rawdah", city: "Jeddah", postal_code: "21442", country: "SA" });
  });
  describe("document type resolution", () => {
    it("a business with a VAT number gets a standard invoice", () => {
      expect(resolveDocType({ buyer: { buyer_type: "business", vat_number: VAT2 } })).toBe("standard");
    });
    it("anyone else gets a simplified one", () => {
      expect(resolveDocType({ buyer: { buyer_type: "business", vat_number: null } })).toBe("simplified");
      expect(resolveDocType({ buyer: { buyer_type: "individual", vat_number: VAT2 } })).toBe("simplified");
    });
    it("the workspace default applies to a buyer without a VAT number", () => {
      expect(resolveDocType({ buyer: { buyer_type: "business", vat_number: null }, defaultDocType: "standard" })).toBe("standard");
      expect(resolveDocType({ buyer: { buyer_type: "individual", vat_number: null }, defaultDocType: "standard" })).toBe("simplified");
    });
    it("an explicit choice stands, and a note is never overridden", () => {
      expect(resolveDocType({ explicit: "simplified", buyer: { buyer_type: "business", vat_number: VAT2 } })).toBe("simplified");
      expect(resolveDocType({ explicit: "credit_note", buyer: { buyer_type: "business", vat_number: VAT2 } })).toBe("credit_note");
      expect(resolveDocType({ explicit: "nonsense", buyer: { buyer_type: "business", vat_number: VAT2 } })).toBe("standard");
    });
  });
});

describe("evaluateInvoice ties it together", () => {
  const entity: TenantEntity = { id: "e1", name: "Acme Co", short_name: "A", address: "", is_default: true, vat_number: VAT, crn: "1010000000", name_ar: "شركة أكمي", building_number: "1234", street: "King Fahd Rd", district: "Olaya", city: "Riyadh", postal_code: "12214", country: "Saudi Arabia" };
  const account = { name: "Buyer Co", name_ar: "شركة المشتري", vat_number: VAT2, address_line1: "Main St", address_building: "4321", address_district: "Rawdah", city: "Jeddah", postal_code: "21442", country: "SA" };

  it("a fully filled Saudi invoice is ready and standard", () => {
    const ev = evaluateInvoice({ invoice: { ...invoice(), status: "draft", entity_id: "e1" }, lines: [line()], account, entities: [entity], config: undefined, currency: "SAR" });
    expect(ev.issues).toEqual([]);
    expect(ev.ready).toBe(true);
    expect(ev.docType).toBe("standard");
    expect(ev.docTypeResolved).toBe(true);
    expect(ev.totals.grandTotal).toBe(11500);
  });
  it("an empty workspace says exactly what is missing", () => {
    const ev = evaluateInvoice({ invoice: { ...invoice(), status: "draft" }, lines: [line({ vat_category: null })], account: { name: "Walk-in" }, entities: [], config: undefined, currency: "SAR" });
    expect(ev.ready).toBe(false);
    expect(ev.docType).toBe("simplified");
    expect(fields(ev.issues)).toEqual(expect.arrayContaining(["seller.name", "seller.vat_number", "seller.crn", "lines.vat_category"]));
    expect(fields(ev.issues)).not.toContain("buyer.vat_number");
  });
  it("the workspace default type applies", () => {
    const ev = evaluateInvoice({ invoice: { ...invoice(), status: "draft" }, lines: [line()], account: { name: "B" }, entities: [entity], config: { einvoicing: { scheme: "ksa_zatca", default_doc_type: "standard" } }, currency: "SAR" });
    expect(ev.docType).toBe("standard");
    expect(fields(ev.issues)).toContain("buyer.vat_number");
  });
  it("a stored type wins over the rules", () => {
    const ev = evaluateInvoice({ invoice: { ...invoice(), einvoice_doc_type: "simplified", status: "draft" }, lines: [line()], account, entities: [entity], config: undefined, currency: "SAR" });
    expect(ev.docType).toBe("simplified");
    expect(ev.docTypeResolved).toBe(false);
  });
});
