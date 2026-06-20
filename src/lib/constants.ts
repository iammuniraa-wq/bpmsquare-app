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
  cases: "/cases",
  amc: "/amc",
  workOrders: "/work-orders",
  workOrder: (id: string) => `/work-orders/${id}`,
  dispatch: "/dispatch",
  technicians: "/technicians",
  technician: (id: string) => `/technicians/${id}`,
  accounts: "/accounts",
  account: (id: string) => `/accounts/${id}`,
  contacts: "/contacts",
  assets: "/assets",
  invoices: "/invoices",
  case: (id: string) => `/cases/${id}`,
  settings: "/settings",
  reports: "/reports",
} as const;

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: number;
  pillar: PillarKey;
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
      { label: "Leads", href: ROUTES.leads, icon: "✦", pillar: "purple", badge: 12 },
      { label: "Partners", href: ROUTES.partners, icon: "⌂", pillar: "purple" },
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
      { label: "AMC contracts", href: ROUTES.amc, icon: "▥", pillar: "teal" },
    ],
  },
  {
    group: "FIELD SERVICE",
    items: [
      { label: "Work orders", href: ROUTES.workOrders, icon: "▤", pillar: "amber" },
      { label: "Dispatch", href: ROUTES.dispatch, icon: "◷", pillar: "amber" },
      { label: "Technicians", href: ROUTES.technicians, icon: "◍", pillar: "amber" },
    ],
  },
  {
    group: "RECORDS",
    items: [
      { label: "Assets",    href: ROUTES.assets,    icon: "⚙", pillar: "green" },
      { label: "Invoices",  href: ROUTES.invoices,  icon: "⊟", pillar: "green" },
      { label: "Analytics", href: ROUTES.reports,   icon: "◫", pillar: "purple" },
    ],
  },
];

export const MOBILE_BREAKPOINT = 780;
export const WORKSPACE_NAME = "Vikas Pioneers workspace";

// Company details — used in PDF headers and footers.
export const COMPANY = {
  name: "Vikas Pioneers India Pvt Ltd",
  shortName: "Vikas Pioneers",
  tagline: "Authorised Service Centre — Crompton Greaves · Marathon Electric · Rotomotive",
  address: "Industrial Area, Hosapete — 583 201, Karnataka, India",
  phone: "+91 8394 220 145",
  email: "service@vikaspioneers.com",
  gstin: "29AABCV1234K1ZX",
  pan: "AABCV1234K",
} as const;
