import { NextResponse, type NextRequest } from "next/server";
import { openPackageRequest } from "@/lib/contractProjects/buyout/server";
import { buildHandover, markHandoverSent } from "@/lib/contractProjects/buyout/writes";

// GET  /api/contract-projects/[id]/buyout/packages/[pid]/handover
//        The Excel handover of an AWARDED package: the supplier, the lines with quantities, the awarded rates, the cost codes, the project and the round it
//        was awarded on. No budget, no bid cost and no markup. INTERNAL: an authenticated download, never a public or signed link. 409 before the award.
// POST /api/contract-projects/[id]/buyout/packages/[pid]/handover  { action: "mark_sent", erp_ref? }
//        Records that the handover went to the ERP team (date, who, the ERP's own reference). From then on the award cannot be undone. -> { row: PackageRow }

type Ctx = { params: Promise<{ id: string; pid: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid);
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const made = await buildHandover(gate.req, gate.pkg);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return new NextResponse(new Uint8Array(made.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${made.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid, { write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || (body as { action?: unknown }).action !== "mark_sent") {
    return NextResponse.json({ error: 'action must be "mark_sent"' }, { status: 422 });
  }
  const made = await markHandoverSent(gate.req, gate.pkg, body as { erp_ref?: unknown });
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ row: made.row });
}
