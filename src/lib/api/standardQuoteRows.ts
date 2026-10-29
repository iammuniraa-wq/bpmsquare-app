import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";

import { readAllPages } from "@/lib/pagedRead";
// The machine-facing view of a standard quote (v1 API, /api/v1/ask, the report builder and the
// MCP tools): the header, who it is for by id, and on the detail endpoint the lines.
//
// DELIBERATELY NOT SELECTED, anywhere on these surfaces:
//   - pricing_flags / pricing_document_id (line): the guardrail result holds the real margin
//     against the floor ("Margin 12% is below the 15% floor"), which is internal cost data.
//   - rfq_line_id (line): points at the supplier request behind the line, i.e. what it costs us.
//   - template_id, created_by, print_options: presentation and authorship, not the quote itself.
//   - contact details: only contact_id is returned. A person's name is personal data and has its
//     own scope ("contacts"), exactly as on the other quote endpoints.
// Every select is explicit; the list is pinned by standardQuoteRows.test.ts. Add a column here
// only after asking whether a customer, and a key scoped to this object, may see it.

/** Columns in the list. custom_data (0209) is appended only while the database has it. */
export const STANDARD_QUOTE_LIST_COLUMNS =
  "id, ref, status, inquiry_date, valid_until, sent_at, closed_at, subtotal, header_discount_pct, tax_pct, shipping_amount, total, account_id, contact_id, opportunity_id, created_at, updated_at";

/** The customer-facing text, only on the detail endpoint. */
export const STANDARD_QUOTE_DETAIL_EXTRA = "intro_text, notes, terms";

/** Line columns. The tail columns come from 0114/0116/0118; the base set works on any database. */
export const STANDARD_QUOTE_LINE_COLUMNS =
  "id, sl_no, description, uom, qty, rate, discount_pct, amount, product_id, group_id, group_label, group_type, break_of, break_qty, is_selected, show_on_pdf";
export const STANDARD_QUOTE_LINE_BASE_COLUMNS = "id, sl_no, description, uom, qty, rate, discount_pct, amount";

type Row = Record<string, unknown>;

const one = (v: unknown): { id?: string; name?: string | null } | null =>
  Array.isArray(v) ? ((v[0] as { id?: string; name?: string | null }) ?? null) : ((v as { id?: string; name?: string | null }) ?? null);

/** One PostgREST row -> the public shape. Pure, so the field list is testable. */
export function shapeStandardQuoteRow(raw: Row, lineCount?: number): Row {
  const acc = one(raw.accounts);
  const id = String(raw.id);
  return {
    id: raw.id,
    ref: raw.ref ?? null,
    status: raw.status,
    inquiry_date: raw.inquiry_date ?? null,
    valid_until: raw.valid_until ?? null,
    sent_at: raw.sent_at ?? null,
    closed_at: raw.closed_at ?? null,
    subtotal: raw.subtotal ?? 0,
    header_discount_pct: raw.header_discount_pct ?? 0,
    tax_pct: raw.tax_pct ?? 0,
    shipping_amount: raw.shipping_amount ?? 0,
    total: raw.total ?? 0,
    account: acc ? { id: acc.id ?? raw.account_id ?? null, name: acc.name ?? null } : (raw.account_id ? { id: raw.account_id, name: null } : null),
    contact_id: raw.contact_id ?? null,
    opportunity_id: raw.opportunity_id ?? null,
    ...(lineCount !== undefined ? { line_count: lineCount } : {}),
    custom_data: raw.custom_data ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    _links: { self: `/api/v1/standard-quotes/${id}`, pdf: `/standard-quotes/${id}/print`, ...(raw.account_id ? { account: `/api/v1/accounts/${String(raw.account_id)}` } : {}) },
  };
}

export function shapeStandardQuoteLine(raw: Row): Row {
  return {
    id: raw.id,
    sl_no: raw.sl_no ?? null,
    description: raw.description,
    uom: raw.uom ?? null,
    qty: raw.qty,
    rate: raw.rate,
    discount_pct: raw.discount_pct ?? 0,
    amount: raw.amount,
    product_id: raw.product_id ?? null,
    group_id: raw.group_id ?? null,
    group_label: raw.group_label ?? null,
    group_type: raw.group_type ?? null,
    break_of: raw.break_of ?? null,
    break_qty: raw.break_qty ?? null,
    is_selected: raw.is_selected ?? true,
    show_on_pdf: raw.show_on_pdf ?? true,
  };
}

/**
 * Every standard quote of a tenant, public shape. A pending 0209 (no custom_data column) reads as
 * "no custom values" and a missing table as none -- never an error.
 */
export async function loadStandardQuotesForApi(tenantId: string): Promise<Row[]> {
  const admin = createAdminSupabase();
  const run = (cols: string) =>
    readAllPages((lo, hi) => admin.from("standard_quotes").select(`${cols}, accounts(id, name)`).eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id", { ascending: true }).range(lo, hi));

  let res = await run(`${STANDARD_QUOTE_LIST_COLUMNS}, custom_data`);
  if (res.error) res = await run(STANDARD_QUOTE_LIST_COLUMNS);
  if (res.error) return [];

  const counts = new Map<string, number>();
  const { data: lines } = await readAllPages((lo, hi) => admin.from("standard_quote_lines").select("standard_quote_id").eq("tenant_id", tenantId).order("id", { ascending: true }).range(lo, hi));
  for (const l of (lines ?? []) as { standard_quote_id: string }[]) counts.set(l.standard_quote_id, (counts.get(l.standard_quote_id) ?? 0) + 1);

  return ((res.data ?? []) as unknown as Row[]).map((r) => shapeStandardQuoteRow(r, counts.get(String(r.id)) ?? 0));
}

/** One standard quote with its lines and customer-facing text, or null. */
export async function loadStandardQuoteForApi(tenantId: string, id: string): Promise<Row | null> {
  const admin = createAdminSupabase();
  const run = (cols: string) =>
    admin.from("standard_quotes").select(`${cols}, accounts(id, name)`).eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const base = `${STANDARD_QUOTE_LIST_COLUMNS}, ${STANDARD_QUOTE_DETAIL_EXTRA}`;
  let res = await run(`${base}, custom_data`);
  if (res.error) res = await run(base);
  if (res.error || !res.data) return null;
  const header = res.data as unknown as Row;

  const runLines = (cols: string) =>
    admin.from("standard_quote_lines").select(cols).eq("standard_quote_id", id).eq("tenant_id", tenantId).order("sl_no");
  let lines = await runLines(STANDARD_QUOTE_LINE_COLUMNS);
  if (lines.error) lines = await runLines(STANDARD_QUOTE_LINE_BASE_COLUMNS);
  const lineRows = ((lines.data ?? []) as unknown as Row[]).map(shapeStandardQuoteLine);

  return {
    ...shapeStandardQuoteRow(header, lineRows.length),
    intro_text: header.intro_text ?? null,
    notes: header.notes ?? null,
    terms: header.terms ?? null,
    lines: lineRows,
  };
}
