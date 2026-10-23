import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";

// The machine-facing view of a sales order (v1 API, /api/v1/ask, the report builder and the MCP tools): the header,
// who it is for by id and name, and on the detail endpoint the lines, notes and terms.
//
// DELIBERATELY NOT SELECTED, anywhere on these surfaces:
//   - created_by, owner_user_id: workspace user ids, internal.
//   - cancel_reason: a free-text note a colleague typed to explain a cancellation; it stays in the app and its history.
//   - bill_to / ship_to contact, phone, email, tax id: a person's details. Only the party's name and address are
//     returned, which is what a delivery integration needs; contacts have their own scope ("contacts").
//   - the order type's template and rules: presentation and internal selection logic.
//   - attachments: private files and links of the customer relationship.
// Every select is explicit; the list is pinned by salesOrderRows.test.ts. Add a column here only after asking whether a
// customer, and a key scoped to this object, may see it. Orders carry no cost or margin field at all.

export const SALES_ORDER_LIST_COLUMNS =
  "id, ref, type_id, origin, status, status_label, spine, account_id, contact_id, bill_to, ship_to, customer_po, source_type, source_id, opportunity_id, currency, pricing_mode, subtotal, discount_total, tax_total, shipping_amount, total, requested_date, expected_date, confirmed_at, sent_at, custom_data, created_at, updated_at";
export const SALES_ORDER_DETAIL_EXTRA = "notes, terms";
export const SALES_ORDER_LINE_COLUMNS =
  "id, line_no, product_id, description, printed_text, qty, uom, unit_price, discount_pct, tax_pct, line_total, requested_date, confirmed_qty, confirmed_date, availability_source, availability_at";

type Row = Record<string, unknown>;

const one = (v: unknown): { id?: string; name?: string | null } | null =>
  Array.isArray(v) ? ((v[0] as { id?: string; name?: string | null }) ?? null) : ((v as { id?: string; name?: string | null }) ?? null);

const party = (v: unknown): { name: string; address: string | null } | null => {
  if (!v || typeof v !== "object") return null;
  const p = v as { name?: unknown; address?: unknown };
  return typeof p.name === "string" && p.name ? { name: p.name, address: typeof p.address === "string" ? p.address : null } : null;
};

export function shapeSalesOrderRow(raw: Row, lineCount?: number): Row {
  const acc = one(raw.accounts);
  const typ = one(raw.sales_order_types);
  const id = String(raw.id);
  return {
    id: raw.id,
    ref: raw.ref ?? null,
    type: typ ? { id: typ.id ?? raw.type_id ?? null, name: typ.name ?? null } : (raw.type_id ? { id: raw.type_id, name: null } : null),
    origin: raw.origin,
    status: raw.status,
    status_label: raw.status_label ?? null,
    spine: raw.spine,
    account: acc ? { id: acc.id ?? raw.account_id ?? null, name: acc.name ?? null } : (raw.account_id ? { id: raw.account_id, name: null } : null),
    contact_id: raw.contact_id ?? null,
    bill_to: party(raw.bill_to),
    ship_to: party(raw.ship_to),
    customer_po: raw.customer_po ?? null,
    source_type: raw.source_type,
    source_id: raw.source_id ?? null,
    opportunity_id: raw.opportunity_id ?? null,
    currency: raw.currency,
    pricing_mode: raw.pricing_mode,
    subtotal: raw.subtotal ?? 0,
    discount_total: raw.discount_total ?? 0,
    tax_total: raw.tax_total ?? 0,
    shipping_amount: raw.shipping_amount ?? 0,
    total: raw.total ?? 0,
    requested_date: raw.requested_date ?? null,
    expected_date: raw.expected_date ?? null,
    confirmed_at: raw.confirmed_at ?? null,
    sent_at: raw.sent_at ?? null,
    ...(lineCount !== undefined ? { line_count: lineCount } : {}),
    custom_data: raw.custom_data ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    _links: { self: `/api/v1/sales-orders/${id}`, pdf: `/sales-orders/${id}/print`, ...(raw.account_id ? { account: `/api/v1/accounts/${String(raw.account_id)}` } : {}) },
  };
}

export function shapeSalesOrderLine(raw: Row): Row {
  return {
    id: raw.id,
    line_no: raw.line_no,
    product_id: raw.product_id ?? null,
    description: raw.description,
    printed_text: raw.printed_text ?? null,
    qty: raw.qty,
    uom: raw.uom ?? null,
    unit_price: raw.unit_price,
    discount_pct: raw.discount_pct ?? 0,
    tax_pct: raw.tax_pct ?? 0,
    line_total: raw.line_total,
    requested_date: raw.requested_date ?? null,
    confirmed_qty: raw.confirmed_qty ?? null,
    confirmed_date: raw.confirmed_date ?? null,
    availability_source: raw.availability_source ?? null,
    availability_at: raw.availability_at ?? null,
  };
}

/** Every sales order of a tenant, public shape. A missing table (0212 pending) reads as none -- never an error. */
export async function loadSalesOrdersForApi(tenantId: string): Promise<Row[]> {
  const admin = createAdminSupabase();
  const res = await admin
    .from("sales_orders")
    .select(`${SALES_ORDER_LIST_COLUMNS}, accounts(id, name), sales_order_types(id, name)`)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (res.error) return [];

  const counts = new Map<string, number>();
  const { data: lines } = await admin.from("sales_order_lines").select("order_id").eq("tenant_id", tenantId).limit(50000);
  for (const l of (lines ?? []) as { order_id: string }[]) counts.set(l.order_id, (counts.get(l.order_id) ?? 0) + 1);
  return ((res.data ?? []) as unknown as Row[]).map((r) => shapeSalesOrderRow(r, counts.get(String(r.id)) ?? 0));
}

/** One sales order with its lines and customer-facing text, or null. */
export async function loadSalesOrderForApi(tenantId: string, id: string): Promise<Row | null> {
  const admin = createAdminSupabase();
  const res = await admin
    .from("sales_orders")
    .select(`${SALES_ORDER_LIST_COLUMNS}, ${SALES_ORDER_DETAIL_EXTRA}, accounts(id, name), sales_order_types(id, name)`)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (res.error || !res.data) return null;
  const header = res.data as unknown as Row;
  const lines = await admin.from("sales_order_lines").select(SALES_ORDER_LINE_COLUMNS).eq("order_id", id).eq("tenant_id", tenantId).order("line_no");
  const lineRows = ((lines.data ?? []) as unknown as Row[]).map(shapeSalesOrderLine);
  return { ...shapeSalesOrderRow(header, lineRows.length), notes: header.notes ?? null, terms: header.terms ?? null, lines: lineRows };
}
