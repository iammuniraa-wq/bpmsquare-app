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
      { label: "Accounts",  href: ROUTES.accounts,  icon: "▣", pillar: "blue", workcenterKey: "accounts" },
      { label: "Contacts",  href: ROUTES.contacts,  icon: "◉", pillar: "blue", workcenterKey: "contacts" },
    ],
  },
  {
    group: "SALES",
    items: [
      {
        label: "Sales", href: ROUTES.quotations, icon: "₹", pillar: "blue",
        children: [
          { label: "Quotations", href: ROUTES.quotations, icon: "₹", pillar: "blue", workcenterKey: "quotations" },
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
          { label: "Cases",         href: ROUTES.cases,       icon: "☎", pillar: "teal", workcenterKey: "cases" },
          { label: "AMC contracts", href: ROUTES.amc,         icon: "▥", pillar: "teal", featureKey: "amc", workcenterKey: "amc" },
          { label: "Work orders",   href: ROUTES.workOrders,  icon: "▤", pillar: "amber", workcenterKey: "work_orders" },
          { label: "Dispatch",      href: ROUTES.dispatch,    icon: "◷", pillar: "amber", featureKey: "dispatch", workcenterKey: "dispatch" },
          { label: "Technicians",   href: ROUTES.technicians, icon: "◍", pillar: "amber", workcenterKey: "technicians" },
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
          { label: "Assets",          href: ROUTES.assets,         icon: "⚙", pillar: "green", workcenterKey: "assets" },
          { label: "Suppliers",       href: ROUTES.suppliers,      icon: "◫", pillar: "green", workcenterKey: "suppliers" },
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
    group: "ANALYTICS",
    items: [
      { label: "Analytics", href: ROUTES.reports, icon: "◫", pillar: "purple", workcenterKey: "reports" },
    ],
  },
  {
    group: "ADMIN",
    items: [
      { label: "Data Workbench", href: ROUTES.dataWorkbench, icon: "⇅", pillar: "teal", workcenterKey: "data_workbench" },
      { label: "Administrator", href: ROUTES.administration, icon: "🛠", pillar: "teal", workcenterKey: "administration" },
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
  | "quote_outcomes" | "quote_overdue" | "quote_source";

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
  is_terminal?: boolean; // quote locked (no edit) when in this status
  is_lost?: boolean;     // this terminal status represents a lost/rejected deal --
                         // distinguishes it from a "won" terminal status (e.g. approved)
                         // when computing won/approved value.
};

// Default statuses used when tenant has not configured custom ones.
export const DEFAULT_QUOTE_STATUSES: QuoteStatusDef[] = [
  { value: "draft",       label: "Draft",       color: "#3b82f6", is_initial: true },
  { value: "sent",        label: "Sent",        color: "#8b5cf6" },
  { value: "approved",    label: "Approved",    color: "#10b981", is_terminal: true },
  { value: "rejected",    label: "Rejected",    color: "#ef4444", is_terminal: true, is_lost: true },
];

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
     * older tenants -- useUiTheme() degrades them to "modern". */
    ui_theme?: "classic" | "modern" | "nextgen";
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
