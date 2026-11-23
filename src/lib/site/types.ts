// Site receipt and Site expenses (docs/design/pcbs-site-receipt-expenses.md). Plain types and constants, no I/O and no server imports,
// so the routes, the screens, the offline queue and the tests read the same words. Tables: migrations 0258 (expenses), 0259 (receipts).
//
// A receipt is a confirmation with evidence and creates no cost. An expense is a cost claim: a manager approves it, it counts as RECORDED
// on its budget line at once, and it goes to the ERP as an unposted journal proposal (parked: this build keeps only the stored fields,
// the status values and a daily Excel register). BPMSquare never posts to a ledger.

export const EXPENSE_STATUSES = ["submitted", "approved", "rejected", "cancelled"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = { submitted: "Waiting", approved: "Approved", rejected: "Returned", cancelled: "Cancelled" };

export const ERP_STATES = ["not_sent", "sent", "posted", "failed"] as const;
export type ErpState = (typeof ERP_STATES)[number];
export const ERP_STATE_LABEL: Record<ErpState, string> = { not_sent: "Not sent", sent: "Sent to ERP", posted: "Posted", failed: "Failed" };

export const DOCUMENT_STATES = ["receipt_attached", "invoice_to_follow"] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const PAID_BY = ["company", "self_paid", "card", "advance"] as const;
export type PaidBy = (typeof PAID_BY)[number];
export const PAID_BY_LABEL: Record<PaidBy, string> = { company: "Company", self_paid: "Paid by me", card: "Company card", advance: "Cash advance" };

export type ExpenseFlag = "duplicate" | "over_limit" | "over_cap" | "no_line";
export const EXPENSE_FLAG_LABEL: Record<ExpenseFlag, string> = {
  duplicate: "Possible duplicate", over_limit: "Over the limit", over_cap: "Over the monthly cap", no_line: "Cost line not chosen",
};

export const RECEIPT_STATUSES = ["confirmed", "cancelled"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = { confirmed: "Confirmed", cancelled: "Cancelled" };

export const RECEIPT_OUTCOMES = ["complete", "partial", "rejected"] as const;
export type ReceiptOutcome = (typeof RECEIPT_OUTCOMES)[number];
export const RECEIPT_OUTCOME_LABEL: Record<ReceiptOutcome, string> = { complete: "Complete", partial: "Partial", rejected: "Rejected" };

export const RECEIPT_SOURCES = ["erp_delivery_note", "package", "email", "manual"] as const;
export type ReceiptSource = (typeof RECEIPT_SOURCES)[number];

export const CONDITIONS = ["ok", "damaged", "wrong_item", "defective"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABEL: Record<Condition, string> = { ok: "Good", damaged: "Damaged", wrong_item: "Wrong item", defective: "Defective" };

/** The default reasons (the client's answer 7 is the default we build): a workspace-specific list is a later Settings option. */
export const RECEIPT_REASONS: readonly { code: string; label: string }[] = [
  { code: "damaged_in_transit", label: "Damaged in transit" },
  { code: "cracked", label: "Cracked or chipped" },
  { code: "wrong_element", label: "Wrong element" },
  { code: "wrong_dimensions", label: "Wrong dimensions" },
  { code: "defective_finish", label: "Defective finish" },
  { code: "not_delivered", label: "Not delivered" },
  { code: "other", label: "Other" },
];
export const isReasonCode = (v: unknown): v is string => typeof v === "string" && RECEIPT_REASONS.some((r) => r.code === v);
export const reasonLabel = (code: string | null | undefined): string => RECEIPT_REASONS.find((r) => r.code === code)?.label ?? "";

/** The six categories a site person picks from, each mapped to an existing resource type (design section 4; the client's answer 8 is the default). */
export const DEFAULT_CATEGORIES: readonly { name: string; resource_code: string; erp_category: string | null }[] = [
  { name: "Materials", resource_code: "11", erp_category: "11" },
  { name: "Equipment rental", resource_code: "21", erp_category: "21" },
  { name: "Manpower", resource_code: "31", erp_category: "31" },
  { name: "Subcontractor", resource_code: "41", erp_category: "41" },
  { name: "Transport", resource_code: "51", erp_category: "51" },
  { name: "Other", resource_code: "51", erp_category: "51" },
];

export type SiteExpenseCategory = {
  id: string;
  name: string;
  resource_code: string | null;
  cost_code: string | null;
  erp_category: string | null;
  limit_amount: number | null;
  active: boolean;
  sort_order: number;
};

export type SiteExpense = {
  id: string;
  ref: string | null;
  project_id: string;
  client_id: string;
  status: ExpenseStatus;
  category_id: string | null;
  line_key: string | null;
  wbs_code: string | null;
  expense_date: string;
  amount: number;
  currency: string;
  amount_project_ccy: number | null;
  vat_amount: number | null;
  vendor_text: string | null;
  supplier_id: string | null;
  document_state: DocumentState;
  invoice_ref: string | null;
  paid_by: PaidBy;
  note: string | null;
  flags: ExpenseFlag[];
  submitted_by: string;
  submitted_at: string;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  ai_read: Record<string, unknown> | null;
  photo_hash?: string | null;
  source_type: string | null;
  source_id: string | null;
  erp_ref: string | null;
  erp_state: ErpState;
  sent_at: string | null;
  posted_amount: number | null;
  posted_at: string | null;
  custom_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SiteReceiptLine = {
  id: string;
  receipt_id: string;
  line_no: number;
  line_key: string | null;
  /** Free text until the element master exists (decision 11, built by another piece of work): nullable on purpose, never a foreign key. */
  element_code: string | null;
  building: string | null;
  description: string;
  uom: string | null;
  qty_expected: number | null;
  qty_received: number;
  qty_accepted: number;
  qty_rejected: number;
  condition: Condition;
  reason_code: string | null;
  note: string | null;
};

export type SiteReceipt = {
  id: string;
  ref: string | null;
  project_id: string;
  client_id: string;
  status: ReceiptStatus;
  package_id: string | null;
  delivery_note_ref: string | null;
  source_type: ReceiptSource;
  source_id: string | null;
  received_at: string;
  received_by: string;
  handed_by: string | null;
  vehicle: string | null;
  note: string | null;
  outcome: ReceiptOutcome;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  erp_ref: string | null;
  erp_state: ErpState;
  custom_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SiteFile = {
  id: string;
  object_type: "site_expense" | "site_receipt";
  object_id: string;
  kind: "photo" | "signature";
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

/** The workspace's site settings (tenants.config.site). Every field optional: a missing value is "no limit". */
export type SiteConfig = {
  /** A project manager approves alone up to this amount (project currency); above it only a cost approver may. */
  pm_limit?: number | null;
  /** A person's own submitted-and-approved total in a calendar month above this is flagged. */
  monthly_cap?: number | null;
};

export const SITE_LIMITS = { maxAmount: 99_999_999, maxQty: 9_999_999, maxLines: 200, maxPhotos: 8, maxPhotoBytes: 8 * 1024 * 1024, dupWindowDays: 60, backdateDays: 366 } as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
