// Canonical workcenter list -- shared between server (src/lib/permissions.ts)
// and client (Business Roles editor UI, Sidebar filtering) code, so it has
// no "server-only" restriction unlike permissions.ts itself.

export type WorkcenterKey =
  | "dashboard" | "accounts" | "contacts" | "quotations" | "standard_quotes" | "pipeline" | "invoices"
  | "cases" | "amc" | "work_orders" | "dispatch" | "technicians"
  | "marketing" | "marketing_segments" | "leads" | "partners"
  | "assets" | "suppliers" | "inventory" | "purchase_orders" | "employees"
  | "reports" | "data_workbench" | "administration" | "wfm";

/**
 * territoryScopable marks the workcenters backed by an object that actually
 * has a `territory` column (accounts, contacts, quotes, service_cases) --
 * the only ones a 'territory' data_scope grant can mean anything for.
 * Territory-scoped row filtering itself is Phase 2 (not wired into any
 * query yet); Phase 1 only lets a role be configured with it.
 */
export const WORKCENTERS: { key: WorkcenterKey; label: string; territoryScopable?: boolean }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "accounts", label: "Accounts", territoryScopable: true },
  { key: "contacts", label: "Contacts", territoryScopable: true },
  { key: "quotations", label: "Quotations", territoryScopable: true },
  { key: "standard_quotes", label: "Standard Quotes" },
  { key: "pipeline", label: "Pipeline" },
  { key: "invoices", label: "Invoices" },
  { key: "cases", label: "Cases", territoryScopable: true },
  { key: "amc", label: "AMC Contracts" },
  { key: "work_orders", label: "Work Orders" },
  { key: "dispatch", label: "Dispatch" },
  { key: "technicians", label: "Technicians" },
  { key: "marketing", label: "Marketing Campaigns" },
  { key: "marketing_segments", label: "Segmentation" },
  { key: "leads", label: "Leads" },
  { key: "partners", label: "Partners" },
  { key: "assets", label: "Assets" },
  { key: "suppliers", label: "Suppliers" },
  { key: "inventory", label: "Inventory" },
  { key: "purchase_orders", label: "Purchase Orders" },
  { key: "employees", label: "Employees" },
  { key: "wfm", label: "Workforce" },
  { key: "reports", label: "Analytics" },
  { key: "data_workbench", label: "Data Workbench" },
  { key: "administration", label: "Administrator" },
];

/** "all" = unrestricted (admins, and members with no Business Role
 * assigned); otherwise the explicit list of workcenters a member's
 * assigned Business Roles grant view access to. Shared client/server type
 * -- kept out of permissions.ts (which is "server-only") so client
 * components (Sidebar, TenantProvider) can import it directly. */
export type ViewableWorkcenters = "all" | WorkcenterKey[];
