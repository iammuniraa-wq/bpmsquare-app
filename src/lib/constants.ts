// VeveyCRM constants — routes + navigation IA. Single source of truth.
// IA follows the customer journey (pillars), per PROJECT.md §4.

import type { PillarKey } from "./theme";

// The single shared app URL — every tenant without a `custom_domain` is reached here.
// Hostnames other than this (and localhost, for dev) are resolved to a tenant via
// `tenants.custom_domain` in middleware.ts.
export const PRIMARY_HOST = "app.bpmsquare.com";

export function isPrimaryOrDevHost(host: string): boolean {
  return host === PRIMARY_HOST || host === "localhost" || host === "127.0.0.1";
}

// Trusted identity headers set ONLY by middleware.ts, after it has already
// verified the session (supabase.auth.getUser(), a real network check) and
// resolved host -> tenant + role. Server-side code (supabase-server.ts) reads
// these to skip repeating that same auth + DB round trip on every request.
// Middleware unconditionally strips any client-supplied value for these names
// before setting its own, on every code path (including public/bypassed
// paths) — a request can never reach the app carrying a spoofed value.
export const TRUSTED_USER_ID_HEADER = "x-bpmsquare-user-id";
export const TRUSTED_EMAIL_HEADER = "x-bpmsquare-email";
export const TRUSTED_TENANT_ID_HEADER = "x-bpmsquare-tenant-id";
export const TRUSTED_ROLE_HEADER = "x-bpmsquare-role";
// Not identity-sensitive like the four above, but set the same way (stripped
// of any client-supplied value, then set once by middleware) so a Server
// Component layout can know the current request's pathname -- next/navigation
// has no built-in way to read that outside a page's own params. Used by the
// (app) layout's WFM-only redirect to avoid redirecting a request that's
// already for the redirect target (an infinite-redirect bug otherwise, since
// /wfm/me lives inside the same (app) route group the layout wraps).
export const PATHNAME_HEADER = "x-bpmsquare-pathname";

/** Business-user gate (0057): a membership is usable only if it isn't
 * admin-locked and today falls inside its validity window (null bounds are
 * open-ended). Lives here (not supabase-server.ts) so middleware.ts can
 * import it too -- both enforcement points must agree exactly. */
export function isMembershipActive(m: { is_locked?: boolean | null; valid_from?: string | null; valid_to?: string | null }): boolean {
  if (m.is_locked) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (m.valid_from && today < m.valid_from) return false;
  if (m.valid_to && today > m.valid_to) return false;
  return true;
}

// @supabase/ssr's own cookie defaults set no `secure` flag at all (httpOnly:
// false is required by its architecture -- the browser client reads the same
// cookie via document.cookie -- so that one isn't overridden here). Passed as
// `cookieOptions` to every createServerClient/createBrowserClient call.
// Conditional on NODE_ENV so local http://localhost dev still works --
// browsers refuse to send a Secure cookie over plain HTTP.
export const SUPABASE_COOKIE_OPTIONS = { secure: process.env.NODE_ENV === "production" };

export const ROUTES = {
  login: "/login",
  pipeline: "/pipeline",
  dashboard: "/",
  leads: "/leads",
  partners: "/partners",
  marketing: "/marketing",
  marketingNew: "/marketing/new",
  marketingCampaign: (id: string) => `/marketing/${id}`,
  marketingUnsubscribe: (accountId: string, token: string) => `/marketing/unsubscribe/${accountId}/${token}`,
  marketingInterest: (campaignId: string, accountId: string, token: string) => `/marketing/interest/${campaignId}/${accountId}/${token}`,
  marketingSegments: "/marketing/segments",
  marketingSegmentNew: "/marketing/segments/new",
  marketingSegment: (id: string) => `/marketing/segments/${id}`,
  quotations: "/quotations",
  quotation: (id: string) => `/quotations/${id}`,
  quotationEdit: (id: string) => `/quotations/${id}/edit`,
  quotationNew: "/quotations/new",
  quotationPrint: (id: string) => `/quotations/${id}/print`,
  standardQuotes: "/standard-quotes",
  standardQuote: (id: string) => `/standard-quotes/${id}`,
  standardQuoteEdit: (id: string) => `/standard-quotes/${id}/edit`,
  standardQuoteNew: "/standard-quotes/new",
  standardQuotePrint: (id: string) => `/standard-quotes/${id}/print`,
  standardQuoteTemplates: "/standard-quotes/templates",
  standardQuoteTemplate: (id: string) => `/standard-quotes/templates/${id}`,
  employees: "/employees",
  configPricing: "/settings/pricing",
  configPricingEngine: "/settings/pricing-engine",
  settingsNumberRanges: "/settings/number-ranges",
  configTemplates: "/settings/templates",
  configCustomFields: "/settings/custom-fields",
  cases: "/cases",
  caseNew: "/cases/new",
  amc: "/amc",
  workOrders: "/work-orders",
  workOrder: (id: string) => `/work-orders/${id}`,
  dispatch: "/dispatch",
  technicians: "/technicians",
  technicianNew: "/technicians/new",
  technician: (id: string) => `/technicians/${id}`,
  technicianConfig: (id: string) => `/technicians/${id}/config`,
  accounts: "/accounts",
  account: (id: string) => `/accounts/${id}`,
  accountNew: "/accounts/new",
  contacts: "/contacts",
  contactNew: "/contacts/new",
  contact: (id: string) => `/contacts/${id}`,
  assets: "/assets",
  assetNew: "/assets/new",
  asset: (id: string) => `/assets/${id}`,
  invoices: "/invoices",
  invoiceNew: "/invoices/new",
  invoice: (id: string) => `/invoices/${id}`,
  case: (id: string) => `/cases/${id}`,
  settings: "/settings",
  settingsGeneral: "/settings/general",
  settingsTeam: "/settings/team",
  settingsEntities: "/settings/entities",
  settingsStatuses: "/settings/statuses",
  settingsEmailTemplates: "/settings/email-templates",
  settingsSales: "/settings/sales",
  settingsDeletionLog: "/settings/deletion-log",
  settingsConnectors: "/settings/connectors",
  reports: "/reports",
  admin: "/admin",
  adminTenant: (id: string) => `/admin/tenants/${id}`,
  suppliers: "/suppliers",
  supplierNew: "/suppliers/new",
  supplier: (id: string) => `/suppliers/${id}`,
  inventory: "/inventory",
  inventoryNew: "/inventory/new",
  inventoryItem: (id: string) => `/inventory/${id}`,
  purchaseOrders: "/purchase-orders",
  purchaseOrderNew: "/purchase-orders/new",
  purchaseOrder: (id: string) => `/purchase-orders/${id}`,
  dataWorkbench: "/data-workbench",
  wfmMe: "/wfm/me",
  wfmLiveBoard: "/wfm/live-board",
  wfmEmployees: "/wfm/employees",
  wfmEmployee: (id: string) => `/wfm/employees/${id}`,
  wfmCorrections: "/wfm/corrections",
  wfmRoster: "/wfm/roster",
  wfmLeave: "/wfm/leave",
  wfmSummary: "/wfm/summary",
  settingsWorkforce: "/settings/workforce",
  administration: "/administration",
  administrationChangeHistory: "/administration/change-history",
  administrationOutboundEmails: "/administration/outbound-emails",
  administrationBusinessRoles: "/administration/business-roles",
  administrationBusinessUsers: "/administration/business-users",
} as const;

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: number;
  pillar: PillarKey;
  /** If set, item is hidden unless the tenant has this feature enabled. */
  featureKey?: string;
  /** Matches a WorkcenterKey (src/lib/permissions.ts) -- absent on pure
   * expand/collapse toggle rows (Sales/Service/Marketing/Master data), which
   * have no access of their own and are hidden only when every child is. */
  workcenterKey?: string;
  /** Hidden from a WFM login unless it's a supervisor (wfm_role=supervisor
   * or tenant admin) -- for items that share the "wfm" workcenter grant with
   * a plain employee's My Workforce page but aren't meant for them. The real
   * enforcement is server-side (requireWfmSupervisorPage); this only keeps
   * the sidebar from advertising a link that would redirect away. */
  supervisorOnly?: boolean;
  /** Sub-items shown when this item is expanded in the sidebar -- the item
   * itself becomes an expand/collapse toggle rather than a direct link. */
  children?: NavItem[];
};

export type NavGroup = { group: string; items: NavItem[] };

// Grouped sidebar — a short workspace core (Dashboard/Accounts/Contacts) at
// the top, then one expandable parent per business function (Sales, Service,
// Marketing, Master data), mirroring the SAP-cloud-style module nav. Parents
// reuse the Marketing parent's children mechanism (expand/collapse row, not a
// link); a parent's href is its first child's route, used only as its
// stable identity key for expand-state/favourites persistence.
export const NAV: NavGroup[] = [
  {
    group: "WORKSPACE",
    items: [
      { label: "Dashboard", href: ROUTES.dashboard, icon: "◴", pillar: "blue", workcenterKey: "dashboard" },
      { label: "Accounts",  href: ROUTES.accounts,  icon: "▣", pillar: "blue", featureKey: "accounts", workcenterKey: "accounts" },
      { label: "Contacts",  href: ROUTES.contacts,  icon: "◉", pillar: "blue", featureKey: "contacts", workcenterKey: "contacts" },
    ],
  },
  {
    group: "SALES",
    items: [
      {
        label: "Sales", href: ROUTES.quotations, icon: "₹", pillar: "blue",
        children: [
          { label: "Quotations", href: ROUTES.quotations, icon: "₹", pillar: "blue", featureKey: "quotations", workcenterKey: "quotations" },
          { label: "Standard Quotes", href: ROUTES.standardQuotes, icon: "≡", pillar: "blue", featureKey: "standard_quotes", workcenterKey: "standard_quotes" },
          { label: "Pipeline",   href: ROUTES.pipeline,   icon: "▦", pillar: "blue", featureKey: "pipeline", workcenterKey: "pipeline" },
          { label: "Invoices",   href: ROUTES.invoices,   icon: "⊟", pillar: "blue", featureKey: "invoices", workcenterKey: "invoices" },
        ],
      },
    ],
  },
  {
    group: "SERVICE",
    items: [
      {
        label: "Service", href: ROUTES.cases, icon: "☎", pillar: "teal",
        children: [
          { label: "Cases",         href: ROUTES.cases,       icon: "☎", pillar: "teal", featureKey: "cases", workcenterKey: "cases" },
          { label: "AMC contracts", href: ROUTES.amc,         icon: "▥", pillar: "teal", featureKey: "amc", workcenterKey: "amc" },
          { label: "Work orders",   href: ROUTES.workOrders,  icon: "▤", pillar: "amber", featureKey: "work_orders", workcenterKey: "work_orders" },
          { label: "Dispatch",      href: ROUTES.dispatch,    icon: "◷", pillar: "amber", featureKey: "dispatch", workcenterKey: "dispatch" },
          { label: "Technicians",   href: ROUTES.technicians, icon: "◍", pillar: "amber", featureKey: "technicians", workcenterKey: "technicians" },
        ],
      },
    ],
  },
  {
    group: "MARKETING",
    items: [
      {
        label: "Marketing", href: ROUTES.marketing, icon: "📣", pillar: "purple",
        children: [
          { label: "Campaigns", href: ROUTES.marketing, icon: "✉", pillar: "purple", featureKey: "marketing", workcenterKey: "marketing" },
          { label: "Segmentation", href: ROUTES.marketingSegments, icon: "⌗", pillar: "purple", featureKey: "marketing", workcenterKey: "marketing_segments" },
          { label: "Leads", href: ROUTES.leads, icon: "✦", pillar: "purple", featureKey: "leads", workcenterKey: "leads" },
          { label: "Partners", href: ROUTES.partners, icon: "⌂", pillar: "purple", featureKey: "partners", workcenterKey: "partners" },
        ],
      },
    ],
  },
  {
    group: "MASTER DATA",
    items: [
      {
        label: "Master data", href: ROUTES.assets, icon: "⚙", pillar: "green",
        children: [
          { label: "Assets",          href: ROUTES.assets,         icon: "⚙", pillar: "green", featureKey: "assets", workcenterKey: "assets" },
          { label: "Suppliers",       href: ROUTES.suppliers,      icon: "◫", pillar: "green", featureKey: "suppliers", workcenterKey: "suppliers" },
          { label: "Inventory",       href: ROUTES.inventory,      icon: "▨", pillar: "green", featureKey: "purchasing", workcenterKey: "inventory" },
          { label: "Purchase Orders", href: ROUTES.purchaseOrders, icon: "⇱", pillar: "green", featureKey: "purchasing", workcenterKey: "purchase_orders" },
          // Employees ships as part of the Business Roles/Business Users
          // bundle, so it shares that bundle's rollout flag rather than
          // getting its own.
          { label: "Employees",       href: ROUTES.employees,      icon: "⚇", pillar: "green", featureKey: "business_roles", workcenterKey: "employees" },
        ],
      },
    ],
  },
  {
    group: "WORKFORCE",
    items: [
      {
        label: "Workforce", href: ROUTES.wfmMe, icon: "⧖", pillar: "amber",
        children: [
          { label: "My Workforce", href: ROUTES.wfmMe, icon: "◈", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm" },
          { label: "Live board",   href: ROUTES.wfmLiveBoard,   icon: "◉", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
          { label: "Employees",    href: ROUTES.wfmEmployees,   icon: "⚇", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
          { label: "Corrections", href: ROUTES.wfmCorrections, icon: "✓", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
          { label: "Roster", href: ROUTES.wfmRoster, icon: "▦", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
          { label: "Leave & Holidays", href: ROUTES.wfmLeave, icon: "☀", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
          { label: "Monthly Summary", href: ROUTES.wfmSummary, icon: "▤", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
        ],
      },
    ],
  },
  {
    group: "ANALYTICS",
    items: [
      { label: "Analytics", href: ROUTES.reports, icon: "◫", pillar: "purple", featureKey: "reports", workcenterKey: "reports" },
    ],
  },
  {
    group: "ADMIN",
    items: [
      { label: "Data Workbench", href: ROUTES.dataWorkbench, icon: "⇅", pillar: "teal", featureKey: "data_workbench", workcenterKey: "data_workbench" },
      { label: "Administrator", href: ROUTES.administration, icon: "🛠", pillar: "teal", featureKey: "administration", workcenterKey: "administration" },
    ],
  },
];

// ── Quote type registry ───────────────────────────────────────────────────────
// Add a new entry here to register a new quote type. No DB change needed.
// When the form for that type is built, set `available: true`.

export const QUOTE_TYPES = [
  {
    id:          "quotation",
    label:       "Quotation",
    description: "Full quotation with Sl no, Particulars, UOM, Qty, Rate and Amount",
    icon:        "₹",
    available:   true,
  },
  {
    id:          "technical",
    label:       "Technical Offer",
    description: "Scope and quantities only — no pricing. Sl no, Particulars, UOM, Qty",
    icon:        "⚙",
    available:   true,
  },
  {
    id:          "budgetary",
    label:       "Budgetary Offer",
    description: "Budget estimate for a group of motors — same fields as a Quotation",
    icon:        "◈",
    available:   true,
  },
  {
    id:          "supply",
    label:       "Supply Quotation",
    description: "Sale of motors, parts or equipment — with HSN codes and GST per line",
    icon:        "📦",
    available:   true,
  },
  {
    id:          "amc",
    label:       "AMC Contract",
    description: "Annual maintenance coverage, visit schedule and equipment list",
    icon:        "▥",
    available:   false,
  },
  {
    id:          "installation",
    label:       "Installation",
    description: "Civil, electrical, commissioning and site-specific scope",
    icon:        "⚡",
    available:   false,
  },
] as const;

export type QuoteTypeId = typeof QUOTE_TYPES[number]["id"];

export const OFFER_TYPE_LABEL: Record<string, string> = {
  quotation:  "Quotation",
  technical:  "Technical Offer",
  budgetary:  "Budgetary Offer",
  supply:     "Supply",
  repair:     "Repair Quotation",
};

export const UOM_OPTIONS = ["Nos", "Job", "Set", "Mtr", "Kg", "Ltr", "Box", "Pair", "Lot", "LSM", "Ton"] as const;

export const MOBILE_BREAKPOINT = 780;

// TenantEntity — shape stored in tenants.config.entities[].
// Populated by the local admin via Settings → Entities.
// Used in PDF headers/footers and quotation entity selectors.
export type TenantEntity = {
  id: string;
  name: string;
  short_name: string;
  tagline?: string;
  address: string;
  phone?: string;
  email?: string;
  gstin?: string;
  is_default: boolean;
};

// TenantTaxConfig — shape stored in tenants.config.tax.
export type TenantTaxConfig = {
  label: string;   // e.g. "GST", "VAT", "MwSt"
  rate: number;    // percentage, e.g. 18
  inclusive: boolean;
};

// ── Label maps (safe to import in client components) ─────────────────────────

export const CASE_STATUS_LABEL: Record<string, string> = {
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

export const CASE_TYPE_LABEL: Record<string, string> = {
  amc:    "AMC",
  adhoc:  "Adhoc",
  direct: "Direct",
};

// TenantFeatures — which optional modules are enabled for this tenant.
// Defined here (not tenant.ts) so client components can import the type safely.
export type TenantFeatures = {
  leads: boolean;
  pipeline: boolean;
  amc: boolean;
  dispatch: boolean;
  invoices: boolean;
  partners: boolean;
  ai_assistant: boolean;
  db_export: boolean;
  purchasing: boolean;
  marketing: boolean;
  // Rolled out to the demo tenant only for now -- off by default everywhere
  // else (including existing clients) until explicitly turned on per tenant
  // via /admin/tenants/[id].
  change_history: boolean;
  outbound_email: boolean;
  business_roles: boolean;
  standard_quotes: boolean;
  gmail_reply_threading: boolean;
  quote_lines_dw: boolean;
  wfm: boolean;
  // Core-module subscription flags (0067). Every nav item now carries one,
  // so a tenant only sees the modules they actually bought -- previously
  // these twelve were ungated and shown to everyone regardless. A MISSING
  // key reads as false (hidden), which is why 0067 backfills all of them to
  // true for every pre-existing tenant: without that, adding these gates
  // would silently strip live clients' navigation.
  accounts: boolean;
  contacts: boolean;
  quotations: boolean;
  cases: boolean;
  work_orders: boolean;
  technicians: boolean;
  assets: boolean;
  suppliers: boolean;
  reports: boolean;
  data_workbench: boolean;
  administration: boolean;
  // PricingEngine (docs/pricing-engine-architecture.md): the dynamic pricing
  // product. Demo tenant only until sold; Small Scale Pricing is unaffected.
  pricing_engine: boolean;
  // The Next Experience program (owner doctrine 2026-08-19, bpmsquarecore
  // §10): the 3-layer theme, engagement layer, and every future "2050"
  // interaction change live behind THIS platform-admin-only flag. Missing
  // key reads false, so every existing tenant is untouched by default --
  // the demo tenant is where it gets proven before any client sees it.
  next_experience: boolean;
};

// WfmConfig — tenant-level WFM (attendance) settings, stored in
// tenants.config.wfm. Per-shift settings (grace, night allowance) live on
// wfm_shifts rows, not here.
export type WfmConfig = {
  // IANA timezone all attendance day-boundary/lateness logic runs in.
  timezone: string;
  // Working hours exclude break time (net = out − in − breaks). Client
  // decision 2026-08-05, overriding the original spec's "breaks are
  // informational only"; kept as config so a tenant can revert to gross.
  deduct_breaks: boolean;
  // Every N late marks in a calendar month = 1 half-day deduction (counted
  // in the CA summary only — no money math).
  late_marks_per_half_day: number;
  // Unused leave carries into next year (false = lapses).
  leave_carry_forward: boolean;
  // Punch selfies purged after this many days (enrollment photos are kept
  // until employee deletion — DPDP).
  selfie_retention_days: number;
  // flag_only: async face compare vs enrolled photo sets a face_mismatch
  // flag; never blocks a punch.
  face_verification_mode: "off" | "flag_only";
  // Weekly off days, 0 = Sunday … 6 = Saturday.
  week_off_days: number[];
  // block: punch outside every site's geofence is rejected (409). flag:
  // punch succeeds, within_geofence=false + flags.outside_geofence (today's
  // only behavior). off: no site match attempted at all, no flag either.
  geofence_mode: "block" | "flag" | "off";
  // Per-event-type email notification toggles. Each fires synchronously
  // from the route that creates the underlying event -- see src/lib/wfm/notify.ts.
  notifications: {
    late_arrival: boolean;       // check-in past shift start+grace -> supervisor
    correction_pending: boolean; // employee files a correction -> supervisor
    leave_pending: boolean;      // employee files a leave request -> supervisor
    recheck_flagged: boolean;    // supervisor flags a punch/day -> employee
  };
  // Employment types this tenant actually uses. Was a hardcoded
  // full_time|contractor enum until a tenant needed "Intern" -- now a
  // tenant-editable list. `code` is what employees.employment_type stores and
  // must never be renamed once in use (the label is the editable part); the
  // monthly Excel export groups its sheets by this list, so adding a type
  // adds a sheet rather than silently folding those people into another.
  employment_types: { code: string; label: string }[];
  // Optional punch-type groups shown in the punch-type dropdown. The core
  // four (check in/out, break start/end) are always on. Default off: a tenant
  // that doesn't do overtime or field work shouldn't see the extra options.
  punch_types: {
    ot: boolean;            // ot_in / ot_out  (+ supervisor approval + pay)
    mobile_work: boolean;   // mobile_work_start / _end
    business_trip: boolean; // business_trip_start / _end
  };
  // Flat tenant-wide overtime rate per hour, applied to APPROVED OT minutes
  // (exact minutes, no rounding). 0 = OT hours are tracked but no cost is
  // computed, which is the safe default until a tenant sets a real rate.
  ot_rate_per_hour: number;
};

/** Seed list for tenants that have never edited their employment types --
 * exactly the two values the old hardcoded enum allowed, so existing rows
 * stay valid. */
export const DEFAULT_EMPLOYMENT_TYPES: { code: string; label: string }[] = [
  { code: "full_time", label: "Full-time" },
  { code: "contractor", label: "Contractor" },
];

export const DEFAULT_WFM_CONFIG: WfmConfig = {
  timezone: "Asia/Kolkata",
  deduct_breaks: true,
  late_marks_per_half_day: 3,
  leave_carry_forward: false,
  selfie_retention_days: 90,
  face_verification_mode: "off",
  week_off_days: [0],
  geofence_mode: "flag",
  notifications: {
    late_arrival: false,
    correction_pending: true,
    leave_pending: true,
    recheck_flagged: true,
  },
  employment_types: DEFAULT_EMPLOYMENT_TYPES,
  punch_types: { ot: false, mobile_work: false, business_trip: false },
  ot_rate_per_hour: 0,
};

// All metric IDs available in the Analytics page.
export type AnalyticsMetricId =
  | "accounts" | "contacts" | "assets" | "open_cases" | "work_orders"
  | "contracts" | "leads" | "technicians"
  | "accounts_by_type" | "lead_funnel" | "assets_by_kind"
  | "quote_trend" | "case_status" | "work_order_status"
  | "technician_availability" | "revenue_overview"
  | "invoices_by_status" | "loaner_availability" | "recent_activity"
  | "account_news"
  | "quote_outcomes" | "quote_overdue" | "quote_source"
  | "wfm_attendance_today" | "wfm_night_shift_cost"
  | "wfm_corrections_queue" | "wfm_leave_requests_queue" | "wfm_recheck_queue"
  | "wfm_site_headcount" | "wfm_workforce_composition" | "wfm_leave_taken_by_type";

// Dashboard layout block — covers native cards and analytics widgets.
// id is a NativeDashBlockId or AnalyticsMetricId string.
// size is an explicit width override; omitted = each block's own sensible default
// (single-stat widgets go compact, everything else goes full width).
export type DashLayoutItem = { id: string; hidden?: boolean; size?: "compact" | "half" | "full" };

// CustomFieldDef — one custom field definition for any object type.
// Stored in tenants.config.custom_fields[objectType][].
export type CustomFieldDef = {
  key: string;       // unique key, e.g. "territory" — value stored as custom_data[key]
  label: string;     // display label, e.g. "Territory"
  type: "text" | "number" | "date" | "select" | "boolean";
  options?: string[]; // only for type = "select"
};

export type QuoteStatusDef = {
  value: string;      // stored in DB, e.g. "draft", "po_received"
  label: string;      // displayed in UI
  color: string;      // hex colour for the pill
  is_initial?: boolean;  // shown as default on new quotes
  is_closed?: boolean;   // quote locked (no edit) when in this status. Purely
                         // a pipeline-position flag -- it says nothing about
                         // win/loss, which is `outcome`'s job (see QuoteOutcome
                         // below). A closed status always requires a decided
                         // (non-"open") outcome; enforced where status is patched.
};

// Default statuses used when tenant has not configured custom ones.
export const DEFAULT_QUOTE_STATUSES: QuoteStatusDef[] = [
  { value: "draft",       label: "Draft",       color: "#3b82f6", is_initial: true },
  { value: "sent",        label: "Sent",        color: "#8b5cf6" },
  { value: "approved",    label: "Approved",    color: "#10b981", is_closed: true },
  { value: "rejected",    label: "Rejected",    color: "#ef4444", is_closed: true },
];

// Quote outcome -- the business RESULT, fully independent of pipeline status
// (a status just tracks where the quote sits; a quote can be marked lost
// while still "Sent", ahead of the paperwork catching up). "lost" (actively
// rejected) and "dropped" (went cold, no decision) are kept distinct since
// they mean different things for win-rate reporting. Not tenant-configurable
// -- unlike status, this is a fixed small vocabulary the system reasons about
// directly (invoice conversion gates on "won").
export const QUOTE_OUTCOMES = ["open", "won", "lost", "dropped"] as const;
export type QuoteOutcome = (typeof QUOTE_OUTCOMES)[number];

// Loss Intelligence (0088): why a quote was lost/dropped -- a fixed small
// vocabulary like outcome itself, so the reasons AGGREGATE (dashboard loss
// mix) and the AI can reason over them. The free-text nuance goes in
// loss_note, never into the reason value.
export const LOSS_REASONS = ["price", "silent", "competitor", "budget", "timing", "other"] as const;
export type LossReason = (typeof LOSS_REASONS)[number];
export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  price: "Price too high",
  silent: "Went silent",
  competitor: "Chose competitor",
  budget: "Budget cut",
  timing: "Bad timing",
  other: "Other",
};

// TenantConfig — full shape of tenants.config JSONB column.
export type TenantConfig = {
  entities: TenantEntity[];
  tax: TenantTaxConfig;
  // Which quote types are shown in the New Quotation picker. Omitted key = visible.
  quote_type_visibility?: Partial<Record<QuoteTypeId, boolean>>;
  // Analytics metrics the tenant has explicitly hidden on the Analytics page.
  analytics_hidden?: AnalyticsMetricId[];
  // Ordered dashboard layout (native cards + pinned analytics widgets).
  dashboard_layout?: DashLayoutItem[];
  // Custom field definitions per object type (e.g. "account", "contact", "asset").
  custom_fields?: Record<string, CustomFieldDef[]>;
  // Configurable quote pipeline statuses. Falls back to DEFAULT_QUOTE_STATUSES if absent.
  quote_statuses?: QuoteStatusDef[];
  // Which asset fields to print on the quote. Empty/absent = hide the section.
  asset_print_fields?: string[];
  // Quote ID (ref) naming convention. Falls back to DEFAULT_QUOTE_ID_FORMAT if absent.
  quote_id_format?: QuoteIdFormat;
  // Sidebar nav items the tenant admin has hidden — tenant-wide, applies to every
  // user/device, not a personal per-browser preference.
  nav_hidden_hrefs?: string[];
  // Tenant-wide appearance defaults. Accent colour is NOT here — tenants.accent_color
  // (a real top-level column, editable by both platform admin and tenant admin) is
  // the single source of truth for that; a second accent setting here would always
  // be silently overridden by it, which is exactly the bug this fixes.
  appearance?: {
    compact_sidebar?: boolean;
    /** The tenant's visual direction, via CSS custom properties (globals.css
     * `[data-theme=...]` blocks): "classic" (the original dark-navy sidebar),
     * "modern" (Structured Enterprise: denser cards, sharper borders,
     * navy+gold sidebar -- the default for newly created tenants, see POST
     * /api/admin/tenants), or "nextgen" (flat Attio/Linear-class chrome with
     * a per-browser dark-mode toggle). Chosen by the CLIENT's own admin in
     * Settings -> General -> Appearance; the platform admin only sets the
     * starting value at provisioning (TenantEditor.tsx). Retired directions
     * ("modern2" Lightning-blue, "modern3" Fluent) may still be stored on
     * older tenants -- useUiTheme() degrades them to "modern". "nextgen2"
     * is the 3-layer structural variant of nextgen (identity moved to the
     * top bar, sidebar footer dropped) -- it shares all of nextgen's CSS
     * tokens; useUiTheme() folds it into "nextgen" the same way, and
     * useIsNextgen3Layer() is the separate hook for the structural bit. */
    ui_theme?: "classic" | "modern" | "nextgen" | "nextgen2";
  };
  // On-demand push to an external system (e.g. an ERP's webhook receiver) --
  // a rep clicks "Push to ERP" on a record; distinct from (and simpler than)
  // the automatic event-driven Webhooks integration, which is still Coming
  // Soon. webhook_secret signs each push (HMAC-SHA256) so the receiver can
  // verify it actually came from BPMSquare.
  integration_push?: {
    webhook_url?: string;
    webhook_secret?: string;
  };
  // WFM module settings (only meaningful when features.wfm is on). Absent
  // keys fall back to DEFAULT_WFM_CONFIG.
  wfm?: Partial<WfmConfig>;
};

// QuoteIdFormat — per-tenant Quote ID naming convention.
// Supported template tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ}
export type QuoteIdFormat = {
  template: string;
  prefix: string;
  seq_digits: number;
  reset: "yearly" | "never";
};

export const DEFAULT_QUOTE_ID_FORMAT: QuoteIdFormat = {
  template: "{PREFIX}-{YYYY}-{SEQ}",
  prefix: "QT",
  seq_digits: 4,
  reset: "yearly",
};
