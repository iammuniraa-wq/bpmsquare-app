// VeveyCRM constants — routes + navigation IA. Single source of truth.
// IA follows the customer journey (pillars), per PROJECT.md §4.

import type { PillarKey } from "./theme";

export const ROUTES = {
  login: "/login",
  pipeline: "/",
  dashboard: "/dashboard",
  leads: "/leads",
  partners: "/partners",
  quotations: "/quotations",
  cases: "/cases",
  amc: "/amc",
  workOrders: "/work-orders",
  dispatch: "/dispatch",
  technicians: "/technicians",
  accounts: "/accounts",
  account: (id: string) => `/accounts/${id}`,
  assets: "/assets",
  invoices: "/invoices",
} as const;

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: number;
  pillar: PillarKey;
};

export type NavGroup = { group: string; items: NavItem[] };

// Grouped sidebar — mirrors the prototype, organised by journey pillar.
export const NAV: NavGroup[] = [
  {
    group: "WORKSPACE",
    items: [
      { label: "Pipeline", href: ROUTES.pipeline, icon: "▦", pillar: "blue" },
      { label: "Dashboard", href: ROUTES.dashboard, icon: "◴", pillar: "blue" },
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
      { label: "Quotations", href: ROUTES.quotations, icon: "₹", pillar: "blue", badge: 8 },
    ],
  },
  {
    group: "SERVICE",
    items: [
      { label: "Cases", href: ROUTES.cases, icon: "☎", pillar: "teal", badge: 3 },
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
      { label: "Accounts", href: ROUTES.accounts, icon: "▣", pillar: "green" },
      { label: "Assets", href: ROUTES.assets, icon: "⚙", pillar: "green" },
      { label: "Invoices", href: ROUTES.invoices, icon: "⊟", pillar: "green" },
    ],
  },
];

export const MOBILE_BREAKPOINT = 780;
export const WORKSPACE_NAME = "Vikas Pioneers workspace";
