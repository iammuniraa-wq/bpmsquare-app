import type { EinvoiceDocType, EinvoiceLineInput } from "./rules";
import { fromHalalas, toHalalas } from "./totals";

// Credit notes.
//
// Convention (decided and documented once): ZATCA wants every amount on a note POSITIVE, with the document type
// saying the direction (invoice type code 381 for a credit note, 383 for a debit note). So a credit note here is an
// ordinary invoice row typed `credit_note`, with positive quantities, rates and totals, linked to the invoice it
// corrects through `original_invoice_id` and carrying a `credit_reason`. Nothing is stored negative.
//
// Where the direction matters (ledgers, summary tiles, "outstanding" figures) a caller multiplies by
// `ledgerSign(docType)`: a credit note counts against the money owed, everything else counts for it.

export type OriginalInvoiceForNote = {
  id: string;
  ref: string;
  account_id: string;
  contact_id: string | null;
  entity_id: string | null;
  discount_type: string | null;
  discount_pct: number | null;
  discount_fixed: number | null;
};

export type NoteLine = {
  sl_no: string;
  description: string;
  uom: string | null;
  qty: number;
  rate: number;
  amount: number;
  vat_category: EinvoiceLineInput["vat_category"] | null;
  vat_rate: number | null;
  vat_exemption_reason: string | null;
};

export type NoteInsert = {
  header: {
    account_id: string;
    contact_id: string | null;
    entity_id: string | null;
    discount_type: string;
    discount_pct: number;
    discount_fixed: number;
    notes: string;
    einvoice_doc_type: "credit_note" | "debit_note";
    original_invoice_id: string;
    credit_reason: string;
  };
  lines: NoteLine[];
  total: number;
};

export function ledgerSign(docType: EinvoiceDocType | null | undefined): 1 | -1 {
  return docType === "credit_note" ? -1 : 1;
}

/**
 * The rows for a credit (or debit) note that corrects `original` in full: every line copied with the same VAT
 * category, rate and reason, amounts positive. The reason is required -- ZATCA rejects a note without one.
 */
export function buildNoteFromInvoice(
  original: OriginalInvoiceForNote,
  lines: EinvoiceLineInput[],
  reason: string,
  kind: "credit_note" | "debit_note" = "credit_note",
): NoteInsert {
  const why = (reason ?? "").trim();
  if (why === "") throw new Error("A credit note needs a reason.");
  if (why.length > 500) throw new Error("The reason is too long (500 characters at most).");
  const copied = lines.map((l, i) => ({
    sl_no: l.sl_no ?? String(i + 1),
    description: l.description,
    uom: l.uom ?? null,
    qty: Math.abs(l.qty),
    rate: Math.abs(l.rate),
    amount: Math.abs(l.amount),
    vat_category: l.vat_category ?? null,
    vat_rate: l.vat_rate ?? null,
    vat_exemption_reason: l.vat_exemption_reason ?? null,
  }));
  return {
    header: {
      account_id: original.account_id,
      contact_id: original.contact_id,
      entity_id: original.entity_id,
      discount_type: original.discount_type ?? "pct",
      discount_pct: original.discount_pct ?? 0,
      discount_fixed: original.discount_fixed ?? 0,
      notes: `${kind === "credit_note" ? "Credit note" : "Debit note"} for ${original.ref}`,
      einvoice_doc_type: kind,
      original_invoice_id: original.id,
      credit_reason: why,
    },
    lines: copied,
    total: fromHalalas(copied.reduce((s, l) => s + toHalalas(l.amount), 0)),
  };
}
