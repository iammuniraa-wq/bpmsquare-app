// Saudi e-invoicing (ZATCA) -- the rule constants and the shared types, in ONE place.
//
// Provenance: this repository holds no copy of the ZATCA specification (only docs/design/saudi-einvoicing-plan.md,
// whose items are marked "verify"). Every value below is therefore ASSUMED from the published Fatoora technical
// specification and the business rules named in the comments (BR-KSA-nn, BR-CO-nn). They are kept here, never
// repeated in a validator or a form, so verifying or changing one is a one-line change. Each is listed in the E1
// report as "assumed, verify against the current spec before E2".

export const EINVOICE_SCHEME = "ksa_zatca" as const;
export type EinvoiceScheme = typeof EINVOICE_SCHEME;

export const ZATCA_RULES = {
  /** VAT registration number: 15 digits, first and last digit 3 (BR-KSA-39 / BR-KSA-40). */
  vatNumber: /^3\d{13}3$/,
  /** Commercial registration number: 10 digits (BR-KSA-08 scheme CRN). */
  crn: /^\d{10}$/,
  /** Postal code: exactly 5 digits (BR-KSA-66 seller, BR-KSA-67 buyer). */
  postalCode: /^\d{5}$/,
  /** Building number: exactly 4 digits (BR-KSA-37 seller, BR-KSA-63 buyer). */
  buildingNumber: /^\d{4}$/,
  /** ISO 3166 alpha-2 code of the country of the address. */
  country: "SA",
  /** The VAT is reported in SAR; amounts have 2 decimals (halalas). */
  currency: "SAR",
  /** Standard VAT rate in the Kingdom (since 1 July 2020), used as the default for a new line. */
  standardRate: 15,
  /** BR-S-05 .. BR-O-05: a Zero, Exempt or Out-of-scope line carries a 0 rate; a Standard line a rate above 0. */
  zeroRateCategories: ["Z", "E", "O"] as const,
  /** BR-KSA-... : a zero, exempt or out-of-scope line needs a stated reason (VATEX code / text). */
  reasonRequiredCategories: ["Z", "E", "O"] as const,
  /** The sub-unit: SAR has 100 halalas. All arithmetic is done in whole halalas. */
  subunit: 100,
} as const;

export const VAT_CATEGORIES = ["S", "Z", "E", "O"] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number];

export const EINVOICE_DOC_TYPES = ["standard", "simplified", "credit_note", "debit_note"] as const;
export type EinvoiceDocType = (typeof EINVOICE_DOC_TYPES)[number];

export const BUYER_TYPES = ["business", "individual"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

/** Identification schemes ZATCA accepts for a buyer that is a person (BR-KSA-14 list, individuals only). */
export const BUYER_ID_SCHEMES = ["NAT", "IQA", "PAS", "GCC", "OTH"] as const;
export type BuyerIdScheme = (typeof BUYER_ID_SCHEMES)[number];

/** The postal address in the structured form ZATCA wants. `street` is the generic address line 1 on an account. */
export type StructuredAddress = {
  building_number: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
};

export type EinvoiceSeller = {
  /** The entity id in tenants.config.entities[] ("" when the workspace has no entity). The counter key. */
  key: string;
  name: string | null;
  name_ar: string | null;
  vat_number: string | null;
  crn: string | null;
  address: StructuredAddress;
};

export type EinvoiceBuyer = {
  name: string | null;
  name_ar: string | null;
  buyer_type: BuyerType;
  vat_number: string | null;
  crn: string | null;
  address: StructuredAddress;
  id_number: string | null;
  id_scheme: string | null;
};

/** The columns of an invoice the e-invoice code reads. Every one is optional: they only exist after migration 0219. */
export type EinvoiceInvoiceInput = {
  id?: string;
  ref?: string;
  status?: string;
  total: number;
  currency?: string | null;
  discount_type?: string | null;
  discount_pct?: number | null;
  discount_fixed?: number | null;
  issued_at?: string | null;
  supply_date?: string | null;
  einvoice_doc_type?: EinvoiceDocType | null;
  einvoice_uuid?: string | null;
  einvoice_seq?: number | null;
  original_invoice_id?: string | null;
  credit_reason?: string | null;
};

export type EinvoiceLineInput = {
  id?: string;
  sl_no?: string | null;
  description: string;
  uom?: string | null;
  qty: number;
  rate: number;
  amount: number;
  vat_category?: VatCategory | null;
  vat_rate?: number | null;
  vat_exemption_reason?: string | null;
};

/** Where a missing item is fixed; the panel turns this into a link or an anchor. */
export type ReadinessArea = "seller" | "buyer" | "invoice" | "lines";

export type ReadinessIssue = {
  /** Stable machine key, e.g. "seller.vat_number" or "lines.vat_category" -- also the anchor id. */
  field: string;
  area: ReadinessArea;
  /** Plain words for the person who has to fix it. */
  message: string;
  /** The line (sl_no / index) the issue is about, for line rules. */
  line?: string;
};

export function isVatCategory(v: unknown): v is VatCategory {
  return typeof v === "string" && (VAT_CATEGORIES as readonly string[]).includes(v);
}
export function isEinvoiceDocType(v: unknown): v is EinvoiceDocType {
  return typeof v === "string" && (EINVOICE_DOC_TYPES as readonly string[]).includes(v);
}
export function isBuyerType(v: unknown): v is BuyerType {
  return typeof v === "string" && (BUYER_TYPES as readonly string[]).includes(v);
}
