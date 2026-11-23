import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { drawingDwGate } from "@/lib/drawings/dw";
import { loadDrawingList } from "@/lib/drawings/list";
import { REVISION_COLS, normaliseRevision } from "@/lib/drawings/server";
import { readAllPages } from "@/lib/pagedRead";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Exports the drawing headers with their real record id (what Update keys off) and the released revision's label. Revisions, files and elements
// are not in this file: they are the register's own, and only a RELEASED revision ever feeds anything else.

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const gate = await assertObjectFeature(tenantId, "drawings");
  if (gate) return gate;
  const g = await drawingDwGate(supabase, tenantId, userId, role, "view");
  if (!g.ok) return g.response;

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };
  const [fieldConfig, salesConfig, list] = await Promise.all([getEffectiveFieldConfig(supabase, tenantId, "drawing"), getSalesConfig(supabase, tenantId), loadDrawingList(g.ctx.admin, tenantId)]);
  if (list.pending) return NextResponse.json({ rows: [] } satisfies ExportResponse);
  const spec = buildObjectSpec("drawings", fieldConfig, salesConfig);

  const { data } = await readAllPages((lo, hi) => g.ctx.admin.from("drawing_revisions").select(REVISION_COLS).eq("tenant_id", tenantId).eq("status", "released").order("id", { ascending: true }).range(lo, hi));
  const releasedLabel = new Map(((data ?? []) as unknown as Record<string, unknown>[]).map(normaliseRevision).map((r) => [r.id, r.rev_label]));

  const rows = list.rows.map((d) => {
    const values = rowToExportValues({ ...d, released_rev: d.current_rev_id ? releasedLabel.get(d.current_rev_id) ?? "" : "" } as unknown as Record<string, unknown>, spec.fields);
    values.id = d.id;
    values.type_name = d.type_name ?? "";
    return values;
  });
  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}
