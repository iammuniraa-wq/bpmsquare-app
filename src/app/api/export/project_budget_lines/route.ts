import { NextResponse, type NextRequest } from "next/server";
import { applyFilters } from "@/lib/import/exportServer";
import { exportProjectLines, projectDwGate } from "@/lib/import/projectElementsServer";
import { PROJECT_BUDGET_LINES_SPEC } from "@/lib/import/projectElementsSchema";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Every budget line of every contract project of the workspace (the open draft revision, else the approved one), with its own real id (the Update key),
// its building, element type and code, the client's and the model's quantity and what the budget uses. Cost, unit cost, amount and margin are not on any
// column. A workspace without the Contract projects module and the Buildings add-on gets a 404.
export async function POST(request: NextRequest) {
  const gate = await projectDwGate("project_budget_lines", false);
  if (!gate.ok) return gate.response;
  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };
  const rows = await exportProjectLines(gate.req);
  const typeByKey = new Map(PROJECT_BUDGET_LINES_SPEC.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}
