import { NextResponse, type NextRequest } from "next/server";
import { openPackageRequest } from "@/lib/contractProjects/buyout/server";
import { unawardPackage } from "@/lib/contractProjects/buyout/writes";

// POST /api/contract-projects/[id]/buyout/packages/[pid]/unaward  { reason }
//   Takes the award back (reason required, 422 { code: "reason_required" }): the line awards of the round are superseded in the RFQ module (the history
//   stays) and the package returns to "out" with no supplier or committed amount. Allowed until the handover is marked sent (409 { code: "handed_over" }).
//   -> { row: PackageRow }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid, { write: true, rfq: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const made = await unawardPackage(gate.req, gate.pkg, body as { reason?: unknown });
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ row: made.row });
}
