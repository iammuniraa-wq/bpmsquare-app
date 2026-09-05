// The standard Business Role catalog: a User and an Admin role for each
// product category (Sales / Service / Marketing / WFM).
//
// This is deliberately a CODE catalog rather than seeded database rows --
// see BUSINESS_ROLES_STANDARD_MAP.md §2. Rows are materialised per tenant on
// demand (provisionStandardRoles, server-side), keyed by `template_key`, so a
// new tenant always gets the current catalog with no backfill migration, and
// adding a workcenter later means editing exactly this file.
//
// Client-safe (no server imports) so the Roles editor UI can render the
// catalog's category grouping directly.

import type { WorkcenterKey } from "./workcenters";
import type { DashLayoutItem } from "./constants";

export type StandardRoleCategory = "sales" | "service" | "marketing" | "wfm";
export type StandardRoleLevel = "user" | "admin";

/** Compact CRUD notation used by the table below: v=view c=create e=edit d=delete. */
type Crud = "v" | "vc" | "vce" | "vced";

export type StandardRoleTemplate = {
  /** Stable identity of this catalog entry -- NEVER change once shipped;
   * it's what business_roles.template_key matches on. */
  key: string;
  category: StandardRoleCategory;
  level: StandardRoleLevel;
  name: string;
  description: string;
  grants: Partial<Record<WorkcenterKey, Crud>>;
  /** Seeded onto business_roles.dashboard_layout when this template is first
   * provisioned for a tenant -- the default dashboard everyone holding this
   * role sees (unioned with any other role they also hold that defines
   * one), until they personalize it further. Omit for a template that
   * shouldn't define one (most don't -- the tenant-wide default applies). */
  dashboardLayout?: DashLayoutItem[];
};

export const STANDARD_ROLE_CATEGORIES: { key: StandardRoleCategory; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "service", label: "Service" },
  { key: "marketing", label: "Marketing" },
  { key: "wfm", label: "Workforce" },
];

// `administration` and `data_workbench` appear in NO standard role, by
// decision (2026-08-06): they are tenant-wide superuser surfaces, and a
// tenant_users.role of "admin" already bypasses Business Roles entirely.
export const STANDARD_ROLES: StandardRoleTemplate[] = [
  {
    key: "sales_user",
    category: "sales",
    level: "user",
    name: "Sales User",
    description: "Works accounts, contacts, quotes and the pipeline. Cannot delete records.",
    grants: {
      dashboard: "v",
      accounts: "vce", contacts: "vce",
      quotations: "vce", standard_quotes: "vce", pipeline: "v", invoices: "v",
      leads: "v",
    },
  },
  {
    key: "sales_admin",
    category: "sales",
    level: "admin",
    name: "Sales Admin",
    description: "Full sales access including deletes, invoicing and analytics.",
    grants: {
      dashboard: "v",
      accounts: "vced", contacts: "vced",
      quotations: "vced", standard_quotes: "vced", pipeline: "v", invoices: "vced",
      leads: "vce", partners: "v", assets: "v", cases: "v",
      reports: "v",
    },
  },
  {
    key: "service_user",
    category: "service",
    level: "user",
    name: "Service User",
    description: "Handles cases, work orders and dispatch. Read-only on customer records.",
    grants: {
      dashboard: "v",
      accounts: "v", contacts: "v",
      cases: "vce", work_orders: "vce", dispatch: "vce",
      amc: "v", technicians: "v", assets: "vce", suppliers: "v", inventory: "v",
    },
  },
  {
    key: "service_admin",
    category: "service",
    level: "admin",
    name: "Service Admin",
    description: "Full service desk: cases, AMC, work orders, technicians, parts and analytics.",
    grants: {
      dashboard: "v",
      accounts: "vce", contacts: "vce",
      cases: "vced", work_orders: "vced", dispatch: "vced", amc: "vced",
      technicians: "vced", assets: "vced", suppliers: "vced", inventory: "vced",
      purchase_orders: "vced", invoices: "vce", quotations: "v",
      employees: "v", wfm: "v",
      reports: "v",
    },
  },
  {
    key: "marketing_user",
    category: "marketing",
    level: "user",
    name: "Marketing User",
    description: "Runs campaigns, segments and leads. Read-only on accounts.",
    grants: {
      dashboard: "v",
      accounts: "v", contacts: "vce",
      marketing: "vce", marketing_segments: "vce", leads: "vce", partners: "vce",
    },
  },
  {
    key: "marketing_admin",
    category: "marketing",
    level: "admin",
    name: "Marketing Admin",
    description: "Full marketing suite including deletes, partners and analytics.",
    grants: {
      dashboard: "v",
      accounts: "vce", contacts: "vced",
      marketing: "vced", marketing_segments: "vced", leads: "vced", partners: "vced",
      pipeline: "v", reports: "v",
    },
  },
  {
    key: "wfm_user",
    category: "wfm",
    level: "user",
    name: "WFM User",
    description: "Punch in and out, own timesheet, leave requests. No other CRM access.",
    grants: {
      dashboard: "v",
      wfm: "v",
    },
  },
  {
    key: "wfm_admin",
    category: "wfm",
    level: "admin",
    name: "WFM Admin",
    description: "Live board, attendance corrections, leave and the monthly summary.",
    // NOT "employees" -- WFM's own Employees hub (/wfm/employees) and its
    // create/edit API are gated purely by requireWfmSupervisor(), never the
    // "employees" workcenter. That grant would only unlock the SEPARATE
    // generic Master Data > Employees page (requireWorkcenterView(
    // "employees")), which is redundant with the dedicated WFM hub for a
    // role scoped to Workforce administration -- fixed 2026-08-11.
    grants: {
      dashboard: "v",
      wfm: "vced",
      reports: "v",
    },
    dashboardLayout: [
      { id: "overview_strip" },
      { id: "wfm_attendance_today" },
      { id: "wfm_corrections_queue" },
      { id: "wfm_leave_requests_queue" },
      { id: "wfm_site_headcount" },
      { id: "wfm_workforce_composition", size: "half" },
      { id: "wfm_night_shift_cost", size: "compact" },
      // Project costing widgets follow their own feature flag at render
      // time, so a role layout can list them safely for a tenant without it.
      { id: "wfm_project_hours" },
      { id: "wfm_project_billing", size: "compact" },
    ],
  },
];

export function expandCrud(crud: Crud) {
  return {
    can_view: true,
    can_create: crud.includes("c"),
    can_edit: crud.includes("e"),
    can_delete: crud.includes("d"),
  };
}

export const STANDARD_ROLE_BY_KEY = new Map(STANDARD_ROLES.map((r) => [r.key, r]));
