import { ZATCA_RULES, isVatCategory, type EinvoiceDocType, type VatCategory } from "./rules";

// What the invoice and invoice-line routes accept for e-invoicing, and what they hide. Pure, so the rules are testable
// without a database. The routes call these only for a workspace with e-invoicing on; for everyone else the fields are
// not read from a body and not returned.

export const INVOICE_EINVOICE_KEYS = [
  "einvoice_doc_type", "einvoice_uuid", "einvoice_seq", "einvoice_unit", "original_invoice_id", "credit_reason", "supply_date",
] as const;

export const LINE_EINVOICE_KEYS = ["vat_category", "vat_rate", "vat_exemption_reason"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type InvoiceEinvoicePatch = Partial<{ einvoice_doc_type: EinvoiceDocType; supply_date: string | null; credit_reason: string | null }>;

/**
 * The part of an invoice PATCH body that concerns e-invoicing. Only three fields are ever writable from a body:
 *  - the type, and only between standard and simplified (a note is made by the credit-note action, never by switching
 *    a type, and a note's type cannot be switched away: the link to its original would be left dangling);
 *  - the supply date (a plain date);
 *  - the reason of a note.
 * The UUID, counter, unit and original-invoice link are set by the server alone.
 */
export function cleanInvoiceEinvoicePatch(body: Record<string, unknown>, currentType: EinvoiceDocType | null): InvoiceEinvoicePatch {
  const out: InvoiceEinvoicePatch = {};
  if ("einvoice_doc_type" in body) {
    const v = body.einvoice_doc_type;
    const isNote = currentType === "credit_note" || currentType === "debit_note";
    if (!isNote && (v === "standard" || v === "simplified")) out.einvoice_doc_type = v;
  }
  if ("supply_date" in body) {
    const v = body.supply_date;
    out.supply_date = typeof v === "string" && DATE_RE.test(v.trim()) ? v.trim() : null;
  }
  if ("credit_reason" in body) {
    const v = body.credit_reason;
    out.credit_reason = typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 500) : null;
  }
  return out;
}

export type LineVat = { vat_category: VatCategory | null; vat_rate: number | null; vat_exemption_reason: string | null };

/**
 * A line's VAT fields from a request body, made consistent: Zero, Exempt and Out-of-scope lines are always 0%, a Standard
 * line with no rate gets the Kingdom's standard rate, and clearing the category clears the rate and the reason with it.
 * `existing` is what the line already holds, so a PATCH that sends only the rate keeps the category.
 */
export function cleanLineVat(body: Record<string, unknown>, existing?: Partial<LineVat> | null): Partial<LineVat> {
  const touched = LINE_EINVOICE_KEYS.some((k) => k in body);
  if (!touched) return {};
  const category: VatCategory | null = "vat_category" in body
    ? (isVatCategory(body.vat_category) ? body.vat_category : null)
    : (existing?.vat_category ?? null);
  if (category == null) return { vat_category: null, vat_rate: null, vat_exemption_reason: null };

  let rate: number | null;
  const sent = body.vat_rate;
  if (category !== "S") rate = 0;
  else if (sent !== undefined && sent !== null && sent !== "" && Number.isFinite(Number(sent))) rate = Math.min(100, Math.max(0, Math.round(Number(sent) * 100) / 100));
  else if (!("vat_category" in body) && existing?.vat_rate != null) rate = existing.vat_rate;
  else rate = ZATCA_RULES.standardRate;

  let reason: string | null;
  if (category === "S") reason = null;
  else if ("vat_exemption_reason" in body) reason = typeof body.vat_exemption_reason === "string" && body.vat_exemption_reason.trim() !== "" ? body.vat_exemption_reason.trim().slice(0, 300) : null;
  else reason = existing?.vat_exemption_reason ?? null;

  return { vat_category: category, vat_rate: rate, vat_exemption_reason: reason };
}

/** An invoice row as an API shows it: the e-invoice keys are removed unless the workspace has e-invoicing on. */
export function shapeInvoiceForApi<T extends Record<string, unknown>>(row: T, einvoicingOn: boolean): T {
  if (einvoicingOn) return row;
  const out: Record<string, unknown> = { ...row };
  for (const k of INVOICE_EINVOICE_KEYS) delete out[k];
  return out as T;
}

export function shapeLineForApi<T extends Record<string, unknown>>(row: T, einvoicingOn: boolean): T {
  if (einvoicingOn) return row;
  const out: Record<string, unknown> = { ...row };
  for (const k of LINE_EINVOICE_KEYS) delete out[k];
  return out as T;
}
