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
  reports: "/reports",
  admin: "/admin",
  adminTenant: (id: string) => `/admin/tenants/${id}`,
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
      { label: "Pipeline",  href: ROUTES.pipeline,  icon: "▦", pillar: "blue" },
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
      { label: "Assets",    href: ROUTES.assets,    icon: "⚙", pillar: "green" },
      { label: "Invoices",  href: ROUTES.invoices,  icon: "⊟", pillar: "green", featureKey: "invoices" },
      { label: "Analytics", href: ROUTES.reports,   icon: "◫", pillar: "purple" },
    ],
  },
];

// ── Quote type registry ───────────────────────────────────────────────────────
// Add a new entry here to register a new quote type. No DB change needed.
// When the form for that type is built, set `available: true`.

export const QUOTE_TYPES = [
  {
    id:          "repair",
    label:       "Repair Quotation",
    description: "Labour, materials, testing & transport for motor / transformer repair",
    icon:        "⚙",
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

export const MOBILE_BREAKPOINT = 780;
export const WORKSPACE_NAME = "Vikas Pioneers workspace";

// Company details — used in PDF headers and footers.
export const COMPANY = {
  name: "VIKAS PIONEERS [INDIA] PVT. LTD.",
  shortName: "Vikas Pioneers",
  tagline: "Professional in Motor Rewindings",
  undertaking: "Rewinding of LT / HT Large Motors · Drives Application Motors · DC Motors · Transformers & Hydro Gensets",
  address: "Plot No: N3-N4/1, Industrial Estate, Dam Road, Hosapete - 583201, Vijayanagara (Dist), Karnataka.",
  phone_dir_tech: "9342681227 / 9538884600",
  phone_commercial: "9538884603",
  phone_work: "9538884602",
  landline: "08394-231687",
  email: "vikaspioneers@gmail.com",
  email2: "vew@vikaspioneers.com",
  web: "www.vikaspioneers.com",
  gstin: "29AHHPG0831F1ZN",
  iso: "ISO 9001:2015",
  partners: "ABB · WEG · SIEMENS · Kirloskar · Jyoti Ltd. · Marathon",
  footer_tagline: "Assuring our best services as always!",
} as const;
