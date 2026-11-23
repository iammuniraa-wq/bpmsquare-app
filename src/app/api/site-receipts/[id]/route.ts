import { NextResponse, type NextRequest } from "next/server";
import { loadReceipt, patchReceipt } from "@/lib/site/receiptsServer";
import { loadViewerScope, isDeciderOn } from "@/lib/site/expensesServer";
import { anyProject, failure, loadActorNames, loadFiles, needsUpdate, openSiteRequest } from "@/lib/site/server";

// GET   /api/site-receipts/[id]  -> { receipt, lines, files, project, received_by_name, can_cancel }
// PATCH /api/site-receipts/[id]  { custom_data }  custom fields (cf_ keys) only; a confirmed receipt's count, photos and time are never edited.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const found = await loadReceipt(gate.req.admin, gate.req.tenantId, id);
  if (found === "pending") return failure(needsUpdate("site_receipts"));
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [files, project, names, scope] = await Promise.all([
    loadFiles(gate.req.admin, gate.req.tenantId, "site_receipt", id), anyProject(gate.req.admin, gate.req.tenantId, found.receipt.project_id),
    loadActorNames(gate.req.admin, gate.req.tenantId, [found.receipt.received_by]), loadViewerScope(gate.req),
  ]);
  return NextResponse.json({
    receipt: found.receipt, lines: found.lines, files, project: project ? { id: project.id, ref: project.ref, name: project.name } : null,
    received_by_name: names.get(found.receipt.received_by) ?? null, can_cancel: found.receipt.status === "confirmed" && isDeciderOn(scope, found.receipt.project_id),
  });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await patchReceipt(gate.req, id, body);
  return NextResponse.json(r.body, { status: r.status });
}
