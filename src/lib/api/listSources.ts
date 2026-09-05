import "server-only";
import { listQuotesForTenant, listAccountsForTenant, listCasesForTenant } from "@/lib/data";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { QueryableField } from "./query";
import type { WorkcenterKey } from "@/lib/workcenters";
import { PROJECT_HOURS_FIELDS, loadProjectHoursRows } from "@/lib/wfm/projectHoursRows";

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
  // Quote-to-cash link, denormalized from this quote's own invoices at load
  // time -- makes cross-object questions ("won quotes not yet invoiced",
  // "quoted vs collected") single-object queries, which is the only kind
  // this engine runs (no join surface = no join injection surface).
  { path: "invoice_count", type: "number" },
  { path: "invoiced_total", type: "number" },
  { path: "paid_total", type: "number" },
  { path: "balance_due", type: "number" },
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

const PROJECT_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "name", type: "string", searchable: true },
  { path: "code", type: "string", searchable: true },
  { path: "level", type: "number" },
  { path: "parent_id", type: "string" },
  { path: "account_id", type: "string" },
  { path: "status", type: "string" },
  { path: "start_date", type: "string" },
  { path: "end_date", type: "string" },
  { path: "budget_hours", type: "number" },
  { path: "bill_rate", type: "number" },
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

// Contact phone/email are encrypted at rest (bpmsquarecore §7) -- they are
// not selected at all here (ciphertext is useless to query and must never
// leak), so the field list simply doesn't include them.
const CONTACT_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "name", type: "string", searchable: true },
  { path: "role", type: "string", searchable: true },
  { path: "department", type: "string", searchable: true },
  { path: "city", type: "string", searchable: true },
  { path: "state", type: "string" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
];

const ASSET_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "name", type: "string", searchable: true },
  { path: "kind", type: "string" },
  { path: "make", type: "string", searchable: true },
  { path: "model", type: "string", searchable: true },
  { path: "rating", type: "string" },
  { path: "serial", type: "string", searchable: true },
  { path: "is_loaner", type: "boolean" },
  { path: "loaner_status", type: "string" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
];

const SUPPLIER_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "name", type: "string", searchable: true },
  { path: "type", type: "string" },
  { path: "city", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "phone", type: "string", sensitive: true },
  { path: "email", type: "string", sensitive: true },
  { path: "created_at", type: "date" },
];

const WORK_ORDER_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "auth_kind", type: "string" },
  { path: "scheduled_for", type: "date" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
  { path: "asset_name", type: "string", searchable: true },
  { path: "technician_name", type: "string", searchable: true },
  { path: "case_ref", type: "string" },
];

const LEAD_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "title", type: "string", searchable: true },
  { path: "source", type: "string" },
  { path: "status", type: "string" },
  { path: "created_at", type: "date" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
];

export const LIST_SOURCES: Record<string, ListSource> = {
  quotations: {
    label: "Quotations",
    description: "Price quotes sent to customers -- status, value, outcome (won/lost), AND each quote's cash link: how much of it has been invoiced and paid (invoiced_total, paid_total, balance_due), so quote-to-cash questions are answerable here directly.",
    relatedWorkcenter: "quotations",
    fields: QUOTE_FIELDS,
    load: async (tenantId) => {
      const [quotes, { data: invoices }] = await Promise.all([
        listQuotesForTenant(tenantId),
        createAdminSupabase()
          .from("invoices")
          .select("quote_id, total, paid_amount, status")
          .eq("tenant_id", tenantId)
          .not("quote_id", "is", null)
          .neq("status", "cancelled"),
      ]);
      const cash = new Map<string, { count: number; invoiced: number; paid: number }>();
      for (const inv of invoices ?? []) {
        const c = cash.get(inv.quote_id) ?? { count: 0, invoiced: 0, paid: 0 };
        c.count += 1;
        c.invoiced += Number(inv.total ?? 0);
        c.paid += Number(inv.paid_amount ?? 0);
        cash.set(inv.quote_id, c);
      }
      return quotes.map(({ quote: q, account, lineCount }) => {
        const c = cash.get(q.id) ?? { count: 0, invoiced: 0, paid: 0 };
        return {
          id: q.id, ref: q.ref, status: q.status, total: q.total, revision: q.revision,
          outcome: q.outcome, loss_reason: q.loss_reason ?? null,
          created_at: q.created_at, quote_date: q.quote_date ?? null, valid_until: q.valid_until,
          account: account ? { id: account.id, name: account.name } : null,
          line_count: lineCount,
          invoice_count: c.count, invoiced_total: c.invoiced, paid_total: c.paid,
          balance_due: c.invoiced - c.paid,
          _links: { self: `/api/v1/quotations/${q.id}`, pdf: `/quotations/${q.id}/print`, account: `/api/v1/accounts/${q.account_id}` },
        };
      });
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
  projects: {
    label: "Projects (workforce, project costing)",
    description: "What worked hours are attributed to. Sub-projects are rows too: level 0 is a project, 1-3 sit beneath it via parent_id. Hours for a period: /api/v1/projects/:id/hours.",
    relatedWorkcenter: "wfm",
    fields: PROJECT_FIELDS,
    load: async (tenantId) => {
      const { data } = await createAdminSupabase()
        .from("wfm_projects")
        .select("id, ref, name, code, parent_id, account_id, status, start_date, end_date, budget_hours, bill_rate, custom_data, created_at, updated_at")
        .eq("tenant_id", tenantId)
        .order("ref");
      const rows = data ?? [];
      // Level is depth in the tree, derived here so the API never has to be
      // told what a stored column would have to be kept in step with.
      const parentOf = new Map(rows.map((p) => [p.id as string, (p.parent_id as string | null) ?? null]));
      const level = (id: string) => {
        let d = 0, cur = parentOf.get(id) ?? null;
        const seen = new Set<string>([id]);
        while (cur && !seen.has(cur)) { seen.add(cur); d++; cur = parentOf.get(cur) ?? null; }
        return d;
      };
      return rows.map((p) => ({
        ...p,
        level: level(p.id as string),
        _links: {
          self: `/api/v1/projects/${p.id}`,
          hours: `/api/v1/projects/${p.id}/hours?from=YYYY-MM-DD&to=YYYY-MM-DD`,
        },
      }));
    },
  },
  project_hours: {
    label: "Project hours (workforce, project costing)",
    description: "Worked hours attributed to projects, ONE ROW PER WORK SESSION over the last 12 months: date, project (and its top-level project, level, account), the person, minutes/hours, the bill rate that applies and the billable amount, whether it has been invoiced, and whether it was assigned to a project at all (project.name is \"Unassigned\" when not). Use for: hours by project/account/person/month, billable value, unbilled or unassigned hours, who worked on what.",
    relatedWorkcenter: "wfm",
    fields: PROJECT_HOURS_FIELDS,
    load: loadProjectHoursRows,
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
  contacts: {
    label: "Contacts",
    description: "People at customer accounts -- name, role, department, which account they belong to. (Phone/email are encrypted and not queryable.)",
    relatedWorkcenter: "contacts",
    fields: CONTACT_FIELDS,
    load: async (tenantId) => {
      const supabase = createAdminSupabase();
      const [{ data: contacts }, { data: accounts }] = await Promise.all([
        supabase.from("contacts").select("id, ref, name, role, department, city, state, account_id").eq("tenant_id", tenantId).order("name"),
        supabase.from("accounts").select("id, name").eq("tenant_id", tenantId),
      ]);
      const nameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
      return (contacts ?? []).map((ct) => ({
        id: ct.id, ref: ct.ref ?? null, name: ct.name, role: ct.role, department: ct.department,
        city: ct.city, state: ct.state,
        account: { id: ct.account_id, name: nameById.get(ct.account_id) ?? null },
        _links: { self: `/contacts/${ct.id}` },
      }));
    },
  },
  assets: {
    label: "Assets (customer equipment)",
    description: "Motors, transformers, pumps, panels -- customer-owned equipment under service, plus company loaner stock. Make, model, rating, owning account.",
    relatedWorkcenter: "assets",
    fields: ASSET_FIELDS,
    load: async (tenantId) => {
      const supabase = createAdminSupabase();
      const [{ data: assets }, { data: accounts }] = await Promise.all([
        supabase.from("assets").select("id, ref, name, kind, make, model, rating, serial, is_loaner, loaner_status, account_id").eq("tenant_id", tenantId).order("name"),
        supabase.from("accounts").select("id, name").eq("tenant_id", tenantId),
      ]);
      const nameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
      return (assets ?? []).map((a) => ({
        id: a.id, ref: a.ref ?? null, name: a.name, kind: a.kind, make: a.make, model: a.model,
        rating: a.rating, serial: a.serial, is_loaner: a.is_loaner, loaner_status: a.loaner_status,
        account: a.account_id ? { id: a.account_id, name: nameById.get(a.account_id) ?? null } : null,
        _links: { self: `/assets/${a.id}` },
      }));
    },
  },
  suppliers: {
    label: "Suppliers",
    description: "Vendors and subcontractors you buy from -- type, city, active/inactive.",
    relatedWorkcenter: "suppliers",
    fields: SUPPLIER_FIELDS,
    load: async (tenantId) => {
      const { data } = await createAdminSupabase()
        .from("suppliers")
        .select("id, ref, name, type, city, status, phone, email, created_at")
        .eq("tenant_id", tenantId)
        .order("name");
      return (data ?? []).map((s) => ({
        id: s.id, ref: s.ref ?? null, name: s.name, type: s.type, city: s.city,
        status: s.status, phone: s.phone, email: s.email, created_at: s.created_at,
        _links: { self: `/suppliers/${s.id}` },
      }));
    },
  },
  "work-orders": {
    label: "Work orders",
    description: "Field/workshop jobs -- status, schedule date, technician, account, the asset being worked on.",
    relatedWorkcenter: "work_orders",
    fields: WORK_ORDER_FIELDS,
    load: async (tenantId) => {
      const { data } = await createAdminSupabase()
        .from("work_orders")
        .select("id, ref, status, auth_kind, scheduled_for, accounts(id, name), assets(name), technicians(name), service_cases(ref)")
        .eq("tenant_id", tenantId)
        .order("scheduled_for", { ascending: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((w: any) => {
        const acc = Array.isArray(w.accounts) ? w.accounts[0] : w.accounts;
        const asset = Array.isArray(w.assets) ? w.assets[0] : w.assets;
        const tech = Array.isArray(w.technicians) ? w.technicians[0] : w.technicians;
        const sc = Array.isArray(w.service_cases) ? w.service_cases[0] : w.service_cases;
        return {
          id: w.id, ref: w.ref, status: w.status, auth_kind: w.auth_kind ?? "quote",
          scheduled_for: w.scheduled_for,
          account: acc ? { id: acc.id, name: acc.name } : null,
          asset_name: asset?.name ?? null,
          technician_name: tech?.name ?? null,
          case_ref: sc?.ref ?? null,
          _links: { self: `/work-orders/${w.id}` },
        };
      });
    },
  },
  leads: {
    label: "Leads",
    description: "Sales leads in the marketing funnel -- source (referral/AMC/direct/campaign), status, which account.",
    relatedWorkcenter: "leads",
    fields: LEAD_FIELDS,
    load: async (tenantId) => {
      const supabase = createAdminSupabase();
      const [{ data: leads }, { data: accounts }] = await Promise.all([
        supabase.from("leads").select("id, title, source, status, created_at, account_id").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
        supabase.from("accounts").select("id, name").eq("tenant_id", tenantId),
      ]);
      const nameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
      return (leads ?? []).map((l) => ({
        id: l.id, title: l.title, source: l.source, status: l.status, created_at: l.created_at,
        account: { id: l.account_id, name: nameById.get(l.account_id) ?? null },
        _links: { self: `/leads` },
      }));
    },
  },
};
