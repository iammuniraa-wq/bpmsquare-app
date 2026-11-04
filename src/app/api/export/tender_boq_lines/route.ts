import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { applyFilters } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { boqDwGate } from "@/lib/import/tenderBoqServer";
import { TENDER_BOQ_LINES_SPEC } from "@/lib/import/tenderBoqLinesSchema";
import { listTenders } from "@/lib/tender/server";
import { boqApiContext, loadBoqRowsForApi } from "@/lib/tender/boq/apiRows";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Every line of every tender's Bill of quantities in the workspace, with its own real id (the Update key) and its tender's Deal ID.
// The rows come from the loader the v1 API uses, which never reads the unit cost, the markup or the price reference (it names the supplier): an export is an Excel
// that gets attached and forwarded like the priced workbook, so cost and margin are not columns of it.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk either.
  const gate = await assertObjectFeature(tenantId, "tender_boq_lines");
  if (gate) return gate;
  const g = await boqDwGate(supabase, tenantId, userId, role, "view");
  if (!g.ok) return g.response;

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };

  const admin = createAdminSupabase();
  const [{ rows: tenders }, deals, ctx] = await Promise.all([
    listTenders(admin, tenantId),
    fetchAllRows<{ id: string; ref: string | null }>(admin, "opportunities", "id, ref", tenantId),
    boqApiContext(admin, tenantId),
  ]);
  const refById = new Map(deals.map((d) => [d.id, d.ref]));
  const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

  const rows: Record<string, string>[] = [];
  for (let i = 0; i < tenders.length; i += 10) {
    const loaded = await Promise.all(tenders.slice(i, i + 10).map((t) => loadBoqRowsForApi(admin, tenantId, t.opportunity_id, { ctx, tender: { ref: refById.get(t.opportunity_id) ?? null, tender_no: t.tender_no } })));
    for (const { rows: lines } of loaded) {
      for (const l of lines) {
        rows.push({
          id: s(l.id),
          tender_ref: s(l.tender_ref),
          item_no: s(l.item_no),
          description: s(l.description),
          details: s(l.details),
          unit: s(l.unit),
          quantity: s(l.quantity),
          cost_code: s(l.cost_code),
          wbs_code: s(l.wbs_code),
          client_columns: l.client_columns && typeof l.client_columns === "object" ? JSON.stringify(l.client_columns) : "",
          rate: s(l.rate),
          amount: s(l.amount),
          rate_source: s(l.rate_source),
          price_as_of: s(l.price_as_of),
          status: s(l.status),
          row_no: s(l.row_no),
        });
      }
    }
  }

  const typeByKey = new Map(TENDER_BOQ_LINES_SPEC.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}
