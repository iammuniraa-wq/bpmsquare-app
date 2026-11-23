import { NextResponse, type NextRequest } from "next/server";
import { cancelExpense } from "@/lib/site/expensesServer";
import { failure, openSiteRequest } from "@/lib/site/server";

// POST /api/site-expenses/[id]/cancel  { reason? }   The person who entered it cancels it while it waits or is returned; a decider cancels one
//   until the ERP has it, with a reason. Nothing is deleted: the row stays, marked cancelled, and counts for nothing.
type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await cancelExpense(gate.req, id, body);
  return NextResponse.json(r.body, { status: r.status });
}
