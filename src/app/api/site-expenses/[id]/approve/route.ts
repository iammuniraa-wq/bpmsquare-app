import { NextResponse, type NextRequest } from "next/server";
import { approveExpense } from "@/lib/site/expensesServer";
import { failure, openSiteRequest } from "@/lib/site/server";

// POST /api/site-expenses/[id]/approve  { category_id?, line_key?, amount_project_ccy?, wbs_code? }
//   The project manager (within the limit set in Settings) or a cost approver (any amount) approves a waiting expense; nobody approves their own
//   unless the workspace allows self-approval. The approver may assign a "Not sure" cost line, change the category, and must enter the amount in the
//   project currency for a foreign expense. From now on the expense counts as recorded cost on its line. Never writes the line's Actual.
type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await approveExpense(gate.req, id, body);
  return NextResponse.json(r.body, { status: r.status });
}
