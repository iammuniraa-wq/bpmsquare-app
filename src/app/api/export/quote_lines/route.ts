import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { tenantHasFeature } from "@/lib/tenant";
import { applyFilters } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { QUOTE_LINES_SPEC } from "@/lib/import/quoteLinesSchema";
import type { QuoteLine } from "@/lib/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "quote_lines");
  if (gate) return gate;
  if (!(await tenantHasFeature(supabase, tenantId, "quote_lines_dw"))) {
    return NextResponse.json({ error: "Quote Lines isn't enabled for your workspace" }, { status: 403 });
  }

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [lines, quotes] = await Promise.all([
    fetchAllRows<QuoteLine>(supabase, "quote_lines", "*", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "quotes", "id, ref", tenantId),
  ]);
  const quoteRefById = new Map(quotes.map((q) => [q.id, q.ref]));

  const rows: Record<string, string>[] = lines.map((l) => ({
    id: l.id,
    quote_ref: quoteRefById.get(l.quote_id) ?? "",
    sl_no: l.sl_no ?? "",
    description: l.description ?? "",
    uom: l.uom ?? "",
    qty: l.qty != null ? String(l.qty) : "",
    rate: l.rate != null ? String(l.rate) : "",
    discount_pct: l.discount_pct != null ? String(l.discount_pct) : "",
    amount: l.amount != null ? String(l.amount) : "",
    category: l.category ?? "",
    deduction: l.deduction != null ? String(l.deduction) : "",
    group: l.group_label ?? "",
  }));

  const typeByKey = new Map(QUOTE_LINES_SPEC.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}
