import { NextResponse, type NextRequest } from "next/server";
import { cancelReceipt } from "@/lib/site/receiptsServer";
import { failure, openSiteRequest } from "@/lib/site/server";

// POST /api/site-receipts/[id]/cancel  { reason }   The project manager, a cost approver or an admin cancels a confirmed receipt with a reason;
//   the site person then enters the delivery again. Nothing is deleted: the receipt stays, marked cancelled, and counts for nothing.
type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await cancelReceipt(gate.req, id, body);
  return NextResponse.json(r.body, { status: r.status });
}
