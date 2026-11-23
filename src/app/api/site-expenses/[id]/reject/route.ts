import { NextResponse, type NextRequest } from "next/server";
import { returnExpense } from "@/lib/site/expensesServer";
import { failure, openSiteRequest } from "@/lib/site/server";

// POST /api/site-expenses/[id]/reject  { reason }   Returns a waiting expense to the person who entered it, with the reason they read. Same
//   authority as approving. The person corrects it and sends it again (PATCH), or cancels it.
type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await returnExpense(gate.req, id, body);
  return NextResponse.json(r.body, { status: r.status });
}
