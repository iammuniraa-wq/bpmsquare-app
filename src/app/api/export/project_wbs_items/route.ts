import { NextResponse, type NextRequest } from "next/server";
import { applyFilters } from "@/lib/import/exportServer";
import { projectDwGate, projectsByRef } from "@/lib/import/projectElementsServer";
import { PROJECT_WBS_ITEMS_SPEC } from "@/lib/import/projectElementsSchema";
import { loadPackages } from "@/lib/contractProjects/workPackagesServer";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Every WBS item (building, activity, cost element) of every contract project of the workspace, with its own real id (the Update key) and its project's
// reference. A workspace whose migration 0243 or 0253 is pending exports what it has (no building codes).
export async function POST(request: NextRequest) {
  const gate = await projectDwGate("project_wbs_items", false);
  if (!gate.ok) return gate.response;
  const { admin, tenantId } = gate.req;
  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };
  const projects = await projectsByRef(admin, tenantId);
  const rows: Record<string, string>[] = [];
  for (const [projectId, ref] of projects.refOf) {
    const have = await loadPackages(admin, tenantId, projectId);
    if (have.pending) continue;
    const codeById = new Map(have.packages.map((p) => [p.id, p.code]));
    for (const p of have.packages) {
      rows.push({
        id: p.id, project_ref: ref ?? "", code: p.code, name: p.name, parent_code: p.parent_id ? codeById.get(p.parent_id) ?? "" : "",
        building_code: p.building_code ?? "", note: p.note ?? "", lines: String(p.line_keys.length + (p.line_parts ?? []).length),
      });
    }
  }
  const typeByKey = new Map(PROJECT_WBS_ITEMS_SPEC.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}
