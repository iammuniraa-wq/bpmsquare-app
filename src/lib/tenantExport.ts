// Every tenant-scoped business table, in FK-safe order (referenced tables
// before their referrers) -- shared by the platform-admin export and import
// routes so a tenant data file always round-trips completely. Deliberately
// excludes auth-coupled tables (tenant_users, platform_admins): user ids
// don't exist across environments, and the import target already has its
// own memberships. Also deliberately excludes tenant_connectors: unlike
// business records, a connector credential is a LIVE key to an external
// system (a real Slack webhook, eventually a real ERP token) -- cloning it
// into another environment would let that environment's test traffic hit
// production infrastructure, which is a materially different risk than
// cloning a quote or an account.
export const TENANT_TABLES = [
  "accounts", "contacts", "sites", "technicians", "suppliers",
  "assets", "contracts", "pricing_items", "text_fragments",
  "custom_fields", "field_overrides", "field_rules", "email_templates", "page_layouts",
  "marketing_campaigns", "marketing_target_groups",
  "quotes", "quote_lines", "quote_revisions",
  "service_cases", "work_orders", "invoices", "invoice_lines", "invoice_payments",
  "visit_logs", "activities", "case_photos", "inspection_reports",
  "technician_leaves",
  "inventory_items", "inventory_transactions", "purchase_orders", "purchase_order_lines",
  "leads", "marketing_campaign_recipients",
] as const;
