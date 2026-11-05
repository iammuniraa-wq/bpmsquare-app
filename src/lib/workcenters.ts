// Canonical workcenter list -- shared between server (src/lib/permissions.ts)
// and client (Business Roles editor UI, Sidebar filtering) code, so it has
// no "server-only" restriction unlike permissions.ts itself.

export type WorkcenterKey =
  | "dashboard" | "accounts" | "contacts" | "quotations" | "standard_quotes" | "sales_orders" | "pipeline" | "contract_projects" | "invoices"
  | "cases" | "amc" | "work_orders" | "dispatch" | "technicians"
  | "marketing" | "marketing_segments" | "leads" | "partners"
  | "assets" | "suppliers" | "inventory" | "purchase_orders" | "employees"
  | "reports" | "data_workbench" | "administration" | "wfm" | "products" | "pricing" | "fence_projects" | "rfqs" | "estimates" | "process_studio" | "marketing_newsletters" | "signals" | "marketing_forms" | "abm" | "marketing_journeys" | "marketing_whatsapp" | "marketing_attribution" | "marketing_events" | "inbox" | "crew";

export const WORKCENTERS: { key: WorkcenterKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "inbox", label: "Inbox" },
  { key: "accounts", label: "Accounts" },
  { key: "contacts", label: "Contacts" },
  { key: "quotations", label: "Quotations" },
  { key: "standard_quotes", label: "Standard Quotes" },
  { key: "sales_orders", label: "Sales Orders" },
  { key: "pipeline", label: "Pipeline" },
  { key: "contract_projects", label: "Contract Projects" },
  { key: "invoices", label: "Invoices" },
  { key: "cases", label: "Cases" },
  { key: "amc", label: "AMC Contracts" },
  { key: "work_orders", label: "Work Orders" },
  { key: "dispatch", label: "Dispatch" },
  { key: "technicians", label: "Technicians" },
  { key: "marketing", label: "Email" },
  { key: "marketing_segments", label: "Audiences" },
  { key: "marketing_newsletters", label: "Newsletters" },
  { key: "signals", label: "Buying signals" },
  { key: "marketing_forms", label: "Forms" },
  { key: "abm", label: "ABM programs" },
  { key: "marketing_journeys", label: "Journeys" },
  { key: "marketing_whatsapp", label: "WhatsApp" },
  { key: "marketing_attribution", label: "Results" },
  { key: "marketing_events", label: "Events" },
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
  { key: "fence_projects", label: "Fence Projects" },
  { key: "rfqs", label: "RFQs" },
  { key: "estimates", label: "Estimates" },
  { key: "process_studio", label: "Process Design Studio" },
  { key: "crew", label: "AI automation" },
];

/**
 * Marketing is two parts (docs/design/marketing-two-parts.md). A Business Role grants workcenters one by one, so a part is
 * granted by granting its keys; the role editor groups them under these headings with a shortcut. No new key, no saved grant changes.
 */
export const WORKCENTER_PARTS: { label: string; keys: WorkcenterKey[] }[] = [
  { label: "Marketing", keys: ["marketing", "marketing_segments", "marketing_newsletters", "marketing_journeys", "marketing_forms", "marketing_whatsapp", "marketing_events"] },
  { label: "Intelligence", keys: ["signals", "leads", "abm", "marketing_attribution"] },
];

/** "all" = unrestricted (admins, and members with no Business Role
 * assigned); otherwise the explicit list of workcenters a member's
 * assigned Business Roles grant view access to. Shared client/server type
 * -- kept out of permissions.ts (which is "server-only") so client
 * components (Sidebar, TenantProvider) can import it directly. */
export type ViewableWorkcenters = "all" | WorkcenterKey[];
