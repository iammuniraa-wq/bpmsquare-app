import { NextResponse, type NextRequest } from "next/server";
import { canSeeExpense, loadExpense, loadViewerScope } from "@/lib/site/expensesServer";
import { loadReceipt } from "@/lib/site/receiptsServer";
import { failure, openSiteRequest, signedEvidenceLink } from "@/lib/site/server";

// GET /api/site/files/[id]  -> 307 to a 60-second signed link of one stored photo, signature or PDF of a site expense or receipt, once the caller
//   may see that record: an expense to its author, the project manager and cost approvers; a receipt to any member of a workspace with the module.
//   The file is looked up by id AND workspace, so another workspace's id is a plain 404.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("any");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const link = await signedEvidenceLink(gate.req.admin, gate.req.tenantId, id);
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (link.objectType === "site_expense") {
    if (gate.req.features.site_expenses !== true) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const e = await loadExpense(gate.req.admin, gate.req.tenantId, link.objectId);
    if (!e || e === "pending" || !canSeeExpense(await loadViewerScope(gate.req), e)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } else {
    if (gate.req.features.site_receipts !== true) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const r = await loadReceipt(gate.req.admin, gate.req.tenantId, link.objectId);
    if (!r || r === "pending") return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.redirect(link.url, 307);
}
