import type { AnalyticsMetricId, TenantFeatures } from "@/lib/constants";

/**
 * ANALYTICS_META / isAnalyticsId used to live in DashboardLayout.tsx (a
 * "use client" file). That worked for client callers (NovaStream,
 * NovaAdaptDrawer) but broke at runtime for server callers -- page.tsx and
 * lib/nova/streamLayout.ts both call isAnalyticsId() as a plain function,
 * and Next's RSC runtime turns every export of a "use client" module into
 * a client reference that can only be RENDERED, not invoked directly, from
 * server code ("Attempted to call isAnalyticsId() from the server but
 * isAnalyticsId is on the client" -- the exact crash this file fixes).
 * `tsc`/`next build` don't catch this; it only surfaces at request time.
 *
 * This file has no "use client" and no JSX, so it's safe to import from
 * both sides of the boundary. renderWidget() stays in DashboardLayout.tsx
 * (it returns JSX built from client-only pieces) -- only the plain
 * data/logic moved here.
 */
export const ANALYTICS_META: Record<AnalyticsMetricId, { label: string; feature?: keyof TenantFeatures }> = {
  // Core-module widgets carry their module's 0067 flag -- previously only
  // the optional-module widgets (amc/leads/invoices/wfm) were gated.
  accounts:                { label: "Accounts",         feature: "accounts" },
  contacts:                { label: "Contacts",         feature: "contacts" },
  assets:                  { label: "Assets",           feature: "assets" },
  products:                { label: "Products",         feature: "products" },
  open_cases:              { label: "Open cases",       feature: "cases" },
  work_orders:             { label: "Work orders",      feature: "work_orders" },
  contracts:               { label: "AMC contracts",    feature: "amc" },
  leads:                   { label: "Leads",            feature: "leads" },
  technicians:             { label: "Technicians",      feature: "technicians" },
  accounts_by_type:        { label: "Accounts by type", feature: "accounts" },
  lead_funnel:             { label: "Lead funnel",      feature: "leads" },
  assets_by_kind:          { label: "Assets by kind",   feature: "assets" },
  quote_trend:             { label: "Quote pipeline",   feature: "quotations" },
  case_status:             { label: "Case status",      feature: "cases" },
  work_order_status:       { label: "Work order status", feature: "work_orders" },
  technician_availability: { label: "Technician availability", feature: "technicians" },
  revenue_overview:        { label: "Revenue overview", feature: "invoices" },
  invoices_by_status:      { label: "Invoices by status", feature: "invoices" },
  loaner_availability:     { label: "Loaner availability", feature: "assets" },
  recent_activity:         { label: "Recent activity (analytics)" },
  account_news:            { label: "Client news",      feature: "accounts" },
  quote_outcomes:          { label: "Quote won/lost value", feature: "quotations" },
  quote_overdue:           { label: "Quote overdue",    feature: "quotations" },
  quote_source:            { label: "Quote source (cases vs standalone)", feature: "quotations" },
  wfm_attendance_today:    { label: "Attendance by site (today)", feature: "wfm" },
  wfm_night_shift_cost:    { label: "Night shift cost (today)",   feature: "wfm" },
  wfm_corrections_queue:    { label: "Corrections queue",          feature: "wfm" },
  wfm_leave_requests_queue: { label: "Leave requests queue",       feature: "wfm" },
  wfm_recheck_queue:        { label: "Recheck requests queue",     feature: "wfm" },
  wfm_site_headcount:       { label: "Headcount by site",          feature: "wfm" },
  wfm_workforce_composition:{ label: "Workforce composition",      feature: "wfm" },
  wfm_leave_taken_by_type:  { label: "Leave taken by type (YTD)",  feature: "wfm" },
};

export function isAnalyticsId(id: string): id is AnalyticsMetricId {
  return id in ANALYTICS_META;
}
