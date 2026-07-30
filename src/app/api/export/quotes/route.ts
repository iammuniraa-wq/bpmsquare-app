import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { Quote, QuoteLine } from "@/lib/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

/**
 * Same row shape the quote IMPORT consumes: one row per line item, header
 * values repeated on every row of the same quote (import only reads the
 * first row's header; repeating keeps filters and Update mode working on
 * every row instead of just the first). A quote with no lines exports as a
 * single header-only row.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, quotes, lines, accounts, contacts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "quote"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Quote>(supabase, "quotes", "*", tenantId),
    fetchAllRows<QuoteLine>(supabase, "quote_lines", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "contacts", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("quotes", fieldConfig, salesConfig);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]));

  const linesByQuote = new Map<string, QuoteLine[]>();
  for (const line of lines) {
    const list = linesByQuote.get(line.quote_id);
    if (list) list.push(line); else linesByQuote.set(line.quote_id, [line]);
  }

  const rows: Record<string, string>[] = [];
  for (const quote of quotes) {
    const header = rowToExportValues(quote as unknown as Record<string, unknown>, spec.fields);
    header.id = quote.id;
    // quote_name is the import's grouping key -- fall back to ref so an
    // unnamed quote still round-trips as its own group.
    header.quote_name = quote.name || quote.ref;
    header.account_name = accountNameById.get(quote.account_id) ?? "";
    header.contact_name = quote.contact_id ? contactNameById.get(quote.contact_id) ?? "" : "";

    const quoteLines = linesByQuote.get(quote.id) ?? [];
    if (quoteLines.length === 0) {
      rows.push(header);
      continue;
    }
    for (const line of quoteLines) {
      rows.push({
        ...header,
        line_description: line.description ?? "",
        line_uom: line.uom ?? "",
        line_qty: line.qty != null ? String(line.qty) : "",
        line_rate: line.rate != null ? String(line.rate) : "",
        line_discount_pct: line.discount_pct != null ? String(line.discount_pct) : "",
      });
    }
  }

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}
