// Canonical workcenter list -- shared between server (src/lib/permissions.ts)
// and client (Business Roles editor UI, Sidebar filtering) code, so it has
// no "server-only" restriction unlike permissions.ts itself.

export type WorkcenterKey =
  | "dashboard" | "accounts" | "contacts" | "quotations" | "standard_quotes" | "pipeline" | "invoices"
  | "cases" | "amc" | "work_orders" | "dispatch" | "technicians"
  | "marketing" | "marketing_segments" | "leads" | "partners"
  | "assets" | "suppliers" | "inventory" | "purchase_orders" | "employees"
  | "reports" | "data_workbench" | "administration" | "wfm" | "products" | "pricing";

export const WORKCENTERS: { key: WorkcenterKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "accounts", label: "Accounts" },
  { key: "contacts", label: "Contacts" },
  { key: "quotations", label: "Quotations" },
  { key: "standard_quotes", label: "Standard Quotes" },
  { key: "pipeline", label: "Pipeline" },
  { key: "invoices", label: "Invoices" },
  { key: "cases", label: "Cases" },
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
  { key: "products", label: "Products" },
  { key: "purchase_orders", label: "Purchase Orders" },
  { key: "employees", label: "Employees" },
  { key: "wfm", label: "Workforce" },
  { key: "reports", label: "Analytics" },
  { key: "data_workbench", label: "Data Workbench" },
  { key: "administration", label: "Audit & Users" },
  { key: "pricing", label: "Pricing" },
];

/** "all" = unrestricted (admins, and members with no Business Role
 * assigned); otherwise the explicit list of workcenters a member's
 * assigned Business Roles grant view access to. Shared client/server type
 * -- kept out of permissions.ts (which is "server-only") so client
 * components (Sidebar, TenantProvider) can import it directly. */
export type ViewableWorkcenters = "all" | WorkcenterKey[];
