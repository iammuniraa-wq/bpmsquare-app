import { isNote, resolveDocType } from "./parties";
import { computeVatTotals, fromHalalas, toHalalas } from "./totals";
import {
  ZATCA_RULES, isVatCategory,
  type EinvoiceBuyer, type EinvoiceDocType, type EinvoiceInvoiceInput, type EinvoiceLineInput,
  type EinvoiceSeller, type ReadinessArea, type ReadinessIssue, type StructuredAddress,
} from "./rules";

export type ValidateOptions = {
  /** Overrides the type stored on the invoice. */
  docType?: EinvoiceDocType | null;
  /** The workspace choice for a buyer without a VAT number (config.einvoicing.default_doc_type). */
  defaultDocType?: "standard" | "simplified" | null;
  /** Currency of the invoice (the tenant currency). Anything but SAR is reported. */
  currency?: string | null;
  /**
   * A draft has no issue date, time or supply date yet: they are stamped when the invoice is sent, so their absence
   * is not a blocker for a draft. Once the invoice is issued they are required.
   */
  draft?: boolean;
};

/** Which path a document takes: a note follows its buyer (a business with a VAT number = the Standard path). */
export function pathOf(docType: EinvoiceDocType, buyer: Pick<EinvoiceBuyer, "buyer_type" | "vat_number">): "standard" | "simplified" {
  if (docType === "standard" || docType === "simplified") return docType;
  return buyer.buyer_type === "business" && buyer.vat_number ? "standard" : "simplified";
}

const present = (v: string | null | undefined) => typeof v === "string" && v.trim() !== "";

function addressIssues(prefix: "seller" | "buyer", who: string, a: StructuredAddress, area: ReadinessArea): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  const add = (key: string, message: string) => out.push({ field: `${prefix}.${key}`, area, message });
  if (!present(a.building_number)) add("building_number", `${who} building number is missing (4 digits).`);
  else if (!ZATCA_RULES.buildingNumber.test(a.building_number!)) add("building_number", `${who} building number must be exactly 4 digits.`);
  if (!present(a.street)) add("street", `${who} street is missing.`);
  if (!present(a.district)) add("district", `${who} district is missing.`);
  if (!present(a.city)) add("city", `${who} city is missing.`);
  if (!present(a.postal_code)) add("postal_code", `${who} postal code is missing (5 digits).`);
  else if (!ZATCA_RULES.postalCode.test(a.postal_code!)) add("postal_code", `${who} postal code must be exactly 5 digits.`);
  if (!present(a.country)) add("country", `${who} country is missing.`);
  else if (a.country !== ZATCA_RULES.country) add("country", `${who} country must be Saudi Arabia (SA) for a Saudi e-invoice.`);
  return out;
}

/**
 * Everything ZATCA needs that is not yet on this invoice, in plain words. An empty list means the invoice is READY.
 * Pure: pass already decrypted account data. `field` is a stable key (also the anchor id the screen scrolls to) and
 * `area` says where it is fixed: the seller unit (Settings > Company), the buyer (the account), the invoice or a line.
 */
export function validateInvoiceForZatca(
  invoice: EinvoiceInvoiceInput,
  lines: EinvoiceLineInput[],
  seller: EinvoiceSeller,
  buyer: EinvoiceBuyer,
  opts: ValidateOptions = {},
): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  const docType = opts.docType ?? invoice.einvoice_doc_type ?? resolveDocType({ buyer, defaultDocType: opts.defaultDocType });
  const path = pathOf(docType, buyer);
  const inv = (field: string, message: string) => out.push({ field: `invoice.${field}`, area: "invoice", message });

  // ── Seller ────────────────────────────────────────────────────────────────
  const s = (field: string, message: string) => out.push({ field: `seller.${field}`, area: "seller", message });
  if (!present(seller.name)) s("name", "Seller legal name is missing.");
  if (!present(seller.name_ar)) s("name_ar", "Seller name in Arabic is missing (printed on the bilingual invoice).");
  if (!present(seller.vat_number)) s("vat_number", "Seller VAT number is missing.");
  else if (!ZATCA_RULES.vatNumber.test(seller.vat_number!)) s("vat_number", "Seller VAT number must be 15 digits, starting and ending with 3.");
  if (!present(seller.crn)) s("crn", "Seller commercial registration number (CRN) is missing.");
  else if (!ZATCA_RULES.crn.test(seller.crn!)) s("crn", "Seller commercial registration number must be 10 digits.");
  out.push(...addressIssues("seller", "Seller", seller.address, "seller"));

  // ── Buyer ─────────────────────────────────────────────────────────────────
  const b = (field: string, message: string) => out.push({ field: `buyer.${field}`, area: "buyer", message });
  if (path === "standard") {
    if (buyer.buyer_type === "individual") b("buyer_type", "A Standard invoice is for a business. Make this a Simplified invoice, or set the buyer as a business.");
    if (!present(buyer.name)) b("name", "Buyer name is missing.");
    if (!present(buyer.name_ar)) b("name_ar", "Buyer name in Arabic is missing (printed on the bilingual invoice).");
    if (!present(buyer.vat_number)) b("vat_number", "Buyer VAT number is missing (a Standard invoice needs it).");
    else if (!ZATCA_RULES.vatNumber.test(buyer.vat_number!)) b("vat_number", "Buyer VAT number must be 15 digits, starting and ending with 3.");
    out.push(...addressIssues("buyer", "Buyer", buyer.address, "buyer"));
  } else {
    // Simplified: the buyer is optional, but what IS given must be well formed.
    if (present(buyer.vat_number) && !ZATCA_RULES.vatNumber.test(buyer.vat_number!)) b("vat_number", "Buyer VAT number must be 15 digits, starting and ending with 3.");
    if (present(buyer.id_number) && !present(buyer.id_scheme)) b("id_scheme", "Buyer ID type is missing (National ID, Iqama, Passport...).");
    if (present(buyer.address.postal_code) && !ZATCA_RULES.postalCode.test(buyer.address.postal_code!)) b("postal_code", "Buyer postal code must be exactly 5 digits.");
  }

  // ── Invoice ───────────────────────────────────────────────────────────────
  if (opts.currency && opts.currency !== ZATCA_RULES.currency) {
    inv("currency", `The invoice currency is ${opts.currency}. ZATCA reports in ${ZATCA_RULES.currency}; other currencies need an exchange rate, which is not captured yet.`);
  }
  if (!opts.draft) {
    if (!present(invoice.issued_at)) inv("issued_at", "Issue date and time are missing.");
    if (path === "standard" && !isNote(docType) && !present(invoice.supply_date)) inv("supply_date", "Supply date is missing (a Standard invoice needs it).");
  }
  if (isNote(docType)) {
    if (!present(invoice.original_invoice_id)) inv("original_invoice_id", `A ${docType === "credit_note" ? "credit" : "debit"} note must refer to the invoice it corrects.`);
    if (!present(invoice.credit_reason)) inv("credit_reason", `A ${docType === "credit_note" ? "credit" : "debit"} note needs a reason.`);
  }

  // ── Lines ─────────────────────────────────────────────────────────────────
  if (lines.length === 0) inv("lines", "The invoice has no lines.");
  lines.forEach((l, i) => {
    const label = l.sl_no ?? String(i + 1);
    const ln = (field: string, message: string) => out.push({ field: `lines.${field}`, area: "lines", message: `Line ${label}: ${message}`, line: l.id ?? label });
    if (!present(l.description)) ln("description", "description is missing.");
    if (!(l.qty > 0)) ln("qty", "quantity must be more than 0.");
    if (l.rate < 0 || l.amount < 0) ln("amount", "amounts must be positive. On a credit note the type says the direction.");
    // The stored amount is qty x rate rounded to the halala; allow that one halala of rounding either way.
    if (Math.abs(toHalalas(l.amount) - toHalalas(l.qty * l.rate)) > 1) ln("amount", "amount does not equal quantity x unit price.");
    if (!isVatCategory(l.vat_category)) {
      ln("vat_category", "VAT category is missing (Standard, Zero rated, Exempt or Out of scope).");
      return;
    }
    if (l.vat_rate == null || !Number.isFinite(l.vat_rate)) ln("vat_rate", "VAT rate is missing.");
    else if (l.vat_rate < 0 || l.vat_rate > 100) ln("vat_rate", "VAT rate must be between 0 and 100.");
    else if (l.vat_category === "S" && l.vat_rate <= 0) ln("vat_rate", "a Standard rated line needs a rate above 0%.");
    else if ((ZATCA_RULES.zeroRateCategories as readonly string[]).includes(l.vat_category) && l.vat_rate !== 0) ln("vat_rate", "a Zero rated, Exempt or Out of scope line must have a 0% rate.");
    if ((ZATCA_RULES.reasonRequiredCategories as readonly string[]).includes(l.vat_category) && !present(l.vat_exemption_reason)) {
      ln("vat_exemption_reason", "the reason for the zero rate, exemption or out-of-scope treatment is missing.");
    }
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  if (lines.length > 0) {
    const totals = computeVatTotals(invoice, lines);
    // The groups plus the discount must give back the stored invoice total to the halala, and payable = taxable + VAT.
    const groupNet = totals.groups.reduce((sum, g) => sum + g.taxable + g.discount, 0);
    if (groupNet !== toHalalas(invoice.total)) {
      inv("total", `The invoice total (${fromHalalas(toHalalas(invoice.total)).toFixed(2)}) does not match its lines (${fromHalalas(groupNet).toFixed(2)}). Save the lines again to refresh it.`);
    }
    if (totals.grandTotal !== totals.taxableTotal + totals.vatTotal) {
      inv("total", "The VAT totals by rate do not add up to the payable amount.");
    }
  }

  return out;
}

export function isReady(issues: ReadinessIssue[]): boolean {
  return issues.length === 0;
}
