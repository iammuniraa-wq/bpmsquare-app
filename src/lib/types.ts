// VeveyCRM domain model — the Account is the hub; everything carries account_id.
// Mirrors the LOCKED data model in PROJECT.md §3.

import type { SegmentFilter } from "@/lib/marketingSegmentation";
import type { QuoteOutcome } from "@/lib/constants";

export type AccountType = "prospect" | "oem" | "direct" | "end_customer";

export type Account = {
  id: string;
  /** Tenant-scoped business ID (ACC-0001, 0061) -- display/reference only, never a mutation key. */
  ref?: string | null;
  name: string;
  type: AccountType;
  // Address
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  // Communication
  phone: string | null;
  phone2: string | null;
  email: string | null;
  email2: string | null;
  website: string | null;
  // Sales
  territory: string | null;
  sales_org: string | null;
  // Business
  industry: string | null;
  employee_count: string | null;
  annual_revenue: string | null;
  gstin: string | null;
  notes: string | null;
  // The OEM that referred this account (when type = end_customer).
  referred_by_account_id: string | null;
  created_at: string;
  custom_data: Record<string, unknown> | null;
  marketing_opt_out: boolean;
};

export type MarketingCampaignStatus = "draft" | "sending" | "sent" | "failed";

export type MarketingCampaign = {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: MarketingCampaignStatus;
  account_types: AccountType[];
  include_account_ids: string[];
  exclude_account_ids: string[];
  manual_emails: string[];
  filters: SegmentFilter[];
  match: "all" | "any";
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  template_id: string | null;
  custom_message: string | null;
};

export type MarketingRecipientStatus = "pending" | "sent" | "failed" | "skipped_opt_out" | "skipped_no_email";

export type MarketingCampaignRecipient = {
  id: string;
  campaign_id: string;
  account_id: string | null;
  manual_email: string | null;
  email: string | null;
  status: MarketingRecipientStatus;
  error: string | null;
  sent_at: string | null;
};

/** A saved, reusable audience definition -- same shape as a campaign's own
 * ad hoc targeting rule, so it can be loaded into the picker as a starting
 * point for a new campaign. `filters`/`match` are the rule-based
 * segmentation conditions built in the drag-and-drop Segmentation builder;
 * see lib/marketingSegmentation.ts. */
export type MarketingTargetGroup = {
  id: string;
  name: string;
  account_types: AccountType[];
  include_account_ids: string[];
  exclude_account_ids: string[];
  manual_emails: string[];
  filters: SegmentFilter[];
  match: "all" | "any";
  created_by: string | null;
  created_at: string;
};

export type Contact = {
  id: string;
  /** CON-0001 (0061) -- display/reference only. */
  ref?: string | null;
  account_id: string;
  name: string;
  role: string | null;
  department: string | null;
  phone: string | null;
  phone2: string | null;
  phone3: string | null;
  email: string | null;
  email2: string | null;
  website: string | null;
  linkedin_url: string | null;
  birthday: string | null;
  // Contact's own address (may differ from account address)
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  territory: string | null;
  sales_org: string | null;
  notes: string | null;
  custom_data: Record<string, unknown> | null;
};

export type Site = {
  id: string;
  account_id: string;
  label: string;
  address: string | null;
};

export type Asset = {
  id: string;
  /** AST-0001 (0061) -- display/reference only. */
  ref?: string | null;
  account_id: string | null; // null = company-owned loaner stock
  kind: "motor" | "transformer" | "pump" | "generator" | "panel";
  name: string;
  make: string | null;       // manufacturer, e.g. "Crompton Greaves"
  model: string | null;      // model / frame number, e.g. "ND315S-2"
  rating: string | null;     // e.g. "75 kW · 415V"
  rpm: string | null;        // e.g. "1480"
  // Motor/generator nameplate fields — see supabase/migrations/0033_asset_nameplate_fields.sql
  frame_type: string | null;
  insulation_class: string | null;
  connection: string | null;
  duty: string | null;
  ambient_temp: string | null;
  output_kw: string | null;
  stator_voltage: string | null;
  stator_current: string | null;
  excitation_voltage: string | null;
  excitation_current: string | null;
  frequency: string | null;
  serial: string | null;
  notes: string | null;      // service history or remarks
  is_loaner: boolean;
  loaner_status: "available" | "on_loan" | null; // null when not loaner stock
  custom_data: Record<string, unknown> | null;
};

export type Contract = {
  id: string;
  account_id: string;
  ref: string;
  // The OEM/holder billed for AMC-covered jobs.
  holder_account_id: string | null;
  status: "active" | "expired" | "draft";
  start_date: string | null;
  end_date: string | null;
  value: number | null;
};

export type LeadStatus = "new" | "inspecting" | "quoted" | "won" | "lost";

export type Lead = {
  id: string;
  account_id: string;
  title: string;
  source: "oem_referral" | "amc" | "direct" | "campaign";
  /** Set when source === "campaign" -- which sent campaign generated this
   * lead, via the click-through "I'm interested" link. */
  source_campaign_id: string | null;
  status: LeadStatus;
  created_at: string;
};

export type QuoteOfferType = "quotation" | "technical" | "budgetary" | "supply" | "repair";

export type Quote = {
  id: string;
  account_id: string;
  ref: string;
  type: QuoteOfferType;
  status: "draft" | "sent" | "approved" | "rejected";
  business_status?: "pending" | "po_received";
  // The business RESULT -- fully independent of status (see
  // QuoteStatusDef.is_closed, which only tracks pipeline position, not
  // win/loss). Can be set any time, including before status reaches a
  // closed state (e.g. marked "lost" while still "sent"); a closed status
  // always requires a decided (non-"open") outcome -- enforced server-side.
  outcome: QuoteOutcome;
  total: number;
  created_at: string;
  // The business date on the quote, back-datable by the user. Falls back to
  // created_at on rows written before the column existed.
  quote_date?: string | null;
  // Date profile (0059): inquiry_date is business-entered; submitted_at and
  // closed_at auto-stamp on first send / terminal transition but accept
  // manual override; updated_at is system-maintained on every edit.
  inquiry_date: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  updated_at: string;
  valid_until: string | null;
  notes: string | null;
  terms?: string | null;
  scope_of_work?: string | null;
  entity_id?: string | null;
  name?: string | null;
  contact_id?: string | null;
  ref_no?: string | null;
  pr_no?: string | null;
  po_number?: string | null;
  po_amount?: number | null;
  discount_type?: "pct" | "fixed";
  discount_pct?: number;
  discount_fixed?: number;
  gst_rate?: number | null;
  asset_ids?: string[];
  revision: number;
  selected_option_id?: string | null;
  territory?: string | null;
  sales_org?: string | null;
  // Custom-field values for this quote (see custom_fields table +
  // AdaptObjectDrawer) -- keyed by field_key. Column exists in the DB and is
  // already read/written by the API routes and QuoteForm's cfValues editor;
  // was just missing from this type.
  custom_data?: Record<string, unknown> | null;
  // Free-form quote metadata written by POST /api/quotes and carried through
  // revise/copy. Existed in the DB (and code) long before this type knew it
  // -- see 0047_schema_drift_reconcile.sql.
  meta?: Record<string, unknown> | null;
};

// One row per revision of a quote — tracks what changed between versions.
export type QuoteRevision = {
  id: string;
  quote_id: string;
  rev: number;
  date: string;
  description: string;
};

export type QuoteLine = {
  id: string;
  quote_id: string;
  description: string;
  uom?: string | null;
  qty: number;
  rate: number;
  discount_pct?: number;
  amount: number;
  group_id?: string | null;
  group_label?: string | null;
  group_type?: string | null;
  sl_no?: string | null;
  group_description?: string | null;
  category?: PricingCategory | null;
  deduction?: number;
  inventory_item_id?: string | null;
};

export type WorkOrderStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "invoiced";

// Every work order is authorized by exactly one commercial wrapper:
// a quote (billable) or a contract (AMC-covered). PROJECT.md §3.
export type WorkOrder = {
  id: string;
  account_id: string;
  ref: string;
  case_id: string | null;
  asset_id: string | null;
  technician_id: string | null;
  authorized_by: { kind: "quote"; id: string } | { kind: "contract"; id: string };
  status: WorkOrderStatus;
  scheduled_for: string | null;
  description: string | null;
  notes: string | null;
  custom_data: Record<string, unknown> | null;
};

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "cancelled";

export type Invoice = {
  id: string;
  tenant_id: string;
  account_id: string;
  contact_id: string | null;
  ref: string;
  work_order_id: string | null;
  quote_id: string | null;
  case_id: string | null;
  contract_id: string | null;
  entity_id: string | null;
  status: InvoiceStatus;
  total: number;
  paid_amount: number;
  due_date: string | null;
  discount_type: "pct" | "fixed";
  discount_pct: number;
  discount_fixed: number;
  notes: string | null;
  terms: string | null;
  custom_data: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  issued_at: string | null;
};

export type InvoiceLine = {
  id: string;
  tenant_id: string;
  invoice_id: string;
  sl_no: string | null;
  description: string;
  uom: string | null;
  qty: number;
  rate: number;
  amount: number;
};

// Employee -- pure master data (0057). A person on the org's books; may or
// may not have a Business User (login). Deliberately NOT the Technician
// object, which is a field-service work record -- an office/sales employee
// is not a technician, and conflating them was explicitly rejected.
export type Employee = {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  employee_code: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

// Standard Quote -- a deliberately independent object, not the (separate)
// Quotation object's type/status/config system. See supabase/migrations/
// 0053_standard_quotes.sql for why it's kept apart.
export type StandardQuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export type StandardQuote = {
  id: string;
  tenant_id: string;
  ref: string;
  account_id: string;
  contact_id: string | null;
  status: StandardQuoteStatus;
  valid_until: string | null;
  terms: string | null;
  notes: string | null;
  subtotal: number;
  total: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  template_id: string | null;
  header_discount_pct: number;
  tax_pct: number;
  shipping_amount: number;
  intro_text: string | null;
  inquiry_date: string | null;
  closed_at: string | null;
};

export type StandardQuoteLine = {
  id: string;
  tenant_id: string;
  standard_quote_id: string;
  sl_no: string | null;
  description: string;
  uom: string | null;
  qty: number;
  rate: number;
  discount_pct: number;
  amount: number;
};

// Standard Quote branded templates -- an ordered list of blocks a tenant can
// reorder, show/hide, and (for the two free-text ones) author content for.
// "letterhead"/"quote_meta"/"bill_to"/"line_items"/"totals" are structural --
// always rendered, reorder only, no visibility toggle -- everything else is
// optional. See supabase/migrations/0054_standard_quote_templates.sql.
export type StandardQuoteTemplateBlockType =
  | "letterhead" | "quote_meta" | "bill_to" | "intro_text" | "line_items"
  | "totals" | "notes" | "terms" | "signature" | "footer_text"
  | "specs_table" | "cta_banner";

export const STANDARD_QUOTE_REQUIRED_BLOCKS: StandardQuoteTemplateBlockType[] = [
  "letterhead", "quote_meta", "bill_to", "line_items", "totals",
];

export type StandardQuoteTemplateBlock = {
  id: string;
  type: StandardQuoteTemplateBlockType;
  visible: boolean;
  content?: string;
};

export type StandardQuoteTemplate = {
  id: string;
  tenant_id: string;
  name: string;
  is_default: boolean;
  accent_color: string | null;
  logo_position: "left" | "center" | "right";
  blocks: StandardQuoteTemplateBlock[];
  created_at: string;
  updated_at: string;
};

export type InvoicePayment = {
  id: string;
  tenant_id: string;
  invoice_id: string;
  amount: number;
  paid_on: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type TechnicianStatus = "active" | "on_leave" | "inactive";

export type Technician = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  skills: string | null;
  certifications: string[];          // e.g. ["HV License (IS 5571)", "DGA Certified"]
  cert_expiry: Record<string, string>; // cert name → YYYY-MM-DD expiry
  status: TechnicianStatus;
  base_location: string | null;
  max_visits_per_day: number;
};

export type LeaveReason = "vacation" | "sick" | "training" | "other";

export type TechnicianLeave = {
  id: string;
  technician_id: string;
  from_date: string; // YYYY-MM-DD
  to_date: string;   // YYYY-MM-DD (inclusive)
  reason: LeaveReason;
  notes: string | null;
};

export type VisitStatus = "planned" | "in_progress" | "completed" | "cancelled";

export type VisitLog = {
  id: string;
  work_order_id: string;
  technician_id: string;
  account_id: string;
  visit_date: string;              // YYYY-MM-DD

  // ── Travel out ───────────────────────────────────────────────────────
  travel_start_time: string | null; // "HH:MM" — left base / home
  travel_distance_km: number | null;
  arrived_time: string | null;      // arrived at customer site

  // ── On-site work ─────────────────────────────────────────────────────
  work_start_time: string | null;
  break_start_time: string | null;
  break_end_time: string | null;
  work_end_time: string | null;

  // ── Return travel ────────────────────────────────────────────────────
  return_start_time: string | null;
  return_end_time: string | null;   // back at base

  // ── Visit summary ────────────────────────────────────────────────────
  work_done: string | null;
  parts_used: string | null;
  customer_feedback: string | null;
  next_action: string | null;
  needs_escalation: boolean;
  customer_acknowledged: boolean;

  status: VisitStatus;
};

// Unified timeline — one job visibly travels across pillars. PROJECT.md §4.
export type Activity = {
  id: string;
  account_id: string;
  pillar: "marketing" | "sales" | "service" | "field" | "finance";
  text: string;
  at: string;
};

// ── Case module ──────────────────────────────────────────────────────────────

export type CaseStatus =
  | "intake"           // unit received at gate, intake photos taken
  | "inspection"       // technician inspecting, inspection photos taken
  | "report_sent"      // inspection report sent to customer
  | "report_approved"  // customer approved findings
  | "quote_sent"       // quotation sent
  | "quote_approved"   // customer approved quote, repair authorized
  | "in_repair"        // repair work underway
  | "qa"               // quality check post-repair
  | "ready"            // ready for pickup / dispatch
  | "closed"           // delivered, case complete
  | "buyback"          // customer sold unit to Vikas
  | "scrapped";        // unit deemed uneconomical, scrapped

export type CaseType = "amc" | "adhoc" | "direct";

export type ServiceCase = {
  id: string;
  account_id: string;
  ref: string;
  type: CaseType;
  status: CaseStatus;
  asset_id: string | null;
  asset_ids: string[];       // full list of linked assets; asset_id mirrors asset_ids[0] for backward compat
  equipment_label: string;   // human description, e.g. "Crompton 75 kW 3-Ph IM · CG-75-2291"
  complaint: string;         // customer-reported issue
  symptom: string | null;    // additional symptom detail, separate from complaint
  assigned_to: string | null; // technician_id
  intake_at: string;
  closed_at: string | null;
  quote_id: string | null;
  contract_id: string | null;
  has_loaner: boolean;
  loaner_asset_id: string | null; // which loaner unit was dispatched (optional)
  parent_case_id: string | null;  // set when this is a sub-case of another case
  disposition: "repair" | "buyback" | "scrap" | null;
  notes: string | null;
  territory: string | null;
  sales_org: string | null;
  custom_data: Record<string, unknown> | null;
};

// ── Page layout builder ───────────────────────────────────────────────────────

export type LayoutSection = {
  id: string;                          // 'core' | 'lines' | 'notes' | 'work_orders' | UUID
  kind: "builtin" | "custom_fields";
  label: string;
  field_keys: string[];                // for custom_fields: ordered cf_ keys in this section
  hidden?: boolean;                    // dashboard widgets: toggled off but kept in order
};

export type PageLayout = LayoutSection[];

// ── Pricing catalog & text fragments ─────────────────────────────────────────

export type PricingCategory = "labour" | "material" | "testing" | "transport";

export type PricingItem = {
  id: string;
  category: PricingCategory;
  description: string;
  unit: string;
  rate: number;
  notes: string | null;
};

export type FragmentCategory = "line_item" | "notes" | "terms" | "sow";

export type TextFragment = {
  id: string;
  label: string;
  category: FragmentCategory;
  text: string;
};

// A subject+body pair a user can pick between when sending an email, with
// {{variable}} placeholders resolved at send time (see lib/emailTemplates.ts).
// category exists so invoice/report templates can be added later without a
// schema change, even though only "quote" is wired to actually send today.
export type EmailTemplateCategory = "quote" | "invoice" | "report";

export type EmailTemplate = {
  id: string;
  category: EmailTemplateCategory;
  name: string;
  subject: string;
  body: string;
  is_default: boolean;
  created_at: string;
};

export type CasePhoto = {
  id: string;
  case_id: string;
  stage: "intake" | "inspection" | "final";
  url: string;
  caption: string;
  taken_at: string;
};

export type InspectionReport = {
  id: string;
  case_id: string;
  findings: string;
  recommendations: string;
  estimated_cost: number | null;
  status: "draft" | "sent" | "approved" | "rejected";
  sent_at: string | null;
  approved_at: string | null;
};

export type SupplierType = "vendor" | "subcontractor" | "both";
export type SupplierStatus = "active" | "inactive";

export type Supplier = {
  id: string;
  /** SUP-0001 (0061) -- display/reference only. */
  ref?: string | null;
  tenant_id: string;
  name: string;
  type: SupplierType;
  city: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  notes: string | null;
  status: SupplierStatus;
  custom_data: Record<string, unknown> | null;
  created_at: string;
};

// ── Inventory ─────────────────────────────────────────────────────────────────

export type InventoryItemStatus = "active" | "inactive";

export type InventoryItem = {
  id: string;
  /** INV-0001 (0061) -- display/reference only. */
  ref?: string | null;
  tenant_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  uom: string;
  supplier_id: string | null;
  qty_on_hand: number;
  reorder_level: number | null;
  unit_cost: number | null;
  status: InventoryItemStatus;
  notes: string | null;
  custom_data: Record<string, unknown> | null;
  created_at: string;
};

export type InventoryTransactionType = "receipt" | "adjustment";

export type InventoryTransaction = {
  id: string;
  tenant_id: string;
  inventory_item_id: string;
  type: InventoryTransactionType;
  qty_delta: number;
  balance_after: number;
  reference_type: "purchase_order_line" | "manual" | null;
  reference_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

// ── Purchase Orders ──────────────────────────────────────────────────────────

export type PurchaseOrderStatus = "draft" | "sent" | "partially_received" | "received" | "cancelled";

export type PurchaseOrder = {
  id: string;
  tenant_id: string;
  ref: string;
  supplier_id: string;
  quote_id: string | null;
  case_id: string | null;
  status: PurchaseOrderStatus;
  order_date: string | null;
  expected_date: string | null;
  notes: string | null;
  terms: string | null;
  total: number;
  custom_data: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

export type PurchaseOrderLine = {
  id: string;
  tenant_id: string;
  po_id: string;
  inventory_item_id: string | null;
  sl_no: number | null;
  description: string;
  uom: string | null;
  qty_ordered: number;
  qty_received: number;
  rate: number;
  amount: number;
};
