// VeveyCRM constants — routes + navigation IA. Single source of truth.
// IA follows the customer journey (pillars), per PROJECT.md §4.

import type { PillarKey } from "./theme";
import type { CurrencyCode } from "./currency";
import type { ScoringRubric } from "./marketing/scoring";

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
  pipelineNew: "/pipeline/new",
  pipelineDetail: (id: string) => `/pipeline/${id}`,
  dashboard: "/",
  leads: "/leads",
  partners: "/partners",
  marketing: "/marketing",
  marketingNew: "/marketing/new",
  marketingCampaign: (id: string) => `/marketing/${id}`,
  marketingUnsubscribe: (accountId: string, token: string) => `/marketing/unsubscribe/${accountId}/${token}`,
  marketingInterest: (campaignId: string, accountId: string, token: string) => `/marketing/interest/${campaignId}/${accountId}/${token}`,
  marketingJourneys: "/marketing/journeys",
  marketingJourneyNew: "/marketing/journeys/new",
  marketingJourney: (id: string) => `/marketing/journeys/${id}`,
  marketingWhatsapp: "/marketing/whatsapp",
  marketingWhatsappNew: "/marketing/whatsapp/new",
  marketingWhatsappTemplate: (id: string) => `/marketing/whatsapp/${id}`,
  marketingWhatsappSetup: "/marketing/whatsapp/setup",
  marketingAttribution: "/marketing/attribution",
  marketingEvents: "/marketing/events",
  marketingEventNew: "/marketing/events/new",
  marketingEvent: (id: string) => `/marketing/events/${id}`,
  marketingNewsletters: "/marketing/newsletters",
  marketingNewsletterNew: "/marketing/newsletters/new",
  marketingNewsletter: (id: string) => `/marketing/newsletters/${id}`,
  marketingForms: "/marketing/forms",
  marketingFormNew: "/marketing/forms/new",
  marketingForm: (id: string) => `/marketing/forms/${id}`,
  marketingPreferences: (contactId: string, token: string) => `/marketing/preferences/${contactId}/${token}`,
  marketingClick: (campaignId: string, recipientId: string, index: number, token: string) => `/marketing/c/${campaignId}/${recipientId}/${index}/${token}`,
  marketingSignals: "/marketing/signals",
  marketingAbm: "/marketing/abm",
  marketingAbmNew: "/marketing/abm/new",
  marketingAbmProgram: (id: string) => `/marketing/abm/${id}`,
  marketingAbmTarget: (programId: string, targetId: string) => `/marketing/abm/${programId}/accounts/${targetId}`,
  // Flat link for places that only know the target id (Nova inbox, search): resolves the program and redirects.
  marketingAbmTargetShort: (targetId: string) => `/marketing/abm/targets/${targetId}`,
  marketingSegments: "/marketing/segments",
  marketingSegmentNew: "/marketing/segments/new",
  marketingSegment: (id: string) => `/marketing/segments/${id}`,
  marketingLeads: "/marketing/leads",
  marketingLead: (id: string) => `/marketing/leads/${id}`,
  inbox: "/inbox",
  inboxMessage: (id: string) => `/inbox/${id}`,
  settingsInbox: "/settings/inbox",
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
  configTemplates: "/settings/templates", // redirects to the Quotations templates tab
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
  settingsGeneral: "/settings/general", // redirects to settingsCompany
  settingsCompany: "/settings/company",
  settingsCurrency: "/settings/currency",
  settingsNavigation: "/settings/navigation",
  settingsQuoteTypes: "/settings/quote-types", // redirects to the Quotations offer types tab
  settingsDeveloper: "/settings/developer",
  settingsPush: "/settings/push",
  settingsMiddleware: "/settings/middleware",
  settingsWebhooks: "/settings/webhooks",
  settingsEmailOutput: "/settings/email-output",
  settingsAppearance: "/settings/appearance",
  settingsDashboard: "/settings/dashboard",
  settingsReset: "/settings/reset",
  settingsPeople: "/settings/people",
  settingsEntities: "/settings/entities",
  settingsCustomFields: "/settings/custom-fields",
  settingsTemplates: "/settings/templates",
  settingsQuotations: "/settings/quotations",
  settingsStatuses: "/settings/statuses", // redirects to the Quotations statuses tab
  settingsEmailTemplates: "/settings/email-templates", // redirects to the Quotations templates tab
  settingsSales: "/settings/sales", // redirects to the Products categories tab
  settingsProducts: "/settings/products",
  settingsProductCategories: "/settings/product-categories", // redirects to settingsProducts
  settingsItemTypes: "/settings/item-types", // redirects to settingsProducts
  settingsAssetPrintFields: "/settings/asset-print-fields", // redirects to the Quotations print tab
  settingsDeletionLog: "/settings/deletion-log",
  settingsConnectors: "/settings/connectors",
  settingsAccount360: "/settings/account-360",
  settingsCoverage: "/settings/coverage",
  settingsRfq: "/settings/rfq",
  settingsMarketingLeads: "/settings/marketing-leads",
  settingsMarketingConsent: "/settings/marketing-consent",
  settingsBrandKit: "/settings/brand-kit",
  settingsEstimateTemplates: "/settings/estimate-templates",
  settingsEstimateTemplate: (id: string) => `/settings/estimate-templates/${id}`,
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
  fenceProjects: "/fence-projects",
  fenceProjectNew: "/fence-projects/new",
  fenceProject: (id: string) => `/fence-projects/${id}`,
  inventory: "/inventory",
  inventoryNew: "/inventory/new",
  inventoryItem: (id: string) => `/inventory/${id}`,
  purchaseOrders: "/purchase-orders",
  purchaseOrderNew: "/purchase-orders/new",
  purchaseOrder: (id: string) => `/purchase-orders/${id}`,
  dataWorkbench: "/data-workbench",
  wfmMe: "/wfm/me",
  // Nested under wfmMe on purpose -- the WFM-only confinement in
  // (app)/layout.tsx allows that prefix, so a sibling route would bounce a
  // plain employee out of their own timesheet.
  wfmMyDetails: "/wfm/me/details",
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
  rfqs: "/rfqs",
  rfqNew: "/rfqs/new",
  rfq: (id: string) => `/rfqs/${id}`,
  estimates: "/estimates",
  estimateNew: "/estimates/new",
  estimate: (id: string) => `/estimates/${id}`,
  processStudio: "/process-studio",
  processStudioNew: "/process-studio/new",
  processStudy: (id: string) => `/process-studio/${id}`,
  administration: "/administration",
  administrationChangeHistory: "/administration/change-history",
  administrationOutboundEmails: "/administration/outbound-emails",
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
  /** Shown only to a member with unrestricted workcenter access (tenant admin
   * or no Business Role) -- Settings. Never hideable from Navigation
   * visibility, so nobody can lock themselves out of it. */
  adminOnly?: boolean;
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
      // Shared Inbox (0214, docs/design/estimator-unification-and-inbox.md): customer mail, read by a team and turned
      // into a Quote, Project, Case, Lead or Estimate. About the whole business, so it sits under Dashboard.
      { label: "Inbox", href: ROUTES.inbox, icon: "✉", pillar: "blue", featureKey: "inbox", workcenterKey: "inbox" },
      // Process Design Studio (0152, docs/process-design-studio-architecture.md): about
      // the whole business, not one pillar, so it sits under Dashboard.
      { label: "Process Design Studio", href: ROUTES.processStudio, icon: "◇", pillar: "blue", featureKey: "process_studio", workcenterKey: "process_studio" },
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
          // RFQ (0128): supplier quotations asked for when no cost/price is
          // found. Procurement, so it sits beside Purchase Orders.
          { label: "RFQs", href: ROUTES.rfqs, icon: "⇄", pillar: "blue", featureKey: "rfq", workcenterKey: "rfqs" },
          // Fence Configurator (0122): a Standard Quotes source, not its own
          // pillar -- lives beside the object it feeds, docs/fence-configurator-architecture.md.
          { label: "Fence Projects", href: ROUTES.fenceProjects, icon: "⌗", pillar: "blue", featureKey: "fence_projects", workcenterKey: "fence_projects" },
          // Project Estimator (0131, docs/estimator-architecture.md): template-driven
          // estimate -> BOM, WBS and cost build-up -> Standard Quote.
          { label: "Estimates", href: ROUTES.estimates, icon: "∑", pillar: "blue", featureKey: "estimator", workcenterKey: "estimates" },
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
          { label: "Newsletters", href: ROUTES.marketingNewsletters, icon: "✎", pillar: "purple", featureKey: "newsletter_studio", workcenterKey: "marketing_newsletters" },
          { label: "Buying signals", href: ROUTES.marketingSignals, icon: "◎", pillar: "purple", featureKey: "buying_signals", workcenterKey: "signals" },
          { label: "Forms", href: ROUTES.marketingForms, icon: "☰", pillar: "purple", featureKey: "marketing_forms", workcenterKey: "marketing_forms" },
          { label: "ABM programs", href: ROUTES.marketingAbm, icon: "◆", pillar: "purple", featureKey: "abm", workcenterKey: "abm" },
          { label: "Journeys", href: ROUTES.marketingJourneys, icon: "↠", pillar: "purple", featureKey: "journeys", workcenterKey: "marketing_journeys" },
          { label: "WhatsApp", href: ROUTES.marketingWhatsapp, icon: "☏", pillar: "purple", featureKey: "whatsapp_marketing", workcenterKey: "marketing_whatsapp" },
          { label: "Events", href: ROUTES.marketingEvents, icon: "◷", pillar: "purple", featureKey: "marketing_events", workcenterKey: "marketing_events" },
          { label: "Revenue by source", href: ROUTES.marketingAttribution, icon: "⌁", pillar: "purple", featureKey: "marketing_attribution", workcenterKey: "marketing_attribution" },
          { label: "Segmentation", href: ROUTES.marketingSegments, icon: "⌗", pillar: "purple", featureKey: "marketing", workcenterKey: "marketing_segments" },
          { label: "Leads", href: ROUTES.leads, icon: "✦", pillar: "purple", featureKey: "leads", workcenterKey: "leads" },
          { label: "Scored leads", href: ROUTES.marketingLeads, icon: "⚡", pillar: "purple", featureKey: "marketing_scoring", workcenterKey: "leads" },
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
          { label: "Workforce employees", href: ROUTES.wfmEmployees,   icon: "⚇", pillar: "amber", featureKey: "wfm", workcenterKey: "wfm", supervisorOnly: true },
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
    group: "INSIGHTS",
    items: [
      { label: "Analytics", href: ROUTES.reports, icon: "◫", pillar: "purple", featureKey: "reports", workcenterKey: "reports" },
      { label: "Pricing", href: ROUTES.pricingToday, icon: "₹", pillar: "amber", featureKey: "pricing_engine", workcenterKey: "pricing" },
    ],
  },
  {
    group: "ADMIN",
    items: [
      { label: "Data Workbench", href: ROUTES.dataWorkbench, icon: "⇅", pillar: "teal", featureKey: "data_workbench", workcenterKey: "data_workbench" },
      { label: "Audit & Users", href: ROUTES.administration, icon: "⛨", pillar: "teal", featureKey: "administration", workcenterKey: "administration" },
      { label: "Settings", href: ROUTES.settings, icon: "◈", pillar: "teal", adminOnly: true },
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
  // The "Spectacular" theme (owner request 2026-09-19, from an Able Pro
  // dashboard reference): nextgen's structure with a softer, bluer, rounder
  // palette. Same platform-admin-only shape as the two flags above -- proven
  // on the demo tenant before any client sees it, missing key reads false.
  // Covers BOTH palettes ("spectacular" navy and "spectacular_purple" lilac,
  // added 2026-09-20): they are one direction rendered in two hues, sharing
  // every rule, so a second flag would gate nothing a tenant with this one
  // cannot already reach.
  spectacular_theme: boolean;
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
  // Fence Configurator (docs/fence-configurator-architecture.md, Phase C):
  // parametric takeoff + BOM, priced through the same engine standard_quotes
  // already uses. Mid-build -- Phase A/B/C only, no CRUD screens or nav yet
  // (deliberate per bpmsquarecore §10: one piece at a time). Demo tenant only
  // until the §3b checklist is walked in full; default OFF, missing key
  // reads false, same shape as pricing_engine.
  fence_projects: boolean;
  // RFQ (0128, docs/rfq-architecture.md): request for quotation to suppliers
  // when no cost or price can be found -- a standard object raised from
  // quotes, deals, cases, inspections, work orders and fence projects, with
  // the supplier conversation (send AND receive) inside the tenant. A sold
  // module: default OFF, missing key reads false. Tenants without it keep
  // the older single-supplier pricing RFQ under Pricing.
  rfq: boolean;
  // Project Estimator (0131, docs/estimator-architecture.md): generic,
  // template-driven estimates (inputs + rates + rule lines -> BOM, WBS, cost
  // build-up -> Standard Quote). A sold module: default OFF, missing key
  // reads false.
  estimator: boolean;
  // Marketing platform M0 (docs/marketing-platform-architecture.md): lead
  // scoring, the consent ledger's settings and the lead stages. A platform-
  // admin-only flag (set in /admin/tenants, never by a workspace admin):
  // default OFF, missing key reads false, and with it off every lead screen,
  // lead route and settings page is exactly what it was before this existed.
  // Needs `marketing`.
  marketing_scoring: boolean;
  // Process Design Studio (0152, docs/process-design-studio-architecture.md): a
  // prospect or client describes how they work and gets a cited fit report,
  // proposed changes and a plan. A sold module, set only by a platform admin
  // in /admin/tenants: default OFF, missing key reads false. The demo
  // tenant has it on (scripts/seed-process-studio-demo.sql).
  process_studio: boolean;
  // Newsletter Studio (0141-0143, docs/newsletter-studio-architecture.md):
  // multilingual newsletter designs, templates and versions, handed to the
  // existing campaign send path. A platform-admin-only flag (set in
  // /admin/tenants, never by a workspace admin): default OFF, missing key
  // reads false, and with it off there is no menu item, no route and no
  // change to any campaign page. Needs `marketing`.
  newsletter_studio: boolean;
  // Buying signals (0175-0179, docs/signals-architecture.md): "Who is in
  // market", a ranked, explainable list of accounts built only from first-party
  // events. A platform-admin-only flag (set in /admin/tenants, never by a
  // workspace admin): default OFF, missing key reads false, and with it off
  // there is no menu item, no route and no cron work for the tenant. Needs
  // `marketing`.
  buying_signals: boolean;
  // Forms and the Preference Centre (0170-0172, docs/shells/forms-shell.md):
  // forms hosted on the tenant's own domain and embedded on its website, each
  // submit recording consent and creating the contact and a lead. A
  // platform-admin-only flag (set in /admin/tenants): default OFF, missing key
  // reads false. With it off the public routes answer 404 and there is no menu
  // item. Needs `marketing`.
  marketing_forms: boolean;
  // Account-Based Marketing (0180-0182, docs/abm-architecture.md): programs,
  // target accounts and buying groups as their own object. A platform-admin-
  // only flag (set in /admin/tenants, never by a workspace admin): default
  // OFF, missing key reads false, and with it off there is no menu item, no
  // route and no card on any other screen. Needs `marketing`.
  abm: boolean;
  // Journeys (0165-0169, docs/shells/journeys-shell.md): automated follow-ups
  // that start from an event and run over days. A platform-admin-only flag:
  // default OFF, missing key reads false; with it off there is no menu item,
  // no route and no runner work for the workspace. Needs `marketing`.
  journeys: boolean;
  // WhatsApp marketing (0185-0188, docs/shells/whatsapp-shell.md): approved
  // templates, a consent-gated send, an inbound webhook and a journey step. A
  // platform-admin-only flag: default OFF, missing key reads false; with it off
  // there is no menu item, no route, no webhook and no journey step. Needs
  // `marketing`.
  whatsapp_marketing: boolean;
  // Attribution (0190-0192, docs/shells/attribution-shell.md): "Revenue by
  // campaign", the deals and revenue each campaign, newsletter, form, journey,
  // WhatsApp template and event started or touched, by first touch, last touch
  // or linear. Read-only on the data it reads. A platform-admin-only flag:
  // default OFF, missing key reads false; with it off there is no menu item,
  // no route and no cron work for the workspace. Needs `marketing`.
  marketing_attribution: boolean;
  // Marketing events (0195-0196, docs/shells/events-shell.md): webinars, shows,
  // roadshows and site visits, registration through an existing Form, check-in
  // by staff, a results panel and a follow-up journey for attendees or
  // no-shows. A platform-admin-only flag: default OFF, missing key reads false;
  // with it off there is no menu item, no route and no hook on any form. Needs
  // `marketing` and `marketing_forms`.
  marketing_events: boolean;
  // Integration middleware (docs/design/integration-middleware.md): one page for
  // everything about sync -- connections, what goes out when a Standard Quote is
  // awarded or rejected, mapping, the message monitor, resync. A platform-admin-
  // only flag (set in /admin/tenants, never by a workspace admin): default OFF,
  // missing key reads false; with it off nothing changes for the workspace -- no
  // menu item, no route, no logging, no event dispatch.
  integration_middleware: boolean;
  // Webhooks library (docs/design/webhooks-library.md): one list where every webhook
  // is created and kept -- Event webhooks (the change feed) and Call webhooks (fired
  // by a Standard Quote award, a record button or a Coverage route, each a Monitor
  // row). A platform-admin-only flag: default OFF, missing key reads false; with it
  // off the workspace keeps today's Webhooks & push page and sees nothing new.
  webhooks_library: boolean;
  // Assistant actions (docs/design/assistant-smarter.md, section 3): lets the AI assistant propose a new record as a
  // confirm card. Nothing is created until the person presses the button on the card, and the record is made by the
  // object's own create route. A platform-admin-only flag: default OFF, missing key reads false; needs `ai_assistant`
  // and `next_experience`. With it off the assistant has no create tool and POST /api/ai/act answers 403.
  ai_assistant_actions: boolean;
  // Assistant web research (docs/design/assistant-smarter.md section 2): the dock may ask "Do you want me to search the
  // web for this?" and, on a yes, run one isolated search on our key and answer with sources. A platform-admin-only
  // flag: default OFF, missing key reads false; needs ai_assistant. With it off the search tool is not offered.
  ai_assistant_web: boolean;
  // Shared Inbox (0214, docs/design/estimator-unification-and-inbox.md): customer mail arrives on a forwarding address (or
  // is read from the company's own mailbox), is read and answered by a team, and is turned into a Quote, Project, Case,
  // Lead or Estimate with its drawings copied across. A platform-admin-only flag (set in /admin/tenants, never by a
  // workspace admin): default OFF, missing key reads false; with it off there is no menu item, no route, no webhook
  // routing and no polling for the workspace. Mail content is private: there is no v1 API endpoint for it.
  inbox: boolean;
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
  /** Where a login whose account is linked to an ACTIVE employee record
   *  lands after signing in: the KPI dashboard, or straight into My
   *  Workforce for the punch.
   *
   *  Tenant config, not a product-wide rule (owner correction 2026-09-21:
   *  "this is true for only BIM client not for any other tenant including
   *  demo"). It shipped on 2026-09-10 as one answer for every WFM workspace,
   *  which is wrong the moment a workspace has WFM alongside Sales -- an
   *  admin who also happens to have an employee record was sent to the punch
   *  screen instead of their own dashboard.
   *
   *  Applied at LOGIN ONLY, by api/auth/landing. It is deliberately not a
   *  redirect on "/": that is the same key read in two places, and as a
   *  redirect it fired on every single visit -- so an admin who pressed
   *  Dashboard, or landed back on "/" after saving a setting, was bounced
   *  out mid-task (owner, 2026-09-21). A landing page is a thing that
   *  happens once. */
  home_landing: "dashboard" | "my_workforce";
  // Per-event-type email notification toggles. Each fires synchronously
  // from the route that creates the underlying event -- see src/lib/wfm/notify.ts.
  notifications: {
    late_arrival: boolean;             // check-in past shift start+grace -> supervisor
    correction_pending: boolean;       // employee files a correction -> supervisor
    correction_resolved: boolean;      // supervisor approves/rejects it -> employee
    leave_pending: boolean;            // employee files a leave request -> supervisor
    leave_resolved: boolean;           // supervisor approves/rejects it -> employee
    recheck_flagged: boolean;          // supervisor flags a punch/day -> employee
    advance_request_pending: boolean;  // employee files an OT/WFH advance request -> supervisor
    clarification_message: boolean;    // either side posts in a clarification thread -> the other
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
  /** Nudge an employee whose BREAK has run long, on their own phone, so a
   *  forgotten break_end doesn't quietly eat their worked hours (client
   *  request, BIM 2026-09-10: "break notifications, standard + custom").
   *
   *  Standard vs custom is one setting, not two features: leaving
   *  `after_minutes` and `message` alone gives every tenant the same standard
   *  reminder, and a tenant whose breaks are genuinely 45 minutes -- or who
   *  wants to say it in their own words, or their own language -- overrides
   *  either. Blank `message` means the standard wording, never a blank push.
   *
   *  Same delivery constraints as long_day_alert: needs VAPID keys server-side
   *  AND the employee to have tapped "Turn on", so it is off by default rather
   *  than promising something that silently does nothing. */
  break_alert: {
    enabled: boolean;
    after_minutes: number;
    message: string;
  };
  /** A start-of-week push telling employees which holidays fall in the next
   *  seven days (client request, BIM 2026-09-10). Reads the same wfm_holidays
   *  rows the monthly summary and the roster already use, so it can never
   *  announce a holiday the timesheet doesn't honour. One digest per employee
   *  per week, and nothing is sent in a week with no holidays in it. */
  holiday_week_alert: {
    enabled: boolean;
  };
  /** Alternate/6-hour Saturday (owner decision 2026-09-09, BIM): every
   *  Saturday is a short day on `short_shift_id`, EXCEPT the 2nd Saturday of
   *  the month, which is a full holiday. Materialized as real data, not a
   *  live rule baked into the shift resolver -- a monthly generator (cron +
   *  an on-demand button on the Roster page) writes ordinary
   *  wfm_roster_assignments rows for the short Saturdays and an ordinary
   *  wfm_holidays row for the 2nd, additively (never overwrites a row a
   *  supervisor already set). Every existing holiday/roster code path (late/
   *  absence, the employee's holiday calendar, ...) then just works, unchanged.
   *  The 2nd-Saturday punch gate (api/wfm/punch/route.ts) is a live date
   *  check, not dependent on the row existing yet, so it can't be bypassed by
   *  the generator simply not having run. */
  saturday_rule: {
    enabled: boolean;
    short_shift_id: string | null;
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
  home_landing: "dashboard",
  geofence_mode: "flag",
  require_location: false,
  selfie_mode: "shift",
  notifications: {
    late_arrival: false,
    correction_pending: true,
    correction_resolved: true,
    leave_pending: true,
    leave_resolved: true,
    recheck_flagged: true,
    advance_request_pending: true,
    clarification_message: true,
  },
  long_day_alert: { enabled: false, after_hours: 9 },
  break_alert: { enabled: false, after_minutes: 30, message: "" },
  holiday_week_alert: { enabled: false },
  saturday_rule: { enabled: false, short_shift_id: null },
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
/** Topics the dashboard's Business news block searches when a tenant has set
 * none of its own. Lives here rather than in lib/data/news.ts because that
 * module is "server-only" and the Settings screen that edits these is a client
 * component -- both sides have to agree on the default or the placeholder
 * lies about what blank means. */
export const DEFAULT_NEWS_TOPICS = ["business news India", "industrial equipment industry"];
export const DEFAULT_NEWS_TOPICS_LABEL = DEFAULT_NEWS_TOPICS.join(", ");

export type AnalyticsMetricId =
  | "accounts" | "contacts" | "assets" | "open_cases" | "work_orders" | "products"
  | "contracts" | "leads" | "technicians"
  | "accounts_by_type" | "lead_funnel" | "assets_by_kind"
  | "quote_trend" | "case_status" | "work_order_status"
  | "technician_availability" | "revenue_overview"
  | "invoices_by_status" | "loaner_availability" | "recent_activity"
  | "account_news" | "business_news"
  | "quote_outcomes" | "quote_overdue" | "quote_source"
  | "pipeline_open_value"
  | "rfq_open"
  | "estimates_open"
  | "inbox_open"
  | "abm_targets_engaged"
  | "wfm_attendance_today" | "wfm_night_shift_cost"
  | "wfm_corrections_queue" | "wfm_leave_requests_queue" | "wfm_recheck_queue"
  | "wfm_site_headcount" | "wfm_workforce_composition" | "wfm_leave_taken_by_type"
  | "wfm_project_hours" | "wfm_project_budget" | "wfm_project_billing"
  // The signed-in person's own daily briefing (assistant). Not a report metric: it is per person, not per workspace.
  | "my_briefing";

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

/** A tenant's own item type (Settings -> Item types). Custom types never
 *  carry components: only the built-in BOM / kit may (src/lib/products/itemTypes.ts). */
export type CustomItemTypeDef = {
  key: string;
  label: string;
  description?: string;
  stocked: boolean;
  sellable: boolean;
  purchasable: boolean;
};

/** Tenant overrides on the built-in item type list: renames, hidden keys and
 *  added custom types. Absent = the defaults exactly. */
export type TenantItemTypes = {
  labels?: Record<string, string>;
  hidden?: string[];
  custom?: CustomItemTypeDef[];
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

// Opportunity (deal) stages -- Sales Engine Piece B (docs/
// sales-engine-architecture.md §4.1). Same shape as QuoteStatusDef plus a
// probability hint per open stage and the outcome a closed stage implies.
// Tenant-configurable via config.opportunity_stages; these are the
// defaults (owner decision 2026-09-06).
export type OpportunityStageDef = {
  value: string;
  label: string;
  color: string;
  is_initial?: boolean;
  is_closed?: boolean;
  /** 0..100 -- the stored probability while no override/rubric applies. */
  probability_hint?: number;
  /** For a closed stage: the outcome it implies (default won). */
  outcome?: "won" | "lost" | "dropped";
};

export const DEFAULT_OPPORTUNITY_STAGES: OpportunityStageDef[] = [
  { value: "qualify",   label: "Qualify",   color: "#3b82f6", is_initial: true, probability_hint: 20 },
  { value: "propose",   label: "Propose",   color: "#8b5cf6", probability_hint: 50 },
  { value: "negotiate", label: "Negotiate", color: "#f59e0b", probability_hint: 75 },
  { value: "won",       label: "Won",       color: "#10b981", is_closed: true, outcome: "won" },
  { value: "lost",      label: "Lost",      color: "#ef4444", is_closed: true, outcome: "lost" },
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
  // Opportunity (deal) stages for the Pipeline board (0120). Falls back to
  // DEFAULT_OPPORTUNITY_STAGES if absent.
  opportunity_stages?: OpportunityStageDef[];
  // Product category tree, defined by the tenant in Settings -> Sales config.
  // OOB depth is exactly two levels (category -> sub-categories); absent/empty
  // means the product form falls back to free-text category entry.
  product_categories?: ProductCategoryDef[];
  // Item types for products (renames, hidden, custom). Absent = the built-in
  // list; see src/lib/products/itemTypes.ts.
  item_types?: TenantItemTypes;
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
     * "nextgen2" it carries no feature-flag gate -- any tenant can pick it.
     * "spectacular" (owner request 2026-09-19) is nextgen's structure with a
     * softer, bluer, rounder palette taken from an Able Pro dashboard
     * reference -- folds into "nextgen" for behaviour like the two above,
     * with useIsSpectacular() as its structural hook. Light only: a
     * workspace that toggles dark gets nextgen's own dark mode.
     * "spectacular_purple" (owner request 2026-09-20) is the SAME direction
     * in a lilac/violet palette taken from a second reference -- structure,
     * band, filled tiles and every rule are shared; only the hue-carrying
     * tokens differ, so it rides the same useIsSpectacular() hook and the
     * same spectacular_theme flag, distinguished by useSpectacularVariant().
     * Two palettes of one theme, not two themes. */
    ui_theme?: "classic" | "modern" | "nextgen" | "nextgen2" | "enterprise" | "spectacular" | "spectacular_purple";
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
    /** Spectacular's own colours, chosen by the workspace (owner request
     *  2026-09-21: "option to change colors in spectacular theme including
     *  mix colors"). The shell is a two-stop gradient, so `from` and `to`
     *  ARE the mix -- a single hue would have made the shell flat, which is
     *  the one thing the palette was never allowed to be.
     *
     *  Every value is consumed through a CSS custom-property fallback
     *  (`var(--spec-shell-from, #2A1259)`), so an unset or partly-set
     *  workspace renders the shipped violet exactly. Each is rendered into a
     *  raw <style> tag by (app)/layout.tsx and is therefore validated as a
     *  strict #rrggbb hex on the way in, same as nova_accent_color above --
     *  an unvalidated string here is a stored-injection vector. */
    /** Which dashboard a workspace opens on (owner request 2026-09-21: "2
     *  versions of dashboard -- 1. with generic info like the artifact,
     *  2. user can mix and match with adaptation").
     *
     *  "curated" renders a fixed, ordered set of blocks -- the composition
     *  from the design board -- and ignores the saved layout entirely, so it
     *  cannot come up empty or half-configured. "adaptive" is the existing
     *  behaviour: the tenant/role/personal layout, Adapt and My layout.
     *
     *  This is the DEFAULT, not a lock: the dashboard header carries a switch
     *  between the two, and switching does not touch anyone's saved layout --
     *  it is still there when they switch back. Unset resolves to "curated"
     *  on Spectacular (the theme the board was drawn for) and "adaptive"
     *  everywhere else, so no existing workspace's dashboard changes. */
    dashboard_mode?: "curated" | "adaptive";
    spectacular_colors?: {
      shell_from?: string;
      shell_to?: string;
      accent?: string;
    };
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
  // Integration middleware rules and selections (no secrets): which outcomes
  // go to the ERP, automatic or manual, and what fence / estimate data leaves
  // with them. Stored as the admin saved it; read through parseRules().
  integration_middleware?: import("@/lib/middleware/types").StoredMiddlewareConfig;
  // Webhooks library: the record buttons (object type -> the id of the Call webhook
  // it sends to). The id is tenant-verified when written and again when fired.
  webhooks_library?: { record_buttons?: { accounts?: string | null } };
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
  /** Dashboard blocks that carry their own content rather than the tenant's
   * data (owner request 2026-09-20: "if the client is not using the system
   * there is no data to represent"). Both default OFF and are set by a
   * WORKSPACE ADMIN for everyone -- the owner's call over per-user blocks or
   * blocks that vanish once real data arrives, so what the team sees on the
   * dashboard stays one decision rather than drifting per person.
   *
   * When on, the block is forced visible in the resolved layout even if a
   * saved layout has it hidden; that is what "always on" means here. It can
   * still be reordered and resized like any other block. */
  dashboard_extras?: {
    /** Topic-based headlines. Has content on day one, unlike account_news,
     * which needs accounts to search on. */
    business_news?: boolean;
    /** Rotating product tips (src/lib/dashboardTips.ts). */
    product_tips?: boolean;
    /** Search terms for business_news. Empty/absent uses
     * DEFAULT_NEWS_TOPICS. Max 4 are fetched. */
    news_topics?: string[];
  };
  // Email output channel (owner requirement 2026-09-06, modelled on SAP C4C's
  // Email and Fax Settings). "partners" sends to the address on the account,
  // contact or employee record; "redirect" sends EVERY outbound email from
  // any transaction to the one address here instead, subject-tagged with the
  // intended recipient. A demo workspace (tenants.is_demo) is always in
  // redirect mode regardless of this value -- see src/lib/emailOutput.ts --
  // so no test document can ever reach a real customer. Absent = partners.
  email_output?: EmailOutputConfig;
  // Currency every money figure is shown, printed and emailed in
  // (src/lib/currency.ts). Absent = INR, exactly what every tenant saw before
  // the setting existed. Set in Settings → Currency (admin).
  currency?: CurrencyCode;
  // BPMSquare Pricing (docs/pricing-engine-architecture.md §17). Absent keys
  // read as the defaults in src/lib/pricing/documents.ts.
  pricing?: PricingConfig;
  // RFQ (0128, docs/rfq-architecture.md). Absent keys read as RFQ_DEFAULTS
  // in src/lib/rfq/types.ts.
  rfq?: RfqConfig;
  // Marketing platform (docs/marketing-platform-architecture.md 10). Absent
  // keys read as the defaults in src/lib/marketing/config.ts.
  marketing?: MarketingConfig;
  // WhatsApp marketing (docs/shells/whatsapp-shell.md). Nothing secret lives
  // here: credentials are encrypted on whatsapp_identities (0186). On a demo
  // workspace a send goes to redirect_number, or is logged as a dry run.
  whatsapp?: { redirect_number?: string; weekly_cap?: number };
  // Process Design Studio allowance (docs/process-design-studio-architecture.md
  // section 6.3), set by a platform admin on the tenant page. Absent keys read as
  // the defaults in src/lib/studio/caps.ts.
  process_studio?: ProcessStudioConfig;
  // Newsletter Studio brand kit (docs/newsletter-studio-architecture.md 2.2),
  // validated by src/lib/newsletter/brandKit.ts. Absent = derived defaults.
  brand_kit?: BrandKit;
  // Newsletter Studio AI allowance, set by a platform admin like process_studio's.
  newsletter_studio?: { monthly_token_budget?: number };
  // The in-app assistant's monthly allowance (docs/nova-assistant-architecture.md section 6). Read since S1;
  // the platform-admin field that writes it arrives with S4, until then absent = DEFAULT_MONTHLY_TOKEN_BUDGET.
  ai_assistant?: {
    monthly_token_budget?: number;
    // The workspace's own policy: true keeps every call that leaves for the internet (web research) switched off,
    // whatever the platform flag says.
    block_external_calls?: boolean;
  };
  // Company analysis (docs/design/account-analysis.md 4): the daily ceiling on web analyses for the whole workspace,
  // the fit rubric's weights and the workspace's own size band in staff. Absent keys read as the defaults in
  // src/lib/analysis/budget.ts and fit.ts.
  company_analysis?: {
    daily_limit?: number;
    fit_weights?: Partial<Record<"industry" | "coverage" | "size" | "topic" | "customer" | "notInMarket" | "risk", number>>;
    size_band?: { min?: number; max?: number };
  };
};

/** A topic a person can agree to or refuse separately ("Offers", "Events"). */
export type MarketingTopic = {
  /** Stable key stored in the consent ledger. Never reused for another meaning. */
  key: string;
  label: string;
  /** One plain line saying what the topic covers. */
  hint: string;
};

export type MarketingConfig = {
  /** The topics offered. Absent = the four defaults. */
  topics?: MarketingTopic[];
  /**
   * What applies to a person with no ledger entry, per jurisdiction.
   * Absent or missing a key = "consent_required" (strict). The owner has not
   * chosen a permissive default for any jurisdiction; only an admin can.
   */
  consent_defaults?: Partial<Record<"SA" | "AE" | "QA" | "KW" | "OM" | "BH" | "IN" | "EU" | "other", "consent_required" | "existing_customer">>;
  /** The lead-scoring rubric (src/lib/marketing/scoring.ts). Absent = DEFAULT_RUBRIC. */
  scoring?: ScoringRubric;
  /**
   * Whether a newsletter carries an open-tracking pixel. Absent or false = no
   * pixel in the HTML at all (owner decision 2026-10-19: opens are unreliable
   * and need a lawful basis in the Gulf; clicks are tracked, opens are not).
   */
  track_opens?: boolean;
  /**
   * How fast a salesperson must pick up a lead that is ready for sales.
   * Absent = one working day, Sunday off (src/lib/marketing/leads/timing.ts).
   * `weekly_off` is 0 = Sunday ... 6 = Saturday.
   */
  lifecycle?: {
    sla_business_days?: number;
    weekly_off?: number[];
    /** Create a lead by itself when a person with no open lead reaches the Engaged (Warm) band. Absent or false = off. */
    auto_create_leads?: boolean;
    /** People (user ids) handed a ready lead, in turn, when Coverage matches nothing. Absent or empty = the oldest admin. */
    fallback_user_ids?: string[];
    /** Who hears about an overdue lead, in the Nova inbox. Absent = nobody. */
    overdue_notify?: { owner?: boolean; team_lead?: boolean };
  };
  /**
   * Where this workspace is based. Decides the default of "Ask the person to confirm by email" on a form
   * (on for the EU, off elsewhere); a form can always override it.
   */
  consent?: { jurisdiction?: "SA" | "AE" | "QA" | "KW" | "OM" | "BH" | "IN" | "EU" | "other" };
  /** Journey safety limits (src/lib/marketing/journeys/safety.ts). Absent keys read as the defaults there. */
  journey_limits?: {
    /** Most journey emails one person gets in a day. Default 1. */
    max_per_day?: number;
    /** Local hour sending stops and starts again. Defaults 20 and 8. */
    quiet_from_hour?: number;
    quiet_to_hour?: number;
    /** 0 = Sunday ... 6 = Saturday. Default [5] (Friday). */
    off_weekdays?: number[];
    /** An open case older than this many days pauses promotional steps. Default 30. */
    trouble_case_days?: number;
    /** Turning a journey on that would enrol more people than this asks first. Default 200. */
    blast_radius?: number;
  };
};

/** The Newsletter Studio brand kit (docs/newsletter-studio-architecture.md 2.2): set once by an admin, used by every design. */
export type BrandKit = {
  /** Public image URL; absent = the workspace logo (tenants.logo_url). */
  logo_url?: string;
  /** Strict #rrggbb. */
  primary?: string;
  secondary?: string;
  text?: string;
  /** Key of an email-safe font pairing (src/lib/newsletter/types.ts FONT_PAIRINGS). */
  font_pairing?: string;
  /** Footer address lines, one per line. */
  footer_address?: string;
  social_links?: { label: string; url: string }[];
  /** Spoken tone used by AI drafts and translations. */
  tone?: "formal" | "warm";
};

export type ProcessStudioConfig = {
  /** Client messages one study may hold before the chat stops (default 40). */
  max_messages_per_study?: number;
  /** AI tokens (input + output) this workspace may use per calendar month across studies. */
  monthly_token_budget?: number;
};

export type RfqMailMode = "platform" | "mailbox";
export type RfqConfig = {
  /** How RFQ email travels. "platform": BPMSquare's own sender, and replies
   *  come back to a signed reply-to address on the inbound domain.
   *  "mailbox": the tenant's own mailbox (the Gmail or Mail server connector)
   *  -- sent over SMTP, replies read from its inbox by the poller. */
  mail_mode?: RfqMailMode;
  /** Which connected mailbox "mailbox" mode uses: "gmail" or "mail_server". */
  mailbox_connector?: "gmail" | "mail_server";
  /** Days a supplier gets to reply; sets respond_by on a new RFQ. */
  default_response_days?: number;
  /** Reminders before/after respond_by, at most this many per supplier. */
  max_reminders?: number;
  /** Days the reply link keeps working after respond_by. */
  link_grace_days?: number;
  /** Text printed under the line table on every RFQ to suppliers. */
  terms?: string;
  /** Attach the printable RFQ (PDF) to each request email. Default on. */
  attach_pdf?: boolean;
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
  /** Whether the quote-line pricing trace shows the actual rate/formula and
   *  the values it was evaluated against (e.g. "610 x 500 = 3,05,000"), not
   *  just which rule matched. Absent/undefined reads as ON -- explainability
   *  is the trust-building default; a tenant turns it off only if the extra
   *  detail is noise for their reps. Test & Trace (the admin/config tool)
   *  always shows full detail regardless of this flag. */
  trace_detail?: boolean;
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
