// VeveyCRM constants — routes + navigation IA. Single source of truth.
// IA follows the customer journey (pillars), per PROJECT.md §4.

import type { PillarKey } from "./theme";

export const ROUTES = {
  login: "/login",
  pipeline: "/pipeline",
  dashboard: "/",
  leads: "/leads",
  partners: "/partners",
  quotations: "/quotations",
  quotation: (id: string) => `/quotations/${id}`,
  quotationNew: "/quotations/new",
  quotationPrint: (id: string) => `/quotations/${id}/print`,
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
  case: (id: string) => `/cases/${id}`,
  settings: "/settings",
  settingsTeam: "/settings/team",
  settingsEntities: "/settings/entities",
  reports: "/reports",
  admin: "/admin",
  adminTenant: (id: string) => `/admin/tenants/${id}`,
  suppliers: "/suppliers",
  supplierNew: "/suppliers/new",
  supplier: (id: string) => `/suppliers/${id}`,
  dataWorkbench: "/data-workbench",
} as const;

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: number;
  pillar: PillarKey;
  /** If set, item is hidden unless the tenant has this feature enabled. */
  featureKey?: string;
};

export type NavGroup = { group: string; items: NavItem[] };

// Grouped sidebar — Accounts at the top (the hub everything points to).
export const NAV: NavGroup[] = [
  {
    group: "WORKSPACE",
    items: [
      { label: "Dashboard", href: ROUTES.dashboard, icon: "◴", pillar: "blue" },
      { label: "Accounts",  href: ROUTES.accounts,  icon: "▣", pillar: "blue" },
      { label: "Contacts",  href: ROUTES.contacts,  icon: "◉", pillar: "blue" },
      { label: "Cases",     href: ROUTES.cases,     icon: "☎", pillar: "teal", badge: 3 },
      { label: "Pipeline",  href: ROUTES.pipeline,  icon: "▦", pillar: "blue", featureKey: "pipeline" },
    ],
  },
  {
    group: "MARKETING",
    items: [
      { label: "Leads", href: ROUTES.leads, icon: "✦", pillar: "purple", badge: 12, featureKey: "leads" },
      { label: "Partners", href: ROUTES.partners, icon: "⌂", pillar: "purple", featureKey: "partners" },
    ],
  },
  {
    group: "SALES",
    items: [
      { label: "Quotations",     href: ROUTES.quotations,    icon: "₹", pillar: "blue", badge: 8 },
    ],
  },
  {
    group: "SERVICE",
    items: [
      { label: "AMC contracts", href: ROUTES.amc, icon: "▥", pillar: "teal", featureKey: "amc" },
    ],
  },
  {
    group: "FIELD SERVICE",
    items: [
      { label: "Work orders", href: ROUTES.workOrders, icon: "▤", pillar: "amber" },
      { label: "Dispatch", href: ROUTES.dispatch, icon: "◷", pillar: "amber", featureKey: "dispatch" },
      { label: "Technicians", href: ROUTES.technicians, icon: "◍", pillar: "amber" },
    ],
  },
  {
    group: "RECORDS",
    items: [
      { label: "Assets",     href: ROUTES.assets,     icon: "⚙", pillar: "green" },
      { label: "Suppliers",  href: ROUTES.suppliers,  icon: "◫", pillar: "green" },
      { label: "Invoices",   href: ROUTES.invoices,   icon: "⊟", pillar: "green", featureKey: "invoices" },
      { label: "Analytics",  href: ROUTES.reports,    icon: "◫", pillar: "purple" },
    ],
  },
  {
    group: "ADMIN",
    items: [
      { label: "Data Workbench", href: ROUTES.dataWorkbench, icon: "⇅", pillar: "teal" },
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

export const UOM_OPTIONS = ["Nos", "Job", "Set", "Mtr", "Kg", "Ltr", "Box", "Pair", "Lot"] as const;

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

export const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft:    "Draft",
  sent:     "Sent",
  approved: "Approved",
  rejected: "Rejected",
};

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

// TenantConfig — full shape of tenants.config JSONB column.
export type TenantConfig = {
  entities: TenantEntity[];
  tax: TenantTaxConfig;
  // Which quote types are shown in the New Quotation picker. Omitted key = visible.
  quote_type_visibility?: Partial<Record<QuoteTypeId, boolean>>;
};
