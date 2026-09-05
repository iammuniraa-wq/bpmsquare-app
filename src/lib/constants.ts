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

/**
 * The origin a TENANT is reached at -- the only correct base for any link
 * that leaves the system (an email, a push, an invite). A client tenant
 * lives on its custom_domain; PRIMARY_HOST is the demo sandbox and nothing
 * else. Building a link from PRIMARY_HOST directly sent a BIM supervisor's
 * correction-request email to the demo workspace (P1, 2026-09-06); a unit
 * test now fails the build if any file does that again.
 */
export function tenantOrigin(customDomain: string | null | undefined): string {
  const host = (customDomain ?? "").trim() || PRIMARY_HOST;
  return `https://${host}`;
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
  settingsAccount360: "/settings/account-360",
  settingsCoverage: "/settings/coverage",
  reports: "/reports",
  reportsTalk: "/reports/talk",
  admin: "/admin",
  adminTenant: (id: string) => `/admin/tenants/${id}`,
  suppliers: "/suppliers",
  supplierNew: "/suppliers/new",
  supplier: (id: string) => `/suppliers/${id}`,
  products: "/products",
  productNew: "/products/new",
  product: (id: string) => `/products/${id}`,
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
  wfmProjects: "/wfm/projects",
  wfmProject: (id: string) => `/wfm/projects/${id}`,
  wfmProjectNew: "/wfm/projects/new",
  wfmLeave: "/wfm/leave",
  wfmSummary: "/wfm/summary",
  settingsWorkforce: "/settings/workforce",
  pricing: "/pricing",
  pricingToday: "/pricing/today",
  pricingSetup: "/pricing/setup",
  pricingHistory: "/pricing/history",
  pricingAdvanced: "/pricing/advanced",
  pricingRfqs: "/pricing/rfqs",
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
    ],
  },
  {
    group: "SALES & PROCUREMENT",
    items: [
      {
        label: "Sales", href: ROUTES.quotations, icon: "₹", pillar: "blue",
        children: [
          { label: "Quotations", href: ROUTES.quotations, icon: "₹", pillar: "blue", featureKey: "quotations", workcenterKey: "quotations" },
          { label: "Standard Quotes", href: ROUTES.standardQuotes, icon: "≡", pillar: "blue", featureKey: "standard_quotes", workcenterKey: "standard_quotes" },
          { label: "Pipeline",   href: ROUTES.pipeline,   icon: "▦", pillar: "blue", featureKey: "pipeline", workcenterKey: "pipeline" },
          { label: "Invoices",   href: ROUTES.invoices,   icon: "⊟", pillar: "blue", featureKey: "invoices", workcenterKey: "invoices" },
          { label: "Purchase Orders", href: ROUTES.purchaseOrders, icon: "⇱", pillar: "blue", featureKey: "purchasing", workcenterKey: "purchase_orders" },
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
        ],
      },
    ],
  },
  {
    group: "MASTER DATA",
    items: [
      {
        label: "Master data", href: ROUTES.assets, icon: "▧", pillar: "green",
        children: [
          { label: "Assets",          href: ROUTES.assets,         icon: "▧", pillar: "green", featureKey: "assets", workcenterKey: "assets" },
          { label: "Suppliers",       href: ROUTES.suppliers,      icon: "◫", pillar: "green", featureKey: "suppliers", workcenterKey: "suppliers" },
          { label: "Inventory",       href: ROUTES.inventory,      icon: "▨", pillar: "green", featureKey: "purchasing", workcenterKey: "inventory" },
          { label: "Products",        href: ROUTES.products,       icon: "▩", pillar: "green", featureKey: "products", workcenterKey: "products" },
          // Employees ships as part of the Business Roles/Business Users
          // bundle, so it shares that bundle's rollout flag rather than
          // getting its own.
          { label: "Employees",       href: ROUTES.employees,      icon: "⚇", pillar: "green", featureKey: "business_roles", workcenterKey: "employees" },
          // Client reorg 2026-08-22: Partners (from Marketing) and
          // Accounts/Contacts (from Workspace) live with the master data.
          { label: "Partners",        href: ROUTES.partners,       icon: "⌂", pillar: "green", featureKey: "partners", workcenterKey: "partners" },
          { label: "Accounts",        href: ROUTES.accounts,       icon: "▣", pillar: "green", featureKey: "accounts", workcenterKey: "accounts" },
          { label: "Contacts",        href: ROUTES.contacts,       icon: "◉", pillar: "green", featureKey: "contacts", workcenterKey: "contacts" },
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
          // Project costing carries its OWN featureKey, so an attendance-only
          // tenant with `wfm` never sees it (WFM_PROJECT_COSTING.md §8).
          { label: "Projects", href: ROUTES.wfmProjects, icon: "◱", pillar: "amber", featureKey: "wfm_projects", workcenterKey: "wfm", supervisorOnly: true },
          { label: "Leave & Holidays", href: ROUTES.wfmLeave, icon: "☀", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
          { label: "Time Summary", href: ROUTES.wfmSummary, icon: "▤", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
        ],
      },
    ],
  },
  {
    group: "PRICING",
    items: [
      { label: "Pricing", href: ROUTES.pricingToday, icon: "₹", pillar: "amber", featureKey: "pricing_engine", workcenterKey: "pricing" },
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
      { label: "Audit & Users", href: ROUTES.administration, icon: "⛨", pillar: "teal", featureKey: "administration", workcenterKey: "administration" },
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
  // Project costing inside WFM (0104, WFM_PROJECT_COSTING.md). A SEPARATE
  // flag from `wfm` on purpose: attendance-only tenants must not gain a
  // project dropdown, a projects screen or a project column on the summary
  // just because they bought WFM. Missing key reads false; level 1
  // (attribution — hours per project, no money anywhere) is all this flag
  // turns on. Cost rates, rate cards and client approval are later levels
  // with their own flags.
  wfm_projects: boolean;
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
  products: boolean;
  reports: boolean;
  data_workbench: boolean;
  administration: boolean;
  // PricingEngine (docs/pricing-engine-architecture.md): the dynamic pricing
  // product. Demo tenant only until sold; Small Scale Pricing is unaffected.
  pricing_engine: boolean;
  // Separate, narrower opt-in that lets a quote line actually pull a live
  // price from PricingEngine's PUBLISHED "default" Price Book (spec: "never
  // a forced migration") -- a tenant can have the Pricing workcenter without
  // this ever touching a real quote. Both flags are required at every call
  // site; default OFF, missing key reads false.
  pricing_engine_quotes: boolean;
  // The Next Experience program (owner doctrine 2026-08-19, bpmsquarecore
  // §10): the 3-layer theme, engagement layer, and every future "2050"
  // interaction change live behind THIS platform-admin-only flag. Missing
  // key reads false, so every existing tenant is untouched by default --
  // the demo tenant is where it gets proven before any client sees it.
  next_experience: boolean;
  // The "Enterprise" theme (owner correction 2026-08-25: it shipped without
  // a gate and surfaced directly in the demo tenant's own picker -- not the
  // design. Platform-admin-only, same shape as next_experience: proven on
  // the demo tenant first, missing key reads false so every existing tenant
  // is untouched.
  enterprise_theme: boolean;
  // Coverage (owner decision 2026-08-26, from the "Orbit" proposal): the
  // rule-based Team/Segment/Coverage org model, replacing flat territory/
  // sales_org picklists with computed rules -- also drives auto-ownership,
  // product availability gating, and per-coverage ERP routing. A sold
  // module like products/pricing_engine, not an experimental-UI flag; still
  // default OFF (missing key reads false) since it can reassign account
  // ownership and reroute ERP pushes once on.
  coverage_model: boolean;
  // AI Report Builder ("talk to data", docs/ai-report-builder-architecture.md):
  // natural-language questions compiled to the same validated query engine the
  // v1 API uses, answered with a chart/table over live data. Calls the model
  // on every fresh question (saved reports don't), so this stays an explicit
  // opt-in flag like pricing_engine/coverage_model rather than bundled into
  // the existing `reports` flag -- default OFF, missing key reads false.
  ai_reports: boolean;
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
  // Kiosk face punch: a registered door tablet identifies an enrolled
  // employee by face (1:N, server-side behind our API) and offers the
  // valid punch buttons -- no login on the device. Default off; the whole
  // surface (enrollment, kiosk registration, /kiosk) hangs off this key.
  face_punch: "off" | "kiosk";
  // Weekly off days, 0 = Sunday … 6 = Saturday.
  week_off_days: number[];
  // block: punch outside every site's geofence is rejected (409). flag:
  // punch succeeds, within_geofence=false + flags.outside_geofence (today's
  // only behavior). off: no site match attempted at all, no flag either.
  geofence_mode: "block" | "flag" | "off";
  // Hard location gate for the shift punch (check in / check out only --
  // breaks and OT are left alone, since those often happen indoors where a
  // fix is slow or impossible). Defaults OFF so no existing tenant's
  // punching changes; enabled in Settings -> Workforce.
  //
  // Enforced SERVER-side in /api/wfm/punch, not just in the UI. It matters
  // because denying location used to be a way AROUND geofence_mode:"block":
  // that check only rejects a punch it can PROVE is outside, so a punch it
  // can't place at all sailed through with a flag. geofence_mode "block"
  // therefore now implies this too.
  //
  // There is no matching require_selfie key on purpose: a selfie is already
  // mandatory for check in/out (startPunch routes both through the camera,
  // and a denied camera ends the punch), so a toggle would be a no-op.
  require_location: boolean;
  // Which punch kinds demand a selfie. "shift" is exactly what the product
  // did before this setting existed (check in/out plus mobile-work and
  // business-trip starts), so it is the default and no tenant's behaviour
  // moves. "off" is the genuinely new capability -- a selfie used to be
  // mandatory with no way to decline, which a DPDP-conscious tenant may not
  // want. "all" extends it to breaks and overtime.
  //
  // Enforced on the punch screen, which is where a camera permission can
  // actually be demanded: a denied camera ends the punch, it does not fall
  // through. The punch route additionally stamps flags.selfie_required so a
  // recorded punch that never received its image is findable afterwards --
  // it cannot reject at punch time, because the image is uploaded in a
  // second request once the event exists.
  selfie_mode: "off" | "shift" | "all";
  // Per-event-type email notification toggles. Each fires synchronously
  // from the route that creates the underlying event -- see src/lib/wfm/notify.ts.
  notifications: {
    late_arrival: boolean;       // check-in past shift start+grace -> supervisor
    correction_pending: boolean; // employee files a correction -> supervisor
    leave_pending: boolean;      // employee files a leave request -> supervisor
    recheck_flagged: boolean;    // supervisor flags a punch/day -> employee
  };
  /** Push an employee's own phone once they pass a worked-hours threshold, so
   *  they know to punch out (client request, BIM 2026-09-04). Off by default:
   *  it needs VAPID keys on the server AND the employee to have allowed
   *  notifications, so switching it on blindly would promise something that
   *  silently does nothing. `after_hours` is WORKED time, net of breaks --
   *  the same figure the timesheet shows, so the two can never disagree. */
  long_day_alert: {
    enabled: boolean;
    after_hours: number;
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
  // Employee self-service. Default true = the model every existing tenant
  // runs: employees log in, punch from their own phone, self-enroll their
  // face, and file their own leave/corrections.
  //
  // false (client decision 2026-08-21, for BIM) = a supervisor-managed
  // workforce: employees do NOT punch from their own phone and do NOT
  // self-enroll their face -- attendance happens only at the office kiosk,
  // by face, and enrollment is done for them by a supervisor. Leave and
  // correction stay available to any employee who does hold a login, since a
  // tenant still needs a way to record them; only the punch/enroll
  // self-service is withdrawn. Per-tenant so Vikas/demo are untouched.
  employee_self_service: boolean;
  // How employees sign in to the self-service portal (client decision
  // 2026-08-21). "email" = a real email address, the model every existing
  // tenant uses. "code" = employee code + password, no personal email: the
  // login screen takes the code and signs in against a synthetic internal
  // address minted from it (src/lib/wfm/employeeLogin.ts). Admins and other
  // business users always sign in by email regardless of this setting.
  login_mode: "email" | "code";
  // Let employees sign in to the portal by FACE, as an alternative to their
  // ID/email + password (client decision 2026-08-21). Default false and
  // opt-in: a face match here grants account ACCESS, unlike a kiosk punch
  // where a wrong match is only a bad attendance row -- so login uses a
  // stricter similarity bar than punching, and this is deliberately off until
  // a tenant turns it on. Requires face enrollment (Face punch on) so a
  // template exists to match against. No liveness yet, so treat it as basic
  // face auth (a photo of the employee could sign in) until liveness ships.
  face_login: boolean;
  // Passkey (WebAuthn) sign-in: the employee's own phone biometric -- real
  // Face ID / fingerprint -- unlocks a device-held key; we store only the
  // public half, so no biometric data ever reaches the server and photos
  // can't spoof it. Off by default like every new login surface.
  passkey_login: boolean;
  /** Project billing (WFM_PROJECT_COSTING.md §11): what an hour on a project
   *  is charged and what it costs. Three rungs, most specific wins --
   *  wfm_projects.bill_rate > the person's employment type > the workspace
   *  default -- mirroring attribution so there is one mental model. */
  costing: WfmCostingConfig;
};

export type WfmCostingConfig = {
  /** Charged per hour when neither the project nor the employment type sets
   *  one. 0 = billing not set up: a preview refuses to raise an invoice at a
   *  zero rate rather than sending a customer a free invoice. */
  default_bill_rate: number;
  /** What an hour costs the business (margin). Internal: shown to admins on
   *  the preview, never on an invoice and never on the API -- the same rule
   *  as products.cost_price. */
  default_cost_rate: number;
  /** Rung 2, keyed by employment-type CODE (WfmConfig.employment_types). */
  rates_by_employment_type: Record<string, { bill?: number; cost?: number }>;
  /** Days from the draft to its due date. */
  due_days: number;
  /** Draft an invoice for every account-linked project with unbilled hours
   *  on the first of each month (GitHub Actions, not a Vercel cron -- see
   *  .github/workflows/wfm-project-invoices.yml). Off by default: a draft
   *  nobody asked for is a surprise in the Invoices list. */
  auto_draft_monthly: boolean;
};

export const DEFAULT_WFM_COSTING: WfmCostingConfig = {
  default_bill_rate: 0,
  default_cost_rate: 0,
  rates_by_employment_type: {},
  due_days: 30,
  auto_draft_monthly: false,
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
  face_punch: "off",
  week_off_days: [0],
  geofence_mode: "flag",
  require_location: false,
  selfie_mode: "shift",
  notifications: {
    late_arrival: false,
    correction_pending: true,
    leave_pending: true,
    recheck_flagged: true,
  },
  long_day_alert: { enabled: false, after_hours: 9 },
  employment_types: DEFAULT_EMPLOYMENT_TYPES,
  punch_types: { ot: false, mobile_work: false, business_trip: false },
  ot_rate_per_hour: 0,
  employee_self_service: true,
  login_mode: "email",
  face_login: false,
  passkey_login: false,
  costing: DEFAULT_WFM_COSTING,
};

// All metric IDs available in the Analytics page.
export type AnalyticsMetricId =
  | "accounts" | "contacts" | "assets" | "open_cases" | "work_orders" | "products"
  | "contracts" | "leads" | "technicians"
  | "accounts_by_type" | "lead_funnel" | "assets_by_kind"
  | "quote_trend" | "case_status" | "work_order_status"
  | "technician_availability" | "revenue_overview"
  | "invoices_by_status" | "loaner_availability" | "recent_activity"
  | "account_news"
  | "quote_outcomes" | "quote_overdue" | "quote_source"
  | "wfm_attendance_today" | "wfm_night_shift_cost"
  | "wfm_corrections_queue" | "wfm_leave_requests_queue" | "wfm_recheck_queue"
  | "wfm_site_headcount" | "wfm_workforce_composition" | "wfm_leave_taken_by_type"
  | "wfm_project_hours" | "wfm_project_budget" | "wfm_project_billing";

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

// One node of the tenant's two-level product category tree (see
// TenantConfig.product_categories). code is stable and stored on records;
// name is the renameable display label (src/lib/picklists.ts).
export type ProductCategoryDef = {
  code: string;
  name: string;
  subs: { code: string; name: string }[];
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
  // Product category tree, defined by the tenant in Settings -> Sales config.
  // OOB depth is exactly two levels (category -> sub-categories); absent/empty
  // means the product form falls back to free-text category entry.
  product_categories?: ProductCategoryDef[];
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
     * useIsNextgen3Layer() is the separate hook for the structural bit.
     * "enterprise" (owner request 2026-08-24) is nextgen's light content
     * with a dark navy sidebar -- also folds into "nextgen" for behaviour;
     * useIsEnterpriseSidebar() is its structural hook, same pattern. Unlike
     * "nextgen2" it carries no feature-flag gate -- any tenant can pick it. */
    ui_theme?: "classic" | "modern" | "nextgen" | "nextgen2" | "enterprise";
    /** Three pieces of Nova/Enterprise chrome a plain-nextgen workspace can
     * switch on for itself (owner decision 2026-09-06). Each was previously
     * reachable only by adopting a whole theme behind a platform-admin flag
     * ("nextgen2" for the first two, "enterprise" for the third), which meant
     * a tenant who wanted the command palette also got the entire Nova
     * experiment. These are the individual switches, tenant-admin owned, in
     * Settings -> General -> Appearance, all default false and all ignored
     * unless ui_theme resolves to nextgen.
     *
     * Deliberately NOT a widening of the Nova gate: the experimental Nova
     * surfaces (engagement layer, Account 360 drawer, Nova sidebar and inbox)
     * stay on useIsNextgen3Layer() and remain unreachable without the
     * platform-admin flag. See useTopBarIdentity/useCommandPalette. */
    /** Sign-in identity moves from the sidebar footer to the top-right. */
    top_bar_identity?: boolean;
    /** Ctrl/Cmd+K opens the command palette instead of focusing search. */
    command_palette?: boolean;
    /** Dark navy left rail against the light content area -- the
     * "Enterprise" look, without the enterprise_theme flag. */
    navy_sidebar?: boolean;
    /** Nova's own accent hue (owner decision 2026-08-24, superseding the
     * earlier "fixed identity, never tenant-derived" call): a hex string that
     * replaces Nova's default pink (#E84393) everywhere Nova derives its
     * signature colour -- tab underline, command-bar glow, gradient midpoint.
     * Deliberately its OWN field, not aliased to tenants.accent_color (see
     * the comment above this object) -- Nova's accent and the classic/
     * nextgen chrome's accent are independent choices; a tenant can run a
     * blue classic theme and a pink Nova theme, or vice versa. Absent/empty
     * = the default pink; consumed via a CSS custom-property fallback
     * (`var(--nova-accent-color, #E84393)` in globals.css), never hardcoded
     * in a component. */
    nova_accent_color?: string;
  };
  // On-demand push to an external system (e.g. an ERP's webhook receiver) --
  // a rep clicks "Push to ERP" on a record; distinct from (and simpler than)
  // the automatic event-driven Webhooks integration, which is still Coming
  // Soon. webhook_secret signs each push (HMAC-SHA256) so the receiver can
  // verify it actually came from BPMSquare. webhook_url/webhook_secret
  // remain the tenant's single DEFAULT endpoint -- unchanged, still used
  // whenever a record's owning coverage doesn't specify one. `endpoints` is
  // the multi-ERP addition (Coverage, 2026-08-26): named additional
  // targets a coverage row can route to via its erp_endpoint_id (a
  // client-generated id, matched against endpoints[].id -- not a DB fk,
  // since these live in config jsonb like the default pair already did).
  integration_push?: {
    webhook_url?: string;
    webhook_secret?: string;
    endpoints?: { id: string; name: string; webhook_url: string; webhook_secret: string }[];
  };
  // WFM module settings (only meaningful when features.wfm is on). Absent
  // keys fall back to DEFAULT_WFM_CONFIG.
  wfm?: Partial<WfmConfig>;
  // Account 360 drawer: which built-in cards show, in what order, plus the
  // tenant's own external source cards. Absent = every built-in card, default
  // order, no external sources.
  account_360?: Account360Config;
  // Email output channel (owner requirement 2026-09-06, modelled on SAP C4C's
  // Email and Fax Settings). "partners" sends to the address on the account,
  // contact or employee record; "redirect" sends EVERY outbound email from
  // any transaction to the one address here instead, subject-tagged with the
  // intended recipient. A demo workspace (tenants.is_demo) is always in
  // redirect mode regardless of this value -- see src/lib/emailOutput.ts --
  // so no test document can ever reach a real customer. Absent = partners.
  email_output?: EmailOutputConfig;
  // BPMSquare Pricing (docs/pricing-engine-architecture.md §17). Absent keys
  // read as the defaults in src/lib/pricing/documents.ts.
  pricing?: PricingConfig;
};

export type PricingConfig = {
  /** How long stored pricing contexts (pricing_documents) are kept before
   *  the daily retention job purges them. Default 180, clamped 7..3650. */
  retention_days?: number;
  /** Which Price Book a line goes to (src/lib/pricing/routing.ts): ordered
   *  rules on context attributes, first match wins, default book last. */
  routing?: {
    rules?: { attribute: string; value: string; area: string }[];
    default_area?: string;
  };
};

export type EmailOutputMode = "partners" | "redirect";
export type EmailOutputConfig = {
  mode: EmailOutputMode;
  /** The single internal inbox everything lands in under "redirect". */
  redirect_to: string;
};

// Account 360 — an external source the tenant plugged in (an ERP, a
// finance system, a data-enrichment API). The drawer fetches the URL
// server-side and maps a few JSON paths onto a card, so adding a source is
// configuration, not code. auth_value is a SECRET: it is redacted for
// non-admins at the TenantProvider boundary (redactTenantForRole) exactly
// like the integration-push webhook secret.
export type Account360SourceDef = {
  id: string;
  title: string;
  /** https URL. Tokens substituted from the account: {account_id} {account_ref}
   *  {account_name} {gstin} {city} {email} — each URL-encoded. */
  url: string;
  auth_header?: string;
  auth_value?: string;
  /** Optional dot path to an object inside the response to read fields from. */
  root_path?: string;
  /** JSON paths (dot/bracket) mapped to labelled values on the card. */
  fields: { label: string; path: string }[];
  enabled: boolean;
};

export type Account360Config = {
  /** Built-in card ids the tenant switched off. */
  hidden_cards?: string[];
  /** Built-in card ids in the tenant's preferred order; unlisted ones keep
   *  their registry order after these. */
  card_order?: string[];
  sources?: Account360SourceDef[];
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
