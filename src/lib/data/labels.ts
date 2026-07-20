// Client-safe: static label maps and shared type definitions.
// No server-only imports — safe to use in "use client" components.

import type {
  Account, Quote, ServiceCase, Technician, PricingItem, VisitLog,
  WorkOrder, TechnicianLeave, Activity, Contact, Asset, QuoteLine, Invoice, Lead, Contract,
} from "@/lib/types";

// ── Re-exported base types (no server import chain) ───────────────────────────

export type { WorkOrder, TechnicianLeave, VisitLog, Activity };

// ── Composite types (mirrors live.ts — keep in sync) ─────────────────────────

export type InvoiceRow = Invoice & { account_name: string };
export type LeadRow = Lead & { account_name: string };

export type ContractRow = {
  id: string;
  ref: string;
  status: "active" | "expired" | "draft";
  start_date: string | null;
  end_date: string | null;
  value: number | null;
  account_name: string;
};

export type DispatchRow = {
  id: string;
  ref: string;
  status: string;
  scheduled_for: string | null;
  description: string | null;
  account_name: string;
  technician_name: string | null;
  case_ref: string | null;
};

export type AccountSummary = {
  account: Account;
  referredBy: Account | null;
  counts: {
    contacts: number;
    assets: number;
    contracts: number;
    quotes: number;
    workOrders: number;
    invoices: number;
  };
};

export type AssetRow = {
  asset: Asset;
  account: Account | null;
  openCaseCount: number;
  loanedToCase: ServiceCase | null;
  loanedToAccount: Account | null;
};

export type ContactWithAccount = {
  contact: Contact;
  account: Account;
};

export type QuoteSummary = {
  quote: Quote;
  account: Account;
  lineCount: number;
  lines: QuoteLine[];
};

export type CaseSummary = {
  serviceCase: ServiceCase;
  account: Account;
  technicianName: string | null;
};

export type WorkOrderRow = {
  workOrder: WorkOrder;
  account: Account;
  asset: Asset | null;
  technician: Technician | null;
  authRef: string;
  authKind: "quote" | "contract";
  serviceCase: ServiceCase | null;
};

export type TechnicianCard = {
  technician: Technician;
  todayWorkOrders: WorkOrder[];
  currentLeave: TechnicianLeave | null;
  monthStats: { visits: number; kmTravelled: number; visitedAccounts: number };
};

export type CalendarDay = {
  date: string;
  isLeave: boolean;
  leaveReason: string | null;
  workOrders: WorkOrder[];
  visitLogs: VisitLog[];
  slotsFree: number;
  slotsTotal: number;
};

export type AnalyticsData = {
  totals: {
    accounts: number; contacts: number; customerAssets: number; openCases: number;
    workOrders: number; activeContracts: number; leads: number; technicians: number;
  };
  accountsByType: Array<{ type: string; label: string; count: number }>;
  leadFunnel: Array<{ stage: string; count: number }>;
  assetsByKind: Array<{ kind: string; label: string; count: number; loanerCount: number }>;
  loanerStock: { available: number; onLoan: number; total: number };
  quotesByStatus: Array<{ status: string; label: string; count: number; value: number }>;
  quoteTrend: Array<{ dateLabel: string; value: number; cumulative: number }>;
  casesByStatus: Array<{ status: string; label: string; count: number }>;
  workOrdersByStatus: Array<{ status: string; label: string; count: number }>;
  techniciansByStatus: Array<{ status: string; label: string; count: number }>;
  invoicesByStatus: Array<{ status: string; label: string; count: number; value: number }>;
  invoiceTotals: { invoiced: number; paid: number; outstanding: number };
  topAccountsByRevenue: Array<{ accountId: string; name: string; value: number }>;
  contractStats: { activeCount: number; totalValue: number };
  recentActivity: Array<{ text: string; at: string; pillar: Activity["pillar"]; accountName: string }>;
};

// ── Display label maps ────────────────────────────────────────────────────────

export const ACCOUNT_TYPE_LABEL: Record<Account["type"], string> = {
  prospect:     "Prospect",
  oem:          "OEM / Vendor",
  direct:       "Direct customer",
  end_customer: "End-customer (under OEM)",
};

export const QUOTE_STATUS_LABEL: Record<Quote["status"], string> = {
  draft:    "Draft",
  sent:     "Sent",
  approved: "Approved",
  rejected: "Rejected",
};

export const CASE_STATUS_LABEL: Record<ServiceCase["status"], string> = {
  intake:          "Intake",
  inspection:      "Inspection",
  report_sent:     "Report sent",
  report_approved: "Report approved",
  quote_sent:      "Quote sent",
  quote_approved:  "Quote approved",
  in_repair:       "In repair",
  qa:              "QA",
  ready:           "Ready",
  closed:          "Closed",
  buyback:         "Buyback",
  scrapped:        "Scrapped",
};

export const CASE_TYPE_LABEL: Record<ServiceCase["type"], string> = {
  amc:    "AMC",
  adhoc:  "Adhoc",
  direct: "Direct",
};

export const TECH_STATUS_LABEL: Record<Technician["status"], string> = {
  active:   "Active",
  on_leave: "On Leave",
  inactive: "Inactive",
};

export const LEAVE_REASON_LABEL: Record<TechnicianLeave["reason"], string> = {
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

export const ASSET_KIND_LABEL: Record<Asset["kind"], string> = {
  motor:       "Motor",
  transformer: "Transformer",
  pump:        "Pump",
  generator:   "Generator",
  panel:       "Panel",
};
