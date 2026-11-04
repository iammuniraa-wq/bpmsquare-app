import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { applyFilters } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { boqDwGate } from "@/lib/import/tenderBoqServer";
import { employeeEmails } from "@/lib/import/tenderWbsServer";
import { TENDER_WBS_ITEMS_SPEC } from "@/lib/import/tenderWbsItemsSchema";
import { listTenders } from "@/lib/tender/server";
import { boqApiContext } from "@/lib/tender/boq/apiRows";
import { loadWbsForApi } from "@/lib/tender/wbs/api";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Every WBS item of every tender in the workspace, with its own real id (the Update key) and its tender's Deal ID. The figures come from the
// loader the v1 API uses (client amounts only; a WBS item has no price of its own and the loader never reads a cost), and the owner is the
// employee's email so an Update file can set it back. A workspace whose migration 0243 is pending exports an empty list.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk either.
  const gate = await assertObjectFeature(tenantId, "tender_wbs_items");
  if (gate) return gate;
  const g = await boqDwGate(supabase, tenantId, userId, role, "view");
  if (!g.ok) return g.response;

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };

  const admin = createAdminSupabase();
  const [{ rows: tenders }, deals, ctx, emails] = await Promise.all([
    listTenders(admin, tenantId),
    fetchAllRows<{ id: string; ref: string | null }>(admin, "opportunities", "id, ref", tenantId),
    boqApiContext(admin, tenantId),
    employeeEmails(admin, tenantId),
  ]);
  const refById = new Map(deals.map((d) => [d.id, d.ref]));
  const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

  const rows: Record<string, string>[] = [];
  for (let i = 0; i < tenders.length; i += 10) {
    const loaded = await Promise.all(tenders.slice(i, i + 10).map(async (t) => ({
      t, wbs: await loadWbsForApi(admin, tenantId, t.opportunity_id, { ctx, tender: { ref: refById.get(t.opportunity_id) ?? null, tender_no: t.tender_no } }),
    })));
    for (const { t, wbs } of loaded) {
      for (const item of wbs.items) {
        const owner = wbs.ownerIds.get(item.id);
        rows.push({
          id: item.id,
          tender_ref: s(refById.get(t.opportunity_id)),
          code: item.code,
          name: item.name,
          parent_code: s(item.parent_code),
          owner_email: owner ? s(emails.emailOf.get(owner)) : "",
          note: s(item.note),
          lines: s(item.line_count),
          shared_lines: s(item.shared_count),
          client_amount: s(item.client_amount),
        });
      }
    }
  }

  const typeByKey = new Map(TENDER_WBS_ITEMS_SPEC.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}
