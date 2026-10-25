import type { EinvoiceEvaluation } from "./evaluate";
import type { EinvoiceDocType, EinvoiceBuyer, EinvoiceSeller } from "./rules";
import type { VatTotals } from "./totals";

// Everything the bilingual printed invoice needs beyond the invoice itself, computed on the server and handed to the print
// component as plain data. The component does no rules of its own: it only lays this out.

export type KsaPrintData = {
  docType: EinvoiceDocType;
  seller: EinvoiceSeller;
  buyer: EinvoiceBuyer;
  /** VAT by rate, in halalas. */
  totals: VatTotals;
  uuid: string | null;
  seq: number | null;
  issuedAt: string | null;
  supplyDate: string | null;
  /** Ref of the invoice a credit or debit note corrects. */
  originalRef: string | null;
  reason: string | null;
};

export function buildKsaPrintData(
  ev: Pick<EinvoiceEvaluation, "docType" | "seller" | "buyer" | "totals">,
  invoice: { einvoice_uuid?: string | null; einvoice_seq?: number | null; issued_at?: string | null; supply_date?: string | null; credit_reason?: string | null },
  originalRef: string | null,
): KsaPrintData {
  return {
    docType: ev.docType,
    seller: ev.seller,
    buyer: ev.buyer,
    totals: ev.totals,
    uuid: invoice.einvoice_uuid ?? null,
    seq: invoice.einvoice_seq ?? null,
    issuedAt: invoice.issued_at ?? null,
    supplyDate: invoice.supply_date ?? null,
    originalRef,
    reason: invoice.credit_reason ?? null,
  };
}

const RIYADH = "Asia/Riyadh";

/** "25 Oct 2026" in the Kingdom's time zone, or "" when there is no value. Fixed locale so server and browser agree. */
export function printDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: RIYADH });
}

/** "14:05" in the Kingdom's time zone (24 hour), or "". */
export function printTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: RIYADH });
}
