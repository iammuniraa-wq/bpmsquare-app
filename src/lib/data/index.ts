// Data-access layer — all reads go to Supabase via live.ts.
// Seed data (seed.ts) is demo data pushed once to the Vikas tenant in Supabase.
// New tenants get a blank DB — no seed imports here.

import type { Account, WorkOrder, Technician, TechnicianLeave, VisitLog, PricingItem, TextFragment, Activity } from "@/lib/types";
import type { LeaveReason } from "@/lib/types";

export type {
  AccountSummary,
  AssetRow,
  ContactWithAccount,
  QuoteSummary,
  CaseSummary,
  WorkOrderRow,
  TechnicianCard,
  CalendarDay,
  AnalyticsData,
  DispatchRow,
  ContractRow,
  LeadRow,
  InvoiceRow,
} from "./live";

export {
  // Accounts
  listAccountsLive as listAccounts,
  getAccountHubLive as getAccountHub,
  // Contacts
  listContactsLive as listContacts,
  // Assets
  listAssetsLive as listAssets,
  // Quotes
  listQuotesLive as listQuotes,
  getQuoteLive as getQuote,
  // Cases
  listCasesLive as listCases,
  getCaseLive as getCase,
  // Work orders
  listWorkOrdersLive as listWorkOrders,
  getWorkOrderLive as getWorkOrder,
  // Technicians
  listTechniciansLive as listTechnicians,
  getTechnicianDetailLive as getTechnicianDetail,
  // Pricing & fragments
  listPricingItemsLive as listPricingItems,
  listTextFragmentsLive as listTextFragments,
  getQuoteFormDataLive as getQuoteFormData,
  // Dashboard & analytics
  getDashboardSummaryLive as getDashboardSummary,
  getAnalyticsDataLive as getAnalyticsData,
  // Other live functions
  listInvoices,
  listLeadsLive as listLeads,
  listContracts,
  listDispatch,
} from "./live";

// ── Display label maps (static — no DB query needed) ─────────────────────────

export const ACCOUNT_TYPE_LABEL: Record<Account["type"], string> = {
  prospect:     "Prospect",
  oem:          "OEM / Vendor",
  direct:       "Direct customer",
  end_customer: "End-customer (under OEM)",
};

export { QUOTE_STATUS_LABEL, CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/constants";

export const TECH_STATUS_LABEL: Record<Technician["status"], string> = {
  active:   "Active",
  on_leave: "On Leave",
  inactive: "Inactive",
};

export const LEAVE_REASON_LABEL: Record<LeaveReason, string> = {
  vacation: "Vacation",
  sick:     "Sick leave",
  training: "Training",
  other:    "Other",
};

export const VISIT_STATUS_LABEL: Record<VisitLog["status"], string> = {
  planned:     "Planned",
  in_progress: "In Progress",
  completed:   "Completed",
  cancelled:   "Cancelled",
};

export const PRICING_CATEGORY_LABEL: Record<PricingItem["category"], string> = {
  labour:    "Labour",
  material:  "Materials",
  testing:   "Testing & Certification",
  transport: "Transport & Logistics",
};

// Keep WorkOrder type alias re-exported for backward compatibility with pages
export type { WorkOrder, TechnicianLeave, VisitLog, Activity };
