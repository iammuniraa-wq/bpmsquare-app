import type { TenantConfig, TenantEntity } from "@/lib/constants";
import { buyerFromAccount, pickEntity, resolveDocType, sellerFromEntity, type AccountForBuyer } from "./parties";
import { computeVatTotals, type VatTotals } from "./totals";
import { isReady, validateInvoiceForZatca } from "./validate";
import type {
  EinvoiceBuyer, EinvoiceDocType, EinvoiceInvoiceInput, EinvoiceLineInput, EinvoiceSeller, ReadinessIssue,
} from "./rules";

// Everything the invoice screen, the print page, the API and the send step need to know about one invoice, computed
// once from data the caller already has. Pure: no database.

export type EinvoiceEvaluation = {
  docType: EinvoiceDocType;
  /** True when the type was chosen by the rules, not stored on the invoice. */
  docTypeResolved: boolean;
  seller: EinvoiceSeller;
  buyer: EinvoiceBuyer;
  issues: ReadinessIssue[];
  ready: boolean;
  totals: VatTotals;
};

export function evaluateInvoice(a: {
  invoice: EinvoiceInvoiceInput & { entity_id?: string | null; status?: string | null };
  lines: EinvoiceLineInput[];
  account: AccountForBuyer | null;
  entities: TenantEntity[] | undefined;
  config: Pick<Partial<TenantConfig>, "einvoicing"> | null | undefined;
  currency: string | null | undefined;
  /** Treat the issue/supply date as not-yet-required (the invoice is still a draft). Defaults to status === "draft". */
  draft?: boolean;
}): EinvoiceEvaluation {
  const seller = sellerFromEntity(pickEntity(a.entities, a.invoice.entity_id ?? null));
  const buyer = buyerFromAccount(a.account);
  const defaultDocType = a.config?.einvoicing?.default_doc_type ?? null;
  const stored = a.invoice.einvoice_doc_type ?? null;
  const docType = resolveDocType({ explicit: stored, buyer, defaultDocType });
  const issues = validateInvoiceForZatca(a.invoice, a.lines, seller, buyer, {
    docType,
    defaultDocType,
    currency: a.currency ?? null,
    draft: a.draft ?? a.invoice.status === "draft",
  });
  return {
    docType,
    docTypeResolved: stored == null,
    seller,
    buyer,
    issues,
    ready: isReady(issues),
    totals: computeVatTotals(a.invoice, a.lines),
  };
}
