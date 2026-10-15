// RFQ object (0128, docs/rfq-architecture.md). Client-safe: no server
// imports, so screens and routes share one set of statuses and defaults.

import type { RfqConfig } from "@/lib/constants";

export const RFQ_STATUSES = ["draft", "sent", "partially_replied", "replied", "awarded", "closed", "cancelled"] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_replied: "Partly replied",
  replied: "All replied",
  awarded: "Awarded",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const RFQ_ORIGIN_TYPES = [
  "manual", "standard_quote", "quote", "opportunity", "case", "inspection_report", "work_order", "fence_project", "pricing",
] as const;
export type RfqOriginType = (typeof RFQ_ORIGIN_TYPES)[number];

export const RFQ_ORIGIN_LABEL: Record<RfqOriginType, string> = {
  manual: "Manual",
  standard_quote: "Standard Quote",
  quote: "Quotation",
  opportunity: "Deal",
  case: "Case",
  inspection_report: "Inspection report",
  work_order: "Work order",
  fence_project: "Fence project",
  pricing: "Pricing",
};

export type RfqLineStatus = "open" | "awarded" | "no_award" | "cancelled";
export type RfqSupplierStatus = "pending" | "sent" | "viewed" | "replied" | "declined" | "expired" | "cancelled";
export type RfqResponseStatus = "quoted" | "no_quote" | "alternative";
export type RfqReplySource = "link" | "buyer" | "upload" | "email";

export const RFQ_SUPPLIER_STATUS_LABEL: Record<RfqSupplierStatus, string> = {
  pending: "Not sent",
  sent: "Sent",
  viewed: "Opened",
  replied: "Replied",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Removed",
};

export type Rfq = {
  id: string;
  tenant_id: string;
  ref: string | null;
  title: string;
  status: RfqStatus;
  origin_type: RfqOriginType;
  origin_id: string | null;
  origin_label: string | null;
  requested_by: string | null;
  buyer_id: string | null;
  respond_by: string | null;
  required_by: string | null;
  delivery_terms: string | null;
  currency: string | null;
  notes_to_supplier: string | null;
  notes_internal: string | null;
  custom_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type RfqLine = {
  id: string;
  rfq_id: string;
  sl_no: number;
  product_id: string | null;
  description: string;
  spec: string | null;
  uom: string | null;
  qty: number | null;
  required_by: string | null;
  status: RfqLineStatus;
  awarded_response_id: string | null;
  awarded_unit_cost: number | null;
  cost_input_id: string | null;
  cost_model_code: string | null;
  path: string;
};

export type RfqSupplier = {
  id: string;
  rfq_id: string;
  supplier_id: string;
  email_to: string | null;
  contact_name: string | null;
  status: RfqSupplierStatus;
  link_expires_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  replied_at: string | null;
  reminder_count: number;
  last_reminded_at: string | null;
  supplier_quote_ref: string | null;
  currency: string | null;
  incoterm: string | null;
  freight_amount: number | null;
  payment_terms: string | null;
  valid_until: string | null;
  note: string | null;
  reply_source: RfqReplySource | null;
};

export type RfqResponse = {
  id: string;
  rfq_supplier_id: string;
  rfq_line_id: string;
  status: RfqResponseStatus;
  unit_price: number | null;
  currency: string | null;
  fx_rate: number | null;
  lead_time_days: number | null;
  moq: number | null;
  offered_description: string | null;
  valid_until: string | null;
  note: string | null;
  source: RfqReplySource;
  is_awarded: boolean;
  submitted_at: string;
};

export type RfqAttachment = { path: string; filename: string; content_type: string; size: number };

export type RfqMessage = {
  id: string;
  rfq_id: string;
  rfq_supplier_id: string | null;
  direction: "out" | "in" | "note";
  channel: "email" | "portal" | "system" | "whatsapp";
  from_address: string | null;
  to_addresses: string[] | null;
  subject: string | null;
  body_text: string | null;
  attachments: RfqAttachment[];
  status: "sent" | "failed" | "received" | "redirected" | "logged";
  error: string | null;
  created_by: string | null;
  read_at: string | null;
  created_at: string;
};

export const RFQ_DEFAULTS: Required<Omit<RfqConfig, "terms">> & { terms: string } = {
  mail_mode: "platform",
  mailbox_connector: "gmail",
  default_response_days: 5,
  max_reminders: 2,
  link_grace_days: 14,
  terms: "",
  attach_pdf: true,
};

export function rfqConfig(cfg: RfqConfig | null | undefined): typeof RFQ_DEFAULTS {
  const c = cfg ?? {};
  const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    mail_mode: c.mail_mode === "mailbox" ? "mailbox" : "platform",
    mailbox_connector: c.mailbox_connector === "mail_server" ? "mail_server" : "gmail",
    default_response_days: clampInt(c.default_response_days, 1, 90, RFQ_DEFAULTS.default_response_days),
    max_reminders: clampInt(c.max_reminders, 0, 5, RFQ_DEFAULTS.max_reminders),
    link_grace_days: clampInt(c.link_grace_days, 0, 90, RFQ_DEFAULTS.link_grace_days),
    terms: typeof c.terms === "string" ? c.terms.slice(0, 4000) : "",
    attach_pdf: c.attach_pdf !== false,
  };
}

/** Limits on what one RFQ and one supplier can put through the public
 *  surfaces -- there is no rate limiter in front of them, so the record is
 *  the limit (docs/rfq-architecture.md §4.3). */
export const RFQ_LIMITS = {
  maxLines: 200,
  maxSuppliers: 30,
  maxSubmissionsPerSupplier: 30,
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxAttachmentsPerMessage: 10,
  maxText: 4000,
  maxPrice: 1e10,
} as const;

export const RFQ_ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};
