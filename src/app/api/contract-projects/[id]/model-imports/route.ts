import { NextResponse, type NextRequest } from "next/server";
import { openAllocation } from "@/lib/contractProjects/allocationServer";
import { MASTER_IMPORT_LIMITS } from "@/lib/contractProjects/masters";
import { readMasterFile } from "@/lib/contractProjects/mastersFile";
import { gridToBatchRows } from "@/lib/elements/batchFile";
import { createImport, listImports } from "@/lib/elements/modelServer";
import { failed, readBody, NOT_FOUND } from "@/lib/elements/respond";
import { buildingsOn } from "@/lib/elements/server";
import { ELEMENT_LIMITS } from "@/lib/elements/types";

// The model comparisons of a contract project (migration 0254; docs/design/pcbs-buildings-elements.md section 2.4).
// GET   the comparisons, newest first: number (M-3), source, model reference, when it arrived, its state and row count.
// POST  a new comparison. Either JSON in the connector's batch shape
//         { source?: "file" | "connector" | "hand", model_ref?, received_at?, rows: [{ building_code?, building_name?, element_type, element_code?, qty, unit?, drawing_no?, drawing_rev? }] }
//       or a multipart form with `file` (.csv or .xlsx, header row with Element type or Element code and Quantity) and an optional `model_ref`.
//       It is stored and matched; NOTHING is written to the budget until rows are ticked and applied. 201 { id, import_no, rows }.
// Behind contract_projects (edit for a write); a project of another workspace is a 404.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, false);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();
  const out = await listImports(open);
  if (!out.ok) return failed(out);
  return NextResponse.json({ imports: out.imports });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();

  let batch: Record<string, unknown> | null;
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: "Send the file as a form upload" }, { status: 400 }); }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    if (file.size > MASTER_IMPORT_LIMITS.maxBytes) return NextResponse.json({ error: "That file is larger than 5 MB" }, { status: 413 });
    const read = await readMasterFile(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!read.ok) return NextResponse.json({ error: read.error }, { status: 422 });
    const grid = gridToBatchRows(read.grid, ELEMENT_LIMITS.maxModelRows);
    if (!grid.ok) return NextResponse.json({ error: grid.error }, { status: 422 });
    const ref = form.get("model_ref");
    batch = { source: "file", model_ref: typeof ref === "string" && ref.trim() ? ref.trim() : file.name.slice(0, 200), rows: grid.rows };
  } else {
    batch = await readBody(request);
    if (!batch) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const made = await createImport(open, batch);
  if (!made.ok) return failed(made);
  return NextResponse.json({ id: made.id, import_no: made.import_no, rows: made.rows }, { status: 201 });
}
