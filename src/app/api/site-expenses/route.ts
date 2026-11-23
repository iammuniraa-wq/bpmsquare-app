import { NextResponse, type NextRequest } from "next/server";
import { createExpense, listExpenses, loadViewerScope } from "@/lib/site/expensesServer";
import { failure, needsUpdate, openSiteRequest } from "@/lib/site/server";

// GET  /api/site-expenses[?project_id=&status=&mine=1]  -> { rows } the expenses this person may see: all of them for a cost approver or admin,
//      their own and those of the projects they manage for anyone else. No budget figure is ever in a row.
// POST /api/site-expenses   multipart { payload: JSON, photos[] } or JSON  -> 201 { expense } (200 + duplicate_request when the same client_id
//      was sent before). Needs the Site expenses module; the phone's offline queue sends the same request later, so it is idempotent.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const scope = await loadViewerScope(gate.req);
  const q = request.nextUrl.searchParams;
  const { rows, pending } = await listExpenses(gate.req, scope, { projectId: q.get("project_id"), status: q.get("status"), mine: q.get("mine") === "1" });
  if (pending) return failure(needsUpdate("site_expenses"));
  return NextResponse.json({ rows });
}

export async function POST(request: NextRequest) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const r = await createExpense(gate.req, request);
  return NextResponse.json(r.body, { status: r.status });
}
