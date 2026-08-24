import "server-only";
import { listQuotesForTenant, listAccountsForTenant, listCasesForTenant } from "@/lib/data";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { QueryableField } from "./query";
import type { WorkcenterKey } from "@/lib/workcenters";

// One place that defines, per list object, both its queryable-field
// whitelist and how to load its tenant-scoped, PII-decrypted rows. The v1
// REST routes, POST /api/v1/ask, AND the in-app Report Builder
// (POST /api/reports/ask) all consume this, so the field set a query is
// validated against and the rows it runs over can never drift apart. Every
// load() is tenant-scoped (session data helpers, or an explicit
// .eq("tenant_id", tenantId) on the admin client).

export type ListSource = {
  label: string;              // human name, shown to the NL model
  description: string;        // one-line disambiguator for Report Builder's
                               // routing stage (docs/ai-report-builder-architecture.md §2.2)
                               // -- "quotations" vs "quotes" reads the same to
                               // a model without this
  relatedWorkcenter: WorkcenterKey;  // Report Builder's catalog is filtered to
                                     // canViewWorkcenter() BEFORE the model ever
                                     // sees this object exists
  fields: QueryableField[];
  load: (tenantId: string) => Promise<Record<string, unknown>[]>;
};

const QUOTE_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "total", type: "number" },
  { path: "revision", type: "number" },
  { path: "outcome", type: "string" },
  { path: "loss_reason", type: "string" },
  { path: "created_at", type: "date" },
  { path: "quote_date", type: "date" },
  { path: "valid_until", type: "date" },
  { path: "line_count", type: "number" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
];

const ACCOUNT_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "name", type: "string", searchable: true },
  { path: "type", type: "string" },
  { path: "city", type: "string", searchable: true },
  { path: "phone", type: "string", sensitive: true },
  { path: "email", type: "string", searchable: true, sensitive: true },
  { path: "created_at", type: "date" },
  { path: "referred_by.name", type: "string" },
];

const CASE_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "type", type: "string" },
  { path: "status", type: "string" },
  { path: "equipment_label", type: "string", searchable: true },
  { path: "complaint", type: "string", searchable: true },
  { path: "disposition", type: "string" },
  { path: "has_loaner", type: "boolean" },
  { path: "intake_at", type: "date" },
  { path: "closed_at", type: "date" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
  { path: "technician_name", type: "string" },
];

const INVENTORY_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "sku", type: "string", searchable: true },
  { path: "name", type: "string", searchable: true },
  { path: "description", type: "string", searchable: true },
  { path: "category", type: "string", searchable: true },
  { path: "uom", type: "string" },
  { path: "qty_on_hand", type: "number" },
  { path: "reorder_level", type: "number" },
  { path: "unit_cost", type: "number" },
  { path: "supplier_id", type: "string" },
  { path: "status", type: "string" },
];

const PRODUCT_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "sku", type: "string", searchable: true },
  { path: "name", type: "string", searchable: true },
  { path: "description", type: "string", searchable: true },
  { path: "category", type: "string", searchable: true },
  { path: "sub_category", type: "string", searchable: true },
  { path: "uom", type: "string" },
  { path: "list_price", type: "number" },
  { path: "tax_percent", type: "number" },
  { path: "status", type: "string" },
];

const EMPLOYEE_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "employee_code", type: "string", searchable: true },
  { path: "first_name", type: "string", searchable: true },
  { path: "last_name", type: "string", searchable: true },
  { path: "email", type: "string", searchable: true, sensitive: true },
  { path: "phone", type: "string", sensitive: true },
  { path: "department", type: "string", searchable: true },
  { path: "designation", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "employment_type", type: "string" },
  { path: "wfm_role", type: "string" },
  { path: "valid_from", type: "date" },
  { path: "valid_to", type: "date" },
  { path: "created_at", type: "date" },
];

const INVOICE_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
  { path: "quote_id", type: "string" },
  { path: "work_order_id", type: "string" },
  { path: "due_date", type: "date" },
  { path: "total", type: "number" },
  { path: "paid_amount", type: "number" },
  { path: "issued_at", type: "date" },
];

const PO_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "supplier.id", type: "string" },
  { path: "supplier.name", type: "string", searchable: true },
  { path: "quote_id", type: "string" },
  { path: "case_id", type: "string" },
  { path: "order_date", type: "date" },
  { path: "expected_date", type: "date" },
  { path: "total", type: "number" },
  { path: "created_at", type: "date" },
];

export const LIST_SOURCES: Record<string, ListSource> = {
  quotations: {
    label: "Quotations",
    description: "Price quotes sent to customers -- their status, value, and outcome (won/lost).",
    relatedWorkcenter: "quotations",
    fields: QUOTE_FIELDS,
    load: async (tenantId) => {
      const quotes = await listQuotesForTenant(tenantId);
      return quotes.map(({ quote: q, account, lineCount }) => ({
        id: q.id, ref: q.ref, status: q.status, total: q.total, revision: q.revision,
        outcome: q.outcome, loss_reason: q.loss_reason ?? null,
        created_at: q.created_at, quote_date: q.quote_date ?? null, valid_until: q.valid_until,
        account: account ? { id: account.id, name: account.name } : null,
        line_count: lineCount,
        _links: { self: `/api/v1/quotations/${q.id}`, pdf: `/quotations/${q.id}/print`, account: `/api/v1/accounts/${q.account_id}` },
      }));
    },
  },
  accounts: {
    label: "Accounts",
    description: "Companies and organizations you sell to -- customers, their type, city, and relationships.",
    relatedWorkcenter: "accounts",
    fields: ACCOUNT_FIELDS,
    load: async (tenantId) => {
      const accounts = await listAccountsForTenant(tenantId);
      return accounts.map(({ account, referredBy, counts }) => ({
        id: account.id, name: account.name, type: account.type, city: account.city ?? null,
        phone: account.phone ?? null, email: account.email ?? null,
        referred_by: referredBy ? { id: referredBy.id, name: referredBy.name } : null,
        created_at: account.created_at, counts,
        _links: { self: `/api/v1/accounts/${account.id}` },
      }));
    },
  },
  cases: {
    label: "Service cases",
    description: "Customer service/repair tickets -- equipment complaint, status, disposition, technician.",
    relatedWorkcenter: "cases",
    fields: CASE_FIELDS,
    load: async (tenantId) => {
      const cases = await listCasesForTenant(tenantId);
      return cases.map(({ serviceCase: sc, account, technicianName }) => ({
        id: sc.id, ref: sc.ref, type: sc.type, status: sc.status,
        equipment_label: sc.equipment_label, complaint: sc.complaint, disposition: sc.disposition,
        has_loaner: sc.has_loaner, intake_at: sc.intake_at, closed_at: sc.closed_at,
        account: account ? { id: account.id, name: account.name } : null,
        technician_name: technicianName,
        _links: { self: `/api/v1/cases/${sc.id}`, account: `/api/v1/accounts/${sc.account_id}` },
      }));
    },
  },
  inventory: {
    label: "Inventory items",
    description: "Stocked spare parts/materials you hold -- quantity on hand, reorder level, unit cost.",
    relatedWorkcenter: "inventory",
    fields: INVENTORY_FIELDS,
    load: async (tenantId) => {
      const { data } = await createAdminSupabase().from("inventory_items").select("*").eq("tenant_id", tenantId).order("name");
      return (data ?? []).map((i) => ({
        id: i.id, sku: i.sku, name: i.name, description: i.description, category: i.category,
        uom: i.uom, qty_on_hand: i.qty_on_hand, reorder_level: i.reorder_level, unit_cost: i.unit_cost,
        supplier_id: i.supplier_id, status: i.status, custom_data: i.custom_data,
        _links: { self: `/api/v1/inventory/${i.id}` },
      }));
    },
  },
  products: {
    label: "Products (sellable catalog)",
    description: "The catalog of products/services you sell -- list price, category, tax rate.",
    relatedWorkcenter: "products",
    fields: PRODUCT_FIELDS,
    load: async (tenantId) => {
      // cost_price is INTERNAL (margin data) and deliberately not selected --
      // no API consumer, whatever its scope, receives it.
      const { data } = await createAdminSupabase()
        .from("products")
        .select("id, ref, sku, name, description, category, sub_category, uom, list_price, tax_percent, status, custom_data")
        .eq("tenant_id", tenantId)
        .order("name");
      return (data ?? []).map((p) => ({
        ...p,
        _links: { self: `/api/v1/products/${p.id}` },
      }));
    },
  },
  employees: {
    label: "Employees",
    description: "Your staff/workforce -- department, designation, employment type, status.",
    relatedWorkcenter: "employees",
    fields: EMPLOYEE_FIELDS,
    load: async (tenantId) => {
      const { data } = await createAdminSupabase()
        .from("employees").select("*").eq("tenant_id", tenantId).order("employee_code");
      return (data ?? []).map((e) => ({
        id: e.id, employee_code: e.employee_code,
        first_name: e.first_name, last_name: e.last_name,
        email: e.email, phone: e.phone,
        department: e.department, designation: e.designation,
        status: e.status, employment_type: e.employment_type, wfm_role: e.wfm_role,
        valid_from: e.valid_from, valid_to: e.valid_to, created_at: e.created_at,
        custom_data: e.custom_data,
        _links: { self: `/api/v1/employees/${e.id}` },
      }));
    },
  },
  invoices: {
    label: "Invoices",
    description: "Billed amounts to customers -- issued/due dates, total, amount paid, status.",
    relatedWorkcenter: "invoices",
    fields: INVOICE_FIELDS,
    load: async (tenantId) => {
      const supabase = createAdminSupabase();
      const { data } = await supabase.from("invoices").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      const accountIds = [...new Set((data ?? []).map((inv) => inv.account_id))];
      const { data: accounts } = accountIds.length
        ? await supabase.from("accounts").select("id, name").in("id", accountIds)
        : { data: [] };
      const nameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
      return (data ?? []).map((inv) => ({
        id: inv.id, ref: inv.ref, status: inv.status,
        account: { id: inv.account_id, name: nameById.get(inv.account_id) ?? null },
        quote_id: inv.quote_id, work_order_id: inv.work_order_id, due_date: inv.due_date,
        total: inv.total, paid_amount: inv.paid_amount, issued_at: inv.issued_at,
        _links: { self: `/api/v1/invoices/${inv.id}` },
      }));
    },
  },
  "purchase-orders": {
    label: "Purchase orders",
    description: "Orders placed WITH your suppliers -- what you're buying, status, expected delivery.",
    relatedWorkcenter: "purchase_orders",
    fields: PO_FIELDS,
    load: async (tenantId) => {
      const supabase = createAdminSupabase();
      const { data } = await supabase.from("purchase_orders").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      const supplierIds = [...new Set((data ?? []).map((p) => p.supplier_id))];
      const { data: suppliers } = supplierIds.length
        ? await supabase.from("suppliers").select("id, name").in("id", supplierIds)
        : { data: [] };
      const nameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
      return (data ?? []).map((po) => ({
        id: po.id, ref: po.ref, status: po.status,
        supplier: { id: po.supplier_id, name: nameById.get(po.supplier_id) ?? null },
        quote_id: po.quote_id, case_id: po.case_id, order_date: po.order_date,
        expected_date: po.expected_date, total: po.total, created_at: po.created_at,
        _links: { self: `/api/v1/purchase-orders/${po.id}` },
      }));
    },
  },
};
